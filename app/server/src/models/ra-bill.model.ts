import { getDb } from '../db/index.js';

export interface RaBillRow {
  id: number;
  bill_no: string;
  dbr_no: string | null;
  financial_year: string;
  ra_sequence: number;
  bill_type: string;
  project_id: number;
  package_id: number;
  contractor_id: number;
  division_id: number;
  period_from: string | null;
  period_to: string | null;
  measurement_book_no: string | null;
  contractor_claim_amount: number;
  previous_paid_amount: number;
  present_bill_amount: number;
  admissible_amount: number;
  total_deduction: number;
  net_payable_amount: number;
  etp_establishment_bps: number;
  etp_tools_plant_bps: number;
  etp_contingency_bps: number;
  etp_total_bps: number;
  etp_amount: number;
  status: string;
  workflow_instance_id: number | null;
  tally_voucher_no: string | null;
  eoffice_file_no: string | null;
  eoffice_note_no: string | null;
  eoffice_remarks: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface RaBillDetailRow extends RaBillRow {
  project_code: string;
  project_name: string;
  package_code: string;
  package_name: string;
  awarded_value: number;
  contractor_name: string;
  contractor_code: string;
  contractor_tds_bps: number;
  division_code: string;
  division_name: string;
  circle_id: number;
  zone_id: number;
  created_by_name: string | null;
}

const DETAIL_SELECT = `
  SELECT rb.*,
         p.project_code, p.name AS project_name, p.circle_id, p.zone_id,
         pk.package_code, pk.name AS package_name, pk.awarded_value,
         c.name AS contractor_name, c.code AS contractor_code, c.tds_rate_bps AS contractor_tds_bps,
         d.code AS division_code, d.name AS division_name,
         u.full_name AS created_by_name
  FROM ra_bills rb
  JOIN projects p ON p.id = rb.project_id
  JOIN packages pk ON pk.id = rb.package_id
  JOIN contractors c ON c.id = rb.contractor_id
  JOIN divisions d ON d.id = rb.division_id
  LEFT JOIN users u ON u.id = rb.created_by
`;

export function findById(id: number): RaBillDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE rb.id = ?`).get(id) as RaBillDetailRow | undefined) ?? null
  );
}

export interface ListRaBillsOptions {
  search?: string;
  status?: string;
  projectId?: number;
  packageId?: number;
  contractorId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  financialYear?: string;
  limit: number;
  offset: number;
}

export function listRaBills(options: ListRaBillsOptions): { rows: RaBillDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(rb.bill_no LIKE ? OR rb.dbr_no LIKE ? OR p.name LIKE ? OR c.name LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like, like);
  }
  for (const [column, value] of [
    ['rb.status', options.status],
    ['rb.project_id', options.projectId],
    ['rb.package_id', options.packageId],
    ['rb.contractor_id', options.contractorId],
    ['rb.division_id', options.divisionId],
    ['p.circle_id', options.circleId],
    ['p.zone_id', options.zoneId],
    ['rb.financial_year', options.financialYear],
  ] as const) {
    if (value !== undefined && value !== null) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM ra_bills rb
         JOIN projects p ON p.id = rb.project_id
         JOIN contractors c ON c.id = rb.contractor_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY rb.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as RaBillDetailRow[];

  return { rows, total };
}

export function insertRaBill(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO ra_bills (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateRaBill(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE ra_bills SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteRaBill(id: number): void {
  getDb().prepare(`DELETE FROM ra_bills WHERE id = ?`).run(id);
}

// --- Items -----------------------------------------------------------------

export interface RaBillItemRow {
  id: number;
  ra_bill_id: number;
  sl_no: number;
  description: string;
  uom: string;
  quantity_upto_date: number;
  quantity_previous: number;
  quantity_present: number;
  rate: number;
  amount: number;
}

export function listItems(billId: number): RaBillItemRow[] {
  return getDb()
    .prepare(`SELECT * FROM ra_bill_items WHERE ra_bill_id = ? ORDER BY sl_no`)
    .all(billId) as RaBillItemRow[];
}

export function replaceItems(
  billId: number,
  items: Omit<RaBillItemRow, 'id' | 'ra_bill_id'>[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM ra_bill_items WHERE ra_bill_id = ?`).run(billId);
    const stmt = db.prepare(
      `INSERT INTO ra_bill_items
         (ra_bill_id, sl_no, description, uom, quantity_upto_date, quantity_previous,
          quantity_present, rate, amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    items.forEach((item, index) => {
      stmt.run(
        billId,
        item.sl_no || index + 1,
        item.description,
        item.uom,
        item.quantity_upto_date,
        item.quantity_previous,
        item.quantity_present,
        item.rate,
        item.amount,
      );
    });
  })();
}

// --- Deductions ------------------------------------------------------------

export interface RaBillDeductionRow {
  id: number;
  ra_bill_id: number;
  deduction_code: string;
  description: string;
  basis: string;
  rate_bps: number;
  amount: number;
}

export function listDeductions(billId: number): RaBillDeductionRow[] {
  return getDb()
    .prepare(`SELECT * FROM ra_bill_deductions WHERE ra_bill_id = ? ORDER BY id`)
    .all(billId) as RaBillDeductionRow[];
}

export function replaceDeductions(
  billId: number,
  deductions: Omit<RaBillDeductionRow, 'id' | 'ra_bill_id'>[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM ra_bill_deductions WHERE ra_bill_id = ?`).run(billId);
    const stmt = db.prepare(
      `INSERT INTO ra_bill_deductions (ra_bill_id, deduction_code, description, basis, rate_bps, amount)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const d of deductions) {
      stmt.run(billId, d.deduction_code, d.description, d.basis, d.rate_bps, d.amount);
    }
  })();
}

/** Active deduction heads applicable to a bill kind, used to seed a new bill. */
export function listApplicableDeductionTypes(
  appliesTo: 'RA' | 'MISC',
): { code: string; name: string; basis: string; rate_bps: number }[] {
  return getDb()
    .prepare(
      `SELECT code, name, basis, rate_bps FROM deduction_types
       WHERE status = 'ACTIVE' AND applies_to IN (?, 'BOTH') ORDER BY code`,
    )
    .all(appliesTo) as { code: string; name: string; basis: string; rate_bps: number }[];
}

/** Highest RA sequence already used on a package, so the next one follows on. */
export function getLastSequence(packageId: number): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(ra_sequence), 0) AS seq FROM ra_bills WHERE package_id = ?`)
    .get(packageId) as { seq: number };
  return row.seq;
}

/** Sum of previously certified bills on a package, excluding rejected drafts. */
export function getPreviousPaid(packageId: number, excludeBillId?: number): number {
  const params: unknown[] = [packageId];
  let clause = `WHERE package_id = ? AND status NOT IN ('REJECTED','DRAFT')`;
  if (excludeBillId) {
    clause += ` AND id != ?`;
    params.push(excludeBillId);
  }
  const row = getDb()
    .prepare(`SELECT COALESCE(SUM(present_bill_amount), 0) AS total FROM ra_bills ${clause}`)
    .get(...params) as { total: number };
  return row.total;
}
