import { z } from 'zod';
import { transaction } from '../db/index.js';
import * as boqModel from '../models/boq.model.js';
import * as packageModel from '../models/package.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { assertVisible as assertPackageVisible } from './package.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { fromQty, lineAmount, toRupees } from '../utils/money.js';
import { quantity, rupees } from '../middleware/validate.js';

/**
 * The agreement bill of quantities.
 *
 * Once a package carries a BOQ, every running account bill is measured against
 * it: an item is chosen from the agreement rather than typed, the rate comes
 * from the agreement rather than from whoever is filling in the form, and the
 * quantity already billed is carried on the line so the same work cannot be
 * measured twice.
 */

export const boqItemSchema = z.object({
  itemCode: z.string().trim().max(40).optional(),
  description: z.string().trim().min(2, 'Describe the item of work.').max(500),
  uom: z.string().trim().min(1, 'Enter the unit.').max(20),
  quantity: quantity,
  agreedRate: rupees,
  srItemId: z.coerce.number().int().positive().optional().nullable(),
  srRate: rupees.optional(),
  remarks: z.string().trim().max(300).optional(),
});

export const replaceBoqSchema = z.object({
  items: z.array(boqItemSchema).max(500),
});

export function present(row: boqModel.BoqItemRow) {
  const balanceQuantity = row.quantity - row.billed_quantity;
  // A negative or zero SR rate simply means the item was never matched to the
  // Schedule of Rates, so there is nothing to compare against.
  const hasSr = row.sr_rate > 0;

  return {
    id: row.id,
    slNo: row.sl_no,
    itemCode: row.item_code,
    description: row.description,
    uom: row.uom,
    quantity: fromQty(row.quantity),
    agreedRate: toRupees(row.agreed_rate),
    amount: toRupees(row.amount),
    sr: hasSr
      ? {
          id: row.sr_item_id,
          code: row.sr_code,
          name: row.sr_name,
          rate: toRupees(row.sr_rate),
          /** How far the agreed rate sits above or below the Schedule of Rates. */
          variancePercent:
            Math.round(((row.agreed_rate - row.sr_rate) / row.sr_rate) * 10_000) / 100,
          varianceAmount: toRupees(
            lineAmount(row.quantity, row.agreed_rate) - lineAmount(row.quantity, row.sr_rate),
          ),
        }
      : null,
    billedQuantity: fromQty(row.billed_quantity),
    billedAmount: toRupees(row.billed_amount),
    balanceQuantity: fromQty(balanceQuantity),
    /** What proportion of the line has been measured, for the progress bar. */
    billedPercent:
      row.quantity > 0 ? Math.round((row.billed_quantity / row.quantity) * 1000) / 10 : 0,
    isFullyBilled: row.quantity > 0 && balanceQuantity <= 0,
    remarks: row.remarks,
  };
}

export function listForPackage(packageId: number, user: AuthUser) {
  const pkg = packageModel.findById(packageId);
  if (!pkg) throw notFound('Package');
  assertPackageVisible(pkg, user);

  const items = boqModel.listByPackage(packageId).map(present);
  const totals = boqModel.packageTotals(packageId);

  return {
    packageId,
    items,
    totals: {
      itemCount: totals.itemCount,
      boqValue: toRupees(totals.boqValue),
      srValue: toRupees(totals.srValue),
      billedValue: toRupees(totals.billedValue),
      balanceValue: toRupees(totals.boqValue - totals.billedValue),
      /** The agreement read against the Schedule of Rates, in one number. */
      variancePercent:
        totals.srValue > 0
          ? Math.round(((totals.boqValue - totals.srValue) / totals.srValue) * 10_000) / 100
          : null,
    },
  };
}

/** Replaces the whole BOQ. Lines already measured on a bill cannot be dropped. */
export function replaceForPackage(
  packageId: number,
  input: z.infer<typeof replaceBoqSchema>,
  user: AuthUser,
) {
  const pkg = packageModel.findById(packageId);
  if (!pkg) throw notFound('Package');
  assertPackageVisible(pkg, user);

  const existing = boqModel.listByPackage(packageId);
  const measured = existing.filter((item) => item.billed_quantity > 0);
  if (measured.length && input.items.length < measured.length) {
    throw conflict(
      `${measured.length} item(s) on this BOQ have already been billed and cannot be removed. ` +
        'Correct the quantities instead.',
    );
  }

  return transaction(() => {
    boqModel.replaceForPackage(
      packageId,
      input.items.map((item, index) => ({
        sl_no: index + 1,
        item_code: item.itemCode ?? null,
        description: item.description,
        uom: item.uom,
        quantity: item.quantity,
        agreed_rate: item.agreedRate,
        amount: lineAmount(item.quantity, item.agreedRate),
        sr_item_id: item.srItemId ?? null,
        sr_rate: item.srRate ?? 0,
        remarks: item.remarks ?? null,
      })),
    );

    insertAuditEntry({
      userId: user.id,
      action: 'PACKAGE_BOQ_SET',
      entityType: 'PACKAGE',
      entityId: packageId,
      detail: `${pkg.package_code}: ${input.items.length} BOQ item(s)`,
    });

    return listForPackage(packageId, user);
  });
}

export function removeItem(id: number, user: AuthUser): void {
  const item = boqModel.findById(id);
  if (!item) throw notFound('BOQ item');
  const pkg = packageModel.findById(item.package_id);
  if (!pkg) throw notFound('Package');
  assertPackageVisible(pkg, user);

  if (boqModel.isMeasured(id)) {
    throw conflict('This item has been measured on a bill and cannot be removed.');
  }
  boqModel.deleteItem(id);
}

/**
 * Checks a measurement against the agreement before it becomes a bill line.
 * Returns the BOQ row so the caller can take the agreed rate from it rather
 * than trusting whatever the form sent.
 */
export function resolveForBilling(
  boqItemId: number,
  packageId: number,
  quantityPresent: number,
  excludeBillId: number | null = null,
): boqModel.BoqItemRow {
  const item = boqModel.findById(boqItemId);
  if (!item) throw notFound('BOQ item');
  if (item.package_id !== packageId) {
    throw badRequest('That BOQ item belongs to a different package.');
  }

  // A bill being edited must not be counted against itself, or re-saving it
  // unchanged would read as an overrun.
  const alreadyBilled = boqModel.billedExcluding(boqItemId, excludeBillId);
  const remaining = item.quantity - alreadyBilled;

  if (quantityPresent > remaining) {
    throw badRequest(
      `Item ${item.sl_no} (${item.description}): only ${fromQty(remaining)} ${item.uom} ` +
        `remain against an agreement quantity of ${fromQty(item.quantity)}. ` +
        `${fromQty(alreadyBilled)} has already been billed.`,
    );
  }

  return item;
}

export function copyFromAward(tenderId: number, bidId: number, packageId: number): number {
  return boqModel.copyFromTender(tenderId, bidId, packageId);
}
