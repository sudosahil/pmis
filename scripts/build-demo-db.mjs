/**
 * Builds the demonstration database as a build artefact.
 *
 * The Vercel deployment is serverless, so its only writable directory is /tmp,
 * which is empty on every cold start. Seeding there at request time would cost
 * several seconds of bcrypt before the first page could answer, so the seeded
 * database is produced once here and shipped alongside the function, which then
 * only has to copy a file.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'app', 'server');
const target = path.join(serverRoot, 'dist', 'db', 'demo.db');

// Start from nothing, so a rebuild never stacks a second seed on the first.
for (const suffix of ['', '-wal', '-shm']) {
  fs.rmSync(`${target}${suffix}`, { force: true });
}
fs.mkdirSync(path.dirname(target), { recursive: true });

console.log('Seeding the demonstration database…');
execFileSync(process.execPath, [path.join(serverRoot, 'dist', 'db', 'seed.js')], {
  cwd: serverRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    DATABASE_FILE: target,
    DATA_DIR: path.join(serverRoot, 'dist', 'db'),
  },
});

if (!fs.existsSync(target)) {
  console.error('The seed produced no database file.');
  process.exit(1);
}

// The write-ahead log has to be folded back into the main file, or the copy
// that reaches /tmp is missing everything the seed just wrote.
const { default: Database } = await import('better-sqlite3');
const db = new Database(target);
db.pragma('wal_checkpoint(TRUNCATE)');
db.pragma('journal_mode = DELETE');
db.close();

for (const suffix of ['-wal', '-shm']) {
  fs.rmSync(`${target}${suffix}`, { force: true });
}

const { size } = fs.statSync(target);
console.log(`Demonstration database built: ${(size / 1024).toFixed(0)} KB at ${target}`);
