import { getDb } from '../db/index.js';

export interface ScopeParams {
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
}

/** Builds a scope predicate against a projects alias. */
function projectScope(alias: string, scope: ScopeParams): { clause: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (scope.divisionId) {
    parts.push(`${alias}.division_id = ?`);
    params.push(scope.divisionId);
  } else if (scope.circleId) {
    parts.push(`${alias}.circle_id = ?`);
    params.push(scope.circleId);
  } else if (scope.zoneId) {
    parts.push(`${alias}.zone_id = ?`);
    params.push(scope.zoneId);
  }
  return { clause: parts.length ? `WHERE ${parts.join(' AND ')}` : '', params };
}

export function projectSummary(scope: ScopeParams) {
  const { clause, params } = projectScope('p', scope);
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status = 'DRAFT' THEN 1 ELSE 0 END) AS draft,
         SUM(CASE WHEN status = 'PENDING_SANCTION' THEN 1 ELSE 0 END) AS pendingSanction,
         SUM(CASE WHEN status = 'SANCTIONED' THEN 1 ELSE 0 END) AS sanctioned,
         SUM(CASE WHEN status = 'IN_PROGRESS' THEN 1 ELSE 0 END) AS inProgress,
         SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed,
         COALESCE(SUM(sanctioned_cost), 0) AS sanctionedValue,
         COALESCE(SUM(estimated_cost), 0) AS estimatedValue
       FROM projects p ${clause}`,
    )
    .get(...params) as Record<string, number>;
}

export function billSummary(scope: ScopeParams) {
  const { clause, params } = projectScope('p', scope);
  const join = `FROM ra_bills rb JOIN projects p ON p.id = rb.project_id`;
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN rb.status = 'IN_APPROVAL' THEN 1 ELSE 0 END) AS inApproval,
         SUM(CASE WHEN rb.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN rb.status = 'SENT_TO_TALLY' THEN 1 ELSE 0 END) AS sentToTally,
         SUM(CASE WHEN rb.status = 'PAID' THEN 1 ELSE 0 END) AS paid,
         COALESCE(SUM(CASE WHEN rb.status = 'PAID' THEN rb.net_payable_amount ELSE 0 END), 0) AS paidValue,
         COALESCE(SUM(CASE WHEN rb.status IN ('IN_APPROVAL','APPROVED','SENT_TO_TALLY')
                    THEN rb.net_payable_amount ELSE 0 END), 0) AS pendingValue
       ${join} ${clause}`,
    )
    .get(...params) as Record<string, number>;
}

export function miscBillSummary(scope: ScopeParams) {
  const params: unknown[] = [];
  let clause = '';
  if (scope.divisionId) {
    clause = `WHERE mb.division_id = ?`;
    params.push(scope.divisionId);
  }
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN mb.status = 'IN_APPROVAL' THEN 1 ELSE 0 END) AS inApproval,
         SUM(CASE WHEN mb.status = 'PAID' THEN 1 ELSE 0 END) AS paid,
         COALESCE(SUM(CASE WHEN mb.status = 'PAID' THEN mb.net_payable_amount ELSE 0 END), 0) AS paidValue,
         COALESCE(SUM(CASE WHEN mb.status NOT IN ('PAID','REJECTED','DRAFT')
                    THEN mb.net_payable_amount ELSE 0 END), 0) AS pendingValue
       FROM misc_bills mb ${clause}`,
    )
    .get(...params) as Record<string, number>;
}

export function tenderSummary(scope: ScopeParams) {
  const { clause, params } = projectScope('p', scope);
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN t.status = 'PUBLISHED' THEN 1 ELSE 0 END) AS published,
         SUM(CASE WHEN t.status = 'PENDING_APPROVAL' THEN 1 ELSE 0 END) AS pendingApproval,
         SUM(CASE WHEN t.status IN ('TECHNICAL_EVALUATION','FINANCIAL_EVALUATION') THEN 1 ELSE 0 END)
           AS underEvaluation,
         SUM(CASE WHEN t.status = 'AWARDED' THEN 1 ELSE 0 END) AS awarded,
         COALESCE(SUM(t.estimated_value), 0) AS estimatedValue
       FROM tenders t JOIN projects p ON p.id = t.project_id ${clause}`,
    )
    .get(...params) as Record<string, number>;
}

