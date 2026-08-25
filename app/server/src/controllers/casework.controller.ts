import type { Request, Response } from 'express';
import { z } from 'zod';
import * as landService from '../services/land.service.js';
import * as courtService from '../services/court.service.js';
import * as committeeService from '../services/committee.service.js';
import * as rtiService from '../services/rti.service.js';
import * as workflowService from '../services/workflow.service.js';
import { ENTITY_TYPES } from '../config/constants.js';
import { created, noContent, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

/**
 * The department's own casework: land it is acquiring, litigation it is party
 * to, committees that sit on its behalf, and information the public asks it for.
 */

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
};

// --- Land acquisition --------------------------------------------------------

export const landQuerySchema = z.object({
  ...page,
  status: z.string().trim().max(30).optional(),
  projectId: z.coerce.number().int().positive().optional(),
});

export const remarksSchema = z.object({ remarks: z.string().trim().max(1000).optional() });
export const reasonSchema = z.object({
  reason: z.string().trim().min(5, 'Record a reason.').max(500),
});

export function listParcels(req: Request, res: Response): void {
  ok(res, landService.list(requireUser(req), req.query as unknown as z.infer<typeof landQuerySchema>));
}

export function getParcel(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...landService.getOne(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.LAND_PARCEL, id, user),
  });
}

export function createParcel(req: Request, res: Response): void {
  created(
    res,
    landService.create(req.body as z.infer<typeof landService.parcelSchema>, requireUser(req)),
  );
}

export function updateParcel(req: Request, res: Response): void {
  ok(
    res,
    landService.update(
      Number(req.params.id),
      req.body as z.infer<typeof landService.parcelSchema>,
      requireUser(req),
    ),
  );
}

export function recordParcelStage(req: Request, res: Response): void {
  ok(
    res,
    landService.recordStage(
      Number(req.params.id),
      req.body as z.infer<typeof landService.parcelStageSchema>,
      requireUser(req),
    ),
  );
}

export function submitParcelAward(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, landService.submitForApproval(Number(req.params.id), requireUser(req), body?.remarks));
}

export function addCompensation(req: Request, res: Response): void {
  created(
    res,
    landService.addPayment(
      Number(req.params.id),
      req.body as z.infer<typeof landService.compensationSchema>,
      requireUser(req),
    ),
  );
}

export function removeCompensation(req: Request, res: Response): void {
  ok(res, landService.removePayment(Number(req.params.paymentId), requireUser(req)));
}

export function removeParcel(req: Request, res: Response): void {
  landService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}

export function projectLandSummary(req: Request, res: Response): void {
  ok(res, landService.summaryForProject(Number(req.params.id), requireUser(req)));
}

// --- Court cases -------------------------------------------------------------

export const caseQuerySchema = z.object({
  ...page,
  status: z.string().trim().max(30).optional(),
  courtType: z.string().trim().max(30).optional(),
  caseType: z.string().trim().max(30).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  /** The cause list: cases listed within this many days. */
  hearingWithinDays: z.coerce.number().int().min(0).max(365).optional(),
});

export function listCases(req: Request, res: Response): void {
  ok(res, courtService.list(requireUser(req), req.query as unknown as z.infer<typeof caseQuerySchema>));
}

export function getCase(req: Request, res: Response): void {
  ok(res, courtService.getOne(Number(req.params.id), requireUser(req)));
}

export function createCase(req: Request, res: Response): void {
  created(
    res,
    courtService.create(req.body as z.infer<typeof courtService.caseSchema>, requireUser(req)),
  );
}

export function updateCase(req: Request, res: Response): void {
  ok(
    res,
    courtService.update(
      Number(req.params.id),
      req.body as z.infer<typeof courtService.caseSchema>,
      requireUser(req),
    ),
  );
}

export function addHearing(req: Request, res: Response): void {
  created(
    res,
    courtService.addHearing(
      Number(req.params.id),
      req.body as z.infer<typeof courtService.hearingSchema>,
      requireUser(req),
    ),
  );
}

export function removeHearing(req: Request, res: Response): void {
  ok(res, courtService.removeHearing(Number(req.params.hearingId), requireUser(req)));
}

export function disposeCase(req: Request, res: Response): void {
  ok(
    res,
    courtService.dispose(
      Number(req.params.id),
      req.body as z.infer<typeof courtService.disposalSchema>,
      requireUser(req),
    ),
  );
}

export function removeCase(req: Request, res: Response): void {
  courtService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}

// --- Committees and meetings -------------------------------------------------

export const committeeQuerySchema = z.object({
  ...page,
  kind: z.string().trim().max(30).optional(),
});

export const meetingQuerySchema = z.object({
  ...page,
  committeeId: z.coerce.number().int().positive().optional(),
  status: z.string().trim().max(30).optional(),
  upcomingOnly: bool.optional(),
});

