import { z } from 'zod';
import { RTI_DAYS } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as rtiModel from '../models/rti.model.js';
import * as userModel from '../models/user.model.js';
import { findDivisionCode } from '../models/misc-bill.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { insertManyNotifications } from '../models/notification.model.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { generateRtiAppealNo, generateRtiNo } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';
import { isoDate, rupees } from '../middleware/validate.js';

/**
 * Applications under the Right to Information Act, 2005.
 *
 * The clock is what this module is for. Section 7(1) gives a Public Information
 * Officer thirty days to reply — forty-eight hours where life or liberty is
 * concerned — and Section 20 makes them personally liable at ₹250 a day for
 * missing it, up to ₹25,000. So the due date is computed from the receipt and
 * stored, the register sorts by how little time is left, and a rejection has to
 * name the clause of Section 8 it rests on.
 */

export const RECEIVED_VIA = [
  'ONLINE', 'RTI_PORTAL', 'POST', 'COUNTER', 'TRANSFERRED_IN',
] as const;

export const REQUEST_STATUSES = [
  'RECEIVED', 'IN_PROGRESS', 'TRANSFERRED', 'REPLIED', 'PARTLY_REJECTED', 'REJECTED', 'CLOSED',
] as const;

/**
 * The exemptions in Section 8(1). A rejection that does not cite one of these
 * is not a rejection an appellate authority can test, so the list is closed.
 */
export const EXEMPTION_SECTIONS: { code: string; label: string }[] = [
  { code: '8(1)(a)', label: 'Sovereignty, integrity, security or strategic interest of the State' },
  { code: '8(1)(b)', label: 'Expressly forbidden by a court or tribunal' },
  { code: '8(1)(c)', label: 'Breach of privilege of Parliament or a State Legislature' },
  { code: '8(1)(d)', label: 'Commercial confidence, trade secrets or intellectual property' },
  { code: '8(1)(e)', label: 'Information held in a fiduciary relationship' },
  { code: '8(1)(f)', label: 'Received in confidence from a foreign government' },
  { code: '8(1)(g)', label: 'Would endanger life or physical safety, or identify a source' },
  { code: '8(1)(h)', label: 'Would impede an investigation or the apprehension of offenders' },
  { code: '8(1)(i)', label: 'Cabinet papers, before the decision is taken' },
  { code: '8(1)(j)', label: 'Personal information with no bearing on any public activity' },
  { code: '9', label: 'Would involve an infringement of copyright subsisting in another' },
  { code: '11', label: 'Third-party information, pending the third party being heard' },
];

const EXEMPTION_CODES = EXEMPTION_SECTIONS.map((section) => section.code);

export const requestSchema = z.object({
  applicantName: z.string().trim().min(2, 'Name the applicant.').max(160),
  applicantAddress: z.string().trim().max(500).optional(),
  applicantEmail: z.string().trim().email('Enter a valid email address.').max(160).optional().or(z.literal('')),
  applicantPhone: z.string().trim().max(40).optional(),
  isBpl: z.coerce.boolean().default(false),
  feePaid: rupees.optional(),
  receivedOn: isoDate,
  receivedVia: z.enum(RECEIVED_VIA).default('ONLINE'),
  subject: z.string().trim().min(3, 'State the subject.').max(500),
  informationSought: z.string().trim().min(3, 'Record what has been asked for.').max(8000),
  isLifeOrLiberty: z.coerce.boolean().default(false),
  divisionId: z.coerce.number().int().positive().optional().nullable(),
  pioUserId: z.coerce.number().int().positive().optional().nullable(),
  remarks: z.string().trim().max(2000).optional(),
});

