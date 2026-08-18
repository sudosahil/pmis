import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as permissionService from '../services/permission.service.js';
import { ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** The full grid: every permission, every role, and what each role holds. */
export function catalogue(_req: Request, res: Response): void {
  ok(res, permissionService.catalogue());
}

export function setRolePermissions(req: Request, res: Response): void {
  ok(
    res,
    permissionService.setRolePermissions(
      String(req.params.roleCode),
      req.body as z.infer<typeof permissionService.updateRoleSchema>,
      requireUser(req),
    ),
  );
}

export function resetRole(req: Request, res: Response): void {
  ok(res, permissionService.resetRole(String(req.params.roleCode), requireUser(req)));
}
