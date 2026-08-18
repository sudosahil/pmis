/**
 * The PMIS API as a single Vercel serverless function.
 *
 * This is a DEMONSTRATION deployment. Vercel gives a function a writable /tmp
 * that is wiped whenever the instance is recycled and is not shared between
 * concurrent instances, so nothing written here survives: bills raised, files
 * uploaded and messages sent all disappear when the instance goes cold.
 *
 * That is a deliberate trade for a demo — every visitor gets the full seeded
 * department in a known-good state. It is the wrong shape for real work; for
 * that the API belongs on a host with a mounted disk, which is what the
 * `render.yaml` blueprint in the repository root sets up.
 *
 * The database is seeded once at build time and shipped as an asset, then
 * copied into /tmp on cold start. Running the seed here instead would spend
 * several seconds bcrypt-hashing the demonstration accounts before the first
 * page could answer.
 *
 * The .mjs extension is deliberate: the Vercel runtime compiles a bare .js
 * function as CommonJS, which breaks on the first `import.meta`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SEEDED_DB = path.join(here, '..', 'app', 'server', 'dist', 'db', 'demo.db');
const LIVE_DB = '/tmp/pmis.db';

/**
 * Puts a fresh copy of the demonstration database in place before anything
 * opens it. Runs once per instance.
 */
function prepareDatabase() {
  if (fs.existsSync(LIVE_DB)) return;

  if (!fs.existsSync(SEEDED_DB)) {
    throw new Error(
      `The seeded demonstration database is missing at ${SEEDED_DB}. ` +
        'It is built by `npm run build:api` — check the Vercel build log.',
    );
  }

  fs.copyFileSync(SEEDED_DB, LIVE_DB);
  fs.mkdirSync('/tmp/uploads', { recursive: true });
  console.log('Demonstration database copied into /tmp for this instance.');
}

prepareDatabase();

// Imported after the database file is in place, because opening it is the first
// thing the app does.
const { createApp } = await import('../app/server/dist/app.js');
const { bootstrapIfEmpty } = await import('../app/server/dist/db/bootstrap.js');

// A safety net: if the shipped database were ever empty, this fills it rather
// than serving an instance nobody can sign in to.
bootstrapIfEmpty();

// An Express app is already a (request, response) handler, which is exactly
// what the Node runtime expects a function to export.
export default createApp();
