import { z } from 'zod';
import { PACKAGE_STATUS, PROJECT_STATUS, ROLES } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as packageModel from '../models/package.model.js';
import * as projectModel from '../models/project.model.js';
import * as contractorModel from '../models/contractor.model.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { generatePackageCode } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { fromBps, toRupees } from '../utils/money.js';
import { isoDate, percent, rupees } from '../middleware/validate.js';

export const createPackageSchema = z.object({
  projectId: z.coerce.number().int().positive(),
  name: z.string().trim().min(3, 'Enter a package name.').max(200),
  description: z.string().trim().max(2000).optional(),
  workTypeId: z.coerce.number().int().positive().optional(),
  estimatedValue: rupees,
  /**
   * The officer responsible for the package. Per the requirements this is the
   * Executive Engineer, not the Assistant Engineer.
   */
  inChargeUserId: z.coerce.number().int().positive().optional(),
  defectLiabilityMonths: z.coerce.number().int().min(0).max(120).default(12),
  securityDeposit: percent.optional(),
  retention: percent.optional(),
});

export const updatePackageSchema = createPackageSchema.partial().omit({ projectId: true }).extend({
  contractorId: z.coerce.number().int().positive().optional(),
  awardedValue: rupees.optional(),
  agreementNo: z.string().trim().max(80).optional(),
  agreementDate: isoDate.optional(),
  workOrderNo: z.string().trim().max(80).optional(),
  workOrderDate: isoDate.optional(),
  commencementDate: isoDate.optional(),
  completionDate: isoDate.optional(),
  physicalProgress: z.coerce.number().int().min(0).max(100).optional(),
  status: z
    .enum([
      PACKAGE_STATUS.DRAFT,
      PACKAGE_STATUS.TENDERING,
      PACKAGE_STATUS.AWARDED,
      PACKAGE_STATUS.IN_PROGRESS,
      PACKAGE_STATUS.COMPLETED,
      PACKAGE_STATUS.CLOSED,
    ])
    .optional(),
});

export function present(row: packageModel.PackageDetailRow) {
  const billed = packageModel.getBilledToDate(row.id);
  return {
    id: row.id,
    packageCode: row.package_code,
    name: row.name,
    description: row.description,
    project: {
      id: row.project_id,
      code: row.project_code,
      name: row.project_name,
      divisionId: row.division_id,
      divisionCode: row.division_code,
      divisionName: row.division_name,
    },
    workType: row.work_type_id ? { id: row.work_type_id, name: row.work_type_name } : null,
    contractor: row.contractor_id
      ? { id: row.contractor_id, code: row.contractor_code, name: row.contractor_name }
      : null,
    inCharge: row.in_charge_user_id
      ? { id: row.in_charge_user_id, name: row.in_charge_name }
      : null,
    estimatedValue: toRupees(row.estimated_value),
    awardedValue: toRupees(row.awarded_value),
    billedToDate: toRupees(billed),
    balanceValue: toRupees(Math.max((row.awarded_value || row.estimated_value) - billed, 0)),
    agreementNo: row.agreement_no,
    agreementDate: row.agreement_date,
    workOrderNo: row.work_order_no,
    workOrderDate: row.work_order_date,
    commencementDate: row.commencement_date,
    completionDate: row.completion_date,
    defectLiabilityMonths: row.defect_liability_months,
    securityDeposit: fromBps(row.security_deposit_bps),
    retention: fromBps(row.retention_bps),
    physicalProgress: row.physical_progress_pct,
    status: row.status,
    billCount: row.bill_count,
    paidAmount: toRupees(row.paid_amount),
    pendingAmount: toRupees(row.pending_amount),
    createdAt: row.created_at,
  };
}

