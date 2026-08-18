import { Router } from 'express';
import * as controller from '../controllers/tender.controller.js';
import {
  awardSchema,
  createTenderSchema,
  submitBidSchema,
  technicalEvaluationSchema,
  updateTenderSchema,
} from '../services/tender.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { paginationQuery, validate } from '../middleware/validate.js';

/** Officers who run a procurement from notice to award. */
const PROCUREMENT_ROLES = [ROLES.ADMIN, ROLES.CE, ROLES.SE, ROLES.EE] as const;
/** The evaluation committee also draws on the accounts cadre. */
const EVALUATION_ROLES = [ROLES.ADMIN, ROLES.CE, ROLES.SE, ROLES.EE, ROLES.CAO] as const;

export const tenderRouter = Router();
tenderRouter.use(authenticate);

// Contractor-facing.
tenderRouter.get('/my-bids', validate(paginationQuery, 'query'), asyncHandler(controller.myBids));
tenderRouter.post(
  '/:id/bids',
  requireRole(ROLES.CONTRACTOR),
  validate(submitBidSchema),
  asyncHandler(controller.submitBid),
);

// Notice board — visible to staff and contractors alike.
tenderRouter.get('/', validate(controller.listQuerySchema, 'query'), asyncHandler(controller.list));
tenderRouter.get('/:id', asyncHandler(controller.getOne));

// Authoring and lifecycle.
tenderRouter.post(
  '/',
  requireRole(...PROCUREMENT_ROLES),
  validate(createTenderSchema),
  asyncHandler(controller.create),
);
tenderRouter.patch(
  '/:id',
  requireRole(...PROCUREMENT_ROLES),
  validate(updateTenderSchema),
  asyncHandler(controller.update),
);
tenderRouter.post(
  '/:id/submit',
  requireRole(...PROCUREMENT_ROLES),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitForApproval),
);
tenderRouter.post(
  '/:id/publish',
  requireRole(...PROCUREMENT_ROLES),
  asyncHandler(controller.publish),
);
tenderRouter.post(
  '/:id/close-bidding',
  requireRole(...PROCUREMENT_ROLES),
  asyncHandler(controller.closeBidding),
);
tenderRouter.post(
  '/:id/cancel',
  requireRole(...PROCUREMENT_ROLES),
  validate(controller.reasonSchema),
  asyncHandler(controller.cancel),
);

// Evaluation and award.
tenderRouter.post(
  '/:id/technical-evaluation/start',
  requireRole(...EVALUATION_ROLES),
  asyncHandler(controller.startTechnicalEvaluation),
);
tenderRouter.post(
  '/:id/technical-evaluation',
  requireRole(...EVALUATION_ROLES),
  validate(technicalEvaluationSchema),
  asyncHandler(controller.recordTechnicalEvaluation),
);
tenderRouter.post(
  '/:id/open-financial',
  requireRole(...EVALUATION_ROLES),
  asyncHandler(controller.openFinancialBids),
);
tenderRouter.post(
  '/:id/award',
  requireRole(ROLES.ADMIN, ROLES.CE, ROLES.SE),
  validate(awardSchema),
  asyncHandler(controller.award),
);
