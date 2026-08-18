import { getDb } from '../db/index.js';

export interface ProjectRow {
  id: number;
  project_code: string;
  name: string;
  description: string | null;
  scheme_id: number;
  work_type_id: number;
  project_category_id: number;
  zone_id: number;
  circle_id: number;
  division_id: number;
  sub_division_id: number | null;
  district_id: number | null;
  town_id: number | null;
  estimated_cost: number;
  sanctioned_cost: number;
  sanction_no: string | null;
  sanction_date: string | null;
  start_date: string | null;
  target_completion_date: string | null;
  actual_completion_date: string | null;
  physical_progress_pct: number;
  latitude: string | null;
  longitude: string | null;
  status: string;
  workflow_instance_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectDetailRow extends ProjectRow {
  scheme_name: string;
  scheme_code: string;
  work_type_name: string;
  category_name: string;
  zone_name: string;
  circle_name: string;
  division_name: string;
  division_code: string;
  sub_division_name: string | null;
  district_name: string | null;
  town_name: string | null;
  created_by_name: string | null;
  package_count: number;
  awarded_value: number;
  paid_amount: number;
  pending_amount: number;
  misc_expenditure: number;
}

const DETAIL_SELECT = `
  SELECT p.*,
         s.name AS scheme_name, s.code AS scheme_code,
         wt.name AS work_type_name,
         pc.name AS category_name,
         z.name AS zone_name, c.name AS circle_name,
         d.name AS division_name, d.code AS division_code,
         sd.name AS sub_division_name,
         dt.name AS district_name, t.name AS town_name,
         u.full_name AS created_by_name,
         (SELECT COUNT(*) FROM packages pk WHERE pk.project_id = p.id) AS package_count,
         (SELECT COALESCE(SUM(pk.awarded_value), 0) FROM packages pk WHERE pk.project_id = p.id) AS awarded_value,
         (SELECT COALESCE(SUM(rb.net_payable_amount), 0) FROM ra_bills rb
            WHERE rb.project_id = p.id AND rb.status = 'PAID') AS paid_amount,
         (SELECT COALESCE(SUM(rb.net_payable_amount), 0) FROM ra_bills rb
            WHERE rb.project_id = p.id AND rb.status NOT IN ('PAID','REJECTED','DRAFT')) AS pending_amount,
         (SELECT COALESCE(SUM(mb.net_payable_amount), 0) FROM misc_bills mb
            WHERE mb.project_id = p.id AND mb.status IN ('APPROVED','SENT_TO_TALLY','PAID')) AS misc_expenditure
  FROM projects p
  JOIN schemes s ON s.id = p.scheme_id
  JOIN work_types wt ON wt.id = p.work_type_id
  JOIN project_categories pc ON pc.id = p.project_category_id
  JOIN zones z ON z.id = p.zone_id
  JOIN circles c ON c.id = p.circle_id
  JOIN divisions d ON d.id = p.division_id
  LEFT JOIN sub_divisions sd ON sd.id = p.sub_division_id
  LEFT JOIN districts dt ON dt.id = p.district_id
  LEFT JOIN towns t ON t.id = p.town_id
  LEFT JOIN users u ON u.id = p.created_by
`;

export function findById(id: number): ProjectDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE p.id = ?`).get(id) as ProjectDetailRow | undefined) ?? null
  );
}

export function findByCode(code: string): ProjectRow | null {
  return (
    (getDb().prepare(`SELECT * FROM projects WHERE project_code = ?`).get(code) as
      | ProjectRow
      | undefined) ?? null
  );
}

export interface ListProjectsOptions {
  search?: string;
  status?: string;
  schemeId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  workTypeId?: number;
  /** Restricts to projects with a package awarded to this contractor. */
  contractorId?: number;
  limit: number;
  offset: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

const SORTABLE: Record<string, string> = {
  code: 'p.project_code',
  name: 'p.name',
  cost: 'p.sanctioned_cost',
  progress: 'p.physical_progress_pct',
  createdAt: 'p.id',
  status: 'p.status',
};

export function listProjects(
  options: ListProjectsOptions,
): { rows: ProjectDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(p.name LIKE ? OR p.project_code LIKE ? OR p.sanction_no LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  if (options.status) {
    where.push(`p.status = ?`);
    params.push(options.status);
  }
  if (options.schemeId) {
    where.push(`p.scheme_id = ?`);
    params.push(options.schemeId);
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
  if (options.workTypeId) {
    where.push(`p.work_type_id = ?`);
    params.push(options.workTypeId);
  }
  if (options.contractorId) {
    where.push(`EXISTS (SELECT 1 FROM packages pk WHERE pk.project_id = p.id AND pk.contractor_id = ?)`);
    params.push(options.contractorId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderColumn = SORTABLE[options.sort ?? 'createdAt'] ?? 'p.id';
  const direction = options.order === 'asc' ? 'ASC' : 'DESC';

  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM projects p ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY ${orderColumn} ${direction} LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as ProjectDetailRow[];

  return { rows, total };
}

export function insertProject(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const columns = entries.map(([k]) => k).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO projects (${columns}) VALUES (${placeholders})`)
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateProject(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE projects SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

// --- Milestones ------------------------------------------------------------

export interface MilestoneRow {
  id: number;
  project_id: number;
  seq: number;
  name: string;
  planned_date: string | null;
  actual_date: string | null;
  weightage_pct: number;
  status: string;
  remarks: string | null;
}

export function listMilestones(projectId: number): MilestoneRow[] {
  return getDb()
    .prepare(`SELECT * FROM project_milestones WHERE project_id = ? ORDER BY seq`)
    .all(projectId) as MilestoneRow[];
}

export function replaceMilestones(
  projectId: number,
  milestones: Omit<MilestoneRow, 'id' | 'project_id'>[],
): void {
  const db = getDb();
  const run = db.transaction(() => {
    db.prepare(`DELETE FROM project_milestones WHERE project_id = ?`).run(projectId);
    const stmt = db.prepare(
      `INSERT INTO project_milestones (project_id, seq, name, planned_date, actual_date, weightage_pct, status, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    milestones.forEach((m, index) => {
      stmt.run(
        projectId,
        m.seq || index + 1,
        m.name,
        m.planned_date,
        m.actual_date,
        m.weightage_pct,
        m.status,
        m.remarks,
      );
    });
  });
  run();
}

/**
 * Physical progress is the weighted sum of completed milestones. Recomputed
 * whenever milestones change so the figure is never entered by hand.
 */
export function recomputeProgress(projectId: number): number {
  const rows = listMilestones(projectId);
  if (!rows.length) return 0;
  const totalWeight = rows.reduce((sum, m) => sum + m.weightage_pct, 0);
  if (totalWeight === 0) return 0;
  const done = rows
    .filter((m) => m.status === 'COMPLETED')
    .reduce((sum, m) => sum + m.weightage_pct, 0);
  const pct = Math.round((done / totalWeight) * 100);
  updateProject(projectId, { physical_progress_pct: pct });
  return pct;
}

/** Cumulative expenditure figures shown on the RA bill screen. */
export function getExpenditure(
  projectId: number,
  financialYear: string,
): { uptoPreviousYear: number; duringYear: number; total: number } {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN financial_year < ? THEN net_payable_amount ELSE 0 END), 0) AS upto_previous,
         COALESCE(SUM(CASE WHEN financial_year = ? THEN net_payable_amount ELSE 0 END), 0) AS during_year
       FROM ra_bills
       WHERE project_id = ? AND status IN ('APPROVED','SENT_TO_TALLY','PAID')`,
    )
    .get(financialYear, financialYear, projectId) as { upto_previous: number; during_year: number };

  return {
    uptoPreviousYear: row.upto_previous,
    duringYear: row.during_year,
    total: row.upto_previous + row.during_year,
  };
}
