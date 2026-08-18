import { INSTANCE_STATUS, WORKFLOW_ACTIONS, type WorkflowAction } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as notificationModel from '../models/notification.model.js';
import * as userModel from '../models/user.model.js';
import * as wf from '../models/workflow.model.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';

/**
 * Entity modules register a callback here so the engine can push status changes
 * back onto the underlying record (a bill becoming APPROVED, a tender becoming
 * PUBLISHED) without the engine importing every domain module.
 */
export interface WorkflowOutcome {
  instance: wf.WorkflowInstanceRow;
  status: 'IN_PROGRESS' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  action: WorkflowAction;
  step: wf.WorkflowStepRow | null;
  nextStep: wf.WorkflowStepRow | null;
  actor: AuthUser;
  remarks: string | null;
}

type OutcomeHandler = (outcome: WorkflowOutcome) => void;

const outcomeHandlers = new Map<string, OutcomeHandler>();

export function registerOutcomeHandler(entityType: string, handler: OutcomeHandler): void {
  outcomeHandlers.set(entityType, handler);
}

function emitOutcome(outcome: WorkflowOutcome): void {
  outcomeHandlers.get(outcome.instance.entity_type)?.(outcome);
}

function addDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

// --- Starting a workflow ---------------------------------------------------

export interface StartWorkflowInput {
  definitionCode: string;
  entityType: string;
  entityId: number;
  entityRef: string;
  title: string;
  amount: number;
  divisionId: number | null;
  circleId: number | null;
  zoneId: number | null;
  initiator: AuthUser;
  remarks?: string | null;
}

/**
 * Creates an instance parked on the first step. The caller is responsible for
 * storing the returned instance id against its entity.
 */
export function startWorkflow(input: StartWorkflowInput): wf.WorkflowInstanceRow {
  const definition = wf.findDefinitionByCode(input.definitionCode);
  if (!definition) throw notFound(`Workflow "${input.definitionCode}"`);

  const firstStep = wf.findFirstStep(definition.id);
  if (!firstStep) throw badRequest(`Workflow "${input.definitionCode}" has no steps configured.`);

  const instanceId = wf.insertInstance({
    definitionId: definition.id,
    entityType: input.entityType,
    entityId: input.entityId,
    entityRef: input.entityRef,
    title: input.title,
    amount: input.amount,
    currentStepId: firstStep.id,
    assignedRole: firstStep.role_code,
    assignedUserId: null,
    divisionId: input.divisionId,
    circleId: input.circleId,
    zoneId: input.zoneId,
    initiatedBy: input.initiator.id,
    dueAt: addDays(firstStep.sla_days),
  });

  wf.insertAction({
    instanceId,
    stepId: null,
    stepName: 'Submitted',
    actorUserId: input.initiator.id,
    actorName: input.initiator.fullName,
    actorRole: input.initiator.roleCode,
    action: WORKFLOW_ACTIONS.SUBMIT,
    remarks: input.remarks ?? null,
    toStepId: firstStep.id,
  });

  const instance = wf.findInstanceById(instanceId)!;
  notifyPendingApprovers(instance, firstStep);
  return instance;
}

// --- Acting on a workflow --------------------------------------------------

export interface ActInput {
  instanceId: number;
  actor: AuthUser;
  action: WorkflowAction;
  remarks?: string | null;
  /** APPROVE/ASSIGN only: pin the next (or current) step to one person. */
  assignToUserId?: number | null;
  /** RETURN only: the step to send the file back to. Defaults to the initiator. */
  returnToStepId?: number | null;
}

/** True when this user is the one the instance is currently waiting on. */
export function canAct(instance: wf.WorkflowInstanceRow, user: AuthUser): boolean {
  if (instance.status !== INSTANCE_STATUS.IN_PROGRESS) return false;
  if (instance.assigned_user_id) return instance.assigned_user_id === user.id;
  if (instance.assigned_role !== user.roleCode) return false;

  const step = instance.current_step_id ? wf.findStepById(instance.current_step_id) : null;
  if (!step) return false;

  switch (step.scope) {
    case 'DIVISION':
      return user.divisionId != null && user.divisionId === instance.division_id;
    case 'CIRCLE':
      return user.circleId != null && user.circleId === instance.circle_id;
    case 'ZONE':
      return user.zoneId != null && user.zoneId === instance.zone_id;
    default:
      return true;
  }
}

