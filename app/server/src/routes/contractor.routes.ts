import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/contractor.controller.js';
import { registrationSchema, updateContractorSchema } from '../services/contractor.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { env } from '../config/env.js';

/** Registration is unauthenticated, so it gets its own tighter limit. */
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.isTest ? 1000 : 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    data: null,
    error: { message: 'Too many registration attempts. Try again later.', code: 'RATE_LIMITED' },
  },
});

export const contractorRouter = Router();

// The registration form needs the list of banks before the firm has an account.
contractorRouter.get('/register/banks', asyncHandler(controller.registrationBanks));

// Public self-registration — the only unauthenticated write in the system.
contractorRouter.post(
  '/register',
  registerLimiter,
  validate(registrationSchema),
  asyncHandler(controller.register),
);

contractorRouter.use(authenticate);

contractorRouter.get('/me', asyncHandler(controller.myProfile));
contractorRouter.get('/eligible', requireStaff, asyncHandler(controller.eligible));
contractorRouter.get(
  '/',
  requireStaff,
  validate(controller.listQuerySchema, 'query'),
  asyncHandler(controller.list),
);
contractorRouter.get('/:id', asyncHandler(controller.getOne));
contractorRouter.patch(
  '/:id',
  validate(updateContractorSchema),
  asyncHandler(controller.update),
);
contractorRouter.post(
  '/:id/blacklist',
  requirePermission('contractors.blacklist'),
  validate(controller.blacklistSchema),
  asyncHandler(controller.setBlacklist),
);
