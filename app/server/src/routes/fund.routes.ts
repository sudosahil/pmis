import { Router } from 'express';
import * as controller from '../controllers/fund.controller.js';
import {
  fundReleaseSchema,
  locApprovalSchema,
  locRequestSchema,
} from '../services/fund.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requireRole, requireStaff } from '../middleware/auth.js';
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
  requireRole(ROLES.ADMIN, ROLES.CAO, ROLES.MD, ROLES.CE),
  validate(fundReleaseSchema),
  asyncHandler(controller.createRelease),
);

fundRouter.get('/loc', validate(controller.locQuerySchema, 'query'), asyncHandler(controller.listLoc));
fundRouter.get('/loc/:id', asyncHandler(controller.getLoc));
fundRouter.post(
  '/loc',
  requireRole(ROLES.ADMIN, ROLES.EE, ROLES.AC, ROLES.AS),
  validate(locRequestSchema),
  asyncHandler(controller.createLoc),
);
fundRouter.post(
  '/loc/:id/submit',
  requireRole(ROLES.ADMIN, ROLES.EE, ROLES.AC, ROLES.AS),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitLoc),
);
fundRouter.patch(
  '/loc/:id/approved-amount',
  requireRole(ROLES.ADMIN, ROLES.CAO, ROLES.AAO, ROLES.MD),
  validate(locApprovalSchema),
  asyncHandler(controller.setApprovedAmount),
);