export function act(input: ActInput): WorkflowOutcome {
  return transaction(() => {
    const instance = wf.findInstanceById(input.instanceId);
    if (!instance) throw notFound('Approval item');
    if (instance.status !== INSTANCE_STATUS.IN_PROGRESS) {
      throw conflict('This item has already been closed.');
    }
    if (!canAct(instance, input.actor)) {
      throw forbidden('This item is not pending with you.');
    }

    const step = instance.current_step_id ? wf.findStepById(instance.current_step_id) : null;
    if (!step) throw badRequest('This item has no active step.');

    switch (input.action) {
      case WORKFLOW_ACTIONS.APPROVE:
        return approve(instance, step, input);
      case WORKFLOW_ACTIONS.REJECT:
        return reject(instance, step, input);
      case WORKFLOW_ACTIONS.RETURN:
        return returnBack(instance, step, input);
      case WORKFLOW_ACTIONS.ASSIGN:
        return assign(instance, step, input);
      default:
        throw badRequest(`Unsupported action "${input.action}".`);
    }
  });
}

function approve(
  instance: wf.WorkflowInstanceRow,
  step: wf.WorkflowStepRow,
  input: ActInput,
): WorkflowOutcome {
  const nextStep = wf.findNextStep(instance.definition_id, step.seq);

  wf.insertAction({
    instanceId: instance.id,
    stepId: step.id,
    stepName: step.name,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorRole: input.actor.roleCode,
    action: WORKFLOW_ACTIONS.APPROVE,
    remarks: input.remarks ?? null,
    toStepId: nextStep?.id ?? null,
  });

  if (nextStep) {
    wf.updateInstance(instance.id, {
      current_step_id: nextStep.id,
      assigned_role: nextStep.role_code,
      assigned_user_id: input.assignToUserId ?? null,
      due_at: addDays(nextStep.sla_days),
    });
  } else {
    wf.updateInstance(instance.id, {
      current_step_id: null,
      assigned_role: null,
      assigned_user_id: null,
      status: INSTANCE_STATUS.APPROVED,
      due_at: null,
      completed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });
  }

  const updated = wf.findInstanceById(instance.id)!;
  const outcome: WorkflowOutcome = {
    instance: updated,
    status: nextStep ? INSTANCE_STATUS.IN_PROGRESS : INSTANCE_STATUS.APPROVED,
    action: WORKFLOW_ACTIONS.APPROVE,
    step,
    nextStep,
    actor: input.actor,
    remarks: input.remarks ?? null,
  };

  if (nextStep) notifyPendingApprovers(updated, nextStep);
  else notifyInitiator(updated, 'Approved', `${updated.entity_ref} has completed all approvals.`, 'SUCCESS');

  emitOutcome(outcome);
  return outcome;
}

function reject(
  instance: wf.WorkflowInstanceRow,
  step: wf.WorkflowStepRow,
  input: ActInput,
): WorkflowOutcome {
  if (!step.allow_reject) throw forbidden('Rejection is not permitted at this step.');
  if (!input.remarks?.trim()) throw badRequest('A reason is required when rejecting.');

  wf.insertAction({
    instanceId: instance.id,
    stepId: step.id,
    stepName: step.name,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorRole: input.actor.roleCode,
    action: WORKFLOW_ACTIONS.REJECT,
    remarks: input.remarks,
    toStepId: null,
  });

  wf.updateInstance(instance.id, {
    current_step_id: null,
    assigned_role: null,
    assigned_user_id: null,
    status: INSTANCE_STATUS.REJECTED,
    due_at: null,
    completed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });

  const updated = wf.findInstanceById(instance.id)!;
  notifyInitiator(updated, 'Rejected', `${updated.entity_ref} was rejected: ${input.remarks}`, 'WARNING');

  const outcome: WorkflowOutcome = {
    instance: updated,
    status: INSTANCE_STATUS.REJECTED,
    action: WORKFLOW_ACTIONS.REJECT,
    step,
    nextStep: null,
    actor: input.actor,
    remarks: input.remarks,
  };
  emitOutcome(outcome);
  return outcome;
}

