/**
 * `tsc` compiles TypeScript and nothing else, so the schema — which the app
 * reads at boot to create its tables — has to be carried into dist by hand.
 * Without this a production start crashes looking for dist/db/schema.sql.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ASSETS = [['src/db/schema.sql', 'dist/db/schema.sql']];

for (const [from, to] of ASSETS) {
  const source = path.join(serverRoot, from);
  const target = path.join(serverRoot, to);

  if (!fs.existsSync(source)) {
    console.error(`Missing build asset: ${from}`);
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`Copied ${from} -> ${to}`);
}
