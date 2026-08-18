import fs from 'node:fs';
import path from 'node:path';

/**
 * Integration tests run against a real SQLite file, not a mock — the money
 * arithmetic, the foreign keys and the ON DELETE strategies are all part of
 * what is under test. Each run starts from an empty database.
 *
 * These variables must be set before any module reads `config/env.ts`, which is
 * why this runs as a vitest setup file rather than inside a test.
 */
const databaseFile = path.resolve(import.meta.dirname, '..', '..', 'data', 'test.db');

process.env.NODE_ENV = 'test';
process.env.DATABASE_FILE = databaseFile;

for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${databaseFile}${suffix}`, { force: true });
}
