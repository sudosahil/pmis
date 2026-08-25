import { z } from 'zod';
import { transaction } from '../db/index.js';
import * as committeeModel from '../models/committee.model.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { insertManyNotifications } from '../models/notification.model.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { generateMeetingNo } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { isoDate } from '../middleware/validate.js';

/**
 * Committees, their sittings, and what those sittings decided.
 *
 * Two rules carry the module. A sitting without quorum cannot record decisions,
 * because a committee that decides without its quorum has not decided anything.
 * And every decision names the officer who has to act on it, with a date —
 * minutes nobody is named against are minutes nobody acts on.
 */

export const COMMITTEE_KINDS = [
  'TENDER', 'TECHNICAL', 'PURCHASE', 'GRIEVANCE', 'BOARD', 'REVIEW', 'OTHER',
] as const;

export const MEMBER_ROLES = [
  'CHAIRPERSON', 'MEMBER_SECRETARY', 'MEMBER', 'SPECIAL_INVITEE',
] as const;

export const committeeSchema = z.object({
  code: z.string().trim().min(2, 'Enter a short code.').max(30).toUpperCase(),
  name: z.string().trim().min(3, 'Name the committee.').max(200),
  kind: z.enum(COMMITTEE_KINDS).default('TENDER'),
  purpose: z.string().trim().max(2000).optional(),
  divisionId: z.coerce.number().int().positive().optional().nullable(),
  quorum: z.coerce.number().int().min(1, 'A quorum of at least one.').max(50).default(3),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
});

export const membersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.coerce.number().int().positive(),
        memberRole: z.enum(MEMBER_ROLES).default('MEMBER'),
        designation: z.string().trim().max(120).optional(),
      }),
    )
    .max(60),
});

export const meetingSchema = z.object({
  title: z.string().trim().min(3, 'Give the sitting a subject.').max(250),
  scheduledAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, 'Use the format YYYY-MM-DD HH:MM.')
    .transform((v) => v.replace('T', ' ').slice(0, 16)),
  venue: z.string().trim().max(200).optional(),
  mode: z.enum(['IN_PERSON', 'VIDEO', 'HYBRID']).default('IN_PERSON'),
  agenda: z.string().trim().max(8000).optional(),
});

export const attendanceSchema = z.object({
  attendance: z
    .array(
      z.object({
        userId: z.coerce.number().int().positive(),
        isPresent: z.coerce.boolean().default(false),
        remarks: z.string().trim().max(300).optional(),
      }),
    )
    .max(60),
});

export const minutesSchema = z.object({
  heldAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, 'Use the format YYYY-MM-DD HH:MM.')
    .transform((v) => v.replace('T', ' ').slice(0, 16))
    .optional(),
  minutes: z.string().trim().min(3, 'Record what the sitting resolved.').max(20_000),
  decisions: z
    .array(
      z.object({
        subject: z.string().trim().min(3, 'Name the item.').max(250),
        decision: z.string().trim().min(3, 'Record the decision.').max(4000),
        actionById: z.coerce.number().int().positive().optional().nullable(),
        dueDate: isoDate.optional(),
      }),
    )
    .max(100)
    .default([]),
});

export const decisionCloseSchema = z.object({
  status: z.enum(['DONE', 'DROPPED']),
  closingNote: z.string().trim().max(2000).optional(),
});

// --- Presentation ------------------------------------------------------------

export function presentCommittee(row: committeeModel.CommitteeDetailRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    purpose: row.purpose,
    division: row.division_id
      ? { id: row.division_id, code: row.division_code, name: row.division_name }
      : null,
    quorum: row.quorum,
    status: row.status,
    memberCount: row.member_count,
    meetingCount: row.meeting_count,
    lastMeetingAt: row.last_meeting_at,
    openActions: row.open_actions,
    /** A committee that cannot muster its own quorum cannot sit at all. */
    isQuorate: row.member_count >= row.quorum,
    createdAt: row.created_at,
  };
}

function presentMember(row: committeeModel.MemberRow) {
  return {
    userId: row.user_id,
    name: row.full_name,
    email: row.email,
    roleCode: row.role_code,
    memberRole: row.member_role,
    designation: row.designation,
  };
}

