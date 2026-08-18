import { getDb } from '../db/index.js';

export interface MiscBillRow {
  id: number;
  bill_no: string;
  bill_category: string;
  financial_year: string;
  project_id: number | null;
  division_id: number;
  bill_date: string;
  period_from: string | null;
  period_to: string | null;
  site_id: string | null;
  payee_name: string;
  payee_type: string;
  contractor_id: number | null;
  submitted_by_user_id: number | null;
  submitted_by_designation: string | null;
  gross_amount: number;
  total_deduction: number;
  net_payable_amount: number;
  amount_in_words: string | null;
  refund_reference: string | null;
  status: string;
  workflow_instance_id: number | null;
  tally_voucher_no: string | null;
  eoffice_file_no: string | null;
  eoffice_note_no: string | null;
  eoffice_remarks: string | null;
  payment_date: string | null;
  payment_reference: string | null;
  remarks: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface MiscBillDetailRow extends MiscBillRow {
  project_code: string | null;
  project_name: string | null;
  circle_id: number | null;
  zone_id: number | null;
  division_code: string;
  division_name: string;
  contractor_name: string | null;
  submitted_by_name: string | null;
  created_by_name: string | null;
}

const DETAIL_SELECT = `
  SELECT mb.*,
         p.project_code, p.name AS project_name, p.circle_id, p.zone_id,
         d.code AS division_code, d.name AS division_name,
         c.name AS contractor_name,
         su.full_name AS submitted_by_name,
         u.full_name AS created_by_name
  FROM misc_bills mb
  JOIN divisions d ON d.id = mb.division_id
  LEFT JOIN projects p ON p.id = mb.project_id
  LEFT JOIN contractors c ON c.id = mb.contractor_id
  LEFT JOIN users su ON su.id = mb.submitted_by_user_id
  LEFT JOIN users u ON u.id = mb.created_by
`;

export function findById(id: number): MiscBillDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE mb.id = ?`).get(id) as MiscBillDetailRow | undefined) ??
    null
  );
}

export interface ListMiscBillsOptions {
  search?: string;
  status?: string;
  billCategory?: string;
  projectId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  financialYear?: string;
  submittedByUserId?: number;
  limit: number;
  offset: number;
}

export function listMiscBills(
  options: ListMiscBillsOptions,
): { rows: MiscBillDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(mb.bill_no LIKE ? OR mb.payee_name LIKE ? OR mb.site_id LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  for (const [column, value] of [
    ['mb.status', options.status],
    ['mb.bill_category', options.billCategory],
    ['mb.project_id', options.projectId],
    ['mb.division_id', options.divisionId],
    ['p.circle_id', options.circleId],
    ['p.zone_id', options.zoneId],
    ['mb.financial_year', options.financialYear],
    ['mb.submitted_by_user_id', options.submittedByUserId],
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
        `SELECT COUNT(*) AS n FROM misc_bills mb LEFT JOIN projects p ON p.id = mb.project_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY mb.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as MiscBillDetailRow[];

  return { rows, total };
}

export function insertMiscBill(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO misc_bills (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateMiscBill(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE misc_bills SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteMiscBill(id: number): void {
  getDb().prepare(`DELETE FROM misc_bills WHERE id = ?`).run(id);
}

export interface MiscBillItemRow {
  id: number;
  misc_bill_id: number;
  sl_no: number;
  expense_date: string;
  description: string;
  category_code: string;
  govt_object_head: string | null;
  invoice_no: string | null;
  gstin: string | null;
  amount: number;
  remarks: string | null;
}

export function listItems(billId: number): MiscBillItemRow[] {
  return getDb()
    .prepare(`SELECT * FROM misc_bill_items WHERE misc_bill_id = ? ORDER BY sl_no`)
    .all(billId) as MiscBillItemRow[];
}

export function replaceItems(
  billId: number,
  items: Omit<MiscBillItemRow, 'id' | 'misc_bill_id'>[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM misc_bill_items WHERE misc_bill_id = ?`).run(billId);
    const stmt = db.prepare(
      `INSERT INTO misc_bill_items
         (misc_bill_id, sl_no, expense_date, description, category_code, govt_object_head,
          invoice_no, gstin, amount, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    items.forEach((item, index) => {
      stmt.run(
        billId,
        item.sl_no || index + 1,
        item.expense_date,
        item.description,
        item.category_code,
        item.govt_object_head,
        item.invoice_no,
        item.gstin,
        item.amount,
        item.remarks,
      );
    });
  })();
}

/** Resolves the government object head configured against an expense category. */
export function findExpenseCategory(
  code: string,
): { code: string; name: string; govt_object_head: string | null; bill_category: string } | null {
  return (
    (getDb()
      .prepare(
        `SELECT code, name, govt_object_head, bill_category FROM expense_categories
         WHERE code = ? AND status = 'ACTIVE'`,
      )
      .get(code) as
      | { code: string; name: string; govt_object_head: string | null; bill_category: string }
      | undefined) ?? null
  );
}

export function findDivisionCode(divisionId: number): string | null {
  const row = getDb()
    .prepare(`SELECT code FROM divisions WHERE id = ?`)
    .get(divisionId) as { code: string } | undefined;
  return row?.code ?? null;
}

export function findSchemeCode(schemeId: number): string | null {
  const row = getDb()
    .prepare(`SELECT code FROM schemes WHERE id = ?`)
    .get(schemeId) as { code: string } | undefined;
  return row?.code ?? null;
}

/** Spend by government object head — the accounting summary for a period. */
export function summariseByObjectHead(
  financialYear: string,
  divisionId?: number,
): { objectHead: string; total: number; billCount: number }[] {
  const params: unknown[] = [financialYear];
  let clause = `WHERE mb.financial_year = ? AND mb.status IN ('APPROVED','SENT_TO_TALLY','PAID')`;
  if (divisionId) {
    clause += ` AND mb.division_id = ?`;
    params.push(divisionId);
  }
  return getDb()
    .prepare(
      `SELECT COALESCE(i.govt_object_head, 'Unclassified') AS objectHead,
              SUM(i.amount) AS total, COUNT(DISTINCT mb.id) AS billCount
       FROM misc_bill_items i
       JOIN misc_bills mb ON mb.id = i.misc_bill_id
       ${clause}
       GROUP BY objectHead ORDER BY total DESC`,
    )
    .all(...params) as { objectHead: string; total: number; billCount: number }[];
}
