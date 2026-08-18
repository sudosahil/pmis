import { getDb } from '../db/index.js';
import { getMasterDefinition, type MasterDefinition } from '../config/masters.js';

export interface MasterRow {
  id: number;
  [key: string]: unknown;
}

/** Builds the SELECT/JOIN pair that resolves every lookup field to a label. */
function buildSelect(def: MasterDefinition): { select: string; joins: string } {
  const columns = ['t.id', 't.created_at', 't.updated_at', ...def.fields.map((f) => `t.${f.column}`)];
  const joins: string[] = [];

  def.fields
    .filter((f) => f.type === 'lookup' && f.refKey)
    .forEach((field, index) => {
      const ref = getMasterDefinition(field.refKey!);
      if (!ref) return;
      const alias = `ref${index}`;
      joins.push(`LEFT JOIN ${ref.table} ${alias} ON ${alias}.id = t.${field.column}`);
      columns.push(`${alias}.name AS ${field.column}__label`);
      columns.push(`${alias}.code AS ${field.column}__code`);
    });

  return { select: columns.join(', '), joins: joins.join('\n') };
}

export interface ListMastersOptions {
  search?: string;
  status?: string;
  limit: number;
  offset: number;
}

export function listMasterRows(
  def: MasterDefinition,
  options: ListMastersOptions,
): { rows: MasterRow[]; total: number } {
  const { select, joins } = buildSelect(def);
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search && def.searchColumns.length) {
    where.push(`(${def.searchColumns.map((c) => `t.${c} LIKE ?`).join(' OR ')})`);
    def.searchColumns.forEach(() => params.push(`%${options.search}%`));
  }
  if (options.status) {
    where.push(`t.status = ?`);
    params.push(options.status);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM ${def.table} t ${joins} ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(
      `SELECT ${select} FROM ${def.table} t ${joins} ${clause}
       ORDER BY t.${def.orderBy} LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as MasterRow[];

  return { rows, total };
}

export function findMasterRow(def: MasterDefinition, id: number): MasterRow | null {
  const { select, joins } = buildSelect(def);
  return (
    (getDb()
      .prepare(`SELECT ${select} FROM ${def.table} t ${joins} WHERE t.id = ?`)
      .get(id) as MasterRow | undefined) ?? null
  );
}

export function findMasterRowByCode(def: MasterDefinition, code: string): MasterRow | null {
  return (
    (getDb()
      .prepare(`SELECT * FROM ${def.table} WHERE code = ?`)
      .get(code) as MasterRow | undefined) ?? null
  );
}

export function insertMasterRow(def: MasterDefinition, values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const columns = entries.map(([k]) => k).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  const result = getDb()
    .prepare(`INSERT INTO ${def.table} (${columns}) VALUES (${placeholders})`)
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateMasterRow(
  def: MasterDefinition,
  id: number,
  values: Record<string, unknown>,
): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE ${def.table} SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteMasterRow(def: MasterDefinition, id: number): void {
  getDb().prepare(`DELETE FROM ${def.table} WHERE id = ?`).run(id);
}

export interface LookupOption {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
}

/**
 * Options for a dropdown. `parentColumn`/`parentId` narrow the list to a
 * selected parent — the frontend uses this to cascade Zone -> Circle ->
 * Division -> Sub Division.
 */
export function listMasterOptions(
  def: MasterDefinition,
  parentId?: number,
): LookupOption[] {
  const parentField = def.fields.find((f) => f.type === 'lookup');
  const parentColumn = parentField?.column;
  const params: unknown[] = [];
  let clause = `WHERE status = 'ACTIVE'`;

  if (parentColumn && parentId) {
    clause += ` AND ${parentColumn} = ?`;
    params.push(parentId);
  }

  const parentSelect = parentColumn ? `${parentColumn} AS parentId` : `NULL AS parentId`;
  return getDb()
    .prepare(`SELECT id, code, name, ${parentSelect} FROM ${def.table} ${clause} ORDER BY ${def.orderBy}`)
    .all(...params) as LookupOption[];
}
