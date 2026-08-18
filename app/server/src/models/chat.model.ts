import { getDb } from '../db/index.js';

export interface ConversationRow {
  id: number;
  kind: string;
  name: string | null;
  topic: string | null;
  created_by: number | null;
  created_by_name: string | null;
  last_message_at: string | null;
  created_at: string;
  member_count: number;
  unread_count: number;
  last_message_body: string | null;
  last_message_sender: string | null;
}

export interface MemberRow {
  user_id: number;
  full_name: string;
  username: string;
  role_code: string;
  designation: string | null;
  division_name: string | null;
  is_admin: number;
  last_read_at: string | null;
  last_seen_at: string | null;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  sender_name: string | null;
  sender_role: string | null;
  body: string;
  entity_type: string | null;
  entity_id: number | null;
  document_id: number | null;
  document_name: string | null;
  deleted_at: string | null;
  created_at: string;
}

/**
 * A direct chat is keyed on its two member ids in ascending order, so asking to
 * chat with someone twice reopens the same conversation.
 */
export function directKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

const CONVERSATION_SELECT = `
  SELECT c.id, c.kind, c.name, c.topic, c.created_by, u.full_name AS created_by_name,
         c.last_message_at, c.created_at,
         (SELECT COUNT(*) FROM conversation_members m WHERE m.conversation_id = c.id) AS member_count,
         (SELECT COUNT(*)
            FROM messages msg
           WHERE msg.conversation_id = c.id
             AND msg.deleted_at IS NULL
             AND msg.sender_id <> @viewer
             AND (me.last_read_at IS NULL OR msg.created_at > me.last_read_at)) AS unread_count,
         (SELECT msg.body FROM messages msg
           WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
           ORDER BY msg.id DESC LIMIT 1) AS last_message_body,
         (SELECT su.full_name FROM messages msg
            LEFT JOIN users su ON su.id = msg.sender_id
           WHERE msg.conversation_id = c.id AND msg.deleted_at IS NULL
           ORDER BY msg.id DESC LIMIT 1) AS last_message_sender
    FROM conversations c
    JOIN conversation_members me ON me.conversation_id = c.id AND me.user_id = @viewer
    LEFT JOIN users u ON u.id = c.created_by`;

export function listConversations(viewerId: number, search?: string): ConversationRow[] {
  const clause = search
    ? `AND (c.name LIKE @like OR EXISTS (
         SELECT 1 FROM conversation_members m2
           JOIN users mu ON mu.id = m2.user_id
          WHERE m2.conversation_id = c.id AND m2.user_id <> @viewer AND mu.full_name LIKE @like))`
    : '';
  return getDb()
    .prepare(
      `${CONVERSATION_SELECT}
       WHERE 1 = 1 ${clause}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    )
    .all({ viewer: viewerId, like: search ? `%${search}%` : null }) as ConversationRow[];
}

export function findConversation(id: number, viewerId: number): ConversationRow | null {
  return (
    (getDb()
      .prepare(`${CONVERSATION_SELECT} WHERE c.id = @id`)
      .get({ viewer: viewerId, id }) as ConversationRow | undefined) ?? null
  );
}

export function findByDirectKey(key: string): { id: number } | null {
  return (
    (getDb()
      .prepare<[string], { id: number }>(`SELECT id FROM conversations WHERE direct_key = ?`)
      .get(key)) ?? null
  );
}

export function insertConversation(values: {
  kind: string;
  name: string | null;
  topic: string | null;
  direct_key: string | null;
  created_by: number;
}): number {
  const result = getDb()
    .prepare(
      `INSERT INTO conversations (kind, name, topic, direct_key, created_by, last_message_at)
       VALUES (@kind, @name, @topic, @direct_key, @created_by, datetime('now'))`,
    )
    .run(values);
  return Number(result.lastInsertRowid);
}

export function renameConversation(id: number, values: { name?: string; topic?: string | null }): void {
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    sets.push(`${key} = @${key}`);
    params[key] = value;
  }
  if (!sets.length) return;
  getDb().prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = @id`).run(params);
}

export function deleteConversation(id: number): void {
  getDb().prepare(`DELETE FROM conversations WHERE id = ?`).run(id);
}

// --- Members ---------------------------------------------------------------

export function listMembers(conversationId: number): MemberRow[] {
  return getDb()
    .prepare(
      `SELECT m.user_id, u.full_name, u.username, u.role_code, u.designation,
              d.name AS division_name, m.is_admin, m.last_read_at, u.last_seen_at
         FROM conversation_members m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN divisions d ON d.id = u.division_id
        WHERE m.conversation_id = ?
        ORDER BY m.is_admin DESC, u.full_name`,
    )
    .all(conversationId) as MemberRow[];
}

export function addMember(conversationId: number, userId: number, isAdmin = false): void {
  getDb()
    .prepare(
      `INSERT INTO conversation_members (conversation_id, user_id, is_admin)
       VALUES (?, ?, ?)
       ON CONFLICT(conversation_id, user_id) DO NOTHING`,
    )
    .run(conversationId, userId, isAdmin ? 1 : 0);
}

