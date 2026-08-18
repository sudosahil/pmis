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
import * as recordController from '../controllers/record.controller.js';
import * as recordService from '../services/record.service.js';
import * as boqService from '../services/boq.service.js';
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

// --- Agreement BOQ ---------------------------------------------------------

packageRouter.get('/:id/boq', asyncHandler(recordController.listBoq));
packageRouter.put(
  '/:id/boq',
  requirePermission('projects.manage'),
  validate(boqService.replaceBoqSchema),
  asyncHandler(recordController.replaceBoq),
);
packageRouter.delete(
  '/:id/boq/:itemId',
  requirePermission('projects.manage'),
  asyncHandler(recordController.removeBoqItem),
);

// --- Sanctions and DPRs ----------------------------------------------------

projectRouter.get('/:id/sanctions', asyncHandler(recordController.listSanctions));
projectRouter.post(
  '/:id/sanctions',
  requirePermission('projects.manage'),
  validate(recordService.sanctionSchema),
  asyncHandler(recordController.addSanction),
);
projectRouter.patch(
  '/:id/sanctions/:sanctionId',
  requirePermission('projects.manage'),
  validate(recordService.sanctionSchema),
  asyncHandler(recordController.updateSanction),
);
projectRouter.delete(
  '/:id/sanctions/:sanctionId',
  requirePermission('projects.manage'),
  asyncHandler(recordController.removeSanction),
);

projectRouter.get('/:id/dprs', asyncHandler(recordController.listDprs));
projectRouter.post(
  '/:id/dprs',
  requirePermission('projects.manage'),
  validate(recordService.dprSchema),
  asyncHandler(recordController.addDpr),
);
projectRouter.patch(
  '/:id/dprs/:dprId',
  requirePermission('projects.manage'),
  validate(recordService.dprSchema),
  asyncHandler(recordController.updateDpr),
);
projectRouter.post(
  '/:id/dprs/:dprId/decision',
  requirePermission('projects.manage'),
  validate(recordService.dprDecisionSchema),
  asyncHandler(recordController.decideDpr),
);
projectRouter.delete(
  '/:id/dprs/:dprId',
  requirePermission('projects.manage'),
  asyncHandler(recordController.removeDpr),
);
