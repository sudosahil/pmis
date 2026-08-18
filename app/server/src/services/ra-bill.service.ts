import { z } from 'zod';
import { BILL_STATUS, ENTITY_TYPES, PACKAGE_STATUS, ROLES, WORKFLOWS } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as raBillModel from '../models/ra-bill.model.js';
import * as packageModel from '../models/package.model.js';
import * as projectModel from '../models/project.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import { assertVisible as assertPackageVisible } from './package.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import {
  financialYear,
  generateDbrNo,
  generateRaBillNo,
  generateTallyVoucherNo,
} from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { applyBps, amountInWords, fromBps, fromQty, lineAmount, toRupees } from '../utils/money.js';
import { isoDate, percent, quantity, rupees } from '../middleware/validate.js';

// --- Schemas ---------------------------------------------------------------

export const raBillItemSchema = z.object({
  slNo: z.coerce.number().int().min(1).optional(),
  description: z.string().trim().min(2, 'Describe the work item.').max(500),
  uom: z.string().trim().min(1).max(20),
  quantityUptoDate: quantity,
  quantityPrevious: quantity.optional(),
  rate: rupees,
});

export const createRaBillSchema = z.object({
  packageId: z.coerce.number().int().positive(),
  billType: z.enum(['RA', 'FINAL']).default('RA'),
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  measurementBookNo: z.string().trim().max(60).optional(),
  items: z.array(raBillItemSchema).min(1, 'Add at least one work item.').max(300),
});

export const updateRaBillSchema = createRaBillSchema.partial().omit({ packageId: true });

/** Executive Engineer certification: admissible amount plus the ETP percentages. */
export const certifySchema = z.object({
  admissibleAmount: rupees,
  etpEstablishment: percent.default(0),
  etpToolsPlant: percent.default(0),
  etpContingency: percent.default(0),
  remarks: z.string().trim().max(1000).optional(),
});

export const deductionsSchema = z.object({
  deductions: z
    .array(
      z.object({
        code: z.string().trim().min(1).max(40),
        description: z.string().trim().min(1).max(200),
        basis: z.enum(['PERCENT', 'AMOUNT']),
        rate: percent.optional(),
        amount: rupees.optional(),
      }),
    )
    .max(30),
});