export function presentMeeting(row: committeeModel.MeetingDetailRow) {
  return {
    id: row.id,
    committee: {
      id: row.committee_id,
      code: row.committee_code,
      name: row.committee_name,
      quorum: row.committee_quorum,
    },
    meetingNo: row.meeting_no,
    title: row.title,
    scheduledAt: row.scheduled_at,
    venue: row.venue,
    mode: row.mode,
    agenda: row.agenda,
    status: row.status,
    heldAt: row.held_at,
    minutes: row.minutes,
    minutesBy: row.minutes_by_name,
    invitedCount: row.invited_count,
    presentCount: row.present_count,
    /** Whether enough members actually attended for the sitting to decide. */
    hasQuorum: row.present_count >= row.committee_quorum,
    decisionCount: row.decision_count,
    openActions: row.open_actions,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentDecision(row: committeeModel.DecisionRow) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: row.id,
    seq: row.seq,
    subject: row.subject,
    decision: row.decision,
    actionBy: row.action_by_id ? { id: row.action_by_id, name: row.action_by_name } : null,
    dueDate: row.due_date,
    status: row.status,
    isOverdue: row.status === 'OPEN' && Boolean(row.due_date) && row.due_date! < today,
    closedOn: row.closed_on,
    closingNote: row.closing_note,
  };
}

// --- Committees --------------------------------------------------------------

function assertStaff(user: AuthUser): void {
  if (scopeFilter(user).contractorId !== undefined) {
    throw forbidden('Committee papers are not available to contractor accounts.');
  }
}

