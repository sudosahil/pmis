import { getDb } from '../db/index.js';

/**
 * Standing committees, their sittings, and what those sittings decided.
 *
 * A decision nobody is named against is a decision nobody acts on, so the
 * action items are first-class rows rather than a paragraph of minutes.
 */

export interface CommitteeRow {
  id: number;
  code: string;
  name: string;
  kind: string;
  purpose: string | null;
  division_id: number | null;
  quorum: number;
  status: string;
  created_by: number | null;
  created_at: string;
}

export interface CommitteeDetailRow extends CommitteeRow {
  division_code: string | null;
  division_name: string | null;
  member_count: number;
  meeting_count: number;
  last_meeting_at: string | null;
  open_actions: number;
}

const DETAIL_SELECT = `
  SELECT c.*,
         d.code AS division_code, d.name AS division_name,
         (SELECT COUNT(*) FROM committee_members cm WHERE cm.committee_id = c.id) AS member_count,
         (SELECT COUNT(*) FROM meetings m WHERE m.committee_id = c.id) AS meeting_count,
         (SELECT MAX(m.scheduled_at) FROM meetings m WHERE m.committee_id = c.id) AS last_meeting_at,
         (SELECT COUNT(*) FROM meeting_decisions md
            JOIN meetings m ON m.id = md.meeting_id
           WHERE m.committee_id = c.id AND md.status = 'OPEN') AS open_actions
    FROM committees c
    LEFT JOIN divisions d ON d.id = c.division_id
`;

export function findById(id: number): CommitteeDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE c.id = ?`).get(id) as CommitteeDetailRow | undefined)
    ?? null
  );
}

export function findByCode(code: string): CommitteeRow | null {
  return (
    (getDb().prepare(`SELECT * FROM committees WHERE code = ?`).get(code) as CommitteeRow | undefined)
    ?? null
  );
}

export function listCommittees(options: {
  search?: string;
  kind?: string;
  divisionId?: number;
  limit: number;
  offset: number;
}): { rows: CommitteeDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(c.name LIKE ? OR c.code LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like);
  }
  if (options.kind) {
    where.push(`c.kind = ?`);
    params.push(options.kind);
  }
  // A departmental committee has no division of its own and is visible to all.
  if (options.divisionId) {
    where.push(`(c.division_id = ? OR c.division_id IS NULL)`);
    params.push(options.divisionId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM committees c ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY c.name LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as CommitteeDetailRow[];

  return { rows, total };
}

export function insertCommittee(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO committees (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateCommittee(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE committees SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

// --- Members -----------------------------------------------------------------

export interface MemberRow {
  id: number;
  committee_id: number;
  user_id: number;
  member_role: string;
  designation: string | null;
  full_name: string;
  role_code: string;
  email: string;
}

export function listMembers(committeeId: number): MemberRow[] {
  return getDb()
    .prepare(
      `SELECT cm.*, u.full_name, u.role_code, u.email
         FROM committee_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.committee_id = ?
        ORDER BY CASE cm.member_role
                   WHEN 'CHAIRPERSON' THEN 0
                   WHEN 'MEMBER_SECRETARY' THEN 1
                   WHEN 'MEMBER' THEN 2
                   ELSE 3 END, u.full_name`,
    )
    .all(committeeId) as MemberRow[];
}

export function replaceMembers(
  committeeId: number,
  members: { user_id: number; member_role: string; designation: string | null }[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM committee_members WHERE committee_id = ?`).run(committeeId);
    const stmt = db.prepare(
      `INSERT INTO committee_members (committee_id, user_id, member_role, designation)
       VALUES (?, ?, ?, ?)`,
    );
    for (const member of members) {
      stmt.run(committeeId, member.user_id, member.member_role, member.designation);
    }
  })();
}

// --- Meetings ----------------------------------------------------------------

export interface MeetingRow {
  id: number;
  committee_id: number;
  meeting_no: string;
  title: string;
  scheduled_at: string;
  venue: string | null;
  mode: string;
  agenda: string | null;
  status: string;
  held_at: string | null;
  minutes: string | null;
  minutes_by: number | null;
  created_by: number | null;
  created_at: string;
}

