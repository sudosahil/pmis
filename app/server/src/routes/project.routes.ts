import { Router } from 'express';
import * as controller from '../controllers/project.controller.js';
import {
  createProjectSchema,
  milestoneSchema,
  updateProjectSchema,
} from '../services/project.service.js';
import { createPackageSchema, updatePackageSchema } from '../services/package.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/** Roles that may author project and package records. */
const AUTHORING_ROLES = [ROLES.ADMIN, ROLES.CE, ROLES.SE, ROLES.EE, ROLES.AEE, ROLES.AE] as const;

export const projectRouter = Router();
projectRouter.use(authenticate);

projectRouter.get(
  '/',
  validate(controller.projectListQuerySchema, 'query'),
  asyncHandler(controller.list),
);
projectRouter.get('/:id', asyncHandler(controller.getOne));

projectRouter.post(
  '/',
  requirePermission('projects.manage'),
  validate(createProjectSchema),
  asyncHandler(controller.create),
);
projectRouter.patch(
  '/:id',
  requirePermission('projects.manage'),
  validate(updateProjectSchema),
  asyncHandler(controller.update),
);
projectRouter.post(
  '/:id/submit',
  requirePermission('projects.manage'),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitForSanction),
);
projectRouter.put(
  '/:id/milestones',
  requirePermission('projects.manage'),
  validate(milestoneSchema),
  asyncHandler(controller.saveMilestones),
);

export const packageRouter = Router();
packageRouter.use(authenticate);

packageRouter.get(
  '/',
  validate(controller.packageListQuerySchema, 'query'),
  asyncHandler(controller.listPackages),
);
packageRouter.get('/:id', asyncHandler(controller.getPackage));
packageRouter.post(
  '/',
  requirePermission('projects.manage'),
  validate(createPackageSchema),
  asyncHandler(controller.createPackage),
);
packageRouter.patch(
  '/:id',
  requirePermission('projects.manage'),
  validate(updatePackageSchema),
  asyncHandler(controller.updatePackage),
);
