import { getDb } from '../db/index.js';

export interface PackageRow {
  id: number;
  package_code: string;
  project_id: number;
  name: string;
  description: string | null;
  work_type_id: number | null;
  estimated_value: number;
  awarded_value: number;
  contractor_id: number | null;
  in_charge_user_id: number | null;
  agreement_no: string | null;
  agreement_date: string | null;
  work_order_no: string | null;
  work_order_date: string | null;
  commencement_date: string | null;
  completion_date: string | null;
  defect_liability_months: number;
  security_deposit_bps: number;
  retention_bps: number;
  physical_progress_pct: number;
  status: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface PackageDetailRow extends PackageRow {
  project_code: string;
  project_name: string;
  division_id: number;
  division_code: string;
  division_name: string;
  circle_id: number;
  zone_id: number;
  work_type_name: string | null;
  contractor_name: string | null;
  contractor_code: string | null;
  in_charge_name: string | null;
  bill_count: number;
  paid_amount: number;
  pending_amount: number;
}

const DETAIL_SELECT = `
  SELECT pk.*,
         p.project_code, p.name AS project_name,
         p.division_id, p.circle_id, p.zone_id,
         d.code AS division_code, d.name AS division_name,
         wt.name AS work_type_name,
         c.name AS contractor_name, c.code AS contractor_code,
         u.full_name AS in_charge_name,
         (SELECT COUNT(*) FROM ra_bills rb WHERE rb.package_id = pk.id) AS bill_count,
         (SELECT COALESCE(SUM(rb.net_payable_amount), 0) FROM ra_bills rb
            WHERE rb.package_id = pk.id AND rb.status = 'PAID') AS paid_amount,
         (SELECT COALESCE(SUM(rb.net_payable_amount), 0) FROM ra_bills rb
            WHERE rb.package_id = pk.id AND rb.status NOT IN ('PAID','REJECTED','DRAFT')) AS pending_amount
  FROM packages pk
  JOIN projects p ON p.id = pk.project_id
  JOIN divisions d ON d.id = p.division_id
  LEFT JOIN work_types wt ON wt.id = pk.work_type_id
  LEFT JOIN contractors c ON c.id = pk.contractor_id
  LEFT JOIN users u ON u.id = pk.in_charge_user_id
`;

export function findById(id: number): PackageDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE pk.id = ?`).get(id) as PackageDetailRow | undefined) ?? null
  );
}

export interface ListPackagesOptions {
  search?: string;
  projectId?: number;
  contractorId?: number;
  status?: string;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  limit: number;
  offset: number;
}

export function listPackages(
  options: ListPackagesOptions,
): { rows: PackageDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(pk.name LIKE ? OR pk.package_code LIKE ? OR pk.agreement_no LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  if (options.projectId) {
    where.push(`pk.project_id = ?`);
    params.push(options.projectId);
  }
  if (options.contractorId) {
    where.push(`pk.contractor_id = ?`);
    params.push(options.contractorId);
  }
  if (options.status) {
    where.push(`pk.status = ?`);
    params.push(options.status);
  }
  if (options.divisionId) {
    where.push(`p.division_id = ?`);
    params.push(options.divisionId);
  }
  if (options.circleId) {
    where.push(`p.circle_id = ?`);
    params.push(options.circleId);
  }
  if (options.zoneId) {
    where.push(`p.zone_id = ?`);
    params.push(options.zoneId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM packages pk JOIN projects p ON p.id = pk.project_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY pk.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as PackageDetailRow[];

  return { rows, total };
}

export function insertPackage(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const columns = entries.map(([k]) => k).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO packages (${columns}) VALUES (${placeholders})`)
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updatePackage(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE packages SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

/** Total already certified against a package, used to cap the next RA bill. */
export function getBilledToDate(packageId: number, excludeBillId?: number): number {
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