export function listCommittees(req: Request, res: Response): void {
  ok(
    res,
    committeeService.listCommittees(
      requireUser(req),
      req.query as unknown as z.infer<typeof committeeQuerySchema>,
    ),
  );
}

export function getCommittee(req: Request, res: Response): void {
  ok(res, committeeService.getCommittee(Number(req.params.id), requireUser(req)));
}

export function createCommittee(req: Request, res: Response): void {
  created(
    res,
    committeeService.createCommittee(
      req.body as z.infer<typeof committeeService.committeeSchema>,
      requireUser(req),
    ),
  );
}

export function updateCommittee(req: Request, res: Response): void {
  ok(
    res,
    committeeService.updateCommittee(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.committeeSchema>,
      requireUser(req),
    ),
  );
}

export function setMembers(req: Request, res: Response): void {
  ok(
    res,
    committeeService.setMembers(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.membersSchema>,
      requireUser(req),
    ),
  );
}

export function listMeetings(req: Request, res: Response): void {
  ok(
    res,
    committeeService.listMeetings(
      requireUser(req),
      req.query as unknown as z.infer<typeof meetingQuerySchema>,
    ),
  );
}

export function getMeeting(req: Request, res: Response): void {
  ok(res, committeeService.getMeeting(Number(req.params.id), requireUser(req)));
}

export function scheduleMeeting(req: Request, res: Response): void {
  created(
    res,
    committeeService.scheduleMeeting(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.meetingSchema>,
      requireUser(req),
    ),
  );
}

export function updateMeeting(req: Request, res: Response): void {
  ok(
    res,
    committeeService.updateMeeting(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.meetingSchema>,
      requireUser(req),
    ),
  );
}

export function markAttendance(req: Request, res: Response): void {
  ok(
    res,
    committeeService.markAttendance(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.attendanceSchema>,
      requireUser(req),
    ),
  );
}

export function recordMinutes(req: Request, res: Response): void {
  ok(
    res,
    committeeService.recordMinutes(
      Number(req.params.id),
      req.body as z.infer<typeof committeeService.minutesSchema>,
      requireUser(req),
    ),
  );
}

export function cancelMeeting(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof reasonSchema>;
  ok(res, committeeService.cancelMeeting(Number(req.params.id), body.reason, requireUser(req)));
}

export function closeDecision(req: Request, res: Response): void {
  ok(
    res,
    committeeService.closeDecision(
      Number(req.params.decisionId),
      req.body as z.infer<typeof committeeService.decisionCloseSchema>,
      requireUser(req),
    ),
  );
}

export function myActions(req: Request, res: Response): void {
  ok(res, committeeService.myActions(requireUser(req)));
}

// --- Right to Information ----------------------------------------------------

export const rtiQuerySchema = z.object({
  ...page,
  status: z.string().trim().max(30).optional(),
  mineOnly: bool.optional(),
  overdueOnly: bool.optional(),
});

export function listRti(req: Request, res: Response): void {
  ok(res, rtiService.list(requireUser(req), req.query as unknown as z.infer<typeof rtiQuerySchema>));
}

export function getRti(req: Request, res: Response): void {
  ok(res, rtiService.getOne(Number(req.params.id), requireUser(req)));
}

/** The exemptions a refusal may rest on, for the reply form. */
export function rtiExemptions(_req: Request, res: Response): void {
  ok(res, rtiService.EXEMPTION_SECTIONS);
}

export function createRti(req: Request, res: Response): void {
  created(res, rtiService.create(req.body as z.infer<typeof rtiService.requestSchema>, requireUser(req)));
}

export function updateRti(req: Request, res: Response): void {
  ok(
    res,
    rtiService.update(
      Number(req.params.id),
      req.body as z.infer<typeof rtiService.requestSchema>,
      requireUser(req),
    ),
  );
}

export function replyRti(req: Request, res: Response): void {
  ok(
    res,
    rtiService.reply(
      Number(req.params.id),
      req.body as z.infer<typeof rtiService.replySchema>,
      requireUser(req),
    ),
  );
}

export function addRtiAppeal(req: Request, res: Response): void {
  created(
    res,
    rtiService.addAppeal(
      Number(req.params.id),
      req.body as z.infer<typeof rtiService.appealSchema>,
      requireUser(req),
    ),
  );
}

export function decideRtiAppeal(req: Request, res: Response): void {
  ok(
    res,
    rtiService.decideAppeal(
      Number(req.params.appealId),
      req.body as z.infer<typeof rtiService.appealDecisionSchema>,
      requireUser(req),
    ),
  );
}

export function removeRti(req: Request, res: Response): void {
  rtiService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}
