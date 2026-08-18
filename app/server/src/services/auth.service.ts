import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import {
  consumeRefreshToken,
  issueRefreshToken,
  revokeAllUserTokens,
  revokeRefreshToken,
  signAccessToken,
} from './token.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, unauthorized } from '../utils/errors.js';

const MAX_FAILED_ATTEMPTS = 5;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, env.BCRYPT_ROUNDS);
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: userModel.UserSummary;
  mustChangePassword: boolean;
}

/**
 * Authenticates by username or email. The same message is returned for an
 * unknown account and a wrong password so the endpoint cannot be used to
 * enumerate valid usernames.
 */
export function login(login: string, password: string, ip?: string): LoginResult {
  const generic = unauthorized('The username or password is incorrect.');
  const row = userModel.findByLogin(login);
  if (!row) {
    bcrypt.compareSync(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw generic;
  }

  if (row.status === 'LOCKED') {
    throw unauthorized('This account is locked. Contact your system administrator.');
  }
  if (row.status !== 'ACTIVE') {
    throw unauthorized('This account is not active. Contact your system administrator.');
  }

  if (!bcrypt.compareSync(password, row.password_hash)) {
    const attempts = userModel.recordFailedLogin(row.id);
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      userModel.updateUserFields(row.id, { status: 'LOCKED' });
      insertAuditEntry({
        userId: row.id,
        action: 'AUTH_ACCOUNT_LOCKED',
        entityType: 'USER',
        entityId: row.id,
        detail: `Locked after ${attempts} failed attempts`,
        ipAddress: ip,
      });
    }
    throw generic;
  }

  userModel.recordSuccessfulLogin(row.id);
  const summary = userModel.findSummaryById(row.id)!;
  const authUser = userModel.findAuthUserById(row.id)!;

  insertAuditEntry({
    userId: row.id,
    action: 'AUTH_LOGIN',
    entityType: 'USER',
    entityId: row.id,
    detail: `Signed in as ${summary.roleCode}`,
    ipAddress: ip,
  });

  return {
    accessToken: signAccessToken(authUser),
    refreshToken: issueRefreshToken(row.id),
    user: summary,
    mustChangePassword: row.must_change_password === 1,
  };
}

/** Rotates a refresh token: the presented token is revoked and a new pair issued. */
export function refresh(token: string): { accessToken: string; refreshToken: string; user: userModel.UserSummary } {
  const userId = consumeRefreshToken(token);
  const authUser = userModel.findAuthUserById(userId);
  if (!authUser) throw unauthorized('This account is no longer active.');

  return {
    accessToken: signAccessToken(authUser),
    refreshToken: issueRefreshToken(userId),
    user: userModel.findSummaryById(userId)!,
  };
}

export function logout(token: string | undefined, user: AuthUser | undefined, ip?: string): void {
  if (token) revokeRefreshToken(token);
  if (user) {
    insertAuditEntry({
      userId: user.id,
      action: 'AUTH_LOGOUT',
      entityType: 'USER',
      entityId: user.id,
      ipAddress: ip,
    });
  }
}

export function changePassword(
  user: AuthUser,
  currentPassword: string,
  newPassword: string,
  ip?: string,
): void {
  const row = userModel.findRowById(user.id);
  if (!row) throw unauthorized();
  if (!bcrypt.compareSync(currentPassword, row.password_hash)) {
    throw badRequest('Your current password is incorrect.');
  }
  if (bcrypt.compareSync(newPassword, row.password_hash)) {
    throw badRequest('The new password must be different from the current one.');
  }

  userModel.setPasswordHash(user.id, hashPassword(newPassword));
  // Every other session is invalidated so a stolen token cannot outlive the reset.
  revokeAllUserTokens(user.id);

  insertAuditEntry({
    userId: user.id,
    action: 'AUTH_PASSWORD_CHANGED',
    entityType: 'USER',
    entityId: user.id,
    ipAddress: ip,
  });
}
