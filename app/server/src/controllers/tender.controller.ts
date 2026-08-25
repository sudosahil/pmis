import type { Request, Response } from 'express';
import { z } from 'zod';
import * as tenderService from '../services/tender.service.js';
import * as workflowService from '../services/workflow.service.js';
import { ENTITY_TYPES } from '../config/constants.js';
import { created, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  projectId: z.coerce.number().int().positive().optional(),
});

export const remarksSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

export const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Record a reason.').max(500),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function list(req: Request, res: Response): void {
  ok(res, tenderService.list(requireUser(req), req.query as unknown as z.infer<typeof listQuerySchema>));
}

export function getOne(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...tenderService.getOne(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.TENDER, id, user),
  });
}

export function create(req: Request, res: Response): void {
  created(
    res,
    tenderService.create(req.body as z.infer<typeof tenderService.createTenderSchema>, requireUser(req)),
  );
}

export function update(req: Request, res: Response): void {
  ok(
    res,
    tenderService.update(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.updateTenderSchema>,
      requireUser(req),
    ),
  );
}

export function submitForApproval(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, tenderService.submitForApproval(Number(req.params.id), requireUser(req), body?.remarks));
}

export function publish(req: Request, res: Response): void {
  ok(res, tenderService.publish(Number(req.params.id), requireUser(req)));
}

export function closeBidding(req: Request, res: Response): void {
  ok(res, tenderService.closeBidding(Number(req.params.id), requireUser(req)));
}

export function cancel(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof reasonSchema>;
  ok(res, tenderService.cancelTender(Number(req.params.id), body.reason, requireUser(req)));
}

export function submitBid(req: Request, res: Response): void {
  created(
    res,
    tenderService.submitBid(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.submitBidSchema>,
      requireUser(req),
    ),
  );
}

export function myBids(req: Request, res: Response): void {
  const query = req.query as unknown as { page: number; pageSize: number };
  ok(res, tenderService.listMyBids(requireUser(req), query.page, query.pageSize));
}

export function startTechnicalEvaluation(req: Request, res: Response): void {
  ok(res, tenderService.startTechnicalEvaluation(Number(req.params.id), requireUser(req)));
}

export function recordTechnicalEvaluation(req: Request, res: Response): void {
  ok(
    res,
    tenderService.recordTechnicalEvaluation(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.technicalEvaluationSchema>,
      requireUser(req),
    ),
  );
}

export function openFinancialBids(req: Request, res: Response): void {
  ok(res, tenderService.openFinancialBids(Number(req.params.id), requireUser(req)));
}

export function award(req: Request, res: Response): void {
  ok(
    res,
    tenderService.award(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.awardSchema>,
      requireUser(req),
    ),
  );
}

// --- Qualification criteria --------------------------------------------------

export function listCriteria(req: Request, res: Response): void {
  ok(res, tenderService.listCriteria(Number(req.params.id), requireUser(req)));
}

export function replaceCriteria(req: Request, res: Response): void {
  ok(
    res,
    tenderService.replaceCriteria(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.replaceCriteriaSchema>,
      requireUser(req),
    ),
  );
}

// --- The Schedule of Rates ceiling -------------------------------------------

export function grantSrRelief(req: Request, res: Response): void {
  ok(
    res,
    tenderService.grantSrRelief(
      Number(req.params.id),
      req.body as z.infer<typeof tenderService.srReliefSchema>,
      requireUser(req),
    ),
  );
}

export function withdrawSrRelief(req: Request, res: Response): void {
  ok(res, tenderService.withdrawSrRelief(Number(req.params.id), requireUser(req)));
}

// --- From report to tender document ------------------------------------------

export function convertDpr(req: Request, res: Response): void {
  created(
    res,
    tenderService.createFromDpr(
      Number(req.params.dprId),
      req.body as z.infer<typeof tenderService.convertDprSchema>,
      requireUser(req),
    ),
  );
}
