import { Router } from 'express';
import * as controller from '../controllers/activity.controller.js';
import * as activityService from '../services/activity.service.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/**
 * The live technical log. Restricted to the administrator and the auditor —
 * it records every screen every officer opened, which is not something the rest
 * of the department needs to see.
 */
export const activityRouter = Router();
activityRouter.use(authenticate, requirePermission('activity.view'));

activityRouter.get('/overview', asyncHandler(controller.overview));
activityRouter.get('/online', asyncHandler(controller.online));
activityRouter.get(
  '/',
  validate(activityService.activityQuerySchema, 'query'),
  asyncHandler(controller.list),
);
activityRouter.post(
  '/prune',
  requirePermission('activity.view'),
  validate(activityService.pruneSchema),
  asyncHandler(controller.prune),
);