export const tallySchema = z.object({
  eofficeFileNo: z.string().trim().min(1, 'Enter the e-Office file number.').max(80),
  eofficeNoteNo: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export const paymentSchema = z.object({
  paymentDate: isoDate,
  paymentReference: z.string().trim().min(1, 'Enter the payment reference.').max(80),
  remarks: z.string().trim().max(1000).optional(),
});

// --- Presentation ----------------------------------------------------------

export function present(row: raBillModel.RaBillDetailRow) {
  const items = raBillModel.listItems(row.id);
  const deductions = raBillModel.listDeductions(row.id);
  const expenditure = projectModel.getExpenditure(row.project_id, row.financial_year);
  const projectEtp = applyBps(expenditure.total, row.etp_total_bps);

  return {
    id: row.id,
    billNo: row.bill_no,
    dbrNo: row.dbr_no,
    financialYear: row.financial_year,
    raSequence: row.ra_sequence,
    billType: row.bill_type,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    package: {
      id: row.package_id,
      code: row.package_code,
      name: row.package_name,
      awardedValue: toRupees(row.awarded_value),
    },
    contractor: { id: row.contractor_id, code: row.contractor_code, name: row.contractor_name },
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    periodFrom: row.period_from,
    periodTo: row.period_to,
    measurementBookNo: row.measurement_book_no,

    // Figures as laid out on the departmental RA bill form.
    amounts: {
      contractorClaimAmount: toRupees(row.contractor_claim_amount),
      previousPaidAmount: toRupees(row.previous_paid_amount),
      presentBillAmount: toRupees(row.present_bill_amount),
      admissibleAmount: toRupees(row.admissible_amount),
      grossAmount: toRupees(row.present_bill_amount),
      totalDeduction: toRupees(row.total_deduction),
      netPayableAmount: toRupees(row.net_payable_amount),
      netPayableInWords: amountInWords(row.net_payable_amount),
    },
    etp: {
      establishment: fromBps(row.etp_establishment_bps),
      establishmentAmount: toRupees(applyBps(row.admissible_amount, row.etp_establishment_bps)),
      toolsPlant: fromBps(row.etp_tools_plant_bps),
      toolsPlantAmount: toRupees(applyBps(row.admissible_amount, row.etp_tools_plant_bps)),
      contingency: fromBps(row.etp_contingency_bps),
      contingencyAmount: toRupees(applyBps(row.admissible_amount, row.etp_contingency_bps)),
      totalPercent: fromBps(row.etp_total_bps),
      totalAmount: toRupees(row.etp_amount),
      basis: 'Admissible Amount',
    },
    projectExpenditure: {
      financialYear: row.financial_year,
      uptoPreviousYear: toRupees(expenditure.uptoPreviousYear),
      duringYear: toRupees(expenditure.duringYear),
      etpPercent: fromBps(row.etp_total_bps),
      etpOnExpenditure: toRupees(projectEtp),
      totalWithEtp: toRupees(expenditure.total + projectEtp),
    },
    items: items.map((item) => ({
      id: item.id,
      slNo: item.sl_no,
      description: item.description,
      uom: item.uom,
      quantityUptoDate: fromQty(item.quantity_upto_date),
      quantityPrevious: fromQty(item.quantity_previous),
      quantityPresent: fromQty(item.quantity_present),
      rate: toRupees(item.rate),
      amount: toRupees(item.amount),
    })),
    deductions: deductions.map((d) => ({
      id: d.id,
      code: d.deduction_code,
      description: d.description,
      basis: d.basis,
      rate: fromBps(d.rate_bps),
      amount: toRupees(d.amount),
    })),
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    tallyVoucherNo: row.tally_voucher_no,
    eoffice: {
      fileNo: row.eoffice_file_no,
      noteNo: row.eoffice_note_no,
      remarks: row.eoffice_remarks,
    },
    paymentDate: row.payment_date,
    paymentReference: row.payment_reference,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

// --- Reading ---------------------------------------------------------------

export function list(
  user: AuthUser,
  options: {
    search?: string;
    status?: string;
    projectId?: number;
    packageId?: number;
    contractorId?: number;
    financialYear?: string;
    page: number;
    pageSize: number;
  },
) {
  const scope = scopeFilter(user);
  const { rows, total } = raBillModel.listRaBills({
    search: options.search,
    status: options.status,
    projectId: options.projectId,
    packageId: options.packageId,
    contractorId: scope.contractorId ?? options.contractorId,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    financialYear: options.financialYear,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

function assertVisible(row: raBillModel.RaBillDetailRow, user: AuthUser): void {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined && row.contractor_id !== scope.contractorId) {
    throw forbidden('This bill belongs to another contractor.');
  }
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This bill belongs to another division.');
  }
  if (scope.circleId && row.circle_id !== scope.circleId) {
    throw forbidden('This bill belongs to another circle.');
  }
  if (scope.zoneId && row.zone_id !== scope.zoneId) {
    throw forbidden('This bill belongs to another zone.');
  }
}

export function getOne(id: number, user: AuthUser) {
  const row = raBillModel.findById(id);
  if (!row) throw notFound('RA bill');
  assertVisible(row, user);
  return present(row);
}

// --- Authoring -------------------------------------------------------------

/**
 * Prices the work items. Present quantity is the difference between the
 * cumulative quantity and what was already billed, which is how a running
 * account bill works.
 */
function priceItems(items: z.infer<typeof raBillItemSchema>[]) {
  let total = 0;
  const priced = items.map((item, index) => {
    const previous = item.quantityPrevious ?? 0;
    const present = item.quantityUptoDate - previous;
    if (present < 0) {
      throw badRequest(
        `Item ${index + 1}: the cumulative quantity cannot be less than the quantity already billed.`,
      );
    }
    const amount = lineAmount(present, item.rate);
    total += amount;
    return {
      sl_no: item.slNo ?? index + 1,
      description: item.description,
      uom: item.uom,
      quantity_upto_date: item.quantityUptoDate,
      quantity_previous: previous,
      quantity_present: present,
      rate: item.rate,
      amount,
    };
  });
  return { priced, total };
}

export function create(input: z.infer<typeof createRaBillSchema>, user: AuthUser) {
  return transaction(() => {
    const pkg = packageModel.findById(input.packageId);
    if (!pkg) throw notFound('Package');
    if (!pkg.contractor_id) throw badRequest('This package has not been awarded to a contractor yet.');

    // A contractor may only raise a bill against their own package.
    if (user.roleCode === ROLES.CONTRACTOR && pkg.contractor_id !== user.contractorId) {
      throw forbidden('This package is not awarded to you.');
    }
    if (user.roleCode !== ROLES.CONTRACTOR) {
      assertPackageVisible(pkg, user);
    }

    const allowed: string[] = [PACKAGE_STATUS.AWARDED, PACKAGE_STATUS.IN_PROGRESS, PACKAGE_STATUS.COMPLETED];
    if (!allowed.includes(pkg.status)) {
      throw conflict('Bills can only be raised against an awarded package.');
    }

    const { priced, total } = priceItems(input.items);
    if (total <= 0) throw badRequest('The bill amount must be greater than zero.');

    const previousPaid = raBillModel.getPreviousPaid(input.packageId);
    const contractValue = pkg.awarded_value || pkg.estimated_value;
    if (contractValue > 0 && previousPaid + total > contractValue) {
      throw badRequest(
        `This bill would take the total billed (₹${toRupees(previousPaid + total).toLocaleString('en-IN')}) past the contract value of ₹${toRupees(contractValue).toLocaleString('en-IN')}.`,
      );
    }

    const fy = financialYear();
    const billNo = generateRaBillNo(pkg.division_code, fy);
    const sequence = raBillModel.getLastSequence(input.packageId) + 1;

    const billId = raBillModel.insertRaBill({
      bill_no: billNo,
      financial_year: fy,
      ra_sequence: sequence,
      bill_type: input.billType,
      project_id: pkg.project_id,
      package_id: input.packageId,
      contractor_id: pkg.contractor_id,
      division_id: pkg.division_id,
      period_from: input.periodFrom ?? null,
      period_to: input.periodTo ?? null,
      measurement_book_no: input.measurementBookNo ?? null,
      contractor_claim_amount: total,
      previous_paid_amount: previousPaid,
      present_bill_amount: total,
      // The admissible amount is certified by the Executive Engineer, not by
      // the AE/AEE and not by the contractor — it starts equal to the claim.
      admissible_amount: total,
      net_payable_amount: total,
      status: BILL_STATUS.DRAFT,
      created_by: user.id,
    });

    raBillModel.replaceItems(billId, priced);
    seedDefaultDeductions(billId, total);
    recalculate(billId);

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_CREATED',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: billId,
      detail: `${billNo} (RA ${sequence}) for ₹${toRupees(total)}`,
    });

    return present(raBillModel.findById(billId)!);
  });
}

/** Applies the standing statutory deduction heads to a newly created bill. */
function seedDefaultDeductions(billId: number, grossAmount: number): void {
  const types = raBillModel.listApplicableDeductionTypes('RA');
  raBillModel.replaceDeductions(
    billId,
    types
      .filter((t) => t.basis === 'PERCENT' && t.rate_bps > 0)
      .map((t) => ({
        deduction_code: t.code,
        description: t.name,
        basis: t.basis,
        rate_bps: t.rate_bps,
        amount: applyBps(grossAmount, t.rate_bps),
      })),
  );
}

/**
 * Single source of truth for the bill arithmetic:
 *   present bill  = sum of item amounts
 *   deductions    = percentage heads recomputed on the present bill amount
 *   net payable   = present bill - deductions
 *   ETP           = configured percentages applied to the admissible amount
 */
export function recalculate(billId: number): void {
  const bill = raBillModel.findById(billId);
  if (!bill) return;

  const items = raBillModel.listItems(billId);
  const presentAmount = items.reduce((sum, item) => sum + item.amount, 0);

  const deductions = raBillModel.listDeductions(billId);
  const recomputed = deductions.map((d) => ({
    deduction_code: d.deduction_code,
    description: d.description,
    basis: d.basis,
    rate_bps: d.rate_bps,
    amount: d.basis === 'PERCENT' ? applyBps(presentAmount, d.rate_bps) : d.amount,
  }));
  raBillModel.replaceDeductions(billId, recomputed);

  const totalDeduction = recomputed.reduce((sum, d) => sum + d.amount, 0);
  const etpTotalBps =
    bill.etp_establishment_bps + bill.etp_tools_plant_bps + bill.etp_contingency_bps;

  raBillModel.updateRaBill(billId, {
    present_bill_amount: presentAmount,
    contractor_claim_amount: presentAmount,
    total_deduction: totalDeduction,
    net_payable_amount: presentAmount - totalDeduction,
    etp_total_bps: etpTotalBps,
    etp_amount: applyBps(bill.admissible_amount, etpTotalBps),
  });
}

function assertEditable(bill: raBillModel.RaBillDetailRow): void {
  const editable: string[] = [BILL_STATUS.DRAFT, BILL_STATUS.RETURNED];
  if (!editable.includes(bill.status)) {
    throw conflict('This bill is in approval and can no longer be edited.');
  }
}

export function update(id: number, input: z.infer<typeof updateRaBillSchema>, user: AuthUser) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    assertEditable(bill);

    if (input.items) {
      const { priced, total } = priceItems(input.items);
      if (total <= 0) throw badRequest('The bill amount must be greater than zero.');

      const previousPaid = raBillModel.getPreviousPaid(bill.package_id, id);
      const contractValue = bill.awarded_value;
      if (contractValue > 0 && previousPaid + total > contractValue) {
        throw badRequest('This bill would take the total billed past the contract value.');
      }
      raBillModel.replaceItems(id, priced);
      raBillModel.updateRaBill(id, { previous_paid_amount: previousPaid });
    }

    raBillModel.updateRaBill(id, {
      bill_type: input.billType,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      measurement_book_no: input.measurementBookNo,
    });
    recalculate(id);

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_UPDATED',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: bill.bill_no,
    });

    return present(raBillModel.findById(id)!);
  });
}

