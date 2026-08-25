import { z } from 'zod';
import { ENTITY_TYPES, LAND_PARCEL_SEQUENCE, LAND_PARCEL_STATUS, WORKFLOWS } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as landModel from '../models/land.model.js';
import * as projectModel from '../models/project.model.js';
import * as packageModel from '../models/package.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { assertVisible as assertProjectVisible, scopeFilter } from './project.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import { generateParcelNo } from '../utils/codes.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { applyBps, fromQty, toRupees } from '../utils/money.js';
import { isoDate, quantity, rupees } from '../middleware/validate.js';

/**
 * Land acquisition, under the Right to Fair Compensation and Transparency in
 * Land Acquisition, Rehabilitation and Resettlement Act, 2013.
 *
 * A work that cannot get its land does not start, so the parcel register is
 * where a delayed project is usually explained. The rules the module actually
 * enforces are the ones a court would test: the statutory stages run in order,
 * compensation is market value plus solatium plus interest rather than one
 * negotiated figure, and possession is not taken before the money is paid.
 */

export const LAND_TYPES = [
  'AGRICULTURAL', 'RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'GOVERNMENT', 'FOREST',
] as const;

export const PAYMENT_MODES = ['RTGS', 'CHEQUE', 'COURT_DEPOSIT'] as const;

/**
 * Section 30(1) of the Act: solatium is one hundred per cent of the
 * compensation, not a figure the acquiring officer arrives at. The default is
 * therefore the statute, and departing from it has to be deliberate.
 */
export const STATUTORY_SOLATIUM_BPS = 10_000;

export const parcelSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  packageId: z.coerce.number().int().positive().optional().nullable(),
  districtId: z.coerce.number().int().positive().optional().nullable(),
  village: z.string().trim().min(2, 'Name the village.').max(120),
  surveyNo: z.string().trim().min(1, 'Enter the survey number.').max(60),
  khataNo: z.string().trim().max(60).optional(),
  landType: z.enum(LAND_TYPES).default('AGRICULTURAL'),
  areaSqm: quantity,
  ownerName: z.string().trim().min(2, 'Name the recorded owner.').max(160),
  ownerAddress: z.string().trim().max(500).optional(),
  ownerContact: z.string().trim().max(60).optional(),
  marketValue: rupees.optional(),
  solatiumAmount: rupees.optional(),
  interestAmount: rupees.optional(),
  otherAmount: rupees.optional(),
  remarks: z.string().trim().max(1000).optional(),
  documentId: z.coerce.number().int().positive().optional().nullable(),
});

/** Recording one of the statutory stages against a parcel. */
export const parcelStageSchema = z.object({
  stage: z.enum(['NOTIFIED', 'DECLARED', 'AWARDED', 'POSSESSED']),
  referenceNo: z.string().trim().max(100).optional(),
  stageDate: isoDate,
  remarks: z.string().trim().max(1000).optional(),
});

export const compensationSchema = z.object({
  paymentDate: isoDate,
  amount: rupees,
  mode: z.enum(PAYMENT_MODES).default('RTGS'),
  referenceNo: z.string().trim().max(80).optional(),
  payeeName: z.string().trim().min(2, 'Name the payee.').max(160),
  remarks: z.string().trim().max(500).optional(),
});

// --- Presentation ------------------------------------------------------------

