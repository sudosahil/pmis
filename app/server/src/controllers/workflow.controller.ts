import type { Request, Response } from 'express';
import { z } from 'zod';
import * as workflowService from '../services/workflow.service.js';
import * as dashboardService from '../services/dashboard.service.js';
import * as workflowModel from '../models/workflow.model.js';
import { ENTITY_TYPES, WORKFLOW_ACTIONS } from '../config/constants.js';
import { ok } from '../utils/respond.js';
import { notFound, unauthorized } from '../utils/errors.js';

export const inboxQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  entityType: z.enum(Object.values(ENTITY_TYPES) as [string, ...string[]]).optional(),
});

export const actionSchema = z
  .object({
    action: z.enum([
      WORKFLOW_ACTIONS.APPROVE,
      WORKFLOW_ACTIONS.REJECT,
      WORKFLOW_ACTIONS.RETURN,
      WORKFLOW_ACTIONS.ASSIGN,
    ]),
    remarks: z.string().trim().max(2000).optional(),
    assignToUserId: z.coerce.number().int().positive().optional(),
    returnToStepId: z.coerce.number().int().positive().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.action === WORKFLOW_ACTIONS.REJECT || data.action === WORKFLOW_ACTIONS.RETURN) &&
      !data.remarks?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remarks'],
        message: 'Record a reason for this decision.',
      });
    }
    if (data.action === WORKFLOW_ACTIONS.ASSIGN && !data.assignToUserId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['assignToUserId'],
        message: 'Select the officer to assign this item to.',
      });
    }
  });

export const cancelSchema = z.object({
  remarks: z.string().trim().min(5, 'Record why this item is being withdrawn.').max(1000),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function inbox(req: Request, res: Response): void {
  ok(
    res,
    dashboardService.getApprovalInbox(
      requireUser(req),
      req.query as unknown as z.infer<typeof inboxQuerySchema>,
    ),
  );
}

export function mySubmissions(req: Request, res: Response): void {
  const query = req.query as unknown as { page: number; pageSize: number };
  ok(res, dashboardService.getMySubmissions(requireUser(req), query.page, query.pageSize));
}

export function getOne(req: Request, res: Response): void {
  const view = workflowService.getWorkflowView(Number(req.params.id), requireUser(req));
  if (!view) throw notFound('Approval item');
  ok(res, view);
}

export function act(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof actionSchema>;
  const outcome = workflowService.act({
    instanceId: Number(req.params.id),
    actor: requireUser(req),
    action: body.action,
    remarks: body.remarks ?? null,
    assignToUserId: body.assignToUserId ?? null,
    returnToStepId: body.returnToStepId ?? null,
  });
  ok(res, {
    status: outcome.status,
    action: outcome.action,
    nextStep: outcome.nextStep ? { id: outcome.nextStep.id, name: outcome.nextStep.name } : null,
    workflow: workflowService.getWorkflowView(outcome.instance.id, requireUser(req)),
  });
}

export function cancel(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof cancelSchema>;
  const outcome = workflowService.cancel(Number(req.params.id), requireUser(req), body.remarks);
  ok(res, { status: outcome.status });
}

/** The configured approval chains, shown on the workflow reference screen. */
export function definitions(_req: Request, res: Response): void {
  const definitions = workflowModel.listDefinitions().map((def) => ({
    id: def.id,
    code: def.code,
    name: def.name,
    entityType: def.entity_type,
    description: def.description,
    steps: workflowModel.listSteps(def.id).map((step) => ({
      id: step.id,
      seq: step.seq,
      code: step.code,
      name: step.name,
      roleCode: step.role_code,
      scope: step.scope,
      slaDays: step.sla_days,
      allowReturn: Boolean(step.allow_return),
      allowReject: Boolean(step.allow_reject),
    })),
  }));
  ok(res, definitions);
}
