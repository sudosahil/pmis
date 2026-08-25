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
  sr_edition: string | null;
  items_total: number;
  contingency_bps: number;
  establishment_bps: number;
  status: string;
  approved_by: string | null;
  approval_date: string | null;
  remarks: string | null;
  document_id: number | null;
  document_name: string | null;
  tender_id: number | null;
  tender_no: string | null;
  tender_status: string | null;
  created_by: number | null;
  created_by_name: string | null;
  item_count: number;
  created_at: string;
}

const DPR_SELECT = `
  SELECT p.*, d.name AS document_name, u.full_name AS created_by_name,
         t.tender_no, t.status AS tender_status,
         (SELECT COUNT(*) FROM project_dpr_items i WHERE i.dpr_id = p.id) AS item_count
    FROM project_dprs p
    LEFT JOIN documents d ON d.id = p.document_id
    LEFT JOIN users u ON u.id = p.created_by
    LEFT JOIN tenders t ON t.id = p.tender_id`;

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
  sr_edition: string | null;
  contingency_bps: number;
  establishment_bps: number;
  status: string;
  remarks: string | null;
  document_id: number | null;
  created_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO project_dprs
         (project_id, dpr_no, version, title, prepared_by, consultant, estimated_cost,
          submission_date, scope, justification, sr_edition, contingency_bps,
          establishment_bps, status, remarks, document_id, created_by)
       VALUES
         (@project_id, @dpr_no, @version, @title, @prepared_by, @consultant, @estimated_cost,
          @submission_date, @scope, @justification, @sr_edition, @contingency_bps,
          @establishment_bps, @status, @remarks, @document_id, @created_by)`,
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

// --- DPR estimate lines ------------------------------------------------------

export interface DprItemRow {
  id: number;
  dpr_id: number;
  sl_no: number;
  sr_item_id: number | null;
  sr_code: string | null;
  sr_name: string | null;
  sr_current_rate: number | null;
  item_code: string | null;
  description: string;
  uom: string;
  quantity: number;
  rate: number;
  sr_rate: number;
  amount: number;
  remarks: string | null;
  created_at: string;
}

/**
 * An estimate line with the Schedule of Rates line behind it. The item's
 * *current* rate is read alongside the rate frozen onto the estimate, so a
 * preparer can see at a glance where the rate book has moved since.
 */
const DPR_ITEM_SELECT = `
  SELECT i.*, sr.code AS sr_code, sr.name AS sr_name, sr.rate AS sr_current_rate
    FROM project_dpr_items i
    LEFT JOIN schedule_of_rates sr ON sr.id = i.sr_item_id`;

export function listDprItems(dprId: number): DprItemRow[] {
  return getDb()
    .prepare(`${DPR_ITEM_SELECT} WHERE i.dpr_id = ? ORDER BY i.sl_no`)
    .all(dprId) as DprItemRow[];
}

export function replaceDprItems(
  dprId: number,
  items: {
    sl_no: number;
    sr_item_id: number | null;
    item_code: string | null;
    description: string;
    uom: string;
    quantity: number;
    rate: number;
    sr_rate: number;
    amount: number;
    remarks: string | null;
  }[],
): void {
  const db = getDb();
  db.prepare(`DELETE FROM project_dpr_items WHERE dpr_id = ?`).run(dprId);
  const stmt = db.prepare(
    `INSERT INTO project_dpr_items
       (dpr_id, sl_no, sr_item_id, item_code, description, uom, quantity, rate, sr_rate, amount, remarks)
     VALUES
       (@dpr_id, @sl_no, @sr_item_id, @item_code, @description, @uom, @quantity, @rate, @sr_rate, @amount, @remarks)`,
  );
  for (const item of items) stmt.run({ dpr_id: dprId, ...item });
}

/** The abstract of cost: what the priced items come to, before the percentages. */
export function dprItemsTotal(dprId: number): number {
  const row = getDb()
    .prepare<[number], { total: number | null }>(
      `SELECT SUM(amount) AS total FROM project_dpr_items WHERE dpr_id = ?`,
    )
    .get(dprId);
  return row?.total ?? 0;
}

export interface ScheduleOfRatesItem {
  id: number;
  code: string;
  name: string;
  uom: string;
  rate: number;
  status: string;
}

/** A Schedule of Rates line, read when an estimate line is priced from it. */
export function findScheduleOfRatesItem(id: number): ScheduleOfRatesItem | null {
  return (
    (getDb()
      .prepare(`SELECT id, code, name, uom, rate, status FROM schedule_of_rates WHERE id = ?`)
      .get(id) as ScheduleOfRatesItem | undefined) ?? null
  );
}

/**
 * The same, found by the item number a bill of quantities was written against.
 * Only an active line matches: a withdrawn rate is not a ceiling.
 */
export function findScheduleOfRatesItemByCode(code: string): ScheduleOfRatesItem | null {
  return (
    (getDb()
      .prepare(
        `SELECT id, code, name, uom, rate, status FROM schedule_of_rates
          WHERE code = ? AND status = 'ACTIVE'`,
      )
      .get(code) as ScheduleOfRatesItem | undefined) ?? null
  );
}

// --- Package progress updates ------------------------------------------------

export interface ProgressUpdateRow {
  id: number;
  package_id: number;
  contractor_id: number | null;
  contractor_name: string | null;
  update_date: string;
  physical_progress_pct: number | null;
  narrative: string;
  status: string;
  review_remarks: string | null;
  reviewed_by: number | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
  submitted_by: number | null;
  submitted_by_name: string | null;
  photo_count: number;
  created_at: string;
  updated_at: string;
}

const PROGRESS_UPDATE_SELECT = `
  SELECT pu.*, c.name AS contractor_name,
         r.full_name AS reviewed_by_name, s.full_name AS submitted_by_name,
         (SELECT COUNT(*) FROM documents doc
            WHERE doc.entity_type = 'PACKAGE_PROGRESS_UPDATE' AND doc.entity_id = pu.id) AS photo_count
    FROM package_progress_updates pu
    LEFT JOIN contractors c ON c.id = pu.contractor_id
    LEFT JOIN users r ON r.id = pu.reviewed_by
    LEFT JOIN users s ON s.id = pu.submitted_by`;

export function listProgressUpdates(packageId: number): ProgressUpdateRow[] {
  return getDb()
    .prepare(`${PROGRESS_UPDATE_SELECT} WHERE pu.package_id = ? ORDER BY pu.update_date DESC, pu.id DESC`)
    .all(packageId) as ProgressUpdateRow[];
}

export function findProgressUpdate(id: number): ProgressUpdateRow | null {
  return (
    (getDb().prepare(`${PROGRESS_UPDATE_SELECT} WHERE pu.id = ?`).get(id) as
      | ProgressUpdateRow
      | undefined) ?? null
  );
}

export function insertProgressUpdate(values: {
  package_id: number;
  contractor_id: number | null;
  update_date: string;
  physical_progress_pct: number | null;
  narrative: string;
  status: string;
  submitted_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO package_progress_updates
         (package_id, contractor_id, update_date, physical_progress_pct, narrative, status, submitted_by)
       VALUES
         (@package_id, @contractor_id, @update_date, @physical_progress_pct, @narrative, @status, @submitted_by)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function updateProgressUpdate(id: number, values: Record<string, unknown>): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE package_progress_updates SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteProgressUpdate(id: number): void {
  getDb().prepare(`DELETE FROM package_progress_updates WHERE id = ?`).run(id);
}
