import { Router } from 'express';
import * as controller from '../controllers/master.controller.js';
import { MASTER_MAINTAINER_ROLES } from '../config/constants.js';
import { authenticate, requireRole, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

export const masterRouter = Router();

masterRouter.use(authenticate, requireStaff);

masterRouter.get('/definitions', asyncHandler(controller.definitions));

// Reading masters is open to all staff — every form depends on these lookups.
masterRouter.get(
  '/:key/options',
  validate(controller.optionsQuerySchema, 'query'),
  asyncHandler(controller.options),
);
masterRouter.get(
  '/:key',
  validate(controller.listQuerySchema, 'query'),
  asyncHandler(controller.list),
);
masterRouter.get('/:key/:id', asyncHandler(controller.getOne));

// Maintaining them is restricted to the administrative cadre.
masterRouter.post('/:key', requireRole(...MASTER_MAINTAINER_ROLES), asyncHandler(controller.create));
masterRouter.patch(
  '/:key/:id',
  requireRole(...MASTER_MAINTAINER_ROLES),
  asyncHandler(controller.update),
);
masterRouter.delete(
  '/:key/:id',
  requireRole(...MASTER_MAINTAINER_ROLES),
  asyncHandler(controller.remove),
);
