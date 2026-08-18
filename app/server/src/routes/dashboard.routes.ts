import { Router } from 'express';
import * as controller from '../controllers/dashboard.controller.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/', asyncHandler(controller.dashboard));

export const notificationRouter = Router();
notificationRouter.use(authenticate);

notificationRouter.get(
  '/',
  validate(controller.notificationQuerySchema, 'query'),
  asyncHandler(controller.notifications),
);
notificationRouter.post(
  '/read',
  validate(controller.markReadSchema),
  asyncHandler(controller.markNotificationsRead),
);

export const auditRouter = Router();
auditRouter.use(authenticate, requirePermission('audit.view'));

auditRouter.get('/', validate(controller.auditQuerySchema, 'query'), asyncHandler(controller.auditLog));
