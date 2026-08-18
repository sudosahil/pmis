import type { Request, Response } from 'express';
import { z } from 'zod';
import * as contractorService from '../services/contractor.service.js';
import * as workflowService from '../services/workflow.service.js';
import * as masterService from '../services/master.service.js';
import { ENTITY_TYPES } from '../config/constants.js';
import { created, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  registrationStatus: z.enum(['PENDING', 'VERIFIED', 'APPROVED', 'REJECTED']).optional(),
  registrationClass: z.enum(['Class A', 'Class B', 'Class C', 'Class D']).optional(),
  blacklisted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const blacklistSchema = z.object({
  blacklisted: z.boolean(),
  reason: z.string().trim().min(5, 'Record why this change is being made.').max(500),
});

/** Public: the bank list the registration form needs before an account exists. */
export function registrationBanks(_req: Request, res: Response): void {
  ok(res, masterService.options('banks'));
}

/** Public: the self-service registration form on the contractor portal. */
export function register(req: Request, res: Response): void {
  const result = contractorService.register(
    req.body as contractorService.RegistrationInput,
    req.ip,
  );
  created(res, {
    contractorCode: result.code,
    username: result.username,
    // Stands in for the activation link that production would email.
    activationToken: result.activationToken,
    message:
      'Registration submitted. Your account activates once the division office verifies your details.',
  });
}

export function list(req: Request, res: Response): void {
  ok(res, contractorService.list(req.query as unknown as z.infer<typeof listQuerySchema>));
}

export function getOne(req: Request, res: Response): void {
  if (!req.user) throw unauthorized();
  const id = Number(req.params.id);
  ok(res, {
    ...contractorService.getOne(id, req.user),
    stats: contractorService.stats(id),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.CONTRACTOR, id, req.user),
  });
}

export function update(req: Request, res: Response): void {
  if (!req.user) throw unauthorized();
  ok(
    res,
    contractorService.update(
      Number(req.params.id),
      req.body as z.infer<typeof contractorService.updateContractorSchema>,
      req.user,
    ),
  );
}

export function setBlacklist(req: Request, res: Response): void {
  if (!req.user) throw unauthorized();
  const body = req.body as z.infer<typeof blacklistSchema>;
  ok(res, contractorService.setBlacklist(Number(req.params.id), body.blacklisted, body.reason, req.user));
}

export function myProfile(req: Request, res: Response): void {
  if (!req.user?.contractorId) throw unauthorized('This view is for contractor accounts.');
  ok(res, {
    profile: contractorService.getOne(req.user.contractorId, req.user),
    stats: contractorService.stats(req.user.contractorId),
  });
}

export function eligible(req: Request, res: Response): void {
  const minClass = (req.query as { minClass?: string }).minClass ?? null;
  ok(res, contractorService.listEligible(minClass));
}
