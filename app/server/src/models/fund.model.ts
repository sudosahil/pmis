import { getDb } from '../db/index.js';

export interface FundReleaseRow {
  id: number;
  release_no: string;
  scheme_id: number;
  project_id: number | null;
  division_id: number;
  financial_year: string;
  sanctioned_amount: number;
  released_amount: number;
  release_date: string;
  reference_no: string | null;
  remarks: string | null;
  status: string;
  created_by: number | null;
  created_at: string;
}

export interface FundReleaseDetailRow extends FundReleaseRow {
  scheme_code: string;
  scheme_name: string;
  project_code: string | null;
  project_name: string | null;
  division_code: string;
  division_name: string;
  created_by_name: string | null;
}

const RELEASE_SELECT = `
  SELECT fr.*, s.code AS scheme_code, s.name AS scheme_name,
         p.project_code, p.name AS project_name,
         d.code AS division_code, d.name AS division_name,
         u.full_name AS created_by_name
  FROM fund_releases fr
  JOIN schemes s ON s.id = fr.scheme_id
  JOIN divisions d ON d.id = fr.division_id
  LEFT JOIN projects p ON p.id = fr.project_id
  LEFT JOIN users u ON u.id = fr.created_by
`;

export function findReleaseById(id: number): FundReleaseDetailRow | null {
  return (
    (getDb().prepare(`${RELEASE_SELECT} WHERE fr.id = ?`).get(id) as
      | FundReleaseDetailRow
      | undefined) ?? null
  );
}

export function listReleases(options: {
  schemeId?: number;
  projectId?: number;
  divisionId?: number;
  financialYear?: string;
  limit: number;
  offset: number;
}): { rows: FundReleaseDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of [
    ['fr.scheme_id', options.schemeId],
    ['fr.project_id', options.projectId],
    ['fr.division_id', options.divisionId],
    ['fr.financial_year', options.financialYear],
  ] as const) {
    if (value !== undefined && value !== null) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM fund_releases fr ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${RELEASE_SELECT} ${clause} ORDER BY fr.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as FundReleaseDetailRow[];
  return { rows, total };
}

export function insertRelease(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO fund_releases (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

// --- Letter of Credit ------------------------------------------------------

export interface LocRow {
  id: number;
  loc_no: string;
  division_id: number;
  scheme_id: number | null;
  financial_year: string;
  request_date: string;
  requested_amount: number;
  approved_amount: number;
  purpose: string | null;
  status: string;
  workflow_instance_id: number | null;
  approval_date: string | null;
  remarks: string | null;
  created_by: number | null;
  created_at: string;
}

export interface LocDetailRow extends LocRow {
  division_code: string;
  division_name: string;
  circle_id: number;
  zone_id: number;
  scheme_name: string | null;
  created_by_name: string | null;
}

const LOC_SELECT = `
  SELECT l.*, d.code AS division_code, d.name AS division_name,
         d.circle_id, c.zone_id,
         s.name AS scheme_name, u.full_name AS created_by_name
  FROM loc_requests l
  JOIN divisions d ON d.id = l.division_id
  JOIN circles c ON c.id = d.circle_id
  LEFT JOIN schemes s ON s.id = l.scheme_id
  LEFT JOIN users u ON u.id = l.created_by
`;

export function findLocById(id: number): LocDetailRow | null {
  return (
    (getDb().prepare(`${LOC_SELECT} WHERE l.id = ?`).get(id) as LocDetailRow | undefined) ?? null
  );
}

export function listLocRequests(options: {
  divisionId?: number;
  status?: string;
  financialYear?: string;
  limit: number;
  offset: number;
}): { rows: LocDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const [column, value] of [
    ['l.division_id', options.divisionId],
    ['l.status', options.status],
    ['l.financial_year', options.financialYear],
  ] as const) {
    if (value !== undefined && value !== null) {
      where.push(`${column} = ?`);
      params.push(value);
    }
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM loc_requests l ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${LOC_SELECT} ${clause} ORDER BY l.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as LocDetailRow[];
  return { rows, total };
}

export function insertLoc(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO loc_requests (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateLoc(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE loc_requests SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}
