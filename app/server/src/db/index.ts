import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { env } from '../config/env.js';

export type Db = Database.Database;

let instance: Db | null = null;

/** Tables whose updated_at is maintained manually (or that have no such column). */
const NO_TOUCH_TRIGGER = new Set(['sqlite_sequence']);

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