/**
 * Sends the file back to an earlier step for correction — the "Reject to EE /
 * Reject to AAO" buttons in the source workflow. Unlike a rejection this keeps
 * the instance alive.
 */
function returnBack(
  instance: wf.WorkflowInstanceRow,
  step: wf.WorkflowStepRow,
  input: ActInput,
): WorkflowOutcome {
  if (!step.allow_return) throw forbidden('Returning is not permitted at this step.');
  if (!input.remarks?.trim()) throw badRequest('A reason is required when returning an item.');

  const steps = wf.listSteps(instance.definition_id);
  let target: wf.WorkflowStepRow | null = null;

  if (input.returnToStepId) {
    target = steps.find((s) => s.id === input.returnToStepId) ?? null;
    if (!target) throw badRequest('The selected step is not part of this workflow.');
    if (target.seq >= step.seq) throw badRequest('An item can only be returned to an earlier step.');
  } else {
    target = steps.find((s) => s.seq < step.seq) ?? null;
  }

  wf.insertAction({
    instanceId: instance.id,
    stepId: step.id,
    stepName: step.name,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorRole: input.actor.roleCode,
    action: WORKFLOW_ACTIONS.RETURN,
    remarks: input.remarks,
    toStepId: target?.id ?? null,
  });

  if (target) {
    wf.updateInstance(instance.id, {
      current_step_id: target.id,
      assigned_role: target.role_code,
      assigned_user_id: null,
      due_at: addDays(target.sla_days),
    });
  } else {
    // No earlier step: the file goes back to whoever raised it.
    wf.updateInstance(instance.id, {
      current_step_id: null,
      assigned_role: null,
      assigned_user_id: instance.initiated_by,
      status: INSTANCE_STATUS.IN_PROGRESS,
      due_at: null,
    });
  }

  const updated = wf.findInstanceById(instance.id)!;
  if (target) notifyPendingApprovers(updated, target);
  notifyInitiator(
    updated,
    'Returned for correction',
    `${updated.entity_ref} was returned by ${input.actor.fullName}: ${input.remarks}`,
    'ACTION',
  );

  const outcome: WorkflowOutcome = {
    instance: updated,
    status: INSTANCE_STATUS.IN_PROGRESS,
    action: WORKFLOW_ACTIONS.RETURN,
    step,
    nextStep: target,
    actor: input.actor,
    remarks: input.remarks,
  };
  emitOutcome(outcome);
  return outcome;
}

/**
 * Pins the current step to a named officer — the "Assign to AAO" action the
 * CAO performs before an item is audited.
 */
function assign(
  instance: wf.WorkflowInstanceRow,
  step: wf.WorkflowStepRow,
  input: ActInput,
): WorkflowOutcome {
  if (!input.assignToUserId) throw badRequest('Select the officer to assign this item to.');
  const target = userModel.findSummaryById(input.assignToUserId);
  if (!target) throw notFound('Officer');
  if (target.status !== 'ACTIVE') throw badRequest('That officer account is not active.');

  wf.insertAction({
    instanceId: instance.id,
    stepId: step.id,
    stepName: step.name,
    actorUserId: input.actor.id,
    actorName: input.actor.fullName,
    actorRole: input.actor.roleCode,
    action: WORKFLOW_ACTIONS.ASSIGN,
    remarks: input.remarks ?? `Assigned to ${target.fullName}`,
    toStepId: step.id,
  });

  wf.updateInstance(instance.id, {
    assigned_user_id: target.id,
    assigned_role: target.roleCode,
  });

  const updated = wf.findInstanceById(instance.id)!;
  notificationModel.insertNotification({
    userId: target.id,
    title: 'Assigned to you',
    message: `${updated.entity_ref} — ${updated.title ?? ''} was assigned to you by ${input.actor.fullName}.`,
    severity: 'ACTION',
    entityType: updated.entity_type,
    entityId: updated.entity_id,
    link: entityLink(updated),
  });

  const outcome: WorkflowOutcome = {
    instance: updated,
    status: INSTANCE_STATUS.IN_PROGRESS,
    action: WORKFLOW_ACTIONS.ASSIGN,
    step,
    nextStep: step,
    actor: input.actor,
    remarks: input.remarks ?? null,
  };
  emitOutcome(outcome);
  return outcome;
}

