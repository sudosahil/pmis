import type { Request, Response } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import * as userModel from '../models/user.model.js';
import * as permissionService from '../services/permission.service.js';
import { ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username or email.').max(120),
  password: z.string().min(1, 'Enter your password.').max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'A refresh token is required.'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: z
      .string()
      .min(10, 'Use at least 10 characters.')
      .max(200)
      .regex(/[A-Z]/, 'Include at least one capital letter.')
      .regex(/[a-z]/, 'Include at least one small letter.')
      .regex(/[0-9]/, 'Include at least one number.'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'The two passwords do not match.',
    path: ['confirmPassword'],
  });

/** The client needs to know what to show, so the session carries its grants. */
function withPermissions<T extends { user: userModel.UserSummary }>(result: T) {
  return {
    ...result,
    user: {
      ...result.user,
      permissions: permissionService.permissionsFor(result.user.roleCode),
    },
  };
}

export function login(req: Request, res: Response): void {
  const { username, password } = req.body as z.infer<typeof loginSchema>;
  ok(res, withPermissions(authService.login(username, password, req.ip)));
}

export function refresh(req: Request, res: Response): void {
  const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
  ok(res, withPermissions(authService.refresh(refreshToken)));
}

export function logout(req: Request, res: Response): void {
  const token = (req.body as { refreshToken?: string })?.refreshToken;
  authService.logout(token, req.user, req.ip);
  ok(res, { message: 'Signed out.' });
}

export function me(req: Request, res: Response): void {
  if (!req.user) throw unauthorized();
  const summary = userModel.findSummaryById(req.user.id);
  // The client hides what the user cannot do; the server still enforces it.
  ok(res, { ...summary, permissions: permissionService.permissionsFor(req.user.roleCode) });
}

export function changePassword(req: Request, res: Response): void {
  if (!req.user) throw unauthorized();
  const body = req.body as z.infer<typeof changePasswordSchema>;
  authService.changePassword(req.user, body.currentPassword, body.newPassword, req.ip);
  ok(res, { message: 'Your password has been changed. Please sign in again.' });
}

export function roles(_req: Request, res: Response): void {
  ok(res, userModel.listRoles());
}
