import { Router } from 'express';
import * as controller from '../controllers/casework.controller.js';
import * as landService from '../services/land.service.js';
import * as courtService from '../services/court.service.js';
import * as committeeService from '../services/committee.service.js';
import * as rtiService from '../services/rti.service.js';
import { authenticate, requirePermission, requireStaff } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

/**
 * The department's own casework. All of it is staff-only: a contractor has no
 * business in the litigation register, the committee papers or the RTI file,
 * whatever permissions they might otherwise hold.
 */

// --- Land acquisition --------------------------------------------------------

export const landRouter = Router();
landRouter.use(authenticate, requireStaff, requirePermission('land.view'));

landRouter.get('/', validate(controller.landQuerySchema, 'query'), asyncHandler(controller.listParcels));
landRouter.get('/:id', asyncHandler(controller.getParcel));

landRouter.post(
  '/',
  requirePermission('land.manage'),
  validate(landService.parcelSchema),
  asyncHandler(controller.createParcel),
);
landRouter.patch(
  '/:id',
  requirePermission('land.manage'),
  validate(landService.parcelSchema),
  asyncHandler(controller.updateParcel),
);
landRouter.post(
  '/:id/stage',
  requirePermission('land.manage'),
  validate(landService.parcelStageSchema),
  asyncHandler(controller.recordParcelStage),
);
landRouter.post(
  '/:id/submit',
  requirePermission('land.manage'),
  validate(controller.remarksSchema),
  asyncHandler(controller.submitParcelAward),
);
// Disbursing compensation is a money action, so it sits behind its own grant.
landRouter.post(
  '/:id/payments',
  requirePermission('land.compensate'),
  validate(landService.compensationSchema),
  asyncHandler(controller.addCompensation),
);
landRouter.delete(
  '/:id/payments/:paymentId',
  requirePermission('land.compensate'),
  asyncHandler(controller.removeCompensation),
);
landRouter.delete('/:id', requirePermission('land.manage'), asyncHandler(controller.removeParcel));

// --- Court cases -------------------------------------------------------------

export const courtRouter = Router();
courtRouter.use(authenticate, requireStaff, requirePermission('court.view'));

courtRouter.get('/', validate(controller.caseQuerySchema, 'query'), asyncHandler(controller.listCases));
courtRouter.get('/:id', asyncHandler(controller.getCase));

courtRouter.post(
  '/',
  requirePermission('court.manage'),
  validate(courtService.caseSchema),
  asyncHandler(controller.createCase),
);
courtRouter.patch(
  '/:id',
  requirePermission('court.manage'),
  validate(courtService.caseSchema),
  asyncHandler(controller.updateCase),
);
courtRouter.post(
  '/:id/hearings',
  requirePermission('court.manage'),
  validate(courtService.hearingSchema),
  asyncHandler(controller.addHearing),
);
courtRouter.delete(
  '/:id/hearings/:hearingId',
  requirePermission('court.manage'),
  asyncHandler(controller.removeHearing),
);
courtRouter.post(
  '/:id/disposal',
  requirePermission('court.manage'),
  validate(courtService.disposalSchema),
  asyncHandler(controller.disposeCase),
);
courtRouter.delete('/:id', requirePermission('court.manage'), asyncHandler(controller.removeCase));

// --- Committees and meetings -------------------------------------------------

export const committeeRouter = Router();
committeeRouter.use(authenticate, requireStaff, requirePermission('committees.view'));

// The action items a member is carrying. Named before `/:id` so it is not
// swallowed by the parameter route.
committeeRouter.get('/my-actions', asyncHandler(controller.myActions));

committeeRouter.get(
  '/meetings',
  validate(controller.meetingQuerySchema, 'query'),
  asyncHandler(controller.listMeetings),
);
committeeRouter.get('/meetings/:id', asyncHandler(controller.getMeeting));
committeeRouter.patch(
  '/meetings/:id',
  requirePermission('committees.manage'),
  validate(committeeService.meetingSchema),
  asyncHandler(controller.updateMeeting),
);
committeeRouter.put(
  '/meetings/:id/attendance',
  requirePermission('committees.manage'),
  validate(committeeService.attendanceSchema),
  asyncHandler(controller.markAttendance),
);
committeeRouter.post(
  '/meetings/:id/minutes',
  requirePermission('committees.manage'),
  validate(committeeService.minutesSchema),
  asyncHandler(controller.recordMinutes),
);
committeeRouter.post(
  '/meetings/:id/cancel',
  requirePermission('committees.manage'),
  validate(controller.reasonSchema),
  asyncHandler(controller.cancelMeeting),
);
// An action item is closed by whoever holds it, which is most staff.
committeeRouter.post(
  '/decisions/:decisionId/close',
  validate(committeeService.decisionCloseSchema),
  asyncHandler(controller.closeDecision),
);

committeeRouter.get(
  '/',
  validate(controller.committeeQuerySchema, 'query'),
  asyncHandler(controller.listCommittees),
);
committeeRouter.get('/:id', asyncHandler(controller.getCommittee));
committeeRouter.post(
  '/',
  requirePermission('committees.manage'),
  validate(committeeService.committeeSchema),
  asyncHandler(controller.createCommittee),
);
committeeRouter.patch(
  '/:id',
  requirePermission('committees.manage'),
  validate(committeeService.committeeSchema),
  asyncHandler(controller.updateCommittee),
);
committeeRouter.put(
  '/:id/members',
  requirePermission('committees.manage'),
  validate(committeeService.membersSchema),
  asyncHandler(controller.setMembers),
);
committeeRouter.post(
  '/:id/meetings',
  requirePermission('committees.manage'),
  validate(committeeService.meetingSchema),
  asyncHandler(controller.scheduleMeeting),
);

// --- Right to Information ----------------------------------------------------

export const rtiRouter = Router();
rtiRouter.use(authenticate, requireStaff, requirePermission('rti.view'));

rtiRouter.get('/exemptions', asyncHandler(controller.rtiExemptions));
rtiRouter.get('/', validate(controller.rtiQuerySchema, 'query'), asyncHandler(controller.listRti));
rtiRouter.get('/:id', asyncHandler(controller.getRti));

rtiRouter.post(
  '/',
  requirePermission('rti.manage'),
  validate(rtiService.requestSchema),
  asyncHandler(controller.createRti),
);
rtiRouter.patch(
  '/:id',
  requirePermission('rti.manage'),
  validate(rtiService.requestSchema),
  asyncHandler(controller.updateRti),
);
// Answering is the Public Information Officer's own act, and the penalty for
// getting it wrong is personal, so it is held apart from merely maintaining
// the register.
rtiRouter.post(
  '/:id/reply',
  requirePermission('rti.reply'),
  validate(rtiService.replySchema),
  asyncHandler(controller.replyRti),
);
rtiRouter.post(
  '/:id/appeals',
  requirePermission('rti.manage'),
  validate(rtiService.appealSchema),
  asyncHandler(controller.addRtiAppeal),
);
rtiRouter.post(
  '/appeals/:appealId/decision',
  requirePermission('rti.appeal.decide'),
  validate(rtiService.appealDecisionSchema),
  asyncHandler(controller.decideRtiAppeal),
);
rtiRouter.delete('/:id', requirePermission('rti.manage'), asyncHandler(controller.removeRti));
