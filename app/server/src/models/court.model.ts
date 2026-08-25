import { getDb } from '../db/index.js';

/**
 * Litigation the department is party to, and every listing of it.
 *
 * A case is read two ways: as a file with a history, and as a line on tomorrow's
 * cause list. Both are served from here.
 */

export interface CaseRow {
  id: number;
  case_no: string;
  internal_ref: string | null;
  court_name: string;
  court_type: string;
  case_type: string;
  filed_by: string;
  petitioner: string;
  respondent: string;
  subject: string;
  filing_date: string;
  division_id: number | null;
  project_id: number | null;
  package_id: number | null;
  parcel_id: number | null;
  contractor_id: number | null;
  claim_amount: number;
  decree_amount: number;
  advocate_name: string | null;
  advocate_fee: number;
  dealing_officer_id: number | null;
  next_hearing_date: string | null;
  status: string;
  outcome: string | null;
  disposal_date: string | null;
  remarks: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface CaseDetailRow extends CaseRow {
  division_code: string | null;
  division_name: string | null;
  circle_id: number | null;
  zone_id: number | null;
  project_code: string | null;
  project_name: string | null;
  package_code: string | null;
  parcel_no: string | null;
  contractor_name: string | null;
  dealing_officer_name: string | null;
  created_by_name: string | null;
  hearing_count: number;
  last_hearing_date: string | null;
}

const DETAIL_SELECT = `
  SELECT cc.*,
         d.code AS division_code, d.name AS division_name,
         d.circle_id,
         c.zone_id,
         p.project_code, p.name AS project_name,
         pk.package_code,
         lp.parcel_no,
         con.name AS contractor_name,
         o.full_name AS dealing_officer_name,
         u.full_name AS created_by_name,
         (SELECT COUNT(*) FROM court_hearings ch WHERE ch.case_id = cc.id) AS hearing_count,
         (SELECT MAX(ch.hearing_date) FROM court_hearings ch WHERE ch.case_id = cc.id)
           AS last_hearing_date
    FROM court_cases cc
    LEFT JOIN divisions d ON d.id = cc.division_id
    LEFT JOIN circles c ON c.id = d.circle_id
    LEFT JOIN projects p ON p.id = cc.project_id
    LEFT JOIN packages pk ON pk.id = cc.package_id
    LEFT JOIN land_parcels lp ON lp.id = cc.parcel_id
    LEFT JOIN contractors con ON con.id = cc.contractor_id
    LEFT JOIN users o ON o.id = cc.dealing_officer_id
    LEFT JOIN users u ON u.id = cc.created_by
`;

export function findById(id: number): CaseDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE cc.id = ?`).get(id) as CaseDetailRow | undefined) ?? null
  );
}

export interface ListCasesOptions {
  search?: string;
  status?: string;
  courtType?: string;
  caseType?: string;
  projectId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  /** Only cases listed within the next `withinDays` days. */
  hearingWithinDays?: number;
  limit: number;
  offset: number;
}

export function listCases(options: ListCasesOptions): { rows: CaseDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(cc.case_no LIKE ? OR cc.subject LIKE ? OR cc.petitioner LIKE ? OR cc.respondent LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like, like);
  }
  if (options.status) {
    where.push(`cc.status = ?`);
    params.push(options.status);
  }
  if (options.courtType) {
    where.push(`cc.court_type = ?`);
    params.push(options.courtType);
  }
  if (options.caseType) {
    where.push(`cc.case_type = ?`);
    params.push(options.caseType);
  }
  if (options.projectId) {
    where.push(`cc.project_id = ?`);
    params.push(options.projectId);
  }
  if (options.divisionId) {
    where.push(`cc.division_id = ?`);
    params.push(options.divisionId);
  } else if (options.circleId) {
    where.push(`d.circle_id = ?`);
    params.push(options.circleId);
  } else if (options.zoneId) {
    where.push(`c.zone_id = ?`);
    params.push(options.zoneId);
  }
  if (options.hearingWithinDays !== undefined) {
    where.push(
      `cc.next_hearing_date IS NOT NULL
         AND date(cc.next_hearing_date) BETWEEN date('now') AND date('now', ?)`,
    );
    params.push(`+${options.hearingWithinDays} days`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM court_cases cc
           LEFT JOIN divisions d ON d.id = cc.division_id
           LEFT JOIN circles c ON c.id = d.circle_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  // The cause list reads by date; the register reads newest first.
  const order = options.hearingWithinDays !== undefined
    ? 'cc.next_hearing_date, cc.id'
    : 'cc.id DESC';
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as CaseDetailRow[];

  return { rows, total };
}

export function insertCase(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO court_cases (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateCase(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE court_cases SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteCase(id: number): void {
  getDb().prepare(`DELETE FROM court_cases WHERE id = ?`).run(id);
}

// --- Hearings ----------------------------------------------------------------

export interface HearingRow {
  id: number;
  case_id: number;
  hearing_date: string;
  purpose: string | null;
  appeared_by: string | null;
  proceedings: string | null;
  order_summary: string | null;
  next_date: string | null;
  document_id: number | null;
  document_name: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
}

export function listHearings(caseId: number): HearingRow[] {
  return getDb()
    .prepare(
      `SELECT ch.*, doc.name AS document_name, u.full_name AS recorded_by_name
         FROM court_hearings ch
         LEFT JOIN documents doc ON doc.id = ch.document_id
         LEFT JOIN users u ON u.id = ch.recorded_by
        WHERE ch.case_id = ? ORDER BY ch.hearing_date DESC, ch.id DESC`,
    )
    .all(caseId) as HearingRow[];
}

export function insertHearing(values: {
  case_id: number;
  hearing_date: string;
  purpose: string | null;
  appeared_by: string | null;
  proceedings: string | null;
  order_summary: string | null;
  next_date: string | null;
  document_id: number | null;
  recorded_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO court_hearings
         (case_id, hearing_date, purpose, appeared_by, proceedings, order_summary,
          next_date, document_id, recorded_by)
       VALUES
         (@case_id, @hearing_date, @purpose, @appeared_by, @proceedings, @order_summary,
          @next_date, @document_id, @recorded_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function findHearing(id: number): HearingRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT ch.*, doc.name AS document_name, u.full_name AS recorded_by_name
           FROM court_hearings ch
           LEFT JOIN documents doc ON doc.id = ch.document_id
           LEFT JOIN users u ON u.id = ch.recorded_by WHERE ch.id = ?`,
      )
      .get(id) as HearingRow | undefined) ?? null
  );
}

export function deleteHearing(id: number): void {
  getDb().prepare(`DELETE FROM court_hearings WHERE id = ?`).run(id);
}
