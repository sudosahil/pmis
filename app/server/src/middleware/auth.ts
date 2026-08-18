import type { NextFunction, Request, Response } from 'express';
import { GLOBAL_SCOPE_ROLES, type RoleCode } from '../config/constants.js';
import { findAuthUserById } from '../models/user.model.js';
import { verifyAccessToken } from '../services/token.service.js';
import { forbidden, unauthorized } from '../utils/errors.js';
import * as permissionService from '../services/permission.service.js';
import { findPermission } from '../config/permissions.js';

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
/** Blocks contractor accounts from internal departmental routes. */
/**
 * Gates a route on a permission rather than a hardcoded list of roles, so an
 * administrator can move access between roles without a code change.
 *
 * Passing several permissions means "any of these".
 */
export function requirePermission(...permissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    const held = permissions.some((permission) =>
      permissionService.userHasPermission(req.user!, permission),
    );
    if (!held) {
      const names = permissions
        .map((key) => findPermission(key)?.label ?? key)
        .join(', ');
      return next(
        forbidden(
          `Your role does not have permission to do this (${names}). ` +
            'An administrator can grant it on the role access screen.',
        ),
      );
    }
    next();
  };
}

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
