import type { NextFunction, Request, Response } from 'express';
import { GLOBAL_SCOPE_ROLES, type RoleCode } from '../config/constants.js';
import { findAuthUserById } from '../models/user.model.js';
import { verifyAccessToken } from '../services/token.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';

/**
 * Verifies the bearer token and re-reads the user from the database, so a
 * deactivated account or a role change takes effect on the next request rather
 * than when the token happens to expire.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(unauthorized('Sign in to continue.'));
  }

  try {
    const payload = verifyAccessToken(header.slice(7));
    const user = findAuthUserById(payload.sub);
    if (!user) return next(unauthorized('This account no longer exists.'));
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/** Restricts a route to the listed roles. */
export function requireRole(...roles: RoleCode[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.roleCode)) {
      return next(forbidden(`This action is restricted to: ${roles.join(', ')}.`));
    }
    next();
  };
}

/** Blocks contractor accounts from internal departmental routes. */
export function requireStaff(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  if (req.user.roleCode === 'CONTRACTOR') {
    return next(forbidden('This section is available to departmental staff only.'));
  }
  next();
}

/** True when the user may see records outside their own division. */
export function hasGlobalScope(roleCode: RoleCode): boolean {
  return GLOBAL_SCOPE_ROLES.includes(roleCode);
}
