import { z } from 'zod';
import { transaction } from '../db/index.js';
import * as courtModel from '../models/court.model.js';
import * as projectModel from '../models/project.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';
import { isoDate, rupees } from '../middleware/validate.js';

/**
 * Court case management.
 *
 * A case is read two ways and the module serves both: as a file with a history
 * of listings, and as a line on next week's cause list. The second is what stops
 * a department losing by default — a hearing nobody was told about is a hearing
 * nobody attends.
 */

export const COURT_TYPES = [
  'SUPREME_COURT', 'HIGH_COURT', 'DISTRICT_COURT', 'TRIBUNAL', 'LOK_ADALAT', 'ARBITRATION',
] as const;

export const CASE_TYPES = [
  'WRIT', 'CIVIL', 'ARBITRATION', 'CONTEMPT', 'LAND_ACQUISITION', 'SERVICE', 'OTHER',
] as const;

export const CASE_STATUSES = [
  'FILED', 'PENDING', 'RESERVED', 'DISPOSED', 'APPEALED', 'WITHDRAWN', 'SETTLED',
] as const;

export const OUTCOMES = [
  'IN_FAVOUR', 'AGAINST', 'PARTLY_IN_FAVOUR', 'SETTLED', 'WITHDRAWN',
] as const;

/** The statuses that mean the department no longer has to attend. */
const CLOSED_STATUSES: string[] = ['DISPOSED', 'WITHDRAWN', 'SETTLED'];

export const caseSchema = z.object({
  caseNo: z.string().trim().min(2, 'Enter the case number.').max(80),
  internalRef: z.string().trim().max(80).optional(),
  courtName: z.string().trim().min(2, 'Name the court.').max(160),
  courtType: z.enum(COURT_TYPES).default('HIGH_COURT'),
  caseType: z.enum(CASE_TYPES).default('WRIT'),
  filedBy: z.enum(['BY_DEPARTMENT', 'AGAINST_DEPARTMENT']).default('AGAINST_DEPARTMENT'),
  petitioner: z.string().trim().min(2, 'Name the petitioner.').max(250),
  respondent: z.string().trim().min(2, 'Name the respondent.').max(250),
  subject: z.string().trim().min(3, 'State what the case is about.').max(1000),
  filingDate: isoDate,
  divisionId: z.coerce.number().int().positive().optional().nullable(),
  projectId: z.coerce.number().int().positive().optional().nullable(),
  packageId: z.coerce.number().int().positive().optional().nullable(),
  parcelId: z.coerce.number().int().positive().optional().nullable(),
  contractorId: z.coerce.number().int().positive().optional().nullable(),
  claimAmount: rupees.optional(),
  advocateName: z.string().trim().max(160).optional(),
  advocateFee: rupees.optional(),
  dealingOfficerId: z.coerce.number().int().positive().optional().nullable(),
  nextHearingDate: isoDate.optional(),
  remarks: z.string().trim().max(2000).optional(),
});

export const hearingSchema = z.object({
  hearingDate: isoDate,
  purpose: z.string().trim().max(250).optional(),
  appearedBy: z.string().trim().max(160).optional(),
  proceedings: z.string().trim().max(4000).optional(),
  orderSummary: z.string().trim().max(4000).optional(),
  nextDate: isoDate.optional(),
  documentId: z.coerce.number().int().positive().optional().nullable(),
});

export const disposalSchema = z.object({
  status: z.enum(['DISPOSED', 'APPEALED', 'WITHDRAWN', 'SETTLED']),
  outcome: z.enum(OUTCOMES),
  disposalDate: isoDate,
  decreeAmount: rupees.optional(),
  remarks: z.string().trim().max(2000).optional(),
});

// --- Presentation ------------------------------------------------------------