export function remove(id: number, user: AuthUser): void {
  const bill = raBillModel.findById(id);
  if (!bill) throw notFound('RA bill');
  assertVisible(bill, user);
  if (bill.status !== BILL_STATUS.DRAFT) throw conflict('Only a draft bill can be deleted.');
  raBillModel.deleteRaBill(id);
  insertAuditEntry({
    userId: user.id,
    action: 'RA_BILL_DELETED',
    entityType: ENTITY_TYPES.RA_BILL,
    entityId: id,
    detail: bill.bill_no,
  });
}

/**
 * Submits the bill into the approval chain and stamps the DBR number — the
 * divisional running number the source documents describe as "1/23-24".
 */
export function submit(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    assertEditable(bill);
    if (bill.present_bill_amount <= 0) throw badRequest('The bill amount must be greater than zero.');

    recalculate(id);
    const dbrNo = bill.dbr_no ?? generateDbrNo(bill.division_code);

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.RA_BILL,
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      entityRef: bill.bill_no,
      title: `RA ${bill.ra_sequence} — ${bill.package_name}`,
      amount: bill.net_payable_amount,
      divisionId: bill.division_id,
      circleId: bill.circle_id,
      zoneId: bill.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    raBillModel.updateRaBill(id, {
      status: BILL_STATUS.IN_APPROVAL,
      workflow_instance_id: instance.id,
      dbr_no: dbrNo,
    });
    packageModel.updatePackage(bill.package_id, { status: PACKAGE_STATUS.IN_PROGRESS });

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_SUBMITTED',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: `${bill.bill_no}, DBR ${dbrNo}`,
    });

    return present(raBillModel.findById(id)!);
  });
}