export interface MeetingDetailRow extends MeetingRow {
  committee_code: string;
  committee_name: string;
  committee_quorum: number;
  division_id: number | null;
  minutes_by_name: string | null;
  created_by_name: string | null;
  present_count: number;
  invited_count: number;
  decision_count: number;
  open_actions: number;
}

const MEETING_SELECT = `
  SELECT m.*,
         c.code AS committee_code, c.name AS committee_name,
         c.quorum AS committee_quorum, c.division_id,
         mb.full_name AS minutes_by_name,
         u.full_name AS created_by_name,
         (SELECT COUNT(*) FROM meeting_attendance ma
            JOIN committee_members cm
                 ON cm.committee_id = m.committee_id AND cm.user_id = ma.user_id
           WHERE ma.meeting_id = m.id AND ma.is_present = 1
             AND cm.member_role <> 'SPECIAL_INVITEE') AS present_count,
         (SELECT COUNT(*) FROM meeting_attendance ma WHERE ma.meeting_id = m.id) AS invited_count,
         (SELECT COUNT(*) FROM meeting_decisions md WHERE md.meeting_id = m.id) AS decision_count,
         (SELECT COUNT(*) FROM meeting_decisions md
           WHERE md.meeting_id = m.id AND md.status = 'OPEN') AS open_actions
    FROM meetings m
    JOIN committees c ON c.id = m.committee_id
    LEFT JOIN users mb ON mb.id = m.minutes_by
    LEFT JOIN users u ON u.id = m.created_by
`;

export function findMeeting(id: number): MeetingDetailRow | null {
  return (
    (getDb().prepare(`${MEETING_SELECT} WHERE m.id = ?`).get(id) as MeetingDetailRow | undefined)
    ?? null
  );
}

