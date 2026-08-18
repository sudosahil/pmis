import { Router } from 'express';
import * as controller from '../controllers/bill.controller.js';
import * as raBillService from '../services/ra-bill.service.js';
import * as miscBillService from '../services/misc-bill.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

// Who may do what is configured on the role access screen, not fixed here.

export const raBillRouter = Router();
raBillRouter.use(authenticate);

raBillRouter.get('/', validate(controller.raListQuerySchema, 'query'), asyncHandler(controller.listRa));
raBillRouter.get('/:id', asyncHandler(controller.getRa));
raBillRouter.post(
  '/',
  requirePermission('bills.ra.raise'),
  validate(raBillService.createRaBillSchema),
  asyncHandler(controller.createRa),
);
raBillRouter.patch(
  '/:id',
  requirePermission('bills.ra.raise'),
  validate(raBillService.updateRaBillSchema),
  asyncHandler(controller.updateRa),
);
raBillRouter.delete('/:id', requirePermission('bills.ra.raise'), asyncHandler(controller.removeRa));
raBillRouter.post(
  '/:id/submit',
  requirePermission('bills.ra.raise'),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitRa),
);

// Executive Engineer certifies the admissible amount and the ETP percentages.
raBillRouter.post(
  '/:id/certify',
  requirePermission('bills.ra.certify'),
  validate(raBillService.certifySchema),
  asyncHandler(controller.certifyRa),
);
raBillRouter.put(
  '/:id/deductions',
  requirePermission('bills.ra.deductions'),
  validate(raBillService.deductionsSchema),
  asyncHandler(controller.setRaDeductions),
);
raBillRouter.post(
  '/:id/send-to-tally',
  requirePermission('bills.treasury'),
  validate(raBillService.tallySchema),
  asyncHandler(controller.sendRaToTally),
);
raBillRouter.post(
  '/:id/payment',
  requirePermission('bills.treasury'),
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
  requirePermission('bills.misc.raise'),
  validate(miscBillService.createMiscBillSchema),
  asyncHandler(controller.createMisc),
);
miscBillRouter.patch(
  '/:id',
  requirePermission('bills.misc.raise'),
  validate(miscBillService.updateMiscBillSchema),
  asyncHandler(controller.updateMisc),
);
miscBillRouter.delete('/:id', requirePermission('bills.misc.raise'), asyncHandler(controller.removeMisc));
miscBillRouter.post(
  '/:id/submit',
  requirePermission('bills.misc.raise'),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitMisc),
);
miscBillRouter.post(
  '/:id/send-to-tally',
  requirePermission('bills.treasury'),
  validate(miscBillService.tallySchema),
  asyncHandler(controller.sendMiscToTally),
);
miscBillRouter.post(
  '/:id/payment',
  requirePermission('bills.treasury'),
  validate(miscBillService.paymentSchema),
  asyncHandler(controller.payMisc),
);
