import { getDb } from '../db/index.js';

export interface AuditEntryInput {
  userId?: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  detail?: string | null;
  ipAddress?: string | null;
  requestId?: string | null;
}

export interface AuditRow {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  detail: string | null;
  ip_address: string | null;
  created_at: string;
}

export function insertAuditEntry(input: AuditEntryInput): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail, ip_address, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId ?? null,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.detail ?? null,
      input.ipAddress ?? null,
      input.requestId ?? null,
    );
}

export interface ListAuditOptions {
  userId?: number;
  entityType?: string;
  entityId?: number;
  action?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export function listAuditEntries(options: ListAuditOptions): { rows: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.userId) {
    where.push('a.user_id = ?');
    params.push(options.userId);
  }
  if (options.entityType) {
    where.push('a.entity_type = ?');
    params.push(options.entityType);
  }
  if (options.entityId) {
    where.push('a.entity_id = ?');
    params.push(options.entityId);
  }
  if (options.action) {
    where.push('a.action LIKE ?');
    params.push(`%${options.action}%`);
  }
  if (options.from) {
    where.push('a.created_at >= ?');
    params.push(options.from);
  }
  if (options.to) {
    where.push('a.created_at <= ?');
    params.push(`${options.to} 23:59:59`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM audit_log a ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(
      `SELECT a.id, a.user_id, u.full_name AS user_name, a.action, a.entity_type, a.entity_id,
              a.detail, a.ip_address, a.created_at
       FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id
       ${clause}
       ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, options.limit, options.offset) as AuditRow[];

  return { rows, total };
}