export const replySchema = z
  .object({
    status: z.enum(['REPLIED', 'PARTLY_REJECTED', 'REJECTED', 'TRANSFERRED']),
    replyDate: isoDate,
    replySummary: z.string().trim().max(8000).optional(),
    rejectionSection: z.enum(EXEMPTION_CODES as [string, ...string[]]).optional(),
    rejectionGround: z.string().trim().max(2000).optional(),
    transferredTo: z.string().trim().max(250).optional(),
    documentId: z.coerce.number().int().positive().optional().nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'REJECTED' || value.status === 'PARTLY_REJECTED') {
      if (!value.rejectionSection) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rejectionSection'],
          message: 'Cite the clause of Section 8 the refusal rests on.',
        });
      }
      if (!value.rejectionGround) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rejectionGround'],
          message: 'State why the exemption applies. A bare citation is not a reason.',
        });
      }
    }
    if (value.status === 'TRANSFERRED' && !value.transferredTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['transferredTo'],
        message: 'Name the public authority it was transferred to under Section 6(3).',
      });
    }
    if (value.status === 'REPLIED' && !value.replySummary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['replySummary'],
        message: 'Record what was supplied.',
      });
    }
  });

export const appealSchema = z.object({
  appealLevel: z.enum(['FIRST', 'SECOND']).default('FIRST'),
  filedOn: isoDate,
  grounds: z.string().trim().min(3, 'Record the grounds of appeal.').max(4000),
  appellateAuthority: z.string().trim().max(200).optional(),
  authorityUserId: z.coerce.number().int().positive().optional().nullable(),
});

export const appealDecisionSchema = z.object({
  status: z.enum(['HEARD', 'ALLOWED', 'REJECTED', 'REMANDED', 'WITHDRAWN']),
  decidedOn: isoDate,
  decision: z.string().trim().min(3, 'Record the decision.').max(4000),
  penaltyImposed: rupees.optional(),
  remarks: z.string().trim().max(2000).optional(),
});

// --- The statutory clock -----------------------------------------------------

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * Section 7(1): thirty days from receipt, or forty-eight hours where life or
 * liberty is at stake. Computed once, at receipt, and stored — a due date the
 * register recalculates is a due date somebody can argue with.
 */
export function dueDateFor(receivedOn: string, isLifeOrLiberty: boolean): string {
  return addDays(receivedOn, isLifeOrLiberty ? 2 : RTI_DAYS.REPLY);
}

// --- Presentation ------------------------------------------------------------

