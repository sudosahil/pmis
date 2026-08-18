import { getDb } from '../db/index.js';

export interface ActivityRow {
  id: number;
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  role_code: string | null;
  method: string;
  path: string;
  action: string | null;
  status_code: number;
  duration_ms: number;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export function insertActivity(values: {
  user_id: number | null;
  username: string | null;
  full_name: string | null;
  role_code: string | null;
  method: string;
  path: string;
  action: string | null;
  status_code: number;
  duration_ms: number;
  ip_address: string | null;
  user_agent: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO activity_log
         (user_id, username, full_name, role_code, method, path, action,
          status_code, duration_ms, ip_address, user_agent)
       VALUES
         (@user_id, @username, @full_name, @role_code, @method, @path, @action,
          @status_code, @duration_ms, @ip_address, @user_agent)`,
    )
    .run(values);
}

export interface ActivityQuery {
  /** Only entries newer than this id — how the live tail polls. */
  sinceId?: number;
  userId?: number;
  roleCode?: string;
  method?: string;
  search?: string;
  /** 'errors' narrows to 4xx and 5xx; 'writes' drops read-only traffic. */
  only?: 'errors' | 'writes';
  limit: number;
  offset: number;
}

function buildWhere(query: ActivityQuery): { clause: string; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (query.sinceId) {
    where.push('a.id > ?');
    params.push(query.sinceId);
  }
  if (query.userId) {
    where.push('a.user_id = ?');
    params.push(query.userId);
  }
  if (query.roleCode) {
    where.push('a.role_code = ?');
    params.push(query.roleCode);
  }
  if (query.method) {
    where.push('a.method = ?');
    params.push(query.method);
  }
  if (query.only === 'errors') where.push('a.status_code >= 400');
  if (query.only === 'writes') where.push("a.method <> 'GET'");
  if (query.search) {
    where.push('(a.path LIKE ? OR a.action LIKE ? OR a.full_name LIKE ? OR a.username LIKE ?)');
    const like = `%${query.search}%`;
    params.push(like, like, like, like);
  }

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listActivity(query: ActivityQuery): { rows: ActivityRow[]; total: number } {
  const { clause, params } = buildWhere(query);
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM activity_log a ${clause}`).get(...params) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(`SELECT a.* FROM activity_log a ${clause} ORDER BY a.id DESC LIMIT ? OFFSET ?`)
    .all(...params, query.limit, query.offset) as ActivityRow[];
  return { rows, total };
}

/** The newest id, so a client can start tailing without reading history. */
export function latestId(): number {
  const row = getDb()
    .prepare<[], { id: number | null }>(`SELECT MAX(id) AS id FROM activity_log`)
    .get();
  return row?.id ?? 0;
}

export interface OnlineUserRow {
  id: number;
  full_name: string;
  username: string;
  role_code: string;
  designation: string | null;
  division_name: string | null;
  last_seen_at: string | null;
  requests_today: number;
}

/** Anyone the API has served inside the window. */
export function listOnlineUsers(windowSeconds: number): OnlineUserRow[] {
  return getDb()
    .prepare(
      `SELECT u.id, u.full_name, u.username, u.role_code, u.designation,
              d.name AS division_name, u.last_seen_at,
              (SELECT COUNT(*) FROM activity_log a
                WHERE a.user_id = u.id AND a.created_at >= datetime('now', '-1 day')) AS requests_today
         FROM users u
         LEFT JOIN divisions d ON d.id = u.division_id
        WHERE u.last_seen_at IS NOT NULL
          AND u.last_seen_at >= datetime('now', ?)
        ORDER BY u.last_seen_at DESC`,
    )
    .all(`-${windowSeconds} seconds`) as OnlineUserRow[];
}

export function touchLastSeen(userId: number): void {
  getDb().prepare(`UPDATE users SET last_seen_at = datetime('now') WHERE id = ?`).run(userId);
}

export interface ActivityStats {
  requestsLastHour: number;
  errorsLastHour: number;
  writesLastHour: number;
  activeUsersLastHour: number;
  slowestMs: number;
}

export function stats(): ActivityStats {
  const row = getDb()
    .prepare<[], ActivityStats>(
      `SELECT
         COUNT(*) AS requestsLastHour,
         SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS errorsLastHour,
         SUM(CASE WHEN method <> 'GET' THEN 1 ELSE 0 END) AS writesLastHour,
         COUNT(DISTINCT user_id) AS activeUsersLastHour,
         COALESCE(MAX(duration_ms), 0) AS slowestMs
       FROM activity_log
       WHERE created_at >= datetime('now', '-1 hour')`,
    )
    .get();
  return {
    requestsLastHour: row?.requestsLastHour ?? 0,
    errorsLastHour: row?.errorsLastHour ?? 0,
    writesLastHour: row?.writesLastHour ?? 0,
    activeUsersLastHour: row?.activeUsersLastHour ?? 0,
    slowestMs: row?.slowestMs ?? 0,
  };
}

/** Busiest users in the last day, for the admin summary. */
export function topUsers(limit: number): { fullName: string; roleCode: string; requests: number }[] {
  return getDb()
    .prepare(
      `SELECT full_name AS fullName, role_code AS roleCode, COUNT(*) AS requests
         FROM activity_log
        WHERE created_at >= datetime('now', '-1 day') AND user_id IS NOT NULL
        GROUP BY user_id
        ORDER BY requests DESC
        LIMIT ?`,
    )
    .all(limit) as { fullName: string; roleCode: string; requests: number }[];
}

/** Keeps the table from growing without bound on a long-lived instance. */
export function pruneOlderThanDays(days: number): number {
  const result = getDb()
    .prepare(`DELETE FROM activity_log WHERE created_at < datetime('now', ?)`)
    .run(`-${days} days`);
  return result.changes;
}
