import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as activityService from '../services/activity.service.js';
import { ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function list(req: Request, res: Response): void {
  requireUser(req);
  ok(res, activityService.list(req.query as unknown as z.infer<typeof activityService.activityQuerySchema>));
}

export function online(_req: Request, res: Response): void {
  ok(res, activityService.online());
}

export function overview(_req: Request, res: Response): void {
  ok(res, activityService.overview());
}

export function prune(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof activityService.pruneSchema>;
  ok(res, activityService.prune(body.days));
}