export function listMeetings(options: {
  committeeId?: number;
  status?: string;
  upcomingOnly?: boolean;
  divisionId?: number;
  limit: number;
  offset: number;
}): { rows: MeetingDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.committeeId) {
    where.push(`m.committee_id = ?`);
    params.push(options.committeeId);
  }
  if (options.status) {
    where.push(`m.status = ?`);
    params.push(options.status);
  }
  if (options.upcomingOnly) {
    where.push(`m.status = 'SCHEDULED' AND datetime(m.scheduled_at) >= datetime('now')`);
  }
  if (options.divisionId) {
    where.push(`(c.division_id = ? OR c.division_id IS NULL)`);
    params.push(options.divisionId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM meetings m JOIN committees c ON c.id = m.committee_id ${clause}`,
      )
      .get(...params) as { n: number }
  ).n;
  const order = options.upcomingOnly ? 'm.scheduled_at' : 'm.scheduled_at DESC';
  const rows = db
    .prepare(`${MEETING_SELECT} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as MeetingDetailRow[];

  return { rows, total };
}

export function insertMeeting(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO meetings (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateMeeting(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE meetings SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function deleteMeeting(id: number): void {
  getDb().prepare(`DELETE FROM meetings WHERE id = ?`).run(id);
}

// --- Attendance and decisions ------------------------------------------------

export interface AttendanceRow {
  id: number;
  meeting_id: number;
  user_id: number;
  is_present: number;
  remarks: string | null;
  full_name: string;
  role_code: string;
  member_role: string | null;
}

export function listAttendance(meetingId: number): AttendanceRow[] {
  return getDb()
    .prepare(
      `SELECT ma.*, u.full_name, u.role_code, cm.member_role
         FROM meeting_attendance ma
         JOIN users u ON u.id = ma.user_id
         JOIN meetings m ON m.id = ma.meeting_id
         LEFT JOIN committee_members cm
                ON cm.committee_id = m.committee_id AND cm.user_id = ma.user_id
        WHERE ma.meeting_id = ?
        ORDER BY CASE cm.member_role
                   WHEN 'CHAIRPERSON' THEN 0
                   WHEN 'MEMBER_SECRETARY' THEN 1
                   WHEN 'MEMBER' THEN 2
                   ELSE 3 END, u.full_name`,
    )
    .all(meetingId) as AttendanceRow[];
}

export function replaceAttendance(
  meetingId: number,
  rows: { user_id: number; is_present: number; remarks: string | null }[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM meeting_attendance WHERE meeting_id = ?`).run(meetingId);
    const stmt = db.prepare(
      `INSERT INTO meeting_attendance (meeting_id, user_id, is_present, remarks)
       VALUES (?, ?, ?, ?)`,
    );
    for (const row of rows) stmt.run(meetingId, row.user_id, row.is_present, row.remarks);
  })();
}

/**
 * How many members attended, for the quorum.
 *
 * A special invitee is present to be heard, not to decide, so they are not
 * counted — a sitting of two members and three invitees is still a sitting of
 * two. Somebody attending who is not on the roll at all counts for nothing
 * either, which is why this joins through the membership rather than trusting
 * the attendance sheet on its own.
 */
export function countPresent(meetingId: number): number {
  const row = getDb()
    .prepare<[number], { n: number }>(
      `SELECT COUNT(*) AS n
         FROM meeting_attendance ma
         JOIN meetings m ON m.id = ma.meeting_id
         JOIN committee_members cm
              ON cm.committee_id = m.committee_id AND cm.user_id = ma.user_id
        WHERE ma.meeting_id = ? AND ma.is_present = 1 AND cm.member_role <> 'SPECIAL_INVITEE'`,
    )
    .get(meetingId);
  return row?.n ?? 0;
}

export interface DecisionRow {
  id: number;
  meeting_id: number;
  seq: number;
  subject: string;
  decision: string;
  action_by_id: number | null;
  action_by_name: string | null;
  due_date: string | null;
  status: string;
  closed_on: string | null;
  closing_note: string | null;
  created_at: string;
}

export function listDecisions(meetingId: number): DecisionRow[] {
  return getDb()
    .prepare(
      `SELECT md.*, u.full_name AS action_by_name
         FROM meeting_decisions md
         LEFT JOIN users u ON u.id = md.action_by_id
        WHERE md.meeting_id = ? ORDER BY md.seq`,
    )
    .all(meetingId) as DecisionRow[];
}

export function findDecision(id: number): DecisionRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT md.*, u.full_name AS action_by_name FROM meeting_decisions md
           LEFT JOIN users u ON u.id = md.action_by_id WHERE md.id = ?`,
      )
      .get(id) as DecisionRow | undefined) ?? null
  );
}

export function replaceDecisions(
  meetingId: number,
  rows: {
    seq: number;
    subject: string;
    decision: string;
    action_by_id: number | null;
    due_date: string | null;
    status: string;
  }[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM meeting_decisions WHERE meeting_id = ?`).run(meetingId);
    const stmt = db.prepare(
      `INSERT INTO meeting_decisions (meeting_id, seq, subject, decision, action_by_id, due_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const row of rows) {
      stmt.run(meetingId, row.seq, row.subject, row.decision, row.action_by_id, row.due_date, row.status);
    }
  })();
}

export function updateDecision(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE meeting_decisions SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

/** Action items owed by one officer — what a committee actually leaves behind. */
export function listActionsForUser(userId: number): (DecisionRow & {
  meeting_no: string;
  meeting_title: string;
  committee_name: string;
})[] {
  return getDb()
    .prepare(
      `SELECT md.*, u.full_name AS action_by_name,
              m.meeting_no, m.title AS meeting_title, c.name AS committee_name
         FROM meeting_decisions md
         JOIN meetings m ON m.id = md.meeting_id
         JOIN committees c ON c.id = m.committee_id
         LEFT JOIN users u ON u.id = md.action_by_id
        WHERE md.action_by_id = ? AND md.status = 'OPEN'
        ORDER BY md.due_date IS NULL, md.due_date`,
    )
    .all(userId) as (DecisionRow & {
    meeting_no: string;
    meeting_title: string;
    committee_name: string;
  })[];
}
