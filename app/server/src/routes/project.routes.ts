import { Router } from 'express';
import * as controller from '../controllers/project.controller.js';
import {
  createProjectSchema,
  milestoneSchema,
  updateProjectSchema,
} from '../services/project.service.js';
import { createPackageSchema, updatePackageSchema } from '../services/package.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requireRole } from '../middleware/auth.js';
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
  requireRole(...AUTHORING_ROLES),
  validate(createProjectSchema),
  asyncHandler(controller.create),
);
projectRouter.patch(
  '/:id',
  requireRole(...AUTHORING_ROLES),
  validate(updateProjectSchema),
  asyncHandler(controller.update),
);
projectRouter.post(
  '/:id/submit',
  requireRole(...AUTHORING_ROLES),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitForSanction),
);
projectRouter.put(
  '/:id/milestones',
  requireRole(...AUTHORING_ROLES),
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
  requireRole(...AUTHORING_ROLES),
  validate(createPackageSchema),
  asyncHandler(controller.createPackage),
);
packageRouter.patch(
  '/:id',
  requireRole(...AUTHORING_ROLES),
  validate(updatePackageSchema),
  asyncHandler(controller.updatePackage),
);
