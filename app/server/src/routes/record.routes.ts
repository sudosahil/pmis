import { Router } from 'express';
import * as controller from '../controllers/record.controller.js';
import * as recordService from '../services/record.service.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/**
 * The noting sheet, which hangs off any record rather than one of them, so it
 * gets its own router keyed on the entity it belongs to.
 */
export const noteRouter = Router();
noteRouter.use(authenticate);

noteRouter.get(
  '/',
  validate(recordService.noteQuerySchema, 'query'),
  asyncHandler(controller.listNotes),
);
noteRouter.post(
  '/',
  validate(recordService.noteQuerySchema, 'query'),
  validate(recordService.noteSchema),
  asyncHandler(controller.addNote),
);
noteRouter.delete('/:id', asyncHandler(controller.removeNote));