export function contractorSummary() {
  return getDb()
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN registration_status = 'PENDING' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN registration_status = 'APPROVED' THEN 1 ELSE 0 END) AS approved,
         SUM(CASE WHEN is_blacklisted = 1 THEN 1 ELSE 0 END) AS blacklisted
       FROM contractors`,
    )
    .get() as Record<string, number>;
}

/** Expenditure by scheme — the funding view senior officers ask for first. */
export function spendByScheme(scope: ScopeParams, limit = 8) {
  const { clause, params } = projectScope('p', scope);
  return getDb()
    .prepare(
      `SELECT s.code AS schemeCode, s.name AS schemeName,
              COUNT(DISTINCT p.id) AS projectCount,
              COALESCE(SUM(p.sanctioned_cost), 0) AS sanctioned,
              COALESCE((SELECT SUM(rb.net_payable_amount) FROM ra_bills rb
                        WHERE rb.project_id IN (SELECT id FROM projects p2 WHERE p2.scheme_id = s.id)
                          AND rb.status = 'PAID'), 0) AS paid
       FROM projects p JOIN schemes s ON s.id = p.scheme_id
       ${clause}
       GROUP BY s.id ORDER BY sanctioned DESC LIMIT ?`,
    )
    .all(...params, limit) as {
    schemeCode: string;
    schemeName: string;
    projectCount: number;
    sanctioned: number;
    paid: number;
  }[];
}

/** Monthly bill throughput for the last N months. */
export function billTrend(scope: ScopeParams, months = 6) {
  const { clause, params } = projectScope('p', scope);
  const extra = clause ? `${clause} AND` : 'WHERE';
  return getDb()
    .prepare(
      `SELECT strftime('%Y-%m', rb.created_at) AS month,
              COUNT(*) AS billCount,
              COALESCE(SUM(rb.net_payable_amount), 0) AS amount,
              COALESCE(SUM(CASE WHEN rb.status = 'PAID' THEN rb.net_payable_amount ELSE 0 END), 0) AS paidAmount
       FROM ra_bills rb JOIN projects p ON p.id = rb.project_id
       ${extra} rb.created_at >= date('now', ?)
       GROUP BY month ORDER BY month`,
    )
    .all(...params, `-${months} months`) as {
    month: string;
    billCount: number;
    amount: number;
    paidAmount: number;
  }[];
}

/** Division-level league table used by circle and head-office dashboards. */
export function divisionPerformance(scope: ScopeParams, limit = 10) {
  const params: unknown[] = [];
  let clause = '';
  if (scope.circleId) {
    clause = `WHERE d.circle_id = ?`;
    params.push(scope.circleId);
  } else if (scope.zoneId) {
    clause = `WHERE c.zone_id = ?`;
    params.push(scope.zoneId);
  }
  return getDb()
    .prepare(
      `SELECT d.id AS divisionId, d.code AS divisionCode, d.name AS divisionName,
              (SELECT COUNT(*) FROM projects p WHERE p.division_id = d.id) AS projectCount,
              (SELECT COALESCE(SUM(p.sanctioned_cost), 0) FROM projects p WHERE p.division_id = d.id)
                AS sanctioned,
              (SELECT COALESCE(SUM(rb.net_payable_amount), 0) FROM ra_bills rb
                 WHERE rb.division_id = d.id AND rb.status = 'PAID') AS paid,
              (SELECT COUNT(*) FROM ra_bills rb
                 WHERE rb.division_id = d.id AND rb.status = 'IN_APPROVAL') AS billsInApproval
       FROM divisions d JOIN circles c ON c.id = d.circle_id
       ${clause}
       ORDER BY sanctioned DESC LIMIT ?`,
    )
    .all(...params, limit) as {
    divisionId: number;
    divisionCode: string;
    divisionName: string;
    projectCount: number;
    sanctioned: number;
    paid: number;
    billsInApproval: number;
  }[];
}

/** Items sitting past their SLA, grouped by the role that owes an action. */
export function overdueApprovals(scope: ScopeParams) {
  const params: unknown[] = [];
  let clause = `WHERE wi.status = 'IN_PROGRESS' AND wi.due_at IS NOT NULL AND wi.due_at < datetime('now')`;
  if (scope.divisionId) {
    clause += ` AND wi.division_id = ?`;
    params.push(scope.divisionId);
  }
  return getDb()
    .prepare(
      `SELECT wi.assigned_role AS role, r.name AS roleName, wi.entity_type AS entityType,
              COUNT(*) AS count, COALESCE(SUM(wi.amount), 0) AS amount
       FROM workflow_instances wi
       LEFT JOIN roles r ON r.code = wi.assigned_role
       ${clause}
       GROUP BY wi.assigned_role, wi.entity_type ORDER BY count DESC`,
    )
    .all(...params) as {
    role: string;
    roleName: string;
    entityType: string;
    count: number;
    amount: number;
  }[];
}

export function recentActivity(limit = 12) {
  return getDb()
    .prepare(
      `SELECT a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId,
              a.detail, a.created_at AS createdAt, u.full_name AS userName
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.id DESC LIMIT ?`,
    )
    .all(limit) as {
    id: number;
    action: string;
    entityType: string | null;
    entityId: number | null;
    detail: string | null;
    createdAt: string;
    userName: string | null;
  }[];
}

// --- Funds -----------------------------------------------------------------

export function fundPosition(scope: ScopeParams, financialYear: string) {
  const params: unknown[] = [financialYear];
  let clause = `WHERE fr.financial_year = ?`;
  if (scope.divisionId) {
    clause += ` AND fr.division_id = ?`;
    params.push(scope.divisionId);
  }
  const released = getDb()
    .prepare(`SELECT COALESCE(SUM(released_amount), 0) AS total FROM fund_releases fr ${clause}`)
    .get(...params) as { total: number };

  const locParams: unknown[] = [financialYear];
  let locClause = `WHERE financial_year = ? AND status = 'APPROVED'`;
  if (scope.divisionId) {
    locClause += ` AND division_id = ?`;
    locParams.push(scope.divisionId);
  }
  const loc = getDb()
    .prepare(`SELECT COALESCE(SUM(approved_amount), 0) AS total FROM loc_requests ${locClause}`)
    .get(...locParams) as { total: number };

  return { released: released.total, locApproved: loc.total };
}
