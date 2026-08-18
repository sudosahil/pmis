import { getDb } from '../db/index.js';

export interface BoqItemRow {
  id: number;
  package_id: number;
  sl_no: number;
  item_code: string | null;
  description: string;
  uom: string;
  quantity: number;
  agreed_rate: number;
  amount: number;
  sr_item_id: number | null;
  sr_code: string | null;
  sr_name: string | null;
  sr_rate: number;
  remarks: string | null;
  /** How much of this line has already been measured on paid or pending bills. */
  billed_quantity: number;
  billed_amount: number;
  created_at: string;
}

/**
 * A BOQ line with what has already been billed against it. The rolled-up
 * quantity is what stops an item being measured twice, so it is read alongside
 * the line rather than computed in the service.
 */
const SELECT = `
  SELECT b.*, sr.code AS sr_code, sr.name AS sr_name,
         COALESCE((
           SELECT SUM(i.quantity_present) FROM ra_bill_items i
             JOIN ra_bills rb ON rb.id = i.ra_bill_id
            WHERE i.boq_item_id = b.id
              AND rb.status NOT IN ('REJECTED', 'CANCELLED')
         ), 0) AS billed_quantity,
         COALESCE((
           SELECT SUM(i.amount) FROM ra_bill_items i
             JOIN ra_bills rb ON rb.id = i.ra_bill_id
            WHERE i.boq_item_id = b.id
              AND rb.status NOT IN ('REJECTED', 'CANCELLED')
         ), 0) AS billed_amount
    FROM package_boq_items b
    LEFT JOIN schedule_of_rates sr ON sr.id = b.sr_item_id`;

export function listByPackage(packageId: number): BoqItemRow[] {
  return getDb()
    .prepare(`${SELECT} WHERE b.package_id = ? ORDER BY b.sl_no`)
    .all(packageId) as BoqItemRow[];
}

export function findById(id: number): BoqItemRow | null {
  return (getDb().prepare(`${SELECT} WHERE b.id = ?`).get(id) as BoqItemRow | undefined) ?? null;
}

/**
 * How much of a BOQ line other bills have measured. A bill being edited must
 * not count against itself, or its own quantities would look like an overrun.
 */
export function billedExcluding(boqItemId: number, excludeBillId: number | null): number {
  const clause = excludeBillId ? 'AND rb.id <> ?' : '';
  const params: unknown[] = excludeBillId ? [boqItemId, excludeBillId] : [boqItemId];
  const row = getDb()
    .prepare(
      `SELECT COALESCE(SUM(i.quantity_present), 0) AS q
         FROM ra_bill_items i
         JOIN ra_bills rb ON rb.id = i.ra_bill_id
        WHERE i.boq_item_id = ?
          AND rb.status NOT IN ('REJECTED', 'CANCELLED') ${clause}`,
    )
    .get(...params) as { q: number } | undefined;
  return row?.q ?? 0;
}

export function insertItem(values: {
  package_id: number;
  sl_no: number;
  item_code: string | null;
  description: string;
  uom: string;
  quantity: number;
  agreed_rate: number;
  amount: number;
  sr_item_id: number | null;
  sr_rate: number;
  remarks: string | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO package_boq_items
         (package_id, sl_no, item_code, description, uom, quantity, agreed_rate, amount,
          sr_item_id, sr_rate, remarks)
       VALUES
         (@package_id, @sl_no, @item_code, @description, @uom, @quantity, @agreed_rate, @amount,
          @sr_item_id, @sr_rate, @remarks)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function replaceForPackage(
  packageId: number,
  items: Omit<Parameters<typeof insertItem>[0], 'package_id'>[],
): void {
  const db = getDb();
  db.prepare(`DELETE FROM package_boq_items WHERE package_id = ?`).run(packageId);
  for (const item of items) insertItem({ package_id: packageId, ...item });
}

export function deleteItem(id: number): void {
  getDb().prepare(`DELETE FROM package_boq_items WHERE id = ?`).run(id);
}

/** True when any bill has already measured this line, so it must not vanish. */
export function isMeasured(id: number): boolean {
  const row = getDb()
    .prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n FROM ra_bill_items WHERE boq_item_id = ?`,
    )
    .get(id);
  return (row?.n ?? 0) > 0;
}

export function packageTotals(packageId: number): {
  itemCount: number;
  boqValue: number;
  billedValue: number;
  srValue: number;
} {
  const row = getDb()
    .prepare<[number], { n: number; boq: number | null; sr: number | null }>(
      `SELECT COUNT(*) AS n,
              SUM(amount) AS boq,
              SUM(CAST(quantity AS INTEGER) * sr_rate / 1000) AS sr
         FROM package_boq_items WHERE package_id = ?`,
    )
    .get(packageId);

  const billed = getDb()
    .prepare<[number], { total: number | null }>(
      `SELECT SUM(i.amount) AS total
         FROM ra_bill_items i
         JOIN ra_bills rb ON rb.id = i.ra_bill_id
         JOIN package_boq_items b ON b.id = i.boq_item_id
        WHERE b.package_id = ? AND rb.status NOT IN ('REJECTED', 'CANCELLED')`,
    )
    .get(packageId);

  return {
    itemCount: row?.n ?? 0,
    boqValue: row?.boq ?? 0,
    srValue: row?.sr ?? 0,
    billedValue: billed?.total ?? 0,
  };
}

/** Copies the winning bid's priced BOQ onto the package when a tender is awarded. */
export function copyFromTender(tenderId: number, bidId: number, packageId: number): number {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT t.sl_no, t.item_code, t.description, t.uom, t.quantity,
              COALESCE(bi.quoted_rate, t.estimated_rate) AS agreed_rate
         FROM tender_boq_items t
         LEFT JOIN bid_items bi ON bi.boq_item_id = t.id AND bi.bid_id = ?
        WHERE t.tender_id = ?
        ORDER BY t.sl_no`,
    )
    .all(bidId, tenderId) as {
    sl_no: number;
    item_code: string | null;
    description: string;
    uom: string;
    quantity: number;
    agreed_rate: number;
  }[];

  db.prepare(`DELETE FROM package_boq_items WHERE package_id = ?`).run(packageId);

  for (const row of rows) {
    // The SR line is matched on item code where the tender carried one, so the
    // agreed rate can be read against the sanctioned rate from day one.
    const sr = row.item_code
      ? (db
          .prepare<[string], { id: number; rate: number }>(
            `SELECT id, rate FROM schedule_of_rates WHERE code = ? AND status = 'ACTIVE'`,
          )
          .get(row.item_code) ?? null)
      : null;

    insertItem({
      package_id: packageId,
      sl_no: row.sl_no,
      item_code: row.item_code,
      description: row.description,
      uom: row.uom,
      quantity: row.quantity,
      agreed_rate: row.agreed_rate,
      amount: Math.round((row.quantity * row.agreed_rate) / 1000),
      sr_item_id: sr?.id ?? null,
      sr_rate: sr?.rate ?? 0,
      remarks: null,
    });
  }

  return rows.length;
}
