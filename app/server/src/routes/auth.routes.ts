import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as controller from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';
import { env } from '../config/env.js';

/** Credential endpoints are rate limited to blunt password guessing. */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    data: null,
    error: { message: 'Too many attempts. Try again in a few minutes.', code: 'RATE_LIMITED' },
  },
});

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  validate(controller.loginSchema),
  asyncHandler(controller.login),
);
authRouter.post(
  '/refresh',
  validate(controller.refreshSchema),
  asyncHandler(controller.refresh),
);
authRouter.post('/logout', asyncHandler(controller.logout));
authRouter.get('/me', authenticate, asyncHandler(controller.me));
authRouter.post(
  '/change-password',
  authenticate,
  authLimiter,
  validate(controller.changePasswordSchema),
  asyncHandler(controller.changePassword),
);
authRouter.get('/roles', authenticate, asyncHandler(controller.roles));