export function removeMember(conversationId: number, userId: number): void {
  getDb()
    .prepare(`DELETE FROM conversation_members WHERE conversation_id = ? AND user_id = ?`)
    .run(conversationId, userId);
}

export function isMember(conversationId: number, userId: number): boolean {
  const row = getDb()
    .prepare<[number, number], { n: number }>(
      `SELECT COUNT(*) AS n FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
    )
    .get(conversationId, userId);
  return (row?.n ?? 0) > 0;
}

export function isConversationAdmin(conversationId: number, userId: number): boolean {
  const row = getDb()
    .prepare<[number, number], { is_admin: number }>(
      `SELECT is_admin FROM conversation_members WHERE conversation_id = ? AND user_id = ?`,
    )
    .get(conversationId, userId);
  return Boolean(row?.is_admin);
}

export function markRead(conversationId: number, userId: number): void {
  getDb()
    .prepare(
      `UPDATE conversation_members SET last_read_at = datetime('now')
        WHERE conversation_id = ? AND user_id = ?`,
    )
    .run(conversationId, userId);
}

/** Drives the unread pip in the header. */
export function totalUnread(userId: number): number {
  const row = getDb()
    .prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM messages msg
         JOIN conversation_members m
           ON m.conversation_id = msg.conversation_id AND m.user_id = ?
        WHERE msg.deleted_at IS NULL
          AND msg.sender_id <> m.user_id
          AND (m.last_read_at IS NULL OR msg.created_at > m.last_read_at)`,
    )
    .get(userId);
  return row?.n ?? 0;
}

// --- Messages --------------------------------------------------------------

const MESSAGE_SELECT = `
  SELECT msg.id, msg.conversation_id, msg.sender_id, u.full_name AS sender_name,
         u.role_code AS sender_role, msg.body, msg.entity_type, msg.entity_id,
         msg.document_id, doc.name AS document_name, msg.deleted_at, msg.created_at
    FROM messages msg
    LEFT JOIN users u ON u.id = msg.sender_id
    LEFT JOIN documents doc ON doc.id = msg.document_id`;

export function listMessages(
  conversationId: number,
  options: { before?: number; after?: number; limit: number },
): MessageRow[] {
  const where: string[] = ['msg.conversation_id = ?'];
  const params: unknown[] = [conversationId];

  if (options.before) {
    where.push('msg.id < ?');
    params.push(options.before);
  }
  if (options.after) {
    where.push('msg.id > ?');
    params.push(options.after);
  }

  // Newest first for paging, then reversed by the service so the client renders
  // oldest to newest without another sort.
  const rows = getDb()
    .prepare(`${MESSAGE_SELECT} WHERE ${where.join(' AND ')} ORDER BY msg.id DESC LIMIT ?`)
    .all(...params, options.limit) as MessageRow[];
  return rows.reverse();
}

export function insertMessage(values: {
  conversation_id: number;
  sender_id: number;
  body: string;
  entity_type: string | null;
  entity_id: number | null;
  document_id: number | null;
}): number {
  const db = getDb();
  const result = db
    .prepare(
      `INSERT INTO messages (conversation_id, sender_id, body, entity_type, entity_id, document_id)
       VALUES (@conversation_id, @sender_id, @body, @entity_type, @entity_id, @document_id)`,
    )
    .run(values);
  db.prepare(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`).run(
    values.conversation_id,
  );
  return Number(result.lastInsertRowid);
}

export function findMessage(id: number): MessageRow | null {
  return (
    (getDb().prepare(`${MESSAGE_SELECT} WHERE msg.id = ?`).get(id) as MessageRow | undefined) ?? null
  );
}

export function softDeleteMessage(id: number): void {
  getDb().prepare(`UPDATE messages SET deleted_at = datetime('now') WHERE id = ?`).run(id);
}

/** People the user may start a chat with. */
export function listContactableUsers(
  viewerId: number,
  search?: string,
  staffOnly = true,
): { id: number; full_name: string; username: string; role_code: string; designation: string | null; division_name: string | null; last_seen_at: string | null }[] {
  const where: string[] = ["u.status = 'ACTIVE'", 'u.id <> ?'];
  const params: unknown[] = [viewerId];
  if (staffOnly) where.push("u.role_code <> 'CONTRACTOR'");
  if (search) {
    where.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.designation LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like);
  }
  return getDb()
    .prepare(
      `SELECT u.id, u.full_name, u.username, u.role_code, u.designation,
              d.name AS division_name, u.last_seen_at
         FROM users u
         LEFT JOIN divisions d ON d.id = u.division_id
        WHERE ${where.join(' AND ')}
        ORDER BY u.full_name
        LIMIT 200`,
    )
    .all(...params) as ReturnType<typeof listContactableUsers>;
}
