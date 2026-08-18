import { Router } from 'express';
import * as controller from '../controllers/permission.controller.js';
import * as permissionService from '../services/permission.service.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/**
 * The role access screen. Editing it is gated on the permission it grants, and
 * that permission cannot be taken away from the administrator — otherwise the
 * first mistaken save would lock everyone out of the screen that fixes it.
 */
export const roleRouter = Router();
roleRouter.use(authenticate, requirePermission('roles.manage'));

roleRouter.get('/', asyncHandler(controller.catalogue));
roleRouter.put(
  '/:roleCode/permissions',
  validate(permissionService.updateRoleSchema),
  asyncHandler(controller.setRolePermissions),
);
roleRouter.post('/:roleCode/reset', asyncHandler(controller.resetRole));
