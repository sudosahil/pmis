import { getDb } from './index.js';
import { seed, seedEssentials } from './seed.js';
import { env } from '../config/env.js';
import { hashPassword } from '../services/auth.service.js';
import { ROLES } from '../config/constants.js';

/**
 * A freshly deployed instance has an empty database: the schema creates the
 * tables, but with no roles, no approval chains and no accounts nobody can sign
 * in. This runs once at boot to make the instance usable, and does nothing at
 * all if it already has users.
 *
 * The mode is an explicit choice rather than a default, because the demo seed
 * installs well-known accounts with a published password — fine for a
 * demonstration, wrong for anything real.
 */
export function bootstrapIfEmpty(): void {
  if (env.SEED_ON_BOOT === 'off') return;

  const db = getDb();
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number };
  if (n > 0) return;

  if (env.SEED_ON_BOOT === 'demo') {
    console.log('Empty database — installing the demonstration data.');
    if (env.isProduction) {
      console.warn(
        'WARNING: the demonstration accounts use a published password. ' +
          'Do not leave SEED_ON_BOOT=demo on an instance holding real work.',
      );
    }
    seed();
    return;
  }

  // 'essential': the reference data the system cannot run without, plus one
  // administrator who then creates the real accounts through the interface.
  if (!env.ADMIN_PASSWORD) {
    console.error(
      'SEED_ON_BOOT=essential needs ADMIN_PASSWORD set, so the first administrator has a ' +
        'password only you know. Refusing to guess one.',
    );
    process.exit(1);
  }

  console.log('Empty database — installing reference data and the first administrator.');
  seedEssentials();

  db.prepare(
    `INSERT INTO users (username, email, password_hash, full_name, designation, role_code, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  ).run(
    env.ADMIN_USERNAME,
    env.ADMIN_EMAIL,
    hashPassword(env.ADMIN_PASSWORD),
    'System Administrator',
    'IT Administrator',
    ROLES.ADMIN,
  );

  console.log(
    `Administrator "${env.ADMIN_USERNAME}" created. It must change its password at first sign-in.`,
  );
}