export function present(row: landModel.ParcelDetailRow) {
  const balance = row.total_compensation - row.paid_amount;

  return {
    id: row.id,
    parcelNo: row.parcel_no,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    packageId: row.package_id,
    packageCode: row.package_code,
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    district: row.district_name,
    village: row.village,
    surveyNo: row.survey_no,
    khataNo: row.khata_no,
    landType: row.land_type,
    areaSqm: fromQty(row.area_sqm),
    /** Acres are what the revenue record and the owner both speak in. */
    areaAcres: Math.round((fromQty(row.area_sqm) / 4046.86) * 1000) / 1000,
    owner: { name: row.owner_name, address: row.owner_address, contact: row.owner_contact },
    stages: {
      notification: { no: row.notification_no, date: row.notification_date },
      declaration: { no: row.declaration_no, date: row.declaration_date },
      award: { no: row.award_no, date: row.award_date },
      possessionDate: row.possession_date,
    },
    compensation: {
      marketValue: toRupees(row.market_value),
      solatium: toRupees(row.solatium_amount),
      interest: toRupees(row.interest_amount),
      other: toRupees(row.other_amount),
      total: toRupees(row.total_compensation),
      paid: toRupees(row.paid_amount),
      balance: toRupees(balance),
      isFullyPaid: row.total_compensation > 0 && balance <= 0,
      paymentCount: row.payment_count,
    },
    status: row.status,
    /** Litigation on this parcel, which is why an acquisition usually stalls. */
    openCaseCount: row.open_case_count,
    remarks: row.remarks,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    workflowInstanceId: row.workflow_instance_id,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentPayment(row: landModel.PaymentRow) {
  return {
    id: row.id,
    paymentDate: row.payment_date,
    amount: toRupees(row.amount),
    mode: row.mode,
    referenceNo: row.reference_no,
    payeeName: row.payee_name,
    remarks: row.remarks,
    recordedBy: row.recorded_by_name,
    createdAt: row.created_at,
  };
}

// --- Reading -----------------------------------------------------------------

export function list(
  user: AuthUser,
  options: { search?: string; status?: string; projectId?: number; page: number; pageSize: number },
) {
  const scope = scopeFilter(user);
  const { rows, total } = landModel.listParcels({
    search: options.search,
    status: options.status,
    projectId: options.projectId,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });

  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

function load(id: number, user: AuthUser): landModel.ParcelDetailRow {
  const row = landModel.findById(id);
  if (!row) throw notFound('Land parcel');
  const project = projectModel.findById(row.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);
  return row;
}

export function getOne(id: number, user: AuthUser) {
  const row = load(id, user);
  return {
    ...present(row),
    payments: landModel.listPayments(id).map(presentPayment),
  };
}

/** The acquisition position of a project, for the project screen. */
export function summaryForProject(projectId: number, user: AuthUser) {
  const project = projectModel.findById(projectId);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  const summary = landModel.projectSummary(projectId);
  return {
    parcels: summary.parcels,
    areaSqm: fromQty(summary.area),
    areaAcres: Math.round((fromQty(summary.area) / 4046.86) * 1000) / 1000,
    compensation: toRupees(summary.compensation),
    paid: toRupees(summary.paid),
    balance: toRupees(summary.compensation - summary.paid),
    possessed: summary.possessed,
    disputed: summary.disputed,
  };
}

// --- Writing -----------------------------------------------------------------

/** Market value plus the statutory additions. Never a single typed figure. */
function totalOf(values: {
  market_value: number;
  solatium_amount: number;
  interest_amount: number;
  other_amount: number;
}): number {
  return values.market_value + values.solatium_amount + values.interest_amount + values.other_amount;
}

export function create(input: z.infer<typeof parcelSchema>, user: AuthUser) {
  return transaction(() => {
    const project = projectModel.findById(input.projectId);
    if (!project) throw notFound('Project');
    assertProjectVisible(project, user);

    if (input.packageId) {
      const pkg = packageModel.findById(input.packageId);
      if (!pkg) throw badRequest('Select a valid package.');
      if (pkg.project_id !== input.projectId) {
        throw badRequest('That package does not belong to the selected project.');
      }
    }

    const marketValue = input.marketValue ?? 0;
    const amounts = {
      market_value: marketValue,
      // Solatium follows the statute unless a figure is given deliberately.
      solatium_amount: input.solatiumAmount ?? applyBps(marketValue, STATUTORY_SOLATIUM_BPS),
      interest_amount: input.interestAmount ?? 0,
      other_amount: input.otherAmount ?? 0,
    };

    const parcelNo = generateParcelNo(project.division_code);
    const id = landModel.insertParcel({
      parcel_no: parcelNo,
      project_id: input.projectId,
      package_id: input.packageId ?? null,
      division_id: project.division_id,
      district_id: input.districtId ?? project.district_id ?? null,
      village: input.village,
      survey_no: input.surveyNo,
      khata_no: input.khataNo ?? null,
      land_type: input.landType,
      area_sqm: input.areaSqm,
      owner_name: input.ownerName,
      owner_address: input.ownerAddress ?? null,
      owner_contact: input.ownerContact ?? null,
      ...amounts,
      total_compensation: totalOf(amounts),
      status: LAND_PARCEL_STATUS.IDENTIFIED,
      remarks: input.remarks ?? null,
      document_id: input.documentId ?? null,
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'LAND_PARCEL_CREATED',
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      detail: `${parcelNo}: ${input.village} survey ${input.surveyNo}, ${input.ownerName}`,
    });

    return getOne(id, user);
  });
}

export function update(id: number, input: z.infer<typeof parcelSchema>, user: AuthUser) {
  return transaction(() => {
    const existing = load(id, user);
    if (existing.status === LAND_PARCEL_STATUS.POSSESSED) {
      throw conflict('Possession has been taken on this parcel. Its particulars are now a record.');
    }

    const marketValue = input.marketValue ?? existing.market_value;
    const amounts = {
      market_value: marketValue,
      solatium_amount: input.solatiumAmount ?? applyBps(marketValue, STATUTORY_SOLATIUM_BPS),
      interest_amount: input.interestAmount ?? 0,
      other_amount: input.otherAmount ?? 0,
    };
    const total = totalOf(amounts);

    // Compensation cannot be revised below what has already gone out the door.
    if (total < existing.paid_amount) {
      throw conflict(
        `₹${toRupees(existing.paid_amount)} has already been paid against this parcel. `
          + 'The compensation cannot be revised below that.',
      );
    }

    landModel.updateParcel(id, {
      package_id: input.packageId ?? null,
      district_id: input.districtId ?? null,
      village: input.village,
      survey_no: input.surveyNo,
      khata_no: input.khataNo ?? null,
      land_type: input.landType,
      area_sqm: input.areaSqm,
      owner_name: input.ownerName,
      owner_address: input.ownerAddress ?? null,
      owner_contact: input.ownerContact ?? null,
      ...amounts,
      total_compensation: total,
      remarks: input.remarks ?? null,
      document_id: input.documentId ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'LAND_PARCEL_UPDATED',
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      detail: existing.parcel_no,
    });

    return getOne(id, user);
  });
}

/**
 * Records one of the statutory stages.
 *
 * The order is the Act's, and it is enforced: a declaration without a
 * preliminary notification behind it, or an award without a declaration, is not
 * an acquisition that would survive being challenged.
 */
export function recordStage(
  id: number,
  input: z.infer<typeof parcelStageSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const parcel = load(id, user);

    const required: Record<string, { after: string; label: string }> = {
      NOTIFIED: { after: LAND_PARCEL_STATUS.IDENTIFIED, label: 'the preliminary notification under Section 11' },
      DECLARED: { after: LAND_PARCEL_STATUS.NOTIFIED, label: 'the declaration under Section 19' },
      AWARDED: { after: LAND_PARCEL_STATUS.DECLARED, label: 'the award under Section 23' },
      POSSESSED: { after: LAND_PARCEL_STATUS.COMPENSATED, label: 'taking possession' },
    };
    const rule = required[input.stage]!;

    const currentIndex = LAND_PARCEL_SEQUENCE.indexOf(parcel.status);
    const neededIndex = LAND_PARCEL_SEQUENCE.indexOf(rule.after);
    if (currentIndex < neededIndex) {
      throw conflict(
        `This parcel is at "${parcel.status.toLowerCase()}". `
          + `${rule.label.charAt(0).toUpperCase()}${rule.label.slice(1)} cannot be recorded until `
          + `it reaches "${rule.after.toLowerCase()}".`,
      );
    }

    // Possession is the one stage that turns on money rather than paperwork.
    if (input.stage === 'POSSESSED' && parcel.paid_amount < parcel.total_compensation) {
      throw conflict(
        `₹${toRupees(parcel.total_compensation - parcel.paid_amount)} of compensation is still `
          + 'unpaid. Possession is not taken before the award is satisfied.',
      );
    }

    const columns: Record<string, Record<string, unknown>> = {
      NOTIFIED: { notification_no: input.referenceNo ?? null, notification_date: input.stageDate },
      DECLARED: { declaration_no: input.referenceNo ?? null, declaration_date: input.stageDate },
      AWARDED: { award_no: input.referenceNo ?? null, award_date: input.stageDate },
      POSSESSED: { possession_date: input.stageDate },
    };

    landModel.updateParcel(id, {
      ...columns[input.stage],
      status: input.stage,
      remarks: input.remarks ?? parcel.remarks,
    });

    insertAuditEntry({
      userId: user.id,
      action: `LAND_PARCEL_${input.stage}`,
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      detail: `${parcel.parcel_no}: ${input.referenceNo ?? ''} dated ${input.stageDate}`.trim(),
    });

    return getOne(id, user);
  });
}

/** Sends an award for approval before compensation can be disbursed. */
export function submitForApproval(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const parcel = load(id, user);
    if (parcel.status !== LAND_PARCEL_STATUS.AWARDED) {
      throw conflict('Record the award under Section 23 before sending it for approval.');
    }
    if (parcel.workflow_instance_id) {
      throw conflict('This award is already under approval.');
    }
    if (parcel.total_compensation <= 0) {
      throw badRequest('Enter the compensation before sending the award for approval.');
    }

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.LAND_ACQUISITION,
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      entityRef: parcel.parcel_no,
      title: `${parcel.village} survey ${parcel.survey_no} — ${parcel.owner_name}`,
      amount: parcel.total_compensation,
      divisionId: parcel.division_id,
      circleId: parcel.circle_id,
      zoneId: parcel.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    landModel.updateParcel(id, { workflow_instance_id: instance.id });

    insertAuditEntry({
      userId: user.id,
      action: 'LAND_AWARD_SUBMITTED',
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      detail: `${parcel.parcel_no} for ₹${toRupees(parcel.total_compensation)}`,
    });

    return getOne(id, user);
  });
}

