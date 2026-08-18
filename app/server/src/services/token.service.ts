import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { getDb } from '../db/index.js';
import { unauthorized } from '../utils/errors.js';
import type { AccessTokenPayload, AuthUser, RefreshTokenPayload } from '../types/auth.js';

/**
 * Refresh tokens are stored only as SHA-256 digests, so a database leak cannot
 * be replayed against the API. Each refresh rotates the token and revokes its
 * predecessor.
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function ttlToMs(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) throw new Error(`Unsupported token TTL: ${ttl}`);
  const value = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const factor = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return value * factor;
}

export function signAccessToken(user: AuthUser): string {
  const payload: AccessTokenPayload = {
    sub: user.id,
    username: user.username,
    role: user.roleCode,
    divisionId: user.divisionId,
    circleId: user.circleId,
    zoneId: user.zoneId,
    subDivisionId: user.subDivisionId,
    contractorId: user.contractorId,
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'pmis',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'pmis',
    }) as unknown as AccessTokenPayload;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
}

export function issueRefreshToken(userId: number): string {
  const jti = crypto.randomUUID();
  const payload: RefreshTokenPayload = { sub: userId, jti };
  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'pmis',
  });

  const expiresAt = new Date(Date.now() + ttlToMs(env.REFRESH_TOKEN_TTL))
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19);

  getDb()
    .prepare(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`)
    .run(userId, hashToken(token), expiresAt);

  return token;
}

/** Verifies a refresh token against both its signature and the stored digest. */
export function consumeRefreshToken(token: string): number {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: 'pmis',
    }) as unknown as RefreshTokenPayload;
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const db = getDb();
  const row = db
    .prepare<[string], { id: number; user_id: number; revoked_at: string | null; expires_at: string }>(
      `SELECT id, user_id, revoked_at, expires_at FROM refresh_tokens WHERE token_hash = ?`,
    )
    .get(hashToken(token));

  if (!row || row.revoked_at) throw unauthorized('This session is no longer valid.');
  if (new Date(`${row.expires_at}Z`).getTime() < Date.now()) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);
  return payload.sub;
}

export function revokeRefreshToken(token: string): void {
  getDb()
    .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE token_hash = ? AND revoked_at IS NULL`)
    .run(hashToken(token));
}

export function revokeAllUserTokens(userId: number): void {
  getDb()
    .prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`)
    .run(userId);
}
