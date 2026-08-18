import { getDb } from '../db/index.js';

export interface WorkflowDefinitionRow {
  id: number;
  code: string;
  name: string;
  entity_type: string;
  description: string | null;
  status: string;
}

export interface WorkflowStepRow {
  id: number;
  definition_id: number;
  seq: number;
  code: string;
  name: string;
  role_code: string;
  scope: string;
  sla_days: number;
  allow_return: number;
  allow_reject: number;
}

export interface WorkflowInstanceRow {
  id: number;
  definition_id: number;
  entity_type: string;
  entity_id: number;
  entity_ref: string | null;
  title: string | null;
  amount: number;
  current_step_id: number | null;
  assigned_role: string | null;
  assigned_user_id: number | null;
  status: string;
  division_id: number | null;
  circle_id: number | null;
  zone_id: number | null;
  initiated_by: number | null;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowActionRow {
  id: number;
  instance_id: number;
  step_id: number | null;
  step_name: string;
  actor_user_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  remarks: string | null;
  to_step_id: number | null;
  created_at: string;
}

export function findDefinitionByCode(code: string): WorkflowDefinitionRow | null {
  return (
    getDb()
      .prepare<[string], WorkflowDefinitionRow>(
        `SELECT id, code, name, entity_type, description, status FROM workflow_definitions WHERE code = ?`,
      )
      .get(code) ?? null
  );
}

export function listDefinitions(): WorkflowDefinitionRow[] {
  return getDb()
    .prepare(
      `SELECT id, code, name, entity_type, description, status
       FROM workflow_definitions ORDER BY name`,
    )
    .all() as WorkflowDefinitionRow[];
}

export function listSteps(definitionId: number): WorkflowStepRow[] {
  return getDb()
    .prepare(`SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY seq`)
    .all(definitionId) as WorkflowStepRow[];
}

export function findStepById(id: number): WorkflowStepRow | null {
  return (
    getDb().prepare<[number], WorkflowStepRow>(`SELECT * FROM workflow_steps WHERE id = ?`).get(id) ??
    null
  );
}

export function findFirstStep(definitionId: number): WorkflowStepRow | null {
  return (
    getDb()
      .prepare<[number], WorkflowStepRow>(
        `SELECT * FROM workflow_steps WHERE definition_id = ? ORDER BY seq LIMIT 1`,
      )
      .get(definitionId) ?? null
  );
}

export function findNextStep(definitionId: number, currentSeq: number): WorkflowStepRow | null {
  return (
    getDb()
      .prepare<[number, number], WorkflowStepRow>(
        `SELECT * FROM workflow_steps WHERE definition_id = ? AND seq > ? ORDER BY seq LIMIT 1`,
      )
      .get(definitionId, currentSeq) ?? null
  );
}

export interface InsertInstanceInput {
  definitionId: number;
  entityType: string;
  entityId: number;
  entityRef: string;
  title: string;
  amount: number;
  currentStepId: number | null;
  assignedRole: string | null;
  assignedUserId: number | null;
  divisionId: number | null;
  circleId: number | null;
  zoneId: number | null;
  initiatedBy: number | null;
  dueAt: string | null;
}

export function insertInstance(input: InsertInstanceInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO workflow_instances
        (definition_id, entity_type, entity_id, entity_ref, title, amount, current_step_id,
         assigned_role, assigned_user_id, division_id, circle_id, zone_id, initiated_by, due_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.definitionId,
      input.entityType,
      input.entityId,
      input.entityRef,
      input.title,
      input.amount,
      input.currentStepId,
      input.assignedRole,
      input.assignedUserId,
      input.divisionId,
      input.circleId,
      input.zoneId,
      input.initiatedBy,
      input.dueAt,
    );
  return Number(result.lastInsertRowid);
}

export function findInstanceById(id: number): WorkflowInstanceRow | null {
  return (
    getDb()
      .prepare<[number], WorkflowInstanceRow>(`SELECT * FROM workflow_instances WHERE id = ?`)
      .get(id) ?? null
  );
}

export function findInstanceByEntity(
  entityType: string,
  entityId: number,
): WorkflowInstanceRow | null {
  return (
    getDb()
      .prepare<[string, number], WorkflowInstanceRow>(
        `SELECT * FROM workflow_instances
         WHERE entity_type = ? AND entity_id = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(entityType, entityId) ?? null
  );
}

export function updateInstance(id: number, fields: Record<string, unknown>): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE workflow_instances SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function insertAction(input: {
  instanceId: number;
  stepId: number | null;
  stepName: string;
  actorUserId: number | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  remarks: string | null;
  toStepId: number | null;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO workflow_actions
        (instance_id, step_id, step_name, actor_user_id, actor_name, actor_role, action, remarks, to_step_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.instanceId,
      input.stepId,
      input.stepName,
      input.actorUserId,
      input.actorName,
      input.actorRole,
      input.action,
      input.remarks,
      input.toStepId,
    );
  return Number(result.lastInsertRowid);
}

export function listActions(instanceId: number): WorkflowActionRow[] {
  return getDb()
    .prepare(`SELECT * FROM workflow_actions WHERE instance_id = ? ORDER BY id`)
    .all(instanceId) as WorkflowActionRow[];
}

export interface InboxRow extends WorkflowInstanceRow {
  definition_code: string;
  definition_name: string;
  step_name: string;
  step_seq: number;
  sla_days: number;
  division_name: string | null;
  initiator_name: string | null;
}

export interface InboxFilter {
  userId: number;
  roleCode: string;
  divisionId: number | null;
  circleId: number | null;
  zoneId: number | null;
  globalScope: boolean;
  entityType?: string;
  limit: number;
  offset: number;
}

/**
 * An instance lands in a user's inbox when it is explicitly assigned to them,
 * or when it is waiting on their role and falls inside their administrative
 * scope. Senior/audit roles carry global scope and see every division.
 */
function inboxWhere(filter: InboxFilter): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const scope: string[] = [];

  scope.push(`wi.assigned_user_id = ?`);
  params.push(filter.userId);

  const roleClause: string[] = [`wi.assigned_user_id IS NULL`, `wi.assigned_role = ?`];
  params.push(filter.roleCode);

  if (!filter.globalScope) {
    const geo: string[] = [];
    if (filter.divisionId) {
      geo.push(`(ws.scope = 'DIVISION' AND wi.division_id = ?)`);
      params.push(filter.divisionId);
    }
    if (filter.circleId) {
      geo.push(`(ws.scope = 'CIRCLE' AND wi.circle_id = ?)`);
      params.push(filter.circleId);
    }
    if (filter.zoneId) {
      geo.push(`(ws.scope = 'ZONE' AND wi.zone_id = ?)`);
      params.push(filter.zoneId);
    }
    geo.push(`ws.scope = 'GLOBAL'`);
    roleClause.push(`(${geo.join(' OR ')})`);
  }

  scope.push(`(${roleClause.join(' AND ')})`);

  let clause = `WHERE wi.status = 'IN_PROGRESS' AND (${scope.join(' OR ')})`;
  if (filter.entityType) {
    clause += ` AND wi.entity_type = ?`;
    params.push(filter.entityType);
  }
  return { clause, params };
}

const INBOX_SELECT = `
  SELECT wi.*, wd.code AS definition_code, wd.name AS definition_name,
         ws.name AS step_name, ws.seq AS step_seq, ws.sla_days,
         d.name AS division_name, u.full_name AS initiator_name
  FROM workflow_instances wi
  JOIN workflow_definitions wd ON wd.id = wi.definition_id
  LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
  LEFT JOIN divisions d ON d.id = wi.division_id
  LEFT JOIN users u ON u.id = wi.initiated_by
`;

export function listInbox(filter: InboxFilter): { rows: InboxRow[]; total: number } {
  const { clause, params } = inboxWhere(filter);
  const db = getDb();

  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM workflow_instances wi
         LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;

  const rows = db
    .prepare(`${INBOX_SELECT} ${clause} ORDER BY wi.due_at IS NULL, wi.due_at, wi.id LIMIT ? OFFSET ?`)
    .all(...params, filter.limit, filter.offset) as InboxRow[];

  return { rows, total };
}

export function countInboxByEntity(filter: InboxFilter): Record<string, number> {
  const { clause, params } = inboxWhere(filter);
  const rows = getDb()
    .prepare(
      `SELECT wi.entity_type AS entityType, COUNT(*) AS n
       FROM workflow_instances wi
       LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
       ${clause} GROUP BY wi.entity_type`,
    )
    .all(...params) as { entityType: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.entityType, r.n]));
}

/** Items the user started that are still moving through approval. */
export function listInitiatedByUser(
  userId: number,
  limit: number,
  offset: number,
): { rows: InboxRow[]; total: number } {
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM workflow_instances WHERE initiated_by = ?`)
      .get(userId) as { n: number }
  ).n;
  const rows = db
    .prepare(`${INBOX_SELECT} WHERE wi.initiated_by = ? ORDER BY wi.id DESC LIMIT ? OFFSET ?`)
    .all(userId, limit, offset) as InboxRow[];
  return { rows, total };
}
