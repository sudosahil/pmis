import { z } from 'zod';
import { ENTITY_TYPES, WORKFLOWS } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as fundModel from '../models/fund.model.js';
import * as miscBillModel from '../models/misc-bill.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import { financialYear, generateFundReleaseNo, generateLocNo } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';
import { isoDate, rupees } from '../middleware/validate.js';

export const fundReleaseSchema = z.object({
  schemeId: z.coerce.number().int().positive(),
  projectId: z.coerce.number().int().positive().optional(),
  divisionId: z.coerce.number().int().positive(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/, 'Use the format 2025-26.').optional(),
  sanctionedAmount: rupees,
  releasedAmount: rupees,
  releaseDate: isoDate,
  referenceNo: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export const locRequestSchema = z.object({
  divisionId: z.coerce.number().int().positive().optional(),
  schemeId: z.coerce.number().int().positive().optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  requestDate: isoDate,
  requestedAmount: rupees,
  purpose: z.string().trim().min(5, 'Describe what the funds are needed for.').max(1000),
});

export const locApprovalSchema = z.object({
  approvedAmount: rupees,
  remarks: z.string().trim().max(1000).optional(),
});

function presentRelease(row: fundModel.FundReleaseDetailRow) {
  return {
    id: row.id,
    releaseNo: row.release_no,
    scheme: { id: row.scheme_id, code: row.scheme_code, name: row.scheme_name },
    project: row.project_id
      ? { id: row.project_id, code: row.project_code, name: row.project_name }
      : null,
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    financialYear: row.financial_year,
    sanctionedAmount: toRupees(row.sanctioned_amount),
    releasedAmount: toRupees(row.released_amount),
    balanceAmount: toRupees(row.sanctioned_amount - row.released_amount),
    releaseDate: row.release_date,
    referenceNo: row.reference_no,
    remarks: row.remarks,
    status: row.status,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentLoc(row: fundModel.LocDetailRow) {
  return {
    id: row.id,
    locNo: row.loc_no,
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    scheme: row.scheme_id ? { id: row.scheme_id, name: row.scheme_name } : null,
    financialYear: row.financial_year,
    requestDate: row.request_date,
    requestedAmount: toRupees(row.requested_amount),
    approvedAmount: toRupees(row.approved_amount),
    purpose: row.purpose,
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    approvalDate: row.approval_date,
    remarks: row.remarks,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

// --- Fund releases ---------------------------------------------------------

export function listReleases(
  user: AuthUser,
  options: { schemeId?: number; projectId?: number; financialYear?: string; page: number; pageSize: number },
) {
  const scope = scopeFilter(user);
  const { rows, total } = fundModel.listReleases({
    schemeId: options.schemeId,
    projectId: options.projectId,
    divisionId: scope.divisionId,
    financialYear: options.financialYear,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(presentRelease), total, page: options.page, pageSize: options.pageSize };
}

export function createRelease(input: z.infer<typeof fundReleaseSchema>, user: AuthUser) {
  return transaction(() => {
    if (input.releasedAmount > input.sanctionedAmount) {
      throw badRequest('The released amount cannot exceed the sanctioned amount.');
    }
    const schemeCode = getSchemeCode(input.schemeId);
    const fy = input.financialYear ?? financialYear(new Date(input.releaseDate));
    const releaseNo = generateFundReleaseNo(schemeCode, fy);

    const id = fundModel.insertRelease({
      release_no: releaseNo,
      scheme_id: input.schemeId,
      project_id: input.projectId ?? null,
      division_id: input.divisionId,
      financial_year: fy,
      sanctioned_amount: input.sanctionedAmount,
      released_amount: input.releasedAmount,
      release_date: input.releaseDate,
      reference_no: input.referenceNo ?? null,
      remarks: input.remarks ?? null,
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'FUND_RELEASED',
      entityType: 'FUND_RELEASE',
      entityId: id,
      detail: `${releaseNo}: ₹${toRupees(input.releasedAmount)}`,
    });

    return presentRelease(fundModel.findReleaseById(id)!);
  });
}

function getSchemeCode(schemeId: number): string {
  const code = miscBillModel.findSchemeCode(schemeId);
  if (!code) throw badRequest('Select a valid scheme.');
  return code;
}

// --- Letter of Credit ------------------------------------------------------

export function listLocRequests(
  user: AuthUser,
  options: { status?: string; financialYear?: string; page: number; pageSize: number },
) {
  const scope = scopeFilter(user);
  const { rows, total } = fundModel.listLocRequests({
    divisionId: scope.divisionId,
    status: options.status,
    financialYear: options.financialYear,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(presentLoc), total, page: options.page, pageSize: options.pageSize };
}

export function getLoc(id: number, user: AuthUser) {
  const row = fundModel.findLocById(id);
  if (!row) throw notFound('LOC request');
  const scope = scopeFilter(user);
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This request belongs to another division.');
  }
  return presentLoc(row);
}

export function createLoc(input: z.infer<typeof locRequestSchema>, user: AuthUser) {
  return transaction(() => {
    const divisionId = input.divisionId ?? user.divisionId;
    if (!divisionId) throw badRequest('Select the division raising this request.');

    const divisionCode = miscBillModel.findDivisionCode(divisionId);
    if (!divisionCode) throw badRequest('Select a valid division.');

    const fy = input.financialYear ?? financialYear(new Date(input.requestDate));
    const locNo = generateLocNo(divisionCode, fy);

    const id = fundModel.insertLoc({
      loc_no: locNo,
      division_id: divisionId,
      scheme_id: input.schemeId ?? null,
      financial_year: fy,
      request_date: input.requestDate,
      requested_amount: input.requestedAmount,
      purpose: input.purpose,
      status: 'DRAFT',
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'LOC_CREATED',
      entityType: ENTITY_TYPES.LOC,
      entityId: id,
      detail: `${locNo}: ₹${toRupees(input.requestedAmount)}`,
    });

    return presentLoc(fundModel.findLocById(id)!);
  });
}

export function submitLoc(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const loc = fundModel.findLocById(id);
    if (!loc) throw notFound('LOC request');
    if (loc.status !== 'DRAFT' && loc.status !== 'RETURNED') {
      throw conflict('This request has already been submitted.');
    }

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.LOC_APPROVAL,
      entityType: ENTITY_TYPES.LOC,
      entityId: id,
      entityRef: loc.loc_no,
      title: loc.purpose ?? 'Letter of Credit request',
      amount: loc.requested_amount,
      divisionId: loc.division_id,
      circleId: loc.circle_id,
      zoneId: loc.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    fundModel.updateLoc(id, { status: 'IN_APPROVAL', workflow_instance_id: instance.id });

    insertAuditEntry({
      userId: user.id,
      action: 'LOC_SUBMITTED',
      entityType: ENTITY_TYPES.LOC,
      entityId: id,
      detail: loc.loc_no,
    });

    return presentLoc(fundModel.findLocById(id)!);
  });
}

/** Records the sanctioned figure, which may be less than what was requested. */
export function setApprovedAmount(
  id: number,
  input: z.infer<typeof locApprovalSchema>,
  user: AuthUser,
) {
  const loc = fundModel.findLocById(id);
  if (!loc) throw notFound('LOC request');
  if (loc.status !== 'IN_APPROVAL') {
    throw conflict('The approved amount can only be set while the request is under approval.');
  }
  if (input.approvedAmount > loc.requested_amount) {
    throw badRequest('The approved amount cannot exceed the amount requested.');
  }

  fundModel.updateLoc(id, {
    approved_amount: input.approvedAmount,
    remarks: input.remarks ?? loc.remarks,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'LOC_AMOUNT_SET',
    entityType: ENTITY_TYPES.LOC,
    entityId: id,
    detail: `${loc.loc_no}: ₹${toRupees(input.approvedAmount)}`,
  });

  return presentLoc(fundModel.findLocById(id)!);
}

registerOutcomeHandler(ENTITY_TYPES.LOC, ({ instance, status }) => {
  if (status === 'IN_PROGRESS') return;
  const loc = fundModel.findLocById(instance.entity_id);
  if (!loc) return;

  if (status === 'APPROVED') {
    fundModel.updateLoc(instance.entity_id, {
      status: 'APPROVED',
      approval_date: new Date().toISOString().slice(0, 10),
      // An approver who did not revise the figure sanctions the full request.
      approved_amount: loc.approved_amount > 0 ? loc.approved_amount : loc.requested_amount,
    });
  } else if (status === 'REJECTED') {
    fundModel.updateLoc(instance.entity_id, { status: 'REJECTED' });
  } else {
    fundModel.updateLoc(instance.entity_id, { status: 'DRAFT', workflow_instance_id: null });
  }
});
