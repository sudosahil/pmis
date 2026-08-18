import { z } from 'zod';
import {
  ENTITY_TYPES,
  GLOBAL_SCOPE_ROLES,
  PROJECT_STATUS,
  ROLES,
  WORKFLOWS,
} from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as projectModel from '../models/project.model.js';
import * as masterModel from '../models/master.model.js';
import { getMasterDefinition } from '../config/masters.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import { financialYear, generateProjectCode } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';
import { isoDate, rupees } from '../middleware/validate.js';

export const createProjectSchema = z.object({
  name: z.string().trim().min(5, 'Enter a descriptive project name.').max(250),
  description: z.string().trim().max(2000).optional(),
  schemeId: z.coerce.number().int().positive(),
  workTypeId: z.coerce.number().int().positive(),
  projectCategoryId: z.coerce.number().int().positive(),
  zoneId: z.coerce.number().int().positive(),
  circleId: z.coerce.number().int().positive(),
  divisionId: z.coerce.number().int().positive(),
  subDivisionId: z.coerce.number().int().positive().optional(),
  districtId: z.coerce.number().int().positive().optional(),
  townId: z.coerce.number().int().positive().optional(),
  estimatedCost: rupees,
  sanctionedCost: rupees.optional(),
  sanctionNo: z.string().trim().max(80).optional(),
  sanctionDate: isoDate.optional(),
  startDate: isoDate.optional(),
  targetCompletionDate: isoDate.optional(),
  latitude: z.string().trim().max(24).optional(),
  longitude: z.string().trim().max(24).optional(),
});

/**
 * The project code is deliberately absent from the update schema: once
 * generated it identifies the work in every downstream register and must never
 * change, which the source requirements call out explicitly.
 */
export const updateProjectSchema = createProjectSchema.partial().extend({
  actualCompletionDate: isoDate.optional(),
  status: z
    .enum([
      PROJECT_STATUS.SANCTIONED,
      PROJECT_STATUS.IN_PROGRESS,
      PROJECT_STATUS.COMPLETED,
      PROJECT_STATUS.CLOSED,
    ])
    .optional(),
});

export const milestoneSchema = z.object({
  milestones: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(200),
        plannedDate: isoDate.optional(),
        actualDate: isoDate.optional(),
        weightage: z.coerce.number().int().min(0).max(100),
        status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED']).default('PENDING'),
        remarks: z.string().trim().max(500).optional(),
      }),
    )
    .max(50),
});

