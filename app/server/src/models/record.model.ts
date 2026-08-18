import { getDb } from '../db/index.js';

/**
 * The records a government file carries alongside its data: the noting sheet,
 * the sanction orders that authorise the work, and the DPR they are granted
 * against.
 */

// --- Noting sheet ----------------------------------------------------------

export interface NoteRow {
  id: number;
  entity_type: string;
  entity_id: number;
  note_no: number;
  author_id: number | null;
  author_name: string | null;
  author_role: string | null;
  body: string;
  is_internal: number;
  document_id: number | null;
  document_name: string | null;
  created_at: string;
}

export function listNotes(
  entityType: string,
  entityId: number,
  includeInternal: boolean,
): NoteRow[] {
  const clause = includeInternal ? '' : 'AND n.is_internal = 0';
  return getDb()
    .prepare(
      `SELECT n.*, d.name AS document_name
         FROM notes n
         LEFT JOIN documents d ON d.id = n.document_id
        WHERE n.entity_type = ? AND n.entity_id = ? ${clause}
        ORDER BY n.note_no`,
    )
    .all(entityType, entityId) as NoteRow[];
}

/** Notes are numbered within the file, the way a paper noting sheet is. */
export function nextNoteNo(entityType: string, entityId: number): number {
  const row = getDb()
    .prepare<[string, number], { n: number | null }>(
      `SELECT MAX(note_no) AS n FROM notes WHERE entity_type = ? AND entity_id = ?`,
    )
    .get(entityType, entityId);
  return (row?.n ?? 0) + 1;
}

export function insertNote(values: {
  entity_type: string;
  entity_id: number;
  note_no: number;
  author_id: number;
  author_name: string;
  author_role: string;
  body: string;
  is_internal: number;
  document_id: number | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO notes
         (entity_type, entity_id, note_no, author_id, author_name, author_role,
          body, is_internal, document_id)
       VALUES
         (@entity_type, @entity_id, @note_no, @author_id, @author_name, @author_role,
          @body, @is_internal, @document_id)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function findNote(id: number): NoteRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT n.*, d.name AS document_name FROM notes n
         LEFT JOIN documents d ON d.id = n.document_id WHERE n.id = ?`,
      )
      .get(id) as NoteRow | undefined) ?? null
  );
}

export function deleteNote(id: number): void {
  getDb().prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}

export function countNotes(entityType: string, entityId: number): number {
  const row = getDb()
    .prepare<[string, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM notes WHERE entity_type = ? AND entity_id = ?`,
    )
    .get(entityType, entityId);
  return row?.n ?? 0;
}

// --- Sanctions -------------------------------------------------------------

export interface SanctionRow {
  id: number;
  project_id: number;
  kind: string;
  reference_no: string;
  sanction_date: string;
  amount: number;
  authority: string;
  designation: string | null;
  remarks: string | null;
  document_id: number | null;
  document_name: string | null;
  recorded_by: number | null;
  recorded_by_name: string | null;
  created_at: string;
}

const SANCTION_SELECT = `
  SELECT s.*, d.name AS document_name, u.full_name AS recorded_by_name
    FROM project_sanctions s
    LEFT JOIN documents d ON d.id = s.document_id
    LEFT JOIN users u ON u.id = s.recorded_by`;

export function listSanctions(projectId: number): SanctionRow[] {
  return getDb()
    .prepare(`${SANCTION_SELECT} WHERE s.project_id = ? ORDER BY s.sanction_date DESC, s.id DESC`)
    .all(projectId) as SanctionRow[];
}

export function findSanction(id: number): SanctionRow | null {
  return (
    (getDb().prepare(`${SANCTION_SELECT} WHERE s.id = ?`).get(id) as SanctionRow | undefined) ?? null
  );
}

export function insertSanction(values: {
  project_id: number;
  kind: string;
  reference_no: string;
  sanction_date: string;
  amount: number;
  authority: string;
  designation: string | null;
  remarks: string | null;
  document_id: number | null;
  recorded_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO project_sanctions
         (project_id, kind, reference_no, sanction_date, amount, authority,
          designation, remarks, document_id, recorded_by)
       VALUES
         (@project_id, @kind, @reference_no, @sanction_date, @amount, @authority,
          @designation, @remarks, @document_id, @recorded_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function updateSanction(id: number, values: Record<string, unknown>): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE project_sanctions SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteSanction(id: number): void {
  getDb().prepare(`DELETE FROM project_sanctions WHERE id = ?`).run(id);
}

/** The latest sanction of a kind — what the project header shows. */
export function latestSanction(projectId: number, kind: string): SanctionRow | null {
  return (
    (getDb()
      .prepare(
        `${SANCTION_SELECT} WHERE s.project_id = ? AND s.kind = ?
          ORDER BY s.sanction_date DESC, s.id DESC LIMIT 1`,
      )
      .get(projectId, kind) as SanctionRow | undefined) ?? null
  );
}

// --- DPR -------------------------------------------------------------------

export interface DprRow {
  id: number;
  project_id: number;
  dpr_no: string;
  version: number;
  title: string;
  prepared_by: string | null;
  consultant: string | null;
  estimated_cost: number;
  submission_date: string | null;
  scope: string | null;
  justification: string | null;
  status: string;
  approved_by: string | null;
  approval_date: string | null;
  remarks: string | null;
  document_id: number | null;
  document_name: string | null;
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
}

const DPR_SELECT = `
  SELECT p.*, d.name AS document_name, u.full_name AS created_by_name
    FROM project_dprs p
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN users u ON u.id = p.created_by`;

export function listDprs(projectId: number): DprRow[] {
  return getDb()
    .prepare(`${DPR_SELECT} WHERE p.project_id = ? ORDER BY p.dpr_no, p.version DESC`)
    .all(projectId) as DprRow[];
}

export function findDpr(id: number): DprRow | null {
  return (getDb().prepare(`${DPR_SELECT} WHERE p.id = ?`).get(id) as DprRow | undefined) ?? null;
}

export function insertDpr(values: {
  project_id: number;
  dpr_no: string;
  version: number;
  title: string;
  prepared_by: string | null;
  consultant: string | null;
  estimated_cost: number;
  submission_date: string | null;
  scope: string | null;
  justification: string | null;
  status: string;
  remarks: string | null;
  document_id: number | null;
  created_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO project_dprs
         (project_id, dpr_no, version, title, prepared_by, consultant, estimated_cost,
          submission_date, scope, justification, status, remarks, document_id, created_by)
       VALUES
         (@project_id, @dpr_no, @version, @title, @prepared_by, @consultant, @estimated_cost,
          @submission_date, @scope, @justification, @status, @remarks, @document_id, @created_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function updateDpr(id: number, values: Record<string, unknown>): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE project_dprs SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteDpr(id: number): void {
  getDb().prepare(`DELETE FROM project_dprs WHERE id = ?`).run(id);
}

/** The next version of a DPR number, so a returned report comes back revised. */
export function nextDprVersion(projectId: number, dprNo: string): number {
  const row = getDb()
    .prepare<[number, string], { v: number | null }>(
      `SELECT MAX(version) AS v FROM project_dprs WHERE project_id = ? AND dpr_no = ?`,
    )
    .get(projectId, dprNo);
  return (row?.v ?? 0) + 1;
}
