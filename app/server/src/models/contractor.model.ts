import { getDb } from '../db/index.js';

export interface ContractorRow {
  id: number;
  code: string;
  name: string;
  contractor_type: string | null;
  registration_class: string | null;
  registration_no: string | null;
  eproc_no: string | null;
  pan: string;
  gstin: string | null;
  contact_person: string | null;
  email: string;
  phone: string | null;
  building: string | null;
  street: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip_code: string | null;
  bank_id: number | null;
  bank_branch: string | null;
  bank_account_no: string | null;
  bank_account_type: string | null;
  ifsc_code: string | null;
  tds_rate_bps: number;
  is_blacklisted: number;
  validity_date: string | null;
  registration_status: string;
  status: string;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractorListRow extends ContractorRow {
  bank_name: string | null;
  active_packages: number;
}

const LIST_SELECT = `
  SELECT c.*, b.name AS bank_name,
         (SELECT COUNT(*) FROM packages p WHERE p.contractor_id = c.id AND p.status IN ('AWARDED','IN_PROGRESS'))
           AS active_packages
  FROM contractors c
  LEFT JOIN banks b ON b.id = c.bank_id
`;

export function findById(id: number): ContractorListRow | null {
  return (
    (getDb().prepare(`${LIST_SELECT} WHERE c.id = ?`).get(id) as ContractorListRow | undefined) ?? null
  );
}

export function findByPan(pan: string): ContractorRow | null {
  return (
    (getDb().prepare(`SELECT * FROM contractors WHERE pan = ?`).get(pan) as ContractorRow | undefined) ??
    null
  );
}

export function findByEmail(email: string): ContractorRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM contractors WHERE lower(email) = lower(?)`)
      .get(email) as ContractorRow | undefined) ?? null
  );
}

export interface ListContractorsOptions {
  search?: string;
  registrationStatus?: string;
  registrationClass?: string;
  blacklisted?: boolean;
  limit: number;
  offset: number;
}

export function listContractors(
  options: ListContractorsOptions,
): { rows: ContractorListRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(c.name LIKE ? OR c.code LIKE ? OR c.pan LIKE ? OR c.gstin LIKE ? OR c.email LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like, like, like);
  }
  if (options.registrationStatus) {
    where.push(`c.registration_status = ?`);
    params.push(options.registrationStatus);
  }
  if (options.registrationClass) {
    where.push(`c.registration_class = ?`);
    params.push(options.registrationClass);
  }
  if (options.blacklisted !== undefined) {
    where.push(`c.is_blacklisted = ?`);
    params.push(options.blacklisted ? 1 : 0);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM contractors c ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${LIST_SELECT} ${clause} ORDER BY c.name LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as ContractorListRow[];

  return { rows, total };
}

export function insertContractor(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const columns = entries.map(([k]) => k).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO contractors (${columns}) VALUES (${placeholders})`)
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateContractor(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE contractors SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

/** Contractors eligible to bid: approved, not blacklisted, registration in date. */
export function listEligible(minClass?: string | null): ContractorListRow[] {
  const params: unknown[] = [];
  let clause = `WHERE c.registration_status = 'APPROVED' AND c.is_blacklisted = 0
                AND c.status = 'ACTIVE'
                AND (c.validity_date IS NULL OR c.validity_date >= date('now'))`;
  if (minClass) {
    clause += ` AND c.registration_class <= ?`;
    params.push(minClass);
  }
  return getDb()
    .prepare(`${LIST_SELECT} ${clause} ORDER BY c.name`)
    .all(...params) as ContractorListRow[];
}

/** Aggregate work and payment position for a contractor's dashboard. */
export function getContractorStats(contractorId: number): {
  activePackages: number;
  completedPackages: number;
  awardedValue: number;
  billsSubmitted: number;
  billsPaid: number;
  amountPaid: number;
  amountPending: number;
} {
  const db = getDb();
  const packages = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status IN ('AWARDED','IN_PROGRESS') THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN status IN ('COMPLETED','CLOSED') THEN 1 ELSE 0 END) AS completed,
         COALESCE(SUM(awarded_value), 0) AS awarded
       FROM packages WHERE contractor_id = ?`,
    )
    .get(contractorId) as { active: number | null; completed: number | null; awarded: number };

  const bills = db
    .prepare(
      `SELECT
         COUNT(*) AS submitted,
         SUM(CASE WHEN status = 'PAID' THEN 1 ELSE 0 END) AS paid,
         COALESCE(SUM(CASE WHEN status = 'PAID' THEN net_payable_amount ELSE 0 END), 0) AS amount_paid,
         COALESCE(SUM(CASE WHEN status NOT IN ('PAID','REJECTED','DRAFT') THEN net_payable_amount ELSE 0 END), 0)
           AS amount_pending
       FROM ra_bills WHERE contractor_id = ?`,
    )
    .get(contractorId) as {
    submitted: number;
    paid: number | null;
    amount_paid: number;
    amount_pending: number;
  };

  return {
    activePackages: packages.active ?? 0,
    completedPackages: packages.completed ?? 0,
    awardedValue: packages.awarded,
    billsSubmitted: bills.submitted,
    billsPaid: bills.paid ?? 0,
    amountPaid: bills.amount_paid,
    amountPending: bills.amount_pending,
  };
}
