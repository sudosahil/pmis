import { Router } from 'express';
import * as controller from '../controllers/report.controller.js';
import { reportQuerySchema } from '../services/report.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/**
 * The departmental reports. Staff only — they aggregate across contractors, so
 * a contractor account has no business in them whatever their permissions say.
 */
export const reportRouter = Router();

reportRouter.use(authenticate, requireStaff, requirePermission('reports.view'));

reportRouter.get('/', asyncHandler(controller.catalogue));
reportRouter.get('/:key', validate(reportQuerySchema, 'query'), asyncHandler(controller.run));