/** Withdraws an in-flight item. Only the initiator or an administrator may do this. */
export function cancel(instanceId: number, actor: AuthUser, remarks: string): WorkflowOutcome {
  return transaction(() => {
    const instance = wf.findInstanceById(instanceId);
    if (!instance) throw notFound('Approval item');
    if (instance.status !== INSTANCE_STATUS.IN_PROGRESS) {
      throw conflict('This item has already been closed.');
    }
    if (instance.initiated_by !== actor.id && actor.roleCode !== 'ADMIN') {
      throw forbidden('Only the officer who raised this item can withdraw it.');
    }

    wf.insertAction({
      instanceId,
      stepId: instance.current_step_id,
      stepName: 'Withdrawn',
      actorUserId: actor.id,
      actorName: actor.fullName,
      actorRole: actor.roleCode,
      action: WORKFLOW_ACTIONS.CANCEL,
      remarks,
      toStepId: null,
    });

    wf.updateInstance(instanceId, {
      current_step_id: null,
      assigned_role: null,
      assigned_user_id: null,
      status: INSTANCE_STATUS.CANCELLED,
      due_at: null,
      completed_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    });

    const updated = wf.findInstanceById(instanceId)!;
    const outcome: WorkflowOutcome = {
      instance: updated,
      status: INSTANCE_STATUS.CANCELLED,
      action: WORKFLOW_ACTIONS.CANCEL,
      step: null,
      nextStep: null,
      actor,
      remarks,
    };
    emitOutcome(outcome);
    return outcome;
  });
}

// --- Notifications ---------------------------------------------------------

function entityLink(instance: wf.WorkflowInstanceRow): string {
  const segment = {
    PROJECT: 'projects',
    TENDER: 'tenders',
    RA_BILL: 'ra-bills',
    MISC_BILL: 'misc-bills',
    CONTRACTOR: 'contractors',
    LOC: 'loc-requests',
  }[instance.entity_type];
  return segment ? `/${segment}/${instance.entity_id}` : '/approvals';
}

function notifyPendingApprovers(
  instance: wf.WorkflowInstanceRow,
  step: wf.WorkflowStepRow,
): void {
  const divisionScoped = step.scope === 'DIVISION' ? instance.division_id : null;
  const recipients = instance.assigned_user_id
    ? [userModel.findSummaryById(instance.assigned_user_id)].filter(Boolean)
    : userModel.findUsersByRole(step.role_code, divisionScoped);

  notificationModel.insertManyNotifications(
    recipients.map((user) => ({
      userId: user!.id,
      title: `Pending: ${step.name}`,
      message: `${instance.entity_ref} — ${instance.title ?? ''} (₹${toRupees(instance.amount).toLocaleString('en-IN')}) is awaiting your action.`,
      severity: 'ACTION' as const,
      entityType: instance.entity_type,
      entityId: instance.entity_id,
      link: entityLink(instance),
    })),
  );
}

function notifyInitiator(
  instance: wf.WorkflowInstanceRow,
  title: string,
  message: string,
  severity: 'INFO' | 'ACTION' | 'WARNING' | 'SUCCESS',
): void {
  if (!instance.initiated_by) return;
  notificationModel.insertNotification({
    userId: instance.initiated_by,
    title,
    message,
    severity,
    entityType: instance.entity_type,
    entityId: instance.entity_id,
    link: entityLink(instance),
  });
}

// --- Reading ---------------------------------------------------------------

export interface TimelineStep {
  stepId: number;
  seq: number;
  name: string;
  roleCode: string;
  state: 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED';
}

