import type { Request, Response } from 'express';
import { z } from 'zod';
import * as userService from '../services/user.service.js';
import { created, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const byRoleQuerySchema = z.object({
  roleCode: z.string().trim().min(1).max(20),
  divisionId: z.coerce.number().int().positive().optional(),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function list(req: Request, res: Response): void {
  ok(res, userService.list(req.query as unknown as z.infer<typeof userService.listUsersQuerySchema>));
}

export function getOne(req: Request, res: Response): void {
  ok(res, userService.getOne(Number(req.params.id)));
}

export function create(req: Request, res: Response): void {
  created(
    res,
    userService.create(req.body as z.infer<typeof userService.createUserSchema>, requireUser(req)),
  );
}

export function update(req: Request, res: Response): void {
  ok(
    res,
    userService.update(
      Number(req.params.id),
      req.body as z.infer<typeof userService.updateUserSchema>,
      requireUser(req),
    ),
  );
}

export function resetPassword(req: Request, res: Response): void {
  ok(res, userService.resetPassword(Number(req.params.id), requireUser(req)));
}

/** Populates the "assign to officer" picker on an approval screen. */
export function byRole(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof byRoleQuerySchema>;
  const user = requireUser(req);
  ok(res, userService.listByRole(query.roleCode, query.divisionId ?? user.divisionId ?? undefined));
}
