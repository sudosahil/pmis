import { getDb } from '../db/index.js';

export interface NotificationRow {
  id: number;
  user_id: number;
  title: string;
  message: string;
  severity: string;
  entity_type: string | null;
  entity_id: number | null;
  link: string | null;
  is_read: number;
  created_at: string;
}

export interface CreateNotificationInput {
  userId: number;
  title: string;
  message: string;
  severity?: 'INFO' | 'ACTION' | 'WARNING' | 'SUCCESS';
  entityType?: string | null;
  entityId?: number | null;
  link?: string | null;
}

export function insertNotification(input: CreateNotificationInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO notifications (user_id, title, message, severity, entity_type, entity_id, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.title,
      input.message,
      input.severity ?? 'INFO',
      input.entityType ?? null,
      input.entityId ?? null,
      input.link ?? null,
    );
  return Number(result.lastInsertRowid);
}

export function insertManyNotifications(inputs: CreateNotificationInput[]): void {
  if (!inputs.length) return;
  const db = getDb();
  const stmt = db.prepare(
    `INSERT INTO notifications (user_id, title, message, severity, entity_type, entity_id, link)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const run = db.transaction((rows: CreateNotificationInput[]) => {
    for (const row of rows) {
      stmt.run(
        row.userId,
        row.title,
        row.message,
        row.severity ?? 'INFO',
        row.entityType ?? null,
        row.entityId ?? null,
        row.link ?? null,
      );
    }
  });
  run(inputs);
}

export function listNotifications(
  userId: number,
  options: { unreadOnly?: boolean; limit: number; offset: number },
): { rows: NotificationRow[]; total: number; unread: number } {
  const db = getDb();
  const params: unknown[] = [userId];
  let clause = `WHERE user_id = ?`;
  if (options.unreadOnly) clause += ` AND is_read = 0`;

  const total = (db.prepare(`SELECT COUNT(*) AS n FROM notifications ${clause}`).get(...params) as {
    n: number;
  }).n;
  const unread = (
    db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0`).get(userId) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(`SELECT * FROM notifications ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as NotificationRow[];

  return { rows, total, unread };
}

export function markRead(userId: number, ids: number[]): void {
  if (!ids.length) return;
  const placeholders = ids.map(() => '?').join(', ');
  getDb()
    .prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (${placeholders})`)
    .run(userId, ...ids);
}

export function markAllRead(userId: number): void {
  getDb().prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`).run(userId);
}
