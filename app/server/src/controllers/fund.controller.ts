import type { Request, Response } from 'express';
import { z } from 'zod';
import * as fundService from '../services/fund.service.js';
import * as workflowService from '../services/workflow.service.js';
import { ENTITY_TYPES } from '../config/constants.js';
import { created, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const releaseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  schemeId: z.coerce.number().int().positive().optional(),
  projectId: z.coerce.number().int().positive().optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const locQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  status: z.string().trim().max(30).optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const remarksSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function listReleases(req: Request, res: Response): void {
  ok(
    res,
    fundService.listReleases(
      requireUser(req),
      req.query as unknown as z.infer<typeof releaseQuerySchema>,
    ),
  );
}

export function createRelease(req: Request, res: Response): void {
  created(
    res,
    fundService.createRelease(
      req.body as z.infer<typeof fundService.fundReleaseSchema>,
      requireUser(req),
    ),
  );
}

export function listLoc(req: Request, res: Response): void {
  ok(
    res,
    fundService.listLocRequests(requireUser(req), req.query as unknown as z.infer<typeof locQuerySchema>),
  );
}

export function getLoc(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...fundService.getLoc(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.LOC, id, user),
  });
}

export function createLoc(req: Request, res: Response): void {
  created(
    res,
    fundService.createLoc(req.body as z.infer<typeof fundService.locRequestSchema>, requireUser(req)),
  );
}

export function submitLoc(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, fundService.submitLoc(Number(req.params.id), requireUser(req), body?.remarks));
}

export function setApprovedAmount(req: Request, res: Response): void {
  ok(
    res,
    fundService.setApprovedAmount(
      Number(req.params.id),
      req.body as z.infer<typeof fundService.locApprovalSchema>,
      requireUser(req),
    ),
  );
}