export interface WorkflowView {
  instance: {
    id: number;
    definitionCode: string;
    definitionName: string;
    entityType: string;
    entityId: number;
    entityRef: string | null;
    title: string | null;
    amount: number;
    status: string;
    currentStepId: number | null;
    currentStepName: string | null;
    assignedRole: string | null;
    assignedUserId: number | null;
    assignedUserName: string | null;
    dueAt: string | null;
    initiatedBy: number | null;
    createdAt: string;
    completedAt: string | null;
  };
  steps: TimelineStep[];
  history: {
    id: number;
    stepName: string;
    actorName: string | null;
    actorRole: string | null;
    action: string;
    remarks: string | null;
    createdAt: string;
  }[];
  /** Actions the requesting user may take right now. */
  availableActions: WorkflowAction[];
  returnTargets: { stepId: number; name: string; roleCode: string }[];
}

export function getWorkflowView(instanceId: number, user: AuthUser): WorkflowView | null {
  const instance = wf.findInstanceById(instanceId);
  if (!instance) return null;

  const definition = wf.listDefinitions().find((d) => d.id === instance.definition_id);
  const steps = wf.listSteps(instance.definition_id);
  const history = wf.listActions(instanceId);
  const currentStep = instance.current_step_id
    ? steps.find((s) => s.id === instance.current_step_id) ?? null
    : null;

  const timeline: TimelineStep[] = steps.map((step) => {
    let state: TimelineStep['state'] = 'PENDING';
    if (currentStep && step.seq < currentStep.seq) state = 'DONE';
    else if (currentStep && step.id === currentStep.id) state = 'CURRENT';
    else if (!currentStep && instance.status === INSTANCE_STATUS.APPROVED) state = 'DONE';
    else if (!currentStep && instance.status !== INSTANCE_STATUS.IN_PROGRESS) {
      const acted = history.some((h) => h.step_id === step.id && h.action === 'APPROVE');
      state = acted ? 'DONE' : 'SKIPPED';
    }
    return {
      stepId: step.id,
      seq: step.seq,
      name: step.name,
      roleCode: step.role_code,
      state,
    };
  });

  const actionable = canAct(instance, user);
  const availableActions: WorkflowAction[] = [];
  if (actionable && currentStep) {
    availableActions.push(WORKFLOW_ACTIONS.APPROVE);
    if (currentStep.allow_return && currentStep.seq > 1) availableActions.push(WORKFLOW_ACTIONS.RETURN);
    if (currentStep.allow_reject) availableActions.push(WORKFLOW_ACTIONS.REJECT);
    availableActions.push(WORKFLOW_ACTIONS.ASSIGN);
  }
  if (
    instance.status === INSTANCE_STATUS.IN_PROGRESS &&
    (instance.initiated_by === user.id || user.roleCode === 'ADMIN')
  ) {
    availableActions.push(WORKFLOW_ACTIONS.CANCEL);
  }

  const assignedUser = instance.assigned_user_id
    ? userModel.findSummaryById(instance.assigned_user_id)
    : null;

  return {
    instance: {
      id: instance.id,
      definitionCode: definition?.code ?? '',
      definitionName: definition?.name ?? '',
      entityType: instance.entity_type,
      entityId: instance.entity_id,
      entityRef: instance.entity_ref,
      title: instance.title,
      amount: toRupees(instance.amount),
      status: instance.status,
      currentStepId: instance.current_step_id,
      currentStepName: currentStep?.name ?? null,
      assignedRole: instance.assigned_role,
      assignedUserId: instance.assigned_user_id,
      assignedUserName: assignedUser?.fullName ?? null,
      dueAt: instance.due_at,
      initiatedBy: instance.initiated_by,
      createdAt: instance.created_at,
      completedAt: instance.completed_at,
    },
    steps: timeline,
    history: history.map((h) => ({
      id: h.id,
      stepName: h.step_name,
      actorName: h.actor_name,
      actorRole: h.actor_role,
      action: h.action,
      remarks: h.remarks,
      createdAt: h.created_at,
    })),
    availableActions,
    returnTargets: currentStep
      ? steps
          .filter((s) => s.seq < currentStep.seq)
          .map((s) => ({ stepId: s.id, name: s.name, roleCode: s.role_code }))
      : [],
  };
}

export function getWorkflowViewForEntity(
  entityType: string,
  entityId: number,
  user: AuthUser,
): WorkflowView | null {
  const instance = wf.findInstanceByEntity(entityType, entityId);
  return instance ? getWorkflowView(instance.id, user) : null;
}

export { wf as workflowModel };
