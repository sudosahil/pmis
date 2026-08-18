import { Router } from 'express';
import * as controller from '../controllers/fund.controller.js';
import {
  fundReleaseSchema,
  locApprovalSchema,
  locRequestSchema,
} from '../services/fund.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

export const fundRouter = Router();
fundRouter.use(authenticate, requireStaff);

fundRouter.get(
  '/releases',
  validate(controller.releaseQuerySchema, 'query'),
  asyncHandler(controller.listReleases),
);
fundRouter.post(
  '/releases',
  requirePermission('funds.release'),
  validate(fundReleaseSchema),
  asyncHandler(controller.createRelease),
);

fundRouter.get('/loc', validate(controller.locQuerySchema, 'query'), asyncHandler(controller.listLoc));
fundRouter.get('/loc/:id', asyncHandler(controller.getLoc));
fundRouter.post(
  '/loc',
  requirePermission('funds.loc.request'),
  validate(locRequestSchema),
  asyncHandler(controller.createLoc),
);
fundRouter.post(
  '/loc/:id/submit',
  requirePermission('funds.loc.request'),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitLoc),
);
fundRouter.patch(
  '/loc/:id/approved-amount',
  requirePermission('funds.loc.approve'),
  validate(locApprovalSchema),
  asyncHandler(controller.setApprovedAmount),
);