export function present(row: courtModel.CaseDetailRow) {
  const isClosed = CLOSED_STATUSES.includes(row.status);
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: row.id,
    caseNo: row.case_no,
    internalRef: row.internal_ref,
    court: { name: row.court_name, type: row.court_type },
    caseType: row.case_type,
    filedBy: row.filed_by,
    /** True when the department is defending rather than moving. */
    isRespondent: row.filed_by === 'AGAINST_DEPARTMENT',
    petitioner: row.petitioner,
    respondent: row.respondent,
    subject: row.subject,
    filingDate: row.filing_date,
    division: row.division_id
      ? { id: row.division_id, code: row.division_code, name: row.division_name }
      : null,
    project: row.project_id
      ? { id: row.project_id, code: row.project_code, name: row.project_name }
      : null,
    packageCode: row.package_code,
    parcel: row.parcel_id ? { id: row.parcel_id, parcelNo: row.parcel_no } : null,
    contractor: row.contractor_id ? { id: row.contractor_id, name: row.contractor_name } : null,
    claimAmount: toRupees(row.claim_amount),
    decreeAmount: toRupees(row.decree_amount),
    advocate: { name: row.advocate_name, fee: toRupees(row.advocate_fee) },
    dealingOfficer: row.dealing_officer_id
      ? { id: row.dealing_officer_id, name: row.dealing_officer_name }
      : null,
    nextHearingDate: row.next_hearing_date,
    /** The figure a dealing officer reads first. */
    isListedToday: !isClosed && row.next_hearing_date === today,
    isHearingMissed: !isClosed
      && Boolean(row.next_hearing_date)
      && row.next_hearing_date! < today,
    status: row.status,
    outcome: row.outcome,
    disposalDate: row.disposal_date,
    isClosed,
    hearingCount: row.hearing_count,
    lastHearingDate: row.last_hearing_date,
    remarks: row.remarks,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentHearing(row: courtModel.HearingRow) {
  return {
    id: row.id,
    hearingDate: row.hearing_date,
    purpose: row.purpose,
    appearedBy: row.appeared_by,
    proceedings: row.proceedings,
    orderSummary: row.order_summary,
    nextDate: row.next_date,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    recordedBy: row.recorded_by_name,
    createdAt: row.created_at,
  };
}

// --- Reading -----------------------------------------------------------------

export function list(
  user: AuthUser,
  options: {
    search?: string;
    status?: string;
    courtType?: string;
    caseType?: string;
    projectId?: number;
    hearingWithinDays?: number;
    page: number;
    pageSize: number;
  },
) {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined) {
    throw forbidden('The litigation register is not available to contractor accounts.');
  }

  const { rows, total } = courtModel.listCases({
    search: options.search,
    status: options.status,
    courtType: options.courtType,
    caseType: options.caseType,
    projectId: options.projectId,
    hearingWithinDays: options.hearingWithinDays,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });

  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

function load(id: number, user: AuthUser): courtModel.CaseDetailRow {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined) {
    throw forbidden('The litigation register is not available to contractor accounts.');
  }
  const row = courtModel.findById(id);
  if (!row) throw notFound('Court case');
  // A case belongs to the division that raised it; head office sees all of them.
  if (scope.divisionId && row.division_id && row.division_id !== scope.divisionId) {
    throw forbidden('This case belongs to another division.');
  }
  return row;
}

export function getOne(id: number, user: AuthUser) {
  const row = load(id, user);
  return { ...present(row), hearings: courtModel.listHearings(id).map(presentHearing) };
}

// --- Writing -----------------------------------------------------------------

export function create(input: z.infer<typeof caseSchema>, user: AuthUser) {
  return transaction(() => {
    if (input.projectId) {
      const project = projectModel.findById(input.projectId);
      if (!project) throw badRequest('Select a valid project.');
    }

    const id = courtModel.insertCase({
      case_no: input.caseNo,
      internal_ref: input.internalRef ?? null,
      court_name: input.courtName,
      court_type: input.courtType,
      case_type: input.caseType,
      filed_by: input.filedBy,
      petitioner: input.petitioner,
      respondent: input.respondent,
      subject: input.subject,
      filing_date: input.filingDate,
      // A case with no division of its own belongs to the officer's division.
      division_id: input.divisionId ?? user.divisionId ?? null,
      project_id: input.projectId ?? null,
      package_id: input.packageId ?? null,
      parcel_id: input.parcelId ?? null,
      contractor_id: input.contractorId ?? null,
      claim_amount: input.claimAmount ?? 0,
      advocate_name: input.advocateName ?? null,
      advocate_fee: input.advocateFee ?? 0,
      dealing_officer_id: input.dealingOfficerId ?? user.id,
      next_hearing_date: input.nextHearingDate ?? null,
      status: 'FILED',
      remarks: input.remarks ?? null,
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'COURT_CASE_REGISTERED',
      entityType: 'COURT_CASE',
      entityId: id,
      detail: `${input.caseNo} — ${input.petitioner} v ${input.respondent}`,
    });

    return getOne(id, user);
  });
}