/**
 * Executive Engineer certification. This is where the admissible amount and
 * the three ETP percentages are set, exactly as the source form specifies.
 */
export function certify(id: number, input: z.infer<typeof certifySchema>, user: AuthUser) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    if (bill.status !== BILL_STATUS.IN_APPROVAL) {
      throw conflict('Only a bill under approval can be certified.');
    }
    if (user.roleCode !== ROLES.EE && user.roleCode !== ROLES.ADMIN) {
      throw forbidden('Only the Executive Engineer certifies the admissible amount.');
    }
    if (input.admissibleAmount > bill.contractor_claim_amount) {
      throw badRequest('The admissible amount cannot exceed the amount claimed by the contractor.');
    }

    const totalBps = input.etpEstablishment + input.etpToolsPlant + input.etpContingency;
    raBillModel.updateRaBill(id, {
      admissible_amount: input.admissibleAmount,
      etp_establishment_bps: input.etpEstablishment,
      etp_tools_plant_bps: input.etpToolsPlant,
      etp_contingency_bps: input.etpContingency,
      etp_total_bps: totalBps,
      etp_amount: applyBps(input.admissibleAmount, totalBps),
    });
    recalculate(id);

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_CERTIFIED',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: `${bill.bill_no}: admissible ₹${toRupees(input.admissibleAmount)}, ETP ${fromBps(totalBps)}%`,
    });

    return present(raBillModel.findById(id)!);
  });
}