export function present(row: rtiModel.RequestDetailRow) {
  const isOpen = ['RECEIVED', 'IN_PROGRESS', 'TRANSFERRED'].includes(row.status);
  const overdueBy = row.days_remaining < 0 ? -row.days_remaining : 0;

  return {
    id: row.id,
    requestNo: row.request_no,
    applicant: {
      name: row.applicant_name,
      address: row.applicant_address,
      email: row.applicant_email,
      phone: row.applicant_phone,
      isBpl: Boolean(row.is_bpl),
    },
    feePaid: toRupees(row.fee_paid),
    receivedOn: row.received_on,
    receivedVia: row.received_via,
    subject: row.subject,
    informationSought: row.information_sought,
    isLifeOrLiberty: Boolean(row.is_life_or_liberty),
    division: row.division_id
      ? { id: row.division_id, code: row.division_code, name: row.division_name }
      : null,
    pio: row.pio_user_id ? { id: row.pio_user_id, name: row.pio_name } : null,
    dueDate: row.due_date,
    daysRemaining: row.days_remaining,
    isOpen,
    isOverdue: isOpen && row.days_remaining < 0,
    /**
     * Section 20: ₹250 a day, to a ceiling of ₹25,000, out of the Public
     * Information Officer's own pocket. Shown while it can still be avoided.
     */
    penaltyExposure: Math.min(overdueBy * 250, 25_000),
    status: row.status,
    replyDate: row.reply_date,
    replySummary: row.reply_summary,
    daysTaken: row.days_taken,
    wasLate: row.reply_date !== null && row.days_remaining < 0,
    rejection: row.rejection_section
      ? {
          section: row.rejection_section,
          label: EXEMPTION_SECTIONS.find((s) => s.code === row.rejection_section)?.label ?? null,
          ground: row.rejection_ground,
        }
      : null,
    transferredTo: row.transferred_to,
    appealCount: row.appeal_count,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    remarks: row.remarks,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentAppeal(row: rtiModel.AppealRow) {
  const isOpen = ['FILED', 'HEARD'].includes(row.status);
  return {
    id: row.id,
    appealNo: row.appeal_no,
    level: row.appeal_level,
    filedOn: row.filed_on,
    grounds: row.grounds,
    appellateAuthority: row.appellate_authority,
    authority: row.authority_user_id
      ? { id: row.authority_user_id, name: row.authority_name }
      : null,
    dueDate: row.due_date,
    daysRemaining: row.days_remaining,
    isOverdue: isOpen && row.days_remaining < 0,
    status: row.status,
    decidedOn: row.decided_on,
    decision: row.decision,
    penaltyImposed: toRupees(row.penalty_imposed),
    remarks: row.remarks,
  };
}

// --- Reading -----------------------------------------------------------------

function assertStaff(user: AuthUser): void {
  if (scopeFilter(user).contractorId !== undefined) {
    throw forbidden('The RTI register is not available to contractor accounts.');
  }
}

export function list(
  user: AuthUser,
  options: {
    search?: string;
    status?: string;
    mineOnly?: boolean;
    overdueOnly?: boolean;
    page: number;
    pageSize: number;
  },
) {
  assertStaff(user);
  const scope = scopeFilter(user);
  const { rows, total } = rtiModel.listRequests({
    search: options.search,
    status: options.status,
    pioUserId: options.mineOnly ? user.id : undefined,
    overdueOnly: options.overdueOnly,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });

  return {
    items: rows.map(present),
    total,
    page: options.page,
    pageSize: options.pageSize,
    compliance: rtiModel.complianceSummary({
      divisionId: scope.divisionId,
      circleId: scope.circleId,
    }),
  };
}

function load(id: number, user: AuthUser): rtiModel.RequestDetailRow {
  assertStaff(user);
  const row = rtiModel.findById(id);
  if (!row) throw notFound('RTI application');
  const scope = scopeFilter(user);
  if (scope.divisionId && row.division_id && row.division_id !== scope.divisionId) {
    throw forbidden('This application was made to another division.');
  }
  return row;
}

export function getOne(id: number, user: AuthUser) {
  const row = load(id, user);
  return { ...present(row), appeals: rtiModel.listAppeals(id).map(presentAppeal) };
}

// --- Writing -----------------------------------------------------------------

export function create(input: z.infer<typeof requestSchema>, user: AuthUser) {
  assertStaff(user);
  return transaction(() => {
    if (input.pioUserId && !userModel.findAuthUserById(input.pioUserId)) {
      throw badRequest('The Public Information Officer named is not an active account.');
    }
    // An applicant below the poverty line pays no fee. It is an exemption in the
    // Act, not a concession, so a fee recorded against one is a mistake.
    if (input.isBpl && (input.feePaid ?? 0) > 0) {
      throw badRequest('An applicant below the poverty line pays no fee under the Act.');
    }

    const divisionId = input.divisionId ?? user.divisionId ?? null;
    // The number reads as a reference an applicant can quote, so it carries the
    // division's own code. An application made to head office has no division.
    const divisionCode = divisionId ? findDivisionCode(divisionId) ?? 'HO' : 'HO';
    const requestNo = generateRtiNo(divisionCode);
    const dueDate = dueDateFor(input.receivedOn, input.isLifeOrLiberty);

    const id = rtiModel.insertRequest({
      request_no: requestNo,
      applicant_name: input.applicantName,
      applicant_address: input.applicantAddress ?? null,
      applicant_email: input.applicantEmail || null,
      applicant_phone: input.applicantPhone ?? null,
      is_bpl: input.isBpl ? 1 : 0,
      fee_paid: input.feePaid ?? 0,
      received_on: input.receivedOn,
      received_via: input.receivedVia,
      subject: input.subject,
      information_sought: input.informationSought,
      is_life_or_liberty: input.isLifeOrLiberty ? 1 : 0,
      division_id: divisionId,
      pio_user_id: input.pioUserId ?? user.id,
      due_date: dueDate,
      status: 'RECEIVED',
      remarks: input.remarks ?? null,
      created_by: user.id,
    });

    // The officer on the clock is told, because the penalty is personal.
    const pio = input.pioUserId ?? user.id;
    if (pio !== user.id) {
      insertManyNotifications([
        {
          userId: pio,
          title: 'An RTI application is with you',
          message: `${requestNo}: ${input.subject}. Reply due ${dueDate}.`,
          severity: 'WARNING',
          entityType: 'RTI',
          entityId: id,
          link: `/rti/${id}`,
        },
      ]);
    }

    insertAuditEntry({
      userId: user.id,
      action: 'RTI_RECEIVED',
      entityType: 'RTI',
      entityId: id,
      detail: `${requestNo} from ${input.applicantName}, due ${dueDate}`,
    });

    return getOne(id, user);
  });
}

export function update(id: number, input: z.infer<typeof requestSchema>, user: AuthUser) {
  const existing = load(id, user);
  if (!['RECEIVED', 'IN_PROGRESS'].includes(existing.status)) {
    throw conflict('This application has been answered. Its particulars are now a record.');
  }
  if (input.isBpl && (input.feePaid ?? 0) > 0) {
    throw badRequest('An applicant below the poverty line pays no fee under the Act.');
  }

  rtiModel.updateRequest(id, {
    applicant_name: input.applicantName,
    applicant_address: input.applicantAddress ?? null,
    applicant_email: input.applicantEmail || null,
    applicant_phone: input.applicantPhone ?? null,
    is_bpl: input.isBpl ? 1 : 0,
    fee_paid: input.feePaid ?? 0,
    received_on: input.receivedOn,
    received_via: input.receivedVia,
    subject: input.subject,
    information_sought: input.informationSought,
    is_life_or_liberty: input.isLifeOrLiberty ? 1 : 0,
    division_id: input.divisionId ?? existing.division_id,
    pio_user_id: input.pioUserId ?? existing.pio_user_id,
    // The clock restarts from the receipt, so correcting either moves the date.
    due_date: dueDateFor(input.receivedOn, input.isLifeOrLiberty),
    remarks: input.remarks ?? null,
  });

  return getOne(id, user);
}

/** Answers the application. What that means depends on the status chosen. */
export function reply(id: number, input: z.infer<typeof replySchema>, user: AuthUser) {
  return transaction(() => {
    const existing = load(id, user);
    if (!['RECEIVED', 'IN_PROGRESS'].includes(existing.status)) {
      throw conflict('This application has already been answered.');
    }
    if (input.replyDate < existing.received_on) {
      throw badRequest('The reply cannot predate the application.');
    }
    if (
      (input.status === 'REJECTED' || input.status === 'PARTLY_REJECTED')
      && (!input.rejectionSection || !input.rejectionGround)
    ) {
      throw badRequest(
        'A refusal has to cite the clause it rests on and say why it applies. '
          + 'One that does not is not a refusal an appellate authority can test.',
      );
    }
    if (input.status === 'TRANSFERRED' && !input.transferredTo) {
      throw badRequest('Name the public authority it was transferred to under Section 6(3).');
    }

    rtiModel.updateRequest(id, {
      status: input.status,
      reply_date: input.replyDate,
      reply_summary: input.replySummary ?? null,
      rejection_section: input.rejectionSection ?? null,
      rejection_ground: input.rejectionGround ?? null,
      transferred_to: input.transferredTo ?? null,
      document_id: input.documentId ?? null,
    });

    const late = input.replyDate > existing.due_date;
    insertAuditEntry({
      userId: user.id,
      action: `RTI_${input.status}`,
      entityType: 'RTI',
      entityId: id,
      detail: `${existing.request_no} answered ${input.replyDate}`
        + (late ? ` — ${daysBetween(existing.due_date, input.replyDate)} day(s) beyond the statutory date` : '')
        + (input.rejectionSection ? `, under Section ${input.rejectionSection}` : ''),
    });

    return getOne(id, user);
  });
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/**
 * Records an appeal. A first appeal lies to a departmental appellate authority
 * and must be decided in thirty days; a second lies to the Information
 * Commission. Either way the clock starts again.
 */
export function addAppeal(id: number, input: z.infer<typeof appealSchema>, user: AuthUser) {
  return transaction(() => {
    const request = load(id, user);

    const existing = rtiModel.listAppeals(id);
    if (existing.some((appeal) => appeal.appeal_level === input.appealLevel)) {
      throw conflict(`A ${input.appealLevel.toLowerCase()} appeal is already on record.`);
    }
    if (input.appealLevel === 'SECOND' && !existing.some((a) => a.appeal_level === 'FIRST')) {
      throw conflict('A second appeal lies only after a first appeal has been decided.');
    }
    if (input.filedOn < request.received_on) {
      throw badRequest('An appeal cannot predate the application it disputes.');
    }

    const appealNo = generateRtiAppealNo(request.request_no, input.appealLevel);
    const appealId = rtiModel.insertAppeal({
      request_id: id,
      appeal_no: appealNo,
      appeal_level: input.appealLevel,
      filed_on: input.filedOn,
      grounds: input.grounds,
      appellate_authority: input.appellateAuthority ?? null,
      authority_user_id: input.authorityUserId ?? null,
      due_date: addDays(input.filedOn, RTI_DAYS.APPEAL),
      status: 'FILED',
      created_by: user.id,
    });

    rtiModel.updateRequest(id, { status: 'CLOSED' });

    if (input.authorityUserId) {
      insertManyNotifications([
        {
          userId: input.authorityUserId,
          title: 'An RTI appeal is with you',
          message: `${appealNo} against ${request.request_no}. To be decided by `
            + `${addDays(input.filedOn, RTI_DAYS.APPEAL)}.`,
          severity: 'WARNING',
          entityType: 'RTI',
          entityId: id,
          link: `/rti/${id}`,
        },
      ]);
    }

    insertAuditEntry({
      userId: user.id,
      action: 'RTI_APPEAL_FILED',
      entityType: 'RTI',
      entityId: id,
      detail: `${appealNo} (${input.appealLevel.toLowerCase()} appeal) against ${request.request_no}`,
    });

    return getOne(id, user);
  });
}

export function decideAppeal(
  appealId: number,
  input: z.infer<typeof appealDecisionSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const appeal = rtiModel.findAppeal(appealId);
    if (!appeal) throw notFound('Appeal');
    const request = load(appeal.request_id, user);

    if (!['FILED', 'HEARD'].includes(appeal.status)) {
      throw conflict('This appeal has already been decided.');
    }
    if (input.decidedOn < appeal.filed_on) {
      throw badRequest('The decision cannot predate the appeal.');
    }

    rtiModel.updateAppeal(appealId, {
      status: input.status,
      decided_on: input.decidedOn,
      decision: input.decision,
      penalty_imposed: input.penaltyImposed ?? 0,
      remarks: input.remarks ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'RTI_APPEAL_DECIDED',
      entityType: 'RTI',
      entityId: request.id,
      detail: `${appeal.appeal_no}: ${input.status.toLowerCase()}`
        + (input.penaltyImposed
          ? `, penalty of ₹${toRupees(input.penaltyImposed)} under Section 20`
          : ''),
    });

    return getOne(request.id, user);
  });
}

export function remove(id: number, user: AuthUser): void {
  const existing = load(id, user);
  if (existing.status !== 'RECEIVED') {
    throw conflict('This application has been acted on. It stays on the register.');
  }
  if (existing.appeal_count > 0) {
    throw conflict('An appeal has been filed against this application.');
  }
  rtiModel.deleteRequest(id);
  insertAuditEntry({
    userId: user.id,
    action: 'RTI_DELETED',
    entityType: 'RTI',
    entityId: id,
    detail: existing.request_no,
  });
}
