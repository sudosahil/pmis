import { getDb } from '../db/index.js';

/**
 * The permanent record of every movement of a Schedule of Rates line.
 *
 * A rate is a financial control — it is the ceiling a bid is measured against
 * and the baseline a running bill is verified against — so a revision has to
 * stay explicable years later. The item's code and name are copied onto each
 * entry rather than joined, so the history still reads if the master row is
 * eventually removed.
 */

export interface SrHistoryRow {
  id: number;
  sr_item_id: number | null;
  sr_code: string;
  sr_name: string;
  chapter: string | null;
  uom: string | null;
  change_kind: string;
  old_rate: number | null;
  new_rate: number | null;
  old_sr_year: string | null;
  new_sr_year: string | null;
  old_status: string | null;
  new_status: string | null;
  effective_date: string | null;
  govt_reference: string | null;
  remarks: string | null;
  changed_by: number | null;
  changed_by_name: string | null;
  created_at: string;
}

export const CHANGE_KINDS = [
  'CREATED',
  'RATE_REVISED',
  'EDITION_CHANGED',
  'RENAMED',
  'STATUS_CHANGED',
  'DELETED',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

export function insertEntry(values: {
  sr_item_id: number | null;
  sr_code: string;
  sr_name: string;
  chapter: string | null;
  uom: string | null;
  change_kind: ChangeKind;
  old_rate: number | null;
  new_rate: number | null;
  old_sr_year: string | null;
  new_sr_year: string | null;
  old_status: string | null;
  new_status: string | null;
  effective_date: string | null;
  govt_reference: string | null;
  remarks: string | null;
  changed_by: number | null;
  changed_by_name: string | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO schedule_of_rate_history
         (sr_item_id, sr_code, sr_name, chapter, uom, change_kind,
          old_rate, new_rate, old_sr_year, new_sr_year, old_status, new_status,
          effective_date, govt_reference, remarks, changed_by, changed_by_name)
       VALUES
         (@sr_item_id, @sr_code, @sr_name, @chapter, @uom, @change_kind,
          @old_rate, @new_rate, @old_sr_year, @new_sr_year, @old_status, @new_status,
          @effective_date, @govt_reference, @remarks, @changed_by, @changed_by_name)`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

/** Everything that has happened to one Schedule of Rates line, newest first. */
export function listForItem(srItemId: number): SrHistoryRow[] {
  return getDb()
    .prepare(
      `SELECT * FROM schedule_of_rate_history
        WHERE sr_item_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(srItemId) as SrHistoryRow[];
}

export interface HistoryFilter {
  chapter?: string;
  changeKind?: string;
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export function listHistory(filter: HistoryFilter): { rows: SrHistoryRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filter.chapter) {
    where.push(`chapter = ?`);
    params.push(filter.chapter);
  }
  if (filter.changeKind) {
    where.push(`change_kind = ?`);
    params.push(filter.changeKind);
  }
  if (filter.search) {
    where.push(`(sr_code LIKE ? OR sr_name LIKE ? OR govt_reference LIKE ?)`);
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  if (filter.from) {
    where.push(`date(created_at) >= ?`);
    params.push(filter.from);
  }
  if (filter.to) {
    where.push(`date(created_at) <= ?`);
    params.push(filter.to);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM schedule_of_rate_history ${clause}`)
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT * FROM schedule_of_rate_history ${clause}
        ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, filter.limit, filter.offset) as SrHistoryRow[];

  return { rows, total };
}
