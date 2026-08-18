/**
 * Drops the SQLite database file and rebuilds it from schema.sql, then seeds.
 * Development convenience only — never wired to a production entry point.
 */
import fs from 'node:fs';
import { env } from '../config/env.js';
import { closeDb, getDb } from './index.js';
import { seed } from './seed.js';

if (env.isProduction) {
  console.error('Refusing to reset the database in production.');
  process.exit(1);
}

closeDb();
for (const suffix of ['', '-wal', '-shm']) {
  const file = `${env.databasePath}${suffix}`;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    console.log(`Removed ${file}`);
  }
}

getDb();
console.log('Schema created.');
seed();