/** Accounts-side revision of the deduction schedule. */
export function setDeductions(id: number, input: z.infer<typeof deductionsSchema>, user: AuthUser) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    if (bill.status !== BILL_STATUS.IN_APPROVAL) {
      throw conflict('Deductions can only be revised while the bill is under approval.');
    }
    const allowedRoles: string[] = [ROLES.AC, ROLES.AS, ROLES.AAO, ROLES.CAO, ROLES.ADMIN];
    if (!allowedRoles.includes(user.roleCode)) {
      throw forbidden('Only the accounts cadre can revise deductions.');
    }

    raBillModel.replaceDeductions(
      id,
      input.deductions.map((d) => {
        if (d.basis === 'PERCENT' && d.rate === undefined) {
          throw badRequest(`Enter a rate for the percentage deduction "${d.description}".`);
        }
        if (d.basis === 'AMOUNT' && d.amount === undefined) {
          throw badRequest(`Enter an amount for the deduction "${d.description}".`);
        }
        return {
          deduction_code: d.code,
          description: d.description,
          basis: d.basis,
          rate_bps: d.rate ?? 0,
          amount: d.basis === 'PERCENT' ? applyBps(bill.present_bill_amount, d.rate!) : d.amount!,
        };
      }),
    );
    recalculate(id);

    const updated = raBillModel.findById(id)!;
    if (updated.net_payable_amount < 0) {
      throw badRequest('Deductions cannot exceed the gross bill amount.');
    }

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_DEDUCTIONS_REVISED',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: `${bill.bill_no}: total deduction ₹${toRupees(updated.total_deduction)}`,
    });

    return present(updated);
  });
}

/** CAO action: stamps the e-Office reference and exports the voucher to Tally. */
export function sendToTally(id: number, input: z.infer<typeof tallySchema>, user: AuthUser) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    if (bill.status !== BILL_STATUS.APPROVED) {
      throw conflict('Only a fully approved bill can be sent to Tally.');
    }
    if (bill.tally_voucher_no) throw conflict('This bill has already been sent to Tally.');

    const voucherNo = generateTallyVoucherNo(bill.division_code, bill.financial_year);
    raBillModel.updateRaBill(id, {
      status: BILL_STATUS.SENT_TO_TALLY,
      tally_voucher_no: voucherNo,
      eoffice_file_no: input.eofficeFileNo,
      eoffice_note_no: input.eofficeNoteNo ?? null,
      eoffice_remarks: input.remarks ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_SENT_TO_TALLY',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: `${bill.bill_no}, voucher ${voucherNo}, e-Office ${input.eofficeFileNo}`,
    });

    return present(raBillModel.findById(id)!);
  });
}

export function recordPayment(id: number, input: z.infer<typeof paymentSchema>, user: AuthUser) {
  return transaction(() => {
    const bill = raBillModel.findById(id);
    if (!bill) throw notFound('RA bill');
    assertVisible(bill, user);
    if (bill.status !== BILL_STATUS.SENT_TO_TALLY) {
      throw conflict('Send the bill to Tally before recording payment.');
    }

    raBillModel.updateRaBill(id, {
      status: BILL_STATUS.PAID,
      payment_date: input.paymentDate,
      payment_reference: input.paymentReference,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'RA_BILL_PAID',
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: id,
      detail: `${bill.bill_no} paid, reference ${input.paymentReference}`,
    });

    return present(raBillModel.findById(id)!);
  });
}

/** Maps the workflow result onto the bill's own status. */
registerOutcomeHandler(ENTITY_TYPES.RA_BILL, ({ instance, status, action }) => {
  const billId = instance.entity_id;
  if (status === 'APPROVED') {
    raBillModel.updateRaBill(billId, { status: BILL_STATUS.APPROVED });
  } else if (status === 'REJECTED') {
    raBillModel.updateRaBill(billId, { status: BILL_STATUS.REJECTED });
  } else if (status === 'CANCELLED') {
    raBillModel.updateRaBill(billId, { status: BILL_STATUS.DRAFT, workflow_instance_id: null });
  } else if (action === 'RETURN' && instance.current_step_id === null) {
    // Returned past the first step: the bill is editable by its originator again.
    raBillModel.updateRaBill(billId, { status: BILL_STATUS.RETURNED });
  }
});