export function present(row: projectModel.ProjectDetailRow) {
  return {
    id: row.id,
    projectCode: row.project_code,
    name: row.name,
    description: row.description,
    scheme: { id: row.scheme_id, code: row.scheme_code, name: row.scheme_name },
    workType: { id: row.work_type_id, name: row.work_type_name },
    category: { id: row.project_category_id, name: row.category_name },
    location: {
      zoneId: row.zone_id,
      zoneName: row.zone_name,
      circleId: row.circle_id,
      circleName: row.circle_name,
      divisionId: row.division_id,
      divisionName: row.division_name,
      divisionCode: row.division_code,
      subDivisionId: row.sub_division_id,
      subDivisionName: row.sub_division_name,
      districtId: row.district_id,
      districtName: row.district_name,
      townId: row.town_id,
      townName: row.town_name,
      latitude: row.latitude,
      longitude: row.longitude,
    },
    estimatedCost: toRupees(row.estimated_cost),
    sanctionedCost: toRupees(row.sanctioned_cost),
    sanctionNo: row.sanction_no,
    sanctionDate: row.sanction_date,
    startDate: row.start_date,
    targetCompletionDate: row.target_completion_date,
    actualCompletionDate: row.actual_completion_date,
    physicalProgress: row.physical_progress_pct,
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    packageCount: row.package_count,
    awardedValue: toRupees(row.awarded_value),
    paidAmount: toRupees(row.paid_amount),
    pendingAmount: toRupees(row.pending_amount),
    miscExpenditure: toRupees(row.misc_expenditure),
    financialProgress:
      row.sanctioned_cost > 0
        ? Math.round((row.paid_amount / row.sanctioned_cost) * 100)
        : 0,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

/** Restricts a listing to what the user's posting allows them to see. */
export function scopeFilter(user: AuthUser): {
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  contractorId?: number;
} {
  if (user.roleCode === ROLES.CONTRACTOR) {
    return { contractorId: user.contractorId ?? -1 };
  }
  if (GLOBAL_SCOPE_ROLES.includes(user.roleCode)) return {};
  if (user.divisionId) return { divisionId: user.divisionId };
  if (user.circleId) return { circleId: user.circleId };
  if (user.zoneId) return { zoneId: user.zoneId };
  return {};
}

export function list(
  user: AuthUser,
  options: {
    search?: string;
    status?: string;
    schemeId?: number;
    divisionId?: number;
    workTypeId?: number;
    page: number;
    pageSize: number;
    sort?: string;
    order?: 'asc' | 'desc';
  },
) {
  const scope = scopeFilter(user);
  const { rows, total } = projectModel.listProjects({
    search: options.search,
    status: options.status,
    schemeId: options.schemeId,
    workTypeId: options.workTypeId,
    // An explicit division filter is honoured only inside the user's own scope.
    divisionId: options.divisionId ?? scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    contractorId: scope.contractorId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
    sort: options.sort,
    order: options.order,
  });
  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

export function getOne(id: number, user: AuthUser) {
  const row = projectModel.findById(id);
  if (!row) throw notFound('Project');
  assertVisible(row, user);
  return {
    ...present(row),
    milestones: projectModel.listMilestones(id).map((m) => ({
      id: m.id,
      seq: m.seq,
      name: m.name,
      plannedDate: m.planned_date,
      actualDate: m.actual_date,
      weightage: m.weightage_pct,
      status: m.status,
      remarks: m.remarks,
    })),
    expenditure: (() => {
      const fy = financialYear();
      const e = projectModel.getExpenditure(id, fy);
      return {
        financialYear: fy,
        uptoPreviousYear: toRupees(e.uptoPreviousYear),
        duringYear: toRupees(e.duringYear),
        total: toRupees(e.total),
      };
    })(),
  };
}

export function assertVisible(row: projectModel.ProjectDetailRow, user: AuthUser): void {
  const scope = scopeFilter(user);
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This project belongs to another division.');
  }
  if (scope.circleId && row.circle_id !== scope.circleId) {
    throw forbidden('This project belongs to another circle.');
  }
  if (scope.zoneId && row.zone_id !== scope.zoneId) {
    throw forbidden('This project belongs to another zone.');
  }
  if (scope.contractorId !== undefined) {
    const hasPackage = projectModel
      .listProjects({ contractorId: scope.contractorId, limit: 1, offset: 0 })
      .rows.some((p) => p.id === row.id);
    if (!hasPackage) throw forbidden('You have no packages under this project.');
  }
}

/** Verifies the geography chain actually links up before a project is stored. */
function assertHierarchy(input: {
  zoneId: number;
  circleId: number;
  divisionId: number;
  subDivisionId?: number;
}): void {
  const circle = masterModel.findMasterRow(getMasterDefinition('circles')!, input.circleId);
  if (!circle) throw badRequest('Select a valid circle.');
  if (circle.zone_id !== input.zoneId) throw badRequest('That circle does not belong to the selected zone.');

  const division = masterModel.findMasterRow(getMasterDefinition('divisions')!, input.divisionId);
  if (!division) throw badRequest('Select a valid division.');
  if (division.circle_id !== input.circleId) {
    throw badRequest('That division does not belong to the selected circle.');
  }

  if (input.subDivisionId) {
    const sub = masterModel.findMasterRow(getMasterDefinition('sub-divisions')!, input.subDivisionId);
    if (!sub) throw badRequest('Select a valid sub-division.');
    if (sub.division_id !== input.divisionId) {
      throw badRequest('That sub-division does not belong to the selected division.');
    }
  }
}

export function create(input: z.infer<typeof createProjectSchema>, user: AuthUser) {
  return transaction(() => {
    assertHierarchy(input);

    const scheme = masterModel.findMasterRow(getMasterDefinition('schemes')!, input.schemeId);
    if (!scheme) throw badRequest('Select a valid scheme.');

    // The code follows the departmental convention SCHEME-LOCATION-SERIAL.
    const locationName =
      (input.townId
        ? (masterModel.findMasterRow(getMasterDefinition('towns')!, input.townId)?.name as string)
        : null) ??
      (input.districtId
        ? (masterModel.findMasterRow(getMasterDefinition('districts')!, input.districtId)?.name as string)
        : null) ??
      (masterModel.findMasterRow(getMasterDefinition('divisions')!, input.divisionId)?.name as string);

    const projectCode = generateProjectCode(scheme.code as string, locationName);

    const id = projectModel.insertProject({
      project_code: projectCode,
      name: input.name,
      description: input.description ?? null,
      scheme_id: input.schemeId,
      work_type_id: input.workTypeId,
      project_category_id: input.projectCategoryId,
      zone_id: input.zoneId,
      circle_id: input.circleId,
      division_id: input.divisionId,
      sub_division_id: input.subDivisionId ?? null,
      district_id: input.districtId ?? null,
      town_id: input.townId ?? null,
      estimated_cost: input.estimatedCost,
      sanctioned_cost: input.sanctionedCost ?? 0,
      sanction_no: input.sanctionNo ?? null,
      sanction_date: input.sanctionDate ?? null,
      start_date: input.startDate ?? null,
      target_completion_date: input.targetCompletionDate ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      status: PROJECT_STATUS.DRAFT,
      created_by: user.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'PROJECT_CREATED',
      entityType: ENTITY_TYPES.PROJECT,
      entityId: id,
      detail: `${projectCode} — ${input.name}`,
    });

    return present(projectModel.findById(id)!);
  });
}

export function update(id: number, input: z.infer<typeof updateProjectSchema>, user: AuthUser) {
  const existing = projectModel.findById(id);
  if (!existing) throw notFound('Project');
  assertVisible(existing, user);

  if (existing.status === PROJECT_STATUS.PENDING_SANCTION) {
    throw conflict('This project is under sanction and cannot be edited. Withdraw it first.');
  }

  if (input.zoneId || input.circleId || input.divisionId || input.subDivisionId) {
    assertHierarchy({
      zoneId: input.zoneId ?? existing.zone_id,
      circleId: input.circleId ?? existing.circle_id,
      divisionId: input.divisionId ?? existing.division_id,
      subDivisionId: input.subDivisionId ?? existing.sub_division_id ?? undefined,
    });
  }

  projectModel.updateProject(id, {
    name: input.name,
    description: input.description,
    scheme_id: input.schemeId,
    work_type_id: input.workTypeId,
    project_category_id: input.projectCategoryId,
    zone_id: input.zoneId,
    circle_id: input.circleId,
    division_id: input.divisionId,
    sub_division_id: input.subDivisionId,
    district_id: input.districtId,
    town_id: input.townId,
    estimated_cost: input.estimatedCost,
    sanctioned_cost: input.sanctionedCost,
    sanction_no: input.sanctionNo,
    sanction_date: input.sanctionDate,
    start_date: input.startDate,
    target_completion_date: input.targetCompletionDate,
    actual_completion_date: input.actualCompletionDate,
    latitude: input.latitude,
    longitude: input.longitude,
    status: input.status,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'PROJECT_UPDATED',
    entityType: ENTITY_TYPES.PROJECT,
    entityId: id,
    detail: existing.project_code,
  });

  return present(projectModel.findById(id)!);
}

/** Sends a draft project into the administrative sanction workflow. */
export function submitForSanction(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const project = projectModel.findById(id);
    if (!project) throw notFound('Project');
    assertVisible(project, user);

    if (project.status !== PROJECT_STATUS.DRAFT && project.status !== PROJECT_STATUS.REJECTED) {
      throw conflict('Only a draft or returned project can be sent for sanction.');
    }
    if (project.estimated_cost <= 0) {
      throw badRequest('Enter the estimated cost before sending the project for sanction.');
    }

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.PROJECT_SANCTION,
      entityType: ENTITY_TYPES.PROJECT,
      entityId: id,
      entityRef: project.project_code,
      title: project.name,
      amount: project.estimated_cost,
      divisionId: project.division_id,
      circleId: project.circle_id,
      zoneId: project.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    projectModel.updateProject(id, {
      status: PROJECT_STATUS.PENDING_SANCTION,
      workflow_instance_id: instance.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'PROJECT_SUBMITTED_FOR_SANCTION',
      entityType: ENTITY_TYPES.PROJECT,
      entityId: id,
      detail: project.project_code,
    });

    return present(projectModel.findById(id)!);
  });
}

