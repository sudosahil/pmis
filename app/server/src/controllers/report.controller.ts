import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as reportService from '../services/report.service.js';
import { ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** What reports exist, and the filters they can be narrowed by. */
export function catalogue(req: Request, res: Response): void {
  ok(res, reportService.catalogue(requireUser(req)));
}

export function run(req: Request, res: Response): void {
  ok(
    res,
    reportService.run(
      req.params.key!,
      requireUser(req),
      req.query as unknown as z.infer<typeof reportService.reportQuerySchema>,
    ),
  );
}
