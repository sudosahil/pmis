import type { Request, Response } from 'express';
import { z } from 'zod';
import * as projectService from '../services/project.service.js';
import * as packageService from '../services/package.service.js';
import * as workflowService from '../services/workflow.service.js';
import { ENTITY_TYPES } from '../config/constants.js';
import { created, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const projectListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  schemeId: z.coerce.number().int().positive().optional(),
  divisionId: z.coerce.number().int().positive().optional(),
  workTypeId: z.coerce.number().int().positive().optional(),
  sort: z.enum(['code', 'name', 'cost', 'progress', 'createdAt', 'status']).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const packageListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  contractorId: z.coerce.number().int().positive().optional(),
  status: z.string().trim().max(30).optional(),
});

export const remarksSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

// --- Projects --------------------------------------------------------------

export function list(req: Request, res: Response): void {
  ok(
    res,
    projectService.list(
      requireUser(req),
      req.query as unknown as z.infer<typeof projectListQuerySchema>,
    ),
  );
}

export function getOne(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...projectService.getOne(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.PROJECT, id, user),
  });
}

export function create(req: Request, res: Response): void {
  created(
    res,
    projectService.create(
      req.body as z.infer<typeof projectService.createProjectSchema>,
      requireUser(req),
    ),
  );
}

export function update(req: Request, res: Response): void {
  ok(
    res,
    projectService.update(
      Number(req.params.id),
      req.body as z.infer<typeof projectService.updateProjectSchema>,
      requireUser(req),
    ),
  );
}

export function submitForSanction(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, projectService.submitForSanction(Number(req.params.id), requireUser(req), body?.remarks));
}

export function saveMilestones(req: Request, res: Response): void {
  ok(
    res,
    projectService.saveMilestones(
      Number(req.params.id),
      req.body as z.infer<typeof projectService.milestoneSchema>,
      requireUser(req),
    ),
  );
}

// --- Packages --------------------------------------------------------------

export function listPackages(req: Request, res: Response): void {
  ok(
    res,
    packageService.list(
      requireUser(req),
      req.query as unknown as z.infer<typeof packageListQuerySchema>,
    ),
  );
}

export function getPackage(req: Request, res: Response): void {
  ok(res, packageService.getOne(Number(req.params.id), requireUser(req)));
}

export function createPackage(req: Request, res: Response): void {
  created(
    res,
    packageService.create(
      req.body as z.infer<typeof packageService.createPackageSchema>,
      requireUser(req),
    ),
  );
}

export function updatePackage(req: Request, res: Response): void {
  ok(
    res,
    packageService.update(
      Number(req.params.id),
      req.body as z.infer<typeof packageService.updatePackageSchema>,
      requireUser(req),
    ),
  );
}
