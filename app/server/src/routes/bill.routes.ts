import { Router } from 'express';
import * as controller from '../controllers/bill.controller.js';
import * as raBillService from '../services/ra-bill.service.js';
import * as miscBillService from '../services/misc-bill.service.js';
import { ROLES } from '../config/constants.js';
import { authenticate, requireRole, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/** A works bill may be raised by the contractor or entered on their behalf. */
const RA_AUTHOR_ROLES = [ROLES.CONTRACTOR, ROLES.ADMIN, ROLES.EE, ROLES.AEE, ROLES.AE, ROLES.AC] as const;
/** Miscellaneous bills originate with the Account Clerk. */
const MISC_AUTHOR_ROLES = [ROLES.ADMIN, ROLES.AC, ROLES.AS, ROLES.EE] as const;
/** Only the accounts leadership pushes a voucher to Tally or records payment. */
const TREASURY_ROLES = [ROLES.ADMIN, ROLES.CAO, ROLES.AAO] as const;

export const raBillRouter = Router();
raBillRouter.use(authenticate);

raBillRouter.get('/', validate(controller.raListQuerySchema, 'query'), asyncHandler(controller.listRa));
raBillRouter.get('/:id', asyncHandler(controller.getRa));
raBillRouter.post(
  '/',
  requireRole(...RA_AUTHOR_ROLES),
  validate(raBillService.createRaBillSchema),
  asyncHandler(controller.createRa),
);
raBillRouter.patch(
  '/:id',
  requireRole(...RA_AUTHOR_ROLES),
  validate(raBillService.updateRaBillSchema),
  asyncHandler(controller.updateRa),
);
raBillRouter.delete('/:id', requireRole(...RA_AUTHOR_ROLES), asyncHandler(controller.removeRa));
raBillRouter.post(
  '/:id/submit',
  requireRole(...RA_AUTHOR_ROLES),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitRa),
);

// Executive Engineer certifies the admissible amount and the ETP percentages.
raBillRouter.post(
  '/:id/certify',
  requireRole(ROLES.EE, ROLES.ADMIN),
  validate(raBillService.certifySchema),
  asyncHandler(controller.certifyRa),
);
raBillRouter.put(
  '/:id/deductions',
  requireRole(ROLES.AC, ROLES.AS, ROLES.AAO, ROLES.CAO, ROLES.ADMIN),
  validate(raBillService.deductionsSchema),
  asyncHandler(controller.setRaDeductions),
);
raBillRouter.post(
  '/:id/send-to-tally',
  requireRole(...TREASURY_ROLES),
  validate(raBillService.tallySchema),
  asyncHandler(controller.sendRaToTally),
);
raBillRouter.post(
  '/:id/payment',
  requireRole(...TREASURY_ROLES),
  validate(raBillService.paymentSchema),
  asyncHandler(controller.payRa),
);

export const miscBillRouter = Router();
miscBillRouter.use(authenticate, requireStaff);

miscBillRouter.get(
  '/object-head-summary',
  asyncHandler(controller.objectHeadSummary),
);
miscBillRouter.get(
  '/',
  validate(controller.miscListQuerySchema, 'query'),
  asyncHandler(controller.listMisc),
);
miscBillRouter.get('/:id', asyncHandler(controller.getMisc));
miscBillRouter.post(
  '/',
  requireRole(...MISC_AUTHOR_ROLES),
  validate(miscBillService.createMiscBillSchema),
  asyncHandler(controller.createMisc),
);
miscBillRouter.patch(
  '/:id',
  requireRole(...MISC_AUTHOR_ROLES),
  validate(miscBillService.updateMiscBillSchema),
  asyncHandler(controller.updateMisc),
);
miscBillRouter.delete('/:id', requireRole(...MISC_AUTHOR_ROLES), asyncHandler(controller.removeMisc));
miscBillRouter.post(
  '/:id/submit',
  requireRole(...MISC_AUTHOR_ROLES),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitMisc),
);
miscBillRouter.post(
  '/:id/send-to-tally',
  requireRole(...TREASURY_ROLES),
  validate(miscBillService.tallySchema),
  asyncHandler(controller.sendMiscToTally),
);
miscBillRouter.post(
  '/:id/payment',
  requireRole(...TREASURY_ROLES),
  validate(miscBillService.paymentSchema),
  asyncHandler(controller.payMisc),
);
