import { Router } from 'express';
import * as controller from '../controllers/workflow.controller.js';
import * as adminController from '../controllers/workflow-admin.controller.js';
import * as workflowAdmin from '../services/workflow-admin.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { paginationQuery, validate } from '../middleware/validate.js';

export const workflowRouter = Router();
workflowRouter.use(authenticate);

workflowRouter.get(
  '/definitions',
  validate(adminController.definitionQuerySchema, 'query'),
  asyncHandler(adminController.list),
);
workflowRouter.get('/definitions/:id', asyncHandler(adminController.getOne));
workflowRouter.get('/definitions/:id/history', asyncHandler(adminController.history));

// Designing the chains is an administrator's job.
workflowRouter.post(
  '/definitions',
  requireRole(ROLES.ADMIN),
  validate(workflowAdmin.createDefinitionSchema),
  asyncHandler(adminController.create),
);
workflowRouter.patch(
  '/definitions/:id',
  requireRole(ROLES.ADMIN),
  validate(workflowAdmin.updateDefinitionSchema),
  asyncHandler(adminController.update),
);
workflowRouter.put(
  '/definitions/:id/steps',
  requireRole(ROLES.ADMIN),
  validate(workflowAdmin.replaceStepsSchema),
  asyncHandler(adminController.replaceSteps),
);
workflowRouter.delete(
  '/definitions/:id',
  requireRole(ROLES.ADMIN),
  asyncHandler(adminController.remove),
);
workflowRouter.get(
  '/inbox',
  validate(controller.inboxQuerySchema, 'query'),
  asyncHandler(controller.inbox),
);
workflowRouter.get(
  '/my-submissions',
  validate(paginationQuery, 'query'),
  asyncHandler(controller.mySubmissions),
);
workflowRouter.get('/:id', asyncHandler(controller.getOne));
workflowRouter.post('/:id/action', validate(controller.actionSchema), asyncHandler(controller.act));
workflowRouter.post('/:id/cancel', validate(controller.cancelSchema), asyncHandler(controller.cancel));
