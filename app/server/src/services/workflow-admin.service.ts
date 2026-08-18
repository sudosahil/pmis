import { z } from 'zod';
import { ENTITY_TYPES, STAFF_ROLES } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as workflowModel from '../models/workflow.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

/**
 * Editing an approval chain.
 *
 * The system promises that a file always finishes on the chain that was in
 * force when it was raised. So a structural change — adding, removing or
 * reordering steps — never mutates a chain that has files in flight. It
 * supersedes it: the old version keeps its steps and its in-flight instances,
 * a new version becomes current, and everything raised from now on uses it.
 *
 * When nothing is in flight there is nothing to protect, so the chain is edited
 * in place and the version number is left alone.
 */

const SCOPES = ['DIVISION', 'CIRCLE', 'ZONE', 'GLOBAL'] as const;

export const stepSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2, 'Give the step a short code.')
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores only, e.g. DIV_SANCTION.'),
  name: z.string().trim().min(2, 'Name the step as it should read on the file.').max(120),
  roleCode: z.enum(STAFF_ROLES as unknown as [string, ...string[]]),
  scope: z.enum(SCOPES).default('DIVISION'),
  slaDays: z.coerce.number().int().min(0).max(365).default(3),
  allowReturn: z.coerce.boolean().default(true),
  allowReject: z.coerce.boolean().default(true),
});

export const createDefinitionSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(3, 'Give the chain a code.')
    .max(40)
    .regex(/^[A-Z0-9_]+$/, 'Use capitals, digits and underscores only, e.g. LOC_APPROVAL.'),
  name: z.string().trim().min(3, 'Name the chain.').max(120),
  entityType: z.enum(Object.values(ENTITY_TYPES) as [string, ...string[]]),
  description: z.string().trim().max(500).optional(),
  steps: z.array(stepSchema).min(1, 'A chain needs at least one step.').max(15),
});

