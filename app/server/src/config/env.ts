import 'dotenv/config';
import path from 'node:path';
import { z } from 'zod';

/**
 * Environment is validated once at boot. A missing or malformed variable should
 * stop the process here rather than surface as a confusing runtime failure.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_FILE: z.string().default('./data/pmis.db'),
  JWT_ACCESS_SECRET: z.string().min(8).default('dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: z.string().min(8).default('dev-refresh-secret-change-me'),
  ACCESS_TOKEN_TTL: z.string().default('30m'),
  REFRESH_TOKEN_TTL: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const raw = parsed.data;
const serverRoot = path.resolve(import.meta.dirname, '..', '..');

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  serverRoot,
  databasePath: path.isAbsolute(raw.DATABASE_FILE)
    ? raw.DATABASE_FILE
    : path.resolve(serverRoot, raw.DATABASE_FILE),
  corsOrigins: raw.CORS_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

if (env.isProduction) {
  const weak = ['dev-access-secret-change-me', 'dev-refresh-secret-change-me'];
  if (weak.includes(env.JWT_ACCESS_SECRET) || weak.includes(env.JWT_REFRESH_SECRET)) {
    console.error('Refusing to start in production with the default JWT secrets.');
    process.exit(1);
  }
}
