import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

export type Db = Database.Database;

let instance: Db | null = null;

/** Tables whose updated_at is maintained manually (or that have no such column). */
const NO_TOUCH_TRIGGER = new Set(['sqlite_sequence']);

/**
 * Columns added to tables that already existed in a deployed database.
 *
 * `CREATE TABLE IF NOT EXISTS` keeps a fresh checkout working but says nothing
 * about a table that is already there, so a new column on an old table needs
 * an explicit `ALTER TABLE`. Each entry is applied only when the column is
 * missing, which makes running this on every boot harmless. The same columns
 * are written into schema.sql as well, so a database created today gets them
 * from the start and never reaches this list.
 */
const ADDED_COLUMNS: { table: string; column: string; ddl: string }[] = [
  // Schedule of Rates: what authorised a rate, and when it took effect.
  { table: 'schedule_of_rates', column: 'effective_date', ddl: 'TEXT' },
  { table: 'schedule_of_rates', column: 'govt_reference', ddl: 'TEXT' },

  // The DPR as a prepared estimate rather than a single typed figure.
  { table: 'project_dprs', column: 'sr_edition', ddl: 'TEXT' },
  { table: 'project_dprs', column: 'items_total', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'project_dprs', column: 'contingency_bps', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'project_dprs', column: 'establishment_bps', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'project_dprs', column: 'tender_id', ddl: 'INTEGER REFERENCES tenders(id) ON DELETE SET NULL' },

  // The Schedule of Rates ceiling, and relief from it.
  { table: 'tenders', column: 'dpr_id', ddl: 'INTEGER REFERENCES project_dprs(id) ON DELETE SET NULL' },
  { table: 'tenders', column: 'sr_ceiling_enforced', ddl: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'tenders', column: 'sr_ceiling_amount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tenders', column: 'above_sr_permitted', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tenders', column: 'above_sr_cap_bps', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tenders', column: 'above_sr_ground', ddl: 'TEXT' },
  { table: 'tenders', column: 'above_sr_authority', ddl: 'TEXT' },
  { table: 'tenders', column: 'above_sr_remarks', ddl: 'TEXT' },
  { table: 'tenders', column: 'above_sr_granted_by', ddl: 'INTEGER REFERENCES users(id) ON DELETE SET NULL' },
  { table: 'tenders', column: 'above_sr_granted_at', ddl: 'TEXT' },
  { table: 'tender_boq_items', column: 'sr_item_id', ddl: 'INTEGER REFERENCES schedule_of_rates(id) ON DELETE SET NULL' },
  { table: 'tender_boq_items', column: 'sr_rate', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'bids', column: 'sr_ceiling_amount', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'bids', column: 'sr_variation_bps', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'bids', column: 'is_above_sr', ddl: 'INTEGER NOT NULL DEFAULT 0' },
];

function applyAddedColumns(db: Db): void {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const exists = db
      .prepare<[string], { n: number }>(
        `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(table);
    if (!exists?.n) continue;

    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (columns.some((c) => c.name === column)) continue;

    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function applyUpdatedAtTriggers(db: Db): void {
  const tables = db
    .prepare<[], { name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    )
    .all();

  for (const { name } of tables) {
    if (NO_TOUCH_TRIGGER.has(name)) continue;
    const columns = db.prepare(`PRAGMA table_info(${name})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === 'updated_at')) continue;
    const pk = columns.find((c) => c.name === 'id') ? 'id' : columns[0]?.name;
    if (!pk) continue;

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_${name}_updated_at
      AFTER UPDATE ON ${name}
      FOR EACH ROW
      WHEN OLD.updated_at = NEW.updated_at
      BEGIN
        UPDATE ${name} SET updated_at = datetime('now') WHERE ${pk} = NEW.${pk};
      END;
    `);
  }
}

/**
 * Opens (and on first call, creates) the SQLite database. The schema is
 * idempotent, so running this on every boot keeps a fresh checkout working
 * without a separate migration step.
 */
export function getDb(): Db {
  if (instance) return instance;

  const dir = path.dirname(env.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  const db = new Database(env.databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  const schemaPath = path.resolve(import.meta.dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  applyAddedColumns(db);
  applyUpdatedAtTriggers(db);

  instance = db;
  return db;
}

export function closeDb(): void {
  instance?.close();
  instance = null;
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
export function transaction<T>(fn: () => T): T {
  const db = getDb();
  return db.transaction(fn)();
}

/**
 * Atomically increments a named counter and returns the new value.
 * Used for project codes, bill numbers, DBR numbers and the like.
 */
export function nextSequence(key: string): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO sequences (key, value) VALUES (?, 0) ON CONFLICT(key) DO NOTHING`,
  ).run(key);
  db.prepare(`UPDATE sequences SET value = value + 1 WHERE key = ?`).run(key);
  const row = db.prepare<[string], { value: number }>(
    `SELECT value FROM sequences WHERE key = ?`,
  ).get(key);
  return row?.value ?? 1;
}