export function listCommittees(
  user: AuthUser,
  options: { search?: string; kind?: string; page: number; pageSize: number },
) {
  assertStaff(user);
  const scope = scopeFilter(user);
  const { rows, total } = committeeModel.listCommittees({
    search: options.search,
    kind: options.kind,
    divisionId: scope.divisionId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return {
    items: rows.map(presentCommittee),
    total,
    page: options.page,
    pageSize: options.pageSize,
  };
}

export function getCommittee(id: number, user: AuthUser) {
  assertStaff(user);
  const row = committeeModel.findById(id);
  if (!row) throw notFound('Committee');
  return {
    ...presentCommittee(row),
    members: committeeModel.listMembers(id).map(presentMember),
    meetings: committeeModel
      .listMeetings({ committeeId: id, limit: 20, offset: 0 })
      .rows.map(presentMeeting),
  };
}

export function createCommittee(input: z.infer<typeof committeeSchema>, user: AuthUser) {
  assertStaff(user);
  if (committeeModel.findByCode(input.code)) {
    throw conflict(`A committee with the code "${input.code}" already exists.`);
  }

  const id = committeeModel.insertCommittee({
    code: input.code,
    name: input.name,
    kind: input.kind,
    purpose: input.purpose ?? null,
    division_id: input.divisionId ?? null,
    quorum: input.quorum,
    status: input.status,
    created_by: user.id,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'COMMITTEE_CONSTITUTED',
    entityType: 'COMMITTEE',
    entityId: id,
    detail: `${input.code} — ${input.name}, quorum ${input.quorum}`,
  });

  return getCommittee(id, user);
}

export function updateCommittee(id: number, input: z.infer<typeof committeeSchema>, user: AuthUser) {
  assertStaff(user);
  const existing = committeeModel.findById(id);
  if (!existing) throw notFound('Committee');

  if (input.code !== existing.code && committeeModel.findByCode(input.code)) {
    throw conflict(`A committee with the code "${input.code}" already exists.`);
  }

  committeeModel.updateCommittee(id, {
    code: input.code,
    name: input.name,
    kind: input.kind,
    purpose: input.purpose ?? null,
    division_id: input.divisionId ?? null,
    quorum: input.quorum,
    status: input.status,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'COMMITTEE_UPDATED',
    entityType: 'COMMITTEE',
    entityId: id,
    detail: existing.code,
  });

  return getCommittee(id, user);
}

/** Sets the membership. Exactly one chairperson, because a sitting needs a chair. */
export function setMembers(id: number, input: z.infer<typeof membersSchema>, user: AuthUser) {
  assertStaff(user);
  const committee = committeeModel.findById(id);
  if (!committee) throw notFound('Committee');

  const chairs = input.members.filter((member) => member.memberRole === 'CHAIRPERSON');
  if (input.members.length && chairs.length !== 1) {
    throw badRequest(
      chairs.length === 0
        ? 'Name a chairperson. A sitting cannot be held without one.'
        : 'A committee has one chairperson.',
    );
  }
  if (input.members.length && input.members.length < committee.quorum) {
    throw badRequest(
      `The quorum is ${committee.quorum}, so the committee needs at least that many members.`,
    );
  }

  const seen = new Set<number>();
  for (const member of input.members) {
    if (seen.has(member.userId)) throw badRequest('A member appears twice on the list.');
    seen.add(member.userId);
    if (!userModel.findAuthUserById(member.userId)) {
      throw badRequest('One of the members is not an active account.');
    }
  }

  committeeModel.replaceMembers(
    id,
    input.members.map((member) => ({
      user_id: member.userId,
      member_role: member.memberRole,
      designation: member.designation ?? null,
    })),
  );

  insertAuditEntry({
    userId: user.id,
    action: 'COMMITTEE_MEMBERS_SET',
    entityType: 'COMMITTEE',
    entityId: id,
    detail: `${committee.code}: ${input.members.length} member(s)`,
  });

  return getCommittee(id, user);
}

// --- Meetings ----------------------------------------------------------------

export function listMeetings(
  user: AuthUser,
  options: {
    committeeId?: number;
    status?: string;
    upcomingOnly?: boolean;
    page: number;
    pageSize: number;
  },
) {
  assertStaff(user);
  const scope = scopeFilter(user);
  const { rows, total } = committeeModel.listMeetings({
    committeeId: options.committeeId,
    status: options.status,
    upcomingOnly: options.upcomingOnly,
    divisionId: scope.divisionId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(presentMeeting), total, page: options.page, pageSize: options.pageSize };
}

export function getMeeting(id: number, user: AuthUser) {
  assertStaff(user);
  const row = committeeModel.findMeeting(id);
  if (!row) throw notFound('Meeting');

  return {
    ...presentMeeting(row),
    attendance: committeeModel.listAttendance(id).map((entry) => ({
      userId: entry.user_id,
      name: entry.full_name,
      roleCode: entry.role_code,
      memberRole: entry.member_role,
      isPresent: Boolean(entry.is_present),
      remarks: entry.remarks,
    })),
    decisions: committeeModel.listDecisions(id).map(presentDecision),
  };
}

/**
 * Convenes a sitting. Everyone on the committee is invited by default and told
 * about it, because a member who was not told cannot be counted absent.
 */
export function scheduleMeeting(
  committeeId: number,
  input: z.infer<typeof meetingSchema>,
  user: AuthUser,
) {
  assertStaff(user);
  return transaction(() => {
    const committee = committeeModel.findById(committeeId);
    if (!committee) throw notFound('Committee');
    if (committee.status !== 'ACTIVE') {
      throw conflict('This committee is no longer active.');
    }

    const members = committeeModel.listMembers(committeeId);
    if (members.length < committee.quorum) {
      throw conflict(
        `The committee has ${members.length} member(s) against a quorum of ${committee.quorum}. `
          + 'Complete the membership before convening a sitting.',
      );
    }

    const meetingNo = generateMeetingNo(committee.code);
    const id = committeeModel.insertMeeting({
      committee_id: committeeId,
      meeting_no: meetingNo,
      title: input.title,
      scheduled_at: input.scheduledAt,
      venue: input.venue ?? null,
      mode: input.mode,
      agenda: input.agenda ?? null,
      status: 'SCHEDULED',
      created_by: user.id,
    });

    // Everyone on the roll is invited; attendance is marked afterwards.
    committeeModel.replaceAttendance(
      id,
      members.map((member) => ({ user_id: member.user_id, is_present: 0, remarks: null })),
    );

    insertManyNotifications(
      members.map((member) => ({
        userId: member.user_id,
        title: `${committee.name} — sitting convened`,
        message: `${meetingNo}: ${input.title}, ${input.scheduledAt}`
          + (input.venue ? ` at ${input.venue}` : ''),
        severity: 'INFO' as const,
        entityType: 'MEETING',
        entityId: id,
        link: `/committees/meetings/${id}`,
      })),
    );

    insertAuditEntry({
      userId: user.id,
      action: 'MEETING_SCHEDULED',
      entityType: 'MEETING',
      entityId: id,
      detail: `${meetingNo}: ${input.title} on ${input.scheduledAt}`,
    });

    return getMeeting(id, user);
  });
}

export function updateMeeting(id: number, input: z.infer<typeof meetingSchema>, user: AuthUser) {
  assertStaff(user);
  const existing = committeeModel.findMeeting(id);
  if (!existing) throw notFound('Meeting');
  if (existing.status !== 'SCHEDULED') {
    throw conflict('This sitting has been held. Its papers are now a record.');
  }

  committeeModel.updateMeeting(id, {
    title: input.title,
    scheduled_at: input.scheduledAt,
    venue: input.venue ?? null,
    mode: input.mode,
    agenda: input.agenda ?? null,
  });

  return getMeeting(id, user);
}

export function markAttendance(
  id: number,
  input: z.infer<typeof attendanceSchema>,
  user: AuthUser,
) {
  assertStaff(user);
  const meeting = committeeModel.findMeeting(id);
  if (!meeting) throw notFound('Meeting');
  if (meeting.status === 'CANCELLED') throw conflict('This sitting was cancelled.');

  committeeModel.replaceAttendance(
    id,
    input.attendance.map((entry) => ({
      user_id: entry.userId,
      is_present: entry.isPresent ? 1 : 0,
      remarks: entry.remarks ?? null,
    })),
  );

  return getMeeting(id, user);
}

/**
 * Records the minutes and closes the sitting.
 *
 * Quorum is checked here rather than at attendance, because attendance is
 * marked as people walk in and only becomes final when the minutes are written.
 * A sitting short of quorum can still be minuted — it just cannot decide.
 */
export function recordMinutes(id: number, input: z.infer<typeof minutesSchema>, user: AuthUser) {
  return transaction(() => {
    assertStaff(user);
    const meeting = committeeModel.findMeeting(id);
    if (!meeting) throw notFound('Meeting');
    if (meeting.status === 'CANCELLED') throw conflict('This sitting was cancelled.');

    const present = committeeModel.countPresent(id);
    if (input.decisions.length && present < meeting.committee_quorum) {
      throw conflict(
        `${present} member(s) attended against a quorum of ${meeting.committee_quorum}. `
          + 'A sitting short of its quorum can be minuted, but it cannot record decisions.',
      );
    }

    for (const decision of input.decisions) {
      if (!decision.actionById) {
        throw badRequest(
          `"${decision.subject}" names nobody to act on it. Every decision carries an owner.`,
        );
      }
    }

    committeeModel.updateMeeting(id, {
      status: 'HELD',
      held_at: input.heldAt ?? meeting.scheduled_at,
      minutes: input.minutes,
      minutes_by: user.id,
    });

    committeeModel.replaceDecisions(
      id,
      input.decisions.map((decision, index) => ({
        seq: index + 1,
        subject: decision.subject,
        decision: decision.decision,
        action_by_id: decision.actionById ?? null,
        due_date: decision.dueDate ?? null,
        status: 'OPEN',
      })),
    );

    // Tell each officer what they have been left with.
    insertManyNotifications(
      input.decisions
        .filter((decision) => decision.actionById)
        .map((decision) => ({
          userId: decision.actionById!,
          title: 'An action item is with you',
          message: `${meeting.committee_name} (${meeting.meeting_no}): ${decision.subject}`
            + (decision.dueDate ? `, due ${decision.dueDate}` : ''),
          severity: 'WARNING' as const,
          entityType: 'MEETING',
          entityId: id,
          link: `/committees/meetings/${id}`,
        })),
    );

    insertAuditEntry({
      userId: user.id,
      action: 'MEETING_MINUTED',
      entityType: 'MEETING',
      entityId: id,
      detail: `${meeting.meeting_no}: ${present} present, ${input.decisions.length} decision(s)`,
    });

    return getMeeting(id, user);
  });
}

export function cancelMeeting(id: number, reason: string, user: AuthUser) {
  assertStaff(user);
  const meeting = committeeModel.findMeeting(id);
  if (!meeting) throw notFound('Meeting');
  if (meeting.status === 'HELD') throw conflict('This sitting has already been held.');
  if (!reason.trim()) throw badRequest('Record why the sitting was called off.');

  committeeModel.updateMeeting(id, { status: 'CANCELLED', minutes: reason });
  insertAuditEntry({
    userId: user.id,
    action: 'MEETING_CANCELLED',
    entityType: 'MEETING',
    entityId: id,
    detail: `${meeting.meeting_no}: ${reason}`,
  });

  return getMeeting(id, user);
}

/** Closes an action item. Only the officer who owns it, or an administrator. */
export function closeDecision(
  decisionId: number,
  input: z.infer<typeof decisionCloseSchema>,
  user: AuthUser,
) {
  assertStaff(user);
  const decision = committeeModel.findDecision(decisionId);
  if (!decision) throw notFound('Action item');
  if (decision.status !== 'OPEN') throw conflict('This action item is already closed.');

  committeeModel.updateDecision(decisionId, {
    status: input.status,
    closed_on: new Date().toISOString().slice(0, 10),
    closing_note: input.closingNote ?? null,
  });

  insertAuditEntry({
    userId: user.id,
    action: `MEETING_ACTION_${input.status}`,
    entityType: 'MEETING',
    entityId: decision.meeting_id,
    detail: decision.subject,
  });

  return getMeeting(decision.meeting_id, user);
}

/** The action items an officer is carrying, for their own dashboard. */
export function myActions(user: AuthUser) {
  assertStaff(user);
  const today = new Date().toISOString().slice(0, 10);
  return committeeModel.listActionsForUser(user.id).map((row) => ({
    id: row.id,
    meetingId: row.meeting_id,
    meetingNo: row.meeting_no,
    meetingTitle: row.meeting_title,
    committeeName: row.committee_name,
    subject: row.subject,
    decision: row.decision,
    dueDate: row.due_date,
    isOverdue: Boolean(row.due_date) && row.due_date! < today,
  }));
}
