import { Router } from 'express';
import * as controller from '../controllers/user.controller.js';
import {
  createUserSchema,
  listUsersQuerySchema,
  updateUserSchema,
} from '../services/user.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

export const userRouter = Router();
userRouter.use(authenticate, requireStaff);

// Any staff member can look up who holds a role, in order to route a file.
userRouter.get(
  '/by-role',
  validate(controller.byRoleQuerySchema, 'query'),
  asyncHandler(controller.byRole),
);

userRouter.use(requirePermission('users.manage'));

userRouter.get('/', validate(listUsersQuerySchema, 'query'), asyncHandler(controller.list));
userRouter.get('/:id', asyncHandler(controller.getOne));
userRouter.post('/', validate(createUserSchema), asyncHandler(controller.create));
userRouter.patch('/:id', validate(updateUserSchema), asyncHandler(controller.update));
userRouter.post('/:id/reset-password', asyncHandler(controller.resetPassword));
