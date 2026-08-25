import { getDb } from '../db/index.js';

/**
 * Applications under the Right to Information Act, 2005, and appeals against
 * how they were answered.
 *
 * The register is read by lateness, so days remaining is computed in SQL
 * alongside the row rather than in the presenter — a list that has to be sorted
 * by a figure the database does not know cannot be paged.
 */

export interface RequestRow {
  id: number;
  request_no: string;
  applicant_name: string;
  applicant_address: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  is_bpl: number;
  fee_paid: number;
  received_on: string;
  received_via: string;
  subject: string;
  information_sought: string;
  is_life_or_liberty: number;
  division_id: number | null;
  pio_user_id: number | null;
  due_date: string;
  status: string;
  reply_date: string | null;
  reply_summary: string | null;
  rejection_section: string | null;
  rejection_ground: string | null;
  transferred_to: string | null;
  document_id: number | null;
  remarks: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface RequestDetailRow extends RequestRow {
  division_code: string | null;
  division_name: string | null;
  circle_id: number | null;
  pio_name: string | null;
  created_by_name: string | null;
  document_name: string | null;
  /** Negative once the statutory period has run out. */
  days_remaining: number;
  /** Days it actually took, on an application already answered. */
  days_taken: number | null;
  appeal_count: number;
}

/**
 * `days_remaining` is measured against the reply date once there is one, so a
 * late reply stays visibly late instead of drifting further behind every day.
 */
const DETAIL_SELECT = `
  SELECT r.*,
         d.code AS division_code, d.name AS division_name, d.circle_id,
         pio.full_name AS pio_name,
         u.full_name AS created_by_name,
         doc.name AS document_name,
         CAST(julianday(r.due_date)
              - julianday(COALESCE(r.reply_date, date('now'))) AS INTEGER) AS days_remaining,
         CASE WHEN r.reply_date IS NULL THEN NULL
              ELSE CAST(julianday(r.reply_date) - julianday(r.received_on) AS INTEGER) END
           AS days_taken,
         (SELECT COUNT(*) FROM rti_appeals a WHERE a.request_id = r.id) AS appeal_count
    FROM rti_requests r
    LEFT JOIN divisions d ON d.id = r.division_id
    LEFT JOIN users pio ON pio.id = r.pio_user_id
    LEFT JOIN users u ON u.id = r.created_by
    LEFT JOIN documents doc ON doc.id = r.document_id
`;

export function findById(id: number): RequestDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE r.id = ?`).get(id) as RequestDetailRow | undefined)
    ?? null
  );
}

export interface ListRequestsOptions {
  search?: string;
  status?: string;
  divisionId?: number;
  circleId?: number;
  pioUserId?: number;
  /** Only applications still open and past their statutory date. */
  overdueOnly?: boolean;
  limit: number;
  offset: number;
}

const OPEN_STATUSES = `('RECEIVED', 'IN_PROGRESS', 'TRANSFERRED')`;

export function listRequests(
  options: ListRequestsOptions,
): { rows: RequestDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(r.request_no LIKE ? OR r.applicant_name LIKE ? OR r.subject LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  if (options.status) {
    where.push(`r.status = ?`);
    params.push(options.status);
  }
  if (options.pioUserId) {
    where.push(`r.pio_user_id = ?`);
    params.push(options.pioUserId);
  }
  if (options.divisionId) {
    where.push(`r.division_id = ?`);
    params.push(options.divisionId);
  } else if (options.circleId) {
    where.push(`d.circle_id = ?`);
    params.push(options.circleId);
  }
  if (options.overdueOnly) {
    where.push(`r.status IN ${OPEN_STATUSES} AND date(r.due_date) < date('now')`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM rti_requests r
           LEFT JOIN divisions d ON d.id = r.division_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  // Open applications sort by how little time is left; the rest by recency.
  const rows = db
    .prepare(
      `${DETAIL_SELECT} ${clause}
        ORDER BY CASE WHEN r.status IN ${OPEN_STATUSES} THEN 0 ELSE 1 END,
                 days_remaining, r.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as RequestDetailRow[];

  return { rows, total };
}

export function insertRequest(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO rti_requests (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateRequest(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE rti_requests SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteRequest(id: number): void {
  getDb().prepare(`DELETE FROM rti_requests WHERE id = ?`).run(id);
}

/** The compliance position: what an Information Commission would ask for. */
export function complianceSummary(scope: { divisionId?: number; circleId?: number }): {
  total: number;
  open: number;
  overdue: number;
  replied: number;
  rejected: number;
  onTime: number;
  late: number;
  appeals: number;
} {
  const where: string[] = [];
  const params: unknown[] = [];
  if (scope.divisionId) {
    where.push(`r.division_id = ?`);
    params.push(scope.divisionId);
  } else if (scope.circleId) {
    where.push(`d.circle_id = ?`);
    params.push(scope.circleId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const row = getDb()
    .prepare<unknown[], Record<string, number | null>>(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN r.status IN ${OPEN_STATUSES} THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN r.status IN ${OPEN_STATUSES}
                        AND date(r.due_date) < date('now') THEN 1 ELSE 0 END) AS overdue,
              SUM(CASE WHEN r.status IN ('REPLIED', 'PARTLY_REJECTED', 'CLOSED') THEN 1 ELSE 0 END)
                AS replied,
              SUM(CASE WHEN r.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN r.reply_date IS NOT NULL
                        AND date(r.reply_date) <= date(r.due_date) THEN 1 ELSE 0 END) AS on_time,
              SUM(CASE WHEN r.reply_date IS NOT NULL
                        AND date(r.reply_date) > date(r.due_date) THEN 1 ELSE 0 END) AS late,
              (SELECT COUNT(*) FROM rti_appeals) AS appeals
         FROM rti_requests r
         LEFT JOIN divisions d ON d.id = r.division_id
         ${clause}`,
    )
    .get(...params);

  return {
    total: row?.total ?? 0,
    open: row?.open ?? 0,
    overdue: row?.overdue ?? 0,
    replied: row?.replied ?? 0,
    rejected: row?.rejected ?? 0,
    onTime: row?.on_time ?? 0,
    late: row?.late ?? 0,
    appeals: row?.appeals ?? 0,
  };
}

// --- Appeals -----------------------------------------------------------------

export interface AppealRow {
  id: number;
  request_id: number;
  appeal_no: string;
  appeal_level: string;
  filed_on: string;
  grounds: string;
  appellate_authority: string | null;
  authority_user_id: number | null;
  authority_name: string | null;
  due_date: string;
  status: string;
  decided_on: string | null;
  decision: string | null;
  penalty_imposed: number;
  remarks: string | null;
  created_at: string;
  days_remaining: number;
}

const APPEAL_SELECT = `
  SELECT a.*, u.full_name AS authority_name,
         CAST(julianday(a.due_date)
              - julianday(COALESCE(a.decided_on, date('now'))) AS INTEGER) AS days_remaining
    FROM rti_appeals a
    LEFT JOIN users u ON u.id = a.authority_user_id
`;

export function listAppeals(requestId: number): AppealRow[] {
  return getDb()
    .prepare(`${APPEAL_SELECT} WHERE a.request_id = ? ORDER BY a.filed_on, a.id`)
    .all(requestId) as AppealRow[];
}

export function findAppeal(id: number): AppealRow | null {
  return (
    (getDb().prepare(`${APPEAL_SELECT} WHERE a.id = ?`).get(id) as AppealRow | undefined) ?? null
  );
}

export function insertAppeal(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO rti_appeals (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateAppeal(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE rti_appeals SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}