/** Records compensation actually disbursed, in the instalments it goes out in. */
export function addPayment(
  id: number,
  input: z.infer<typeof compensationSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const parcel = load(id, user);

    if (LAND_PARCEL_SEQUENCE.indexOf(parcel.status) < LAND_PARCEL_SEQUENCE.indexOf(LAND_PARCEL_STATUS.AWARDED)) {
      throw conflict('Compensation cannot be paid before the award is passed under Section 23.');
    }
    if (input.amount <= 0) throw badRequest('Enter the amount paid.');

    const balance = parcel.total_compensation - parcel.paid_amount;
    if (input.amount > balance) {
      throw badRequest(
        `Only ₹${toRupees(balance)} remains payable against an award of `
          + `₹${toRupees(parcel.total_compensation)}.`,
      );
    }

    landModel.insertPayment({
      parcel_id: id,
      payment_date: input.paymentDate,
      amount: input.amount,
      mode: input.mode,
      reference_no: input.referenceNo ?? null,
      payee_name: input.payeeName,
      remarks: input.remarks ?? null,
      recorded_by: user.id,
    });

    // The running total is recomputed from the payments rather than added to,
    // so a deleted instalment cannot leave the parcel overstating what it paid.
    const paid = landModel.paidTotal(id);
    landModel.updateParcel(id, {
      paid_amount: paid,
      status: paid >= parcel.total_compensation ? LAND_PARCEL_STATUS.COMPENSATED : parcel.status,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'LAND_COMPENSATION_PAID',
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: id,
      detail: `${parcel.parcel_no}: ₹${toRupees(input.amount)} to ${input.payeeName}`,
    });

    return getOne(id, user);
  });
}