/** Renaming and re-describing never touches structure, so it is always safe. */
export const updateDefinitionSchema = z.object({
  name: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const replaceStepsSchema = z.object({
  steps: z.array(stepSchema).min(1, 'A chain needs at least one step.').max(15),
});

// --- Presentation ----------------------------------------------------------

export function present(def: workflowModel.WorkflowDefinitionRow) {
  const inFlight = workflowModel.countInFlight(def.id);
  return {
    id: def.id,
    code: def.code,
    version: def.version,
    isCurrent: Boolean(def.is_current),
    name: def.name,
    entityType: def.entity_type,
    description: def.description,
    status: def.status,
    supersededAt: def.superseded_at,
    createdAt: def.created_at,
    inFlightCount: inFlight,
    totalInstances: workflowModel.countInstances(def.id),
    /** A structural edit here would supersede rather than mutate. */
    editsInPlace: inFlight === 0,
    steps: workflowModel.listSteps(def.id).map((step) => ({
      id: step.id,
      seq: step.seq,
      code: step.code,
      name: step.name,
      roleCode: step.role_code,
      scope: step.scope,
      slaDays: step.sla_days,
      allowReturn: Boolean(step.allow_return),
      allowReject: Boolean(step.allow_reject),
    })),
  };
}

export function list(includeSuperseded = false) {
  return workflowModel.listDefinitions(includeSuperseded).map(present);
}

export function getOne(id: number) {
  const def = workflowModel.findDefinitionById(id);
  if (!def) throw notFound('Approval chain');
  return present(def);
}

export function history(code: string) {
  const versions = workflowModel.listDefinitionVersions(code);
  if (!versions.length) throw notFound('Approval chain');
  return versions.map(present);
}

// --- Writes ----------------------------------------------------------------

function assertStepsCoherent(steps: z.infer<typeof stepSchema>[]): void {
  const codes = new Set<string>();
  for (const step of steps) {
    if (codes.has(step.code)) {
      throw badRequest(`Two steps share the code "${step.code}". Step codes must be unique.`);
    }
    codes.add(step.code);
  }
}

function writeSteps(definitionId: number, steps: z.infer<typeof stepSchema>[]): void {
  steps.forEach((step, index) => {
    workflowModel.insertStep({
      definition_id: definitionId,
      seq: index + 1,
      code: step.code,
      name: step.name,
      role_code: step.roleCode,
      scope: step.scope,
      sla_days: step.slaDays,
      allow_return: step.allowReturn ? 1 : 0,
      allow_reject: step.allowReject ? 1 : 0,
    });
  });
}

export function create(input: z.infer<typeof createDefinitionSchema>, user: AuthUser) {
  assertStepsCoherent(input.steps);
  if (workflowModel.findDefinitionByCode(input.code)) {
    throw conflict(`An approval chain with the code "${input.code}" already exists.`);
  }

  return transaction(() => {
    const id = workflowModel.insertDefinition({
      code: input.code,
      version: workflowModel.nextDefinitionVersion(input.code),
      name: input.name,
      entity_type: input.entityType,
      description: input.description ?? null,
      status: 'ACTIVE',
      created_by: user.id,
    });
    writeSteps(id, input.steps);

    insertAuditEntry({
      userId: user.id,
      action: 'WORKFLOW_CREATED',
      entityType: 'WORKFLOW',
      entityId: id,
      detail: `${input.code} — ${input.name}, ${input.steps.length} steps`,
    });

    return present(workflowModel.findDefinitionById(id)!);
  });
}

/** Label-only changes. Safe on any version, including one with files in flight. */
export function update(id: number, input: z.infer<typeof updateDefinitionSchema>, user: AuthUser) {
  const def = workflowModel.findDefinitionById(id);
  if (!def) throw notFound('Approval chain');
  if (!def.is_current) {
    throw conflict('A superseded version is a historical record and cannot be edited.');
  }

  workflowModel.updateDefinition(id, {
    name: input.name,
    description: input.description ?? undefined,
    status: input.status,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'WORKFLOW_UPDATED',
    entityType: 'WORKFLOW',
    entityId: id,
    detail: `${def.code}: ${Object.keys(input).join(', ')}`,
  });

  return present(workflowModel.findDefinitionById(id)!);
}

/**
 * Replaces the steps of a chain. Edits in place when nothing is in flight;
 * otherwise supersedes the version so files already moving are untouched.
 */
export function replaceSteps(
  id: number,
  input: z.infer<typeof replaceStepsSchema>,
  user: AuthUser,
) {
  const def = workflowModel.findDefinitionById(id);
  if (!def) throw notFound('Approval chain');
  if (!def.is_current) {
    throw conflict('A superseded version is a historical record and cannot be edited.');
  }
  assertStepsCoherent(input.steps);

  const inFlight = workflowModel.countInFlight(id);

  return transaction(() => {
    if (inFlight === 0) {
      workflowModel.deleteSteps(id);
      writeSteps(id, input.steps);

      insertAuditEntry({
        userId: user.id,
        action: 'WORKFLOW_STEPS_REPLACED',
        entityType: 'WORKFLOW',
        entityId: id,
        detail: `${def.code} v${def.version}: now ${input.steps.length} steps`,
      });

      return present(workflowModel.findDefinitionById(id)!);
    }

    // Files are moving on this version, so it becomes history.
    workflowModel.supersedeDefinition(id);
    const newId = workflowModel.insertDefinition({
      code: def.code,
      version: workflowModel.nextDefinitionVersion(def.code),
      name: def.name,
      entity_type: def.entity_type,
      description: def.description,
      status: def.status,
      created_by: user.id,
    });
    writeSteps(newId, input.steps);

    const newVersion = workflowModel.findDefinitionById(newId)!;
    insertAuditEntry({
      userId: user.id,
      action: 'WORKFLOW_SUPERSEDED',
      entityType: 'WORKFLOW',
      entityId: newId,
      detail:
        `${def.code} v${def.version} superseded by v${newVersion.version}; ` +
        `${inFlight} file(s) continue on v${def.version}`,
    });

    return present(newVersion);
  });
}

/**
 * A chain can only be removed if it has never been used. One that has carried a
 * file is deactivated instead, so its history stays readable.
 */
export function remove(id: number, user: AuthUser): void {
  const def = workflowModel.findDefinitionById(id);
  if (!def) throw notFound('Approval chain');

  if (workflowModel.countInstances(id) > 0) {
    throw conflict(
      'This chain has carried files and cannot be deleted. Set it to Inactive instead — ' +
        'no new file will use it, and its history stays intact.',
    );
  }

  workflowModel.deleteDefinition(id);
  insertAuditEntry({
    userId: user.id,
    action: 'WORKFLOW_DELETED',
    entityType: 'WORKFLOW',
    entityId: id,
    detail: `${def.code} v${def.version}`,
  });
}
