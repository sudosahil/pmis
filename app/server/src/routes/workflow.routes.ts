import { Router } from 'express';
import * as controller from '../controllers/workflow.controller.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { paginationQuery, validate } from '../middleware/validate.js';

export const workflowRouter = Router();
workflowRouter.use(authenticate);

workflowRouter.get('/definitions', asyncHandler(controller.definitions));
workflowRouter.get(
  '/inbox',
  validate(controller.inboxQuerySchema, 'query'),
  asyncHandler(controller.inbox),
);
workflowRouter.get(
  '/my-submissions',
  validate(paginationQuery, 'query'),
  asyncHandler(controller.mySubmissions),
);
workflowRouter.get('/:id', asyncHandler(controller.getOne));
workflowRouter.post('/:id/action', validate(controller.actionSchema), asyncHandler(controller.act));
workflowRouter.post('/:id/cancel', validate(controller.cancelSchema), asyncHandler(controller.cancel));