export function removePayment(paymentId: number, user: AuthUser) {
  return transaction(() => {
    const payment = landModel.findPayment(paymentId);
    if (!payment) throw notFound('Payment');
    const parcel = load(payment.parcel_id, user);

    if (parcel.status === LAND_PARCEL_STATUS.POSSESSED) {
      throw conflict('Possession has been taken against this award. Its payments are now a record.');
    }

    landModel.deletePayment(paymentId);
    const paid = landModel.paidTotal(parcel.id);
    landModel.updateParcel(parcel.id, {
      paid_amount: paid,
      status: paid >= parcel.total_compensation
        ? LAND_PARCEL_STATUS.COMPENSATED
        : LAND_PARCEL_STATUS.AWARDED,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'LAND_COMPENSATION_REVERSED',
      entityType: ENTITY_TYPES.LAND_PARCEL,
      entityId: parcel.id,
      detail: `${parcel.parcel_no}: ₹${toRupees(payment.amount)} reversed`,
    });

    return getOne(parcel.id, user);
  });
}

export function remove(id: number, user: AuthUser): void {
  const parcel = load(id, user);
  if (parcel.status !== LAND_PARCEL_STATUS.IDENTIFIED) {
    throw conflict(
      'The statutory process has begun on this parcel. Withdraw the acquisition rather than '
        + 'deleting the record.',
    );
  }
  landModel.deleteParcel(id);
  insertAuditEntry({
    userId: user.id,
    action: 'LAND_PARCEL_DELETED',
    entityType: ENTITY_TYPES.LAND_PARCEL,
    entityId: id,
    detail: parcel.parcel_no,
  });
}

/** Applies the outcome of the award approval chain. */
registerOutcomeHandler(ENTITY_TYPES.LAND_PARCEL, ({ instance, status }) => {
  if (status === 'IN_PROGRESS') return;
  if (status === 'APPROVED') return;
  // A rejected or withdrawn award goes back to the declaration it rests on.
  landModel.updateParcel(instance.entity_id, {
    status: LAND_PARCEL_STATUS.DECLARED,
    workflow_instance_id: null,
  });
});
