import type { Request, Response } from 'express';
import { z } from 'zod';
import * as workflowAdmin from '../services/workflow-admin.service.js';
import * as workflowModel from '../models/workflow.model.js';
import { created, noContent, ok } from '../utils/respond.js';
import { notFound, unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const definitionQuerySchema = z.object({
  includeSuperseded: z.enum(['true', 'false']).optional(),
});

export function list(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof definitionQuerySchema>;
  ok(res, workflowAdmin.list(query.includeSuperseded === 'true'));
}

export function getOne(req: Request, res: Response): void {
  ok(res, workflowAdmin.getOne(Number(req.params.id)));
}

/** Every version of the chain this id belongs to, newest first. */
export function history(req: Request, res: Response): void {
  const definition = workflowModel.findDefinitionById(Number(req.params.id));
  if (!definition) throw notFound('Approval chain');
  ok(res, workflowAdmin.history(definition.code));
}

export function create(req: Request, res: Response): void {
  created(
    res,
    workflowAdmin.create(
      req.body as z.infer<typeof workflowAdmin.createDefinitionSchema>,
      requireUser(req),
    ),
  );
}

export function update(req: Request, res: Response): void {
  ok(
    res,
    workflowAdmin.update(
      Number(req.params.id),
      req.body as z.infer<typeof workflowAdmin.updateDefinitionSchema>,
      requireUser(req),
    ),
  );
}

export function replaceSteps(req: Request, res: Response): void {
  ok(
    res,
    workflowAdmin.replaceSteps(
      Number(req.params.id),
      req.body as z.infer<typeof workflowAdmin.replaceStepsSchema>,
      requireUser(req),
    ),
  );
}

export function remove(req: Request, res: Response): void {
  workflowAdmin.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}
