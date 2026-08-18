import { createApp } from './app.js';
import { env } from './config/env.js';
import { closeDb } from './db/index.js';
import { bootstrapIfEmpty } from './db/bootstrap.js';

const app = createApp();

// Runs before the first request is served, and is a no-op once the instance
// has users — so a restart never touches an existing database.
bootstrapIfEmpty();

const server = app.listen(env.PORT, () => {
  console.log(`PMIS API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  console.log(`Database: ${env.databasePath}`);
});

function shutdown(signal: string): void {
  console.log(`\n${signal} received, shutting down.`);
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Do not let a hung connection block the shutdown indefinitely.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