export function list(
  user: AuthUser,
  options: {
    search?: string;
    projectId?: number;
    contractorId?: number;
    status?: string;
    page: number;
    pageSize: number;
  },
) {
  const scope = scopeFilter(user);
  const { rows, total } = packageModel.listPackages({
    search: options.search,
    projectId: options.projectId,
    // Contractors only ever see their own packages.
    contractorId: scope.contractorId ?? options.contractorId,
    status: options.status,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

export function assertVisible(row: packageModel.PackageDetailRow, user: AuthUser): void {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined && row.contractor_id !== scope.contractorId) {
    throw forbidden('This package is not awarded to you.');
  }
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This package belongs to another division.');
  }
  if (scope.circleId && row.circle_id !== scope.circleId) {
    throw forbidden('This package belongs to another circle.');
  }
  if (scope.zoneId && row.zone_id !== scope.zoneId) {
    throw forbidden('This package belongs to another zone.');
  }
}

export function getOne(id: number, user: AuthUser) {
  const row = packageModel.findById(id);
  if (!row) throw notFound('Package');
  assertVisible(row, user);
  return present(row);
}

export function create(input: z.infer<typeof createPackageSchema>, user: AuthUser) {
  return transaction(() => {
    const project = projectModel.findById(input.projectId);
    if (!project) throw notFound('Project');

    if (project.status === PROJECT_STATUS.DRAFT || project.status === PROJECT_STATUS.PENDING_SANCTION) {
      throw conflict('Packages can only be created once the project is sanctioned.');
    }

    if (input.inChargeUserId) {
      const officer = userModel.findSummaryById(input.inChargeUserId);
      if (!officer) throw badRequest('Select a valid officer.');
      if (officer.roleCode !== ROLES.EE) {
        throw badRequest('The officer in charge of a package must be an Executive Engineer.');
      }
    }

    const packageCode = generatePackageCode(project.project_code);
    const id = packageModel.insertPackage({
      package_code: packageCode,
      project_id: input.projectId,
      name: input.name,
      description: input.description ?? null,
      work_type_id: input.workTypeId ?? project.work_type_id,
      estimated_value: input.estimatedValue,
      in_charge_user_id: input.inChargeUserId ?? null,
      defect_liability_months: input.defectLiabilityMonths,
      security_deposit_bps: input.securityDeposit ?? 500,
      retention_bps: input.retention ?? 500,
      status: PACKAGE_STATUS.DRAFT,
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'PACKAGE_CREATED',
      entityType: 'PACKAGE',
      entityId: id,
      detail: `${packageCode} — ${input.name}`,
    });

    return present(packageModel.findById(id)!);
  });
}

export function update(id: number, input: z.infer<typeof updatePackageSchema>, user: AuthUser) {
  const existing = packageModel.findById(id);
  if (!existing) throw notFound('Package');
  assertVisible(existing, user);

  if (input.contractorId) {
    const contractor = contractorModel.findById(input.contractorId);
    if (!contractor) throw badRequest('Select a valid contractor.');
    if (contractor.is_blacklisted) throw badRequest('That contractor is blacklisted.');
    if (contractor.registration_status !== 'APPROVED') {
      throw badRequest('That contractor registration is not approved.');
    }
  }

  if (input.inChargeUserId) {
    const officer = userModel.findSummaryById(input.inChargeUserId);
    if (!officer) throw badRequest('Select a valid officer.');
    if (officer.roleCode !== ROLES.EE) {
      throw badRequest('The officer in charge of a package must be an Executive Engineer.');
    }
  }

  // The package code is a permanent reference — it is never part of an update.
  packageModel.updatePackage(id, {
    name: input.name,
    description: input.description,
    work_type_id: input.workTypeId,
    estimated_value: input.estimatedValue,
    awarded_value: input.awardedValue,
    contractor_id: input.contractorId,
    in_charge_user_id: input.inChargeUserId,
    agreement_no: input.agreementNo,
    agreement_date: input.agreementDate,
    work_order_no: input.workOrderNo,
    work_order_date: input.workOrderDate,
    commencement_date: input.commencementDate,
    completion_date: input.completionDate,
    defect_liability_months: input.defectLiabilityMonths,
    security_deposit_bps: input.securityDeposit,
    retention_bps: input.retention,
    physical_progress_pct: input.physicalProgress,
    status: input.status,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'PACKAGE_UPDATED',
    entityType: 'PACKAGE',
    entityId: id,
    detail: existing.package_code,
  });

  return present(packageModel.findById(id)!);
}