export function update(id: number, input: z.infer<typeof caseSchema>, user: AuthUser) {
  return transaction(() => {
    const existing = load(id, user);
    if (CLOSED_STATUSES.includes(existing.status)) {
      throw conflict('This case has been closed. Its particulars are now a record.');
    }

    courtModel.updateCase(id, {
      case_no: input.caseNo,
      internal_ref: input.internalRef ?? null,
      court_name: input.courtName,
      court_type: input.courtType,
      case_type: input.caseType,
      filed_by: input.filedBy,
      petitioner: input.petitioner,
      respondent: input.respondent,
      subject: input.subject,
      filing_date: input.filingDate,
      division_id: input.divisionId ?? existing.division_id,
      project_id: input.projectId ?? null,
      package_id: input.packageId ?? null,
      parcel_id: input.parcelId ?? null,
      contractor_id: input.contractorId ?? null,
      claim_amount: input.claimAmount ?? 0,
      advocate_name: input.advocateName ?? null,
      advocate_fee: input.advocateFee ?? 0,
      dealing_officer_id: input.dealingOfficerId ?? existing.dealing_officer_id,
      next_hearing_date: input.nextHearingDate ?? null,
      remarks: input.remarks ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'COURT_CASE_UPDATED',
      entityType: 'COURT_CASE',
      entityId: id,
      detail: existing.case_no,
    });

    return getOne(id, user);
  });
}

/**
 * Records a listing. The date given for the next one is copied onto the case,
 * because the cause list is read off the case and not off its hearings.
 */
export function addHearing(id: number, input: z.infer<typeof hearingSchema>, user: AuthUser) {
  return transaction(() => {
    const existing = load(id, user);
    if (CLOSED_STATUSES.includes(existing.status)) {
      throw conflict('This case has been closed. No further hearings can be recorded against it.');
    }
    if (input.nextDate && input.nextDate < input.hearingDate) {
      throw badRequest('The next date cannot fall before the hearing it was given at.');
    }

    courtModel.insertHearing({
      case_id: id,
      hearing_date: input.hearingDate,
      purpose: input.purpose ?? null,
      appeared_by: input.appearedBy ?? null,
      proceedings: input.proceedings ?? null,
      order_summary: input.orderSummary ?? null,
      next_date: input.nextDate ?? null,
      document_id: input.documentId ?? null,
      recorded_by: user.id,
    });

    courtModel.updateCase(id, {
      next_hearing_date: input.nextDate ?? null,
      // A case that has actually been heard is no longer merely filed.
      status: existing.status === 'FILED' ? 'PENDING' : existing.status,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'COURT_HEARING_RECORDED',
      entityType: 'COURT_CASE',
      entityId: id,
      detail: `${existing.case_no} heard ${input.hearingDate}`
        + (input.nextDate ? `, next ${input.nextDate}` : ''),
    });

    return getOne(id, user);
  });
}

export function removeHearing(hearingId: number, user: AuthUser) {
  const hearing = courtModel.findHearing(hearingId);
  if (!hearing) throw notFound('Hearing');
  const existing = load(hearing.case_id, user);

  courtModel.deleteHearing(hearingId);
  insertAuditEntry({
    userId: user.id,
    action: 'COURT_HEARING_DELETED',
    entityType: 'COURT_CASE',
    entityId: existing.id,
    detail: `${existing.case_no}: hearing of ${hearing.hearing_date}`,
  });
  return getOne(existing.id, user);
}

/** Closes a case. An outcome is required — a disposal without one says nothing. */
export function dispose(id: number, input: z.infer<typeof disposalSchema>, user: AuthUser) {
  return transaction(() => {
    const existing = load(id, user);
    if (CLOSED_STATUSES.includes(existing.status)) {
      throw conflict('This case has already been closed.');
    }
    if (input.disposalDate < existing.filing_date) {
      throw badRequest('The disposal cannot precede the filing.');
    }

    courtModel.updateCase(id, {
      status: input.status,
      outcome: input.outcome,
      disposal_date: input.disposalDate,
      decree_amount: input.decreeAmount ?? 0,
      next_hearing_date: null,
      remarks: input.remarks ?? existing.remarks,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'COURT_CASE_DISPOSED',
      entityType: 'COURT_CASE',
      entityId: id,
      detail: `${existing.case_no}: ${input.outcome.replace(/_/g, ' ').toLowerCase()}`
        + (input.decreeAmount ? `, decree ₹${toRupees(input.decreeAmount)}` : ''),
    });

    return getOne(id, user);
  });
}

export function remove(id: number, user: AuthUser): void {
  const existing = load(id, user);
  if (existing.hearing_count > 0) {
    throw conflict(
      'Hearings have been recorded against this case. Withdraw it rather than deleting the record.',
    );
  }
  courtModel.deleteCase(id);
  insertAuditEntry({
    userId: user.id,
    action: 'COURT_CASE_DELETED',
    entityType: 'COURT_CASE',
    entityId: id,
    detail: existing.case_no,
  });
}