export function saveMilestones(
  id: number,
  input: z.infer<typeof milestoneSchema>,
  user: AuthUser,
) {
  const project = projectModel.findById(id);
  if (!project) throw notFound('Project');
  assertVisible(project, user);

  const total = input.milestones.reduce((sum, m) => sum + m.weightage, 0);
  if (input.milestones.length && total !== 100) {
    throw badRequest(`Milestone weightage must total 100%. It currently totals ${total}%.`);
  }

  projectModel.replaceMilestones(
    id,
    input.milestones.map((m, index) => ({
      seq: index + 1,
      name: m.name,
      planned_date: m.plannedDate ?? null,
      actual_date: m.actualDate ?? null,
      weightage_pct: m.weightage,
      status: m.status,
      remarks: m.remarks ?? null,
    })),
  );
  const progress = projectModel.recomputeProgress(id);

  insertAuditEntry({
    userId: user.id,
    action: 'PROJECT_MILESTONES_UPDATED',
    entityType: ENTITY_TYPES.PROJECT,
    entityId: id,
    detail: `${input.milestones.length} milestones, progress ${progress}%`,
  });

  return getOne(id, user);
}

/** Applies the sanction decision once the workflow completes. */
registerOutcomeHandler(ENTITY_TYPES.PROJECT, ({ instance, status }) => {
  if (status === 'IN_PROGRESS') return;

  if (status === 'APPROVED') {
    const project = projectModel.findById(instance.entity_id);
    projectModel.updateProject(instance.entity_id, {
      status: PROJECT_STATUS.SANCTIONED,
      // The sanctioned figure defaults to the estimate when no revision was made.
      sanctioned_cost: project && project.sanctioned_cost > 0 ? project.sanctioned_cost : instance.amount,
      sanction_date: new Date().toISOString().slice(0, 10),
    });
  } else if (status === 'REJECTED') {
    projectModel.updateProject(instance.entity_id, { status: PROJECT_STATUS.REJECTED });
  } else {
    projectModel.updateProject(instance.entity_id, { status: PROJECT_STATUS.DRAFT });
  }
});
