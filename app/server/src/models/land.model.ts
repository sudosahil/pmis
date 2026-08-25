import { getDb } from '../db/index.js';

/**
 * Land taken for a work, parcel by parcel.
 *
 * Every figure below the HTTP boundary is an integer: compensation in paise,
 * area scaled by a thousand like any other quantity.
 */

export interface ParcelRow {
  id: number;
  parcel_no: string;
  project_id: number;
  package_id: number | null;
  division_id: number;
  district_id: number | null;
  village: string;
  survey_no: string;
  khata_no: string | null;
  land_type: string;
  area_sqm: number;
  owner_name: string;
  owner_address: string | null;
  owner_contact: string | null;
  notification_no: string | null;
  notification_date: string | null;
  declaration_no: string | null;
  declaration_date: string | null;
  award_no: string | null;
  award_date: string | null;
  market_value: number;
  solatium_amount: number;
  interest_amount: number;
  other_amount: number;
  total_compensation: number;
  paid_amount: number;
  possession_date: string | null;
  status: string;
  remarks: string | null;
  document_id: number | null;
  workflow_instance_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ParcelDetailRow extends ParcelRow {
  project_code: string;
  project_name: string;
  circle_id: number;
  zone_id: number;
  division_code: string;
  division_name: string;
  district_name: string | null;
  package_code: string | null;
  created_by_name: string | null;
  document_name: string | null;
  /** Compensation actually disbursed, and how many times. */
  payment_count: number;
  /** Litigation hanging off this parcel — the reason an acquisition stalls. */
  open_case_count: number;
}

const DETAIL_SELECT = `
  SELECT lp.*,
         p.project_code, p.name AS project_name, p.circle_id, p.zone_id,
         d.code AS division_code, d.name AS division_name,
         dist.name AS district_name,
         pk.package_code,
         u.full_name AS created_by_name,
         doc.name AS document_name,
         (SELECT COUNT(*) FROM land_compensation_payments lcp WHERE lcp.parcel_id = lp.id)
           AS payment_count,
         (SELECT COUNT(*) FROM court_cases cc
           WHERE cc.parcel_id = lp.id
             AND cc.status NOT IN ('DISPOSED', 'WITHDRAWN', 'SETTLED')) AS open_case_count
    FROM land_parcels lp
    JOIN projects p ON p.id = lp.project_id
    JOIN divisions d ON d.id = lp.division_id
    LEFT JOIN districts dist ON dist.id = lp.district_id
    LEFT JOIN packages pk ON pk.id = lp.package_id
    LEFT JOIN users u ON u.id = lp.created_by
    LEFT JOIN documents doc ON doc.id = lp.document_id
`;

export function findById(id: number): ParcelDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE lp.id = ?`).get(id) as ParcelDetailRow | undefined)
    ?? null
  );
}

export interface ListParcelsOptions {
  search?: string;
  status?: string;
  projectId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  limit: number;
  offset: number;
}

export function listParcels(
  options: ListParcelsOptions,
): { rows: ParcelDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(lp.parcel_no LIKE ? OR lp.village LIKE ? OR lp.survey_no LIKE ? OR lp.owner_name LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like, like);
  }
  if (options.status) {
    where.push(`lp.status = ?`);
    params.push(options.status);
  }
  if (options.projectId) {
    where.push(`lp.project_id = ?`);
    params.push(options.projectId);
  }
  if (options.divisionId) {
    where.push(`lp.division_id = ?`);
    params.push(options.divisionId);
  } else if (options.circleId) {
    where.push(`p.circle_id = ?`);
    params.push(options.circleId);
  } else if (options.zoneId) {
    where.push(`p.zone_id = ?`);
    params.push(options.zoneId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM land_parcels lp
           JOIN projects p ON p.id = lp.project_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY lp.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as ParcelDetailRow[];

  return { rows, total };
}

export function insertParcel(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO land_parcels (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateParcel(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE land_parcels SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteParcel(id: number): void {
  getDb().prepare(`DELETE FROM land_parcels WHERE id = ?`).run(id);
}

// --- Compensation payments ---------------------------------------------------

export interface PaymentRow {
  id: number;
  parcel_id: number;
  payment_date: string;
  amount: number;
  mode: string;
  reference_no: string | null;
  payee_name: string;
  remarks: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
}

export function listPayments(parcelId: number): PaymentRow[] {
  return getDb()
    .prepare(
      `SELECT lcp.*, u.full_name AS recorded_by_name
         FROM land_compensation_payments lcp
         LEFT JOIN users u ON u.id = lcp.recorded_by
        WHERE lcp.parcel_id = ? ORDER BY lcp.payment_date, lcp.id`,
    )
    .all(parcelId) as PaymentRow[];
}

export function insertPayment(values: {
  parcel_id: number;
  payment_date: string;
  amount: number;
  mode: string;
  reference_no: string | null;
  payee_name: string;
  remarks: string | null;
  recorded_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO land_compensation_payments
         (parcel_id, payment_date, amount, mode, reference_no, payee_name, remarks, recorded_by)
       VALUES
         (@parcel_id, @payment_date, @amount, @mode, @reference_no, @payee_name, @remarks, @recorded_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function findPayment(id: number): PaymentRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT lcp.*, u.full_name AS recorded_by_name
           FROM land_compensation_payments lcp
           LEFT JOIN users u ON u.id = lcp.recorded_by WHERE lcp.id = ?`,
      )
      .get(id) as PaymentRow | undefined) ?? null
  );
}

export function deletePayment(id: number): void {
  getDb().prepare(`DELETE FROM land_compensation_payments WHERE id = ?`).run(id);
}

/** What has actually been disbursed against a parcel, to the paisa. */
export function paidTotal(parcelId: number): number {
  const row = getDb()
    .prepare<[number], { total: number | null }>(
      `SELECT SUM(amount) AS total FROM land_compensation_payments WHERE parcel_id = ?`,
    )
    .get(parcelId);
  return row?.total ?? 0;
}

/** The acquisition position of one project, for the project screen. */
export function projectSummary(projectId: number): {
  parcels: number;
  area: number;
  compensation: number;
  paid: number;
  possessed: number;
  disputed: number;
} {
  const row = getDb()
    .prepare<[number], Record<string, number | null>>(
      `SELECT COUNT(*) AS parcels,
              COALESCE(SUM(area_sqm), 0) AS area,
              COALESCE(SUM(total_compensation), 0) AS compensation,
              COALESCE(SUM(paid_amount), 0) AS paid,
              COALESCE(SUM(CASE WHEN status = 'POSSESSED' THEN 1 ELSE 0 END), 0) AS possessed,
              COALESCE(SUM(CASE WHEN status = 'DISPUTED' THEN 1 ELSE 0 END), 0) AS disputed
         FROM land_parcels WHERE project_id = ?`,
    )
    .get(projectId);

  return {
    parcels: row?.parcels ?? 0,
    area: row?.area ?? 0,
    compensation: row?.compensation ?? 0,
    paid: row?.paid ?? 0,
    possessed: row?.possessed ?? 0,
    disputed: row?.disputed ?? 0,
  };
}
