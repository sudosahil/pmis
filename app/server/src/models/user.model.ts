import { getDb } from '../db/index.js';
import type { RoleCode } from '../config/constants.js';
import type { AuthUser } from '../types/auth.js';

export interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  full_name: string;
  employee_code: string | null;
  designation: string | null;
  role_code: RoleCode;
  phone: string | null;
  zone_id: number | null;
  circle_id: number | null;
  division_id: number | null;
  sub_division_id: number | null;
  contractor_id: number | null;
  status: string;
  must_change_password: number;
  failed_attempts: number;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserSummary {
  id: number;
  username: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  designation: string | null;
  roleCode: RoleCode;
  roleName: string;
  phone: string | null;
  zoneId: number | null;
  zoneName: string | null;
  circleId: number | null;
  circleName: string | null;
  divisionId: number | null;
  divisionName: string | null;
  subDivisionId: number | null;
  subDivisionName: string | null;
  contractorId: number | null;
  contractorName: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

const SUMMARY_SELECT = `
  SELECT u.id, u.username, u.email, u.full_name, u.employee_code, u.designation,
         u.role_code, r.name AS role_name, u.phone,
         u.zone_id, z.name AS zone_name,
         u.circle_id, c.name AS circle_name,
         u.division_id, d.name AS division_name,
         u.sub_division_id, sd.name AS sub_division_name,
         u.contractor_id, ct.name AS contractor_name,
         u.status, u.last_login_at, u.created_at
  FROM users u
  JOIN roles r ON r.code = u.role_code
  LEFT JOIN zones z ON z.id = u.zone_id
  LEFT JOIN circles c ON c.id = u.circle_id
  LEFT JOIN divisions d ON d.id = u.division_id
  LEFT JOIN sub_divisions sd ON sd.id = u.sub_division_id
  LEFT JOIN contractors ct ON ct.id = u.contractor_id
`;

function mapSummary(row: Record<string, unknown>): UserSummary {
  return {
    id: row.id as number,
    username: row.username as string,
    email: row.email as string,
    fullName: row.full_name as string,
    employeeCode: (row.employee_code as string) ?? null,
    designation: (row.designation as string) ?? null,
    roleCode: row.role_code as RoleCode,
    roleName: row.role_name as string,
    phone: (row.phone as string) ?? null,
    zoneId: (row.zone_id as number) ?? null,
    zoneName: (row.zone_name as string) ?? null,
    circleId: (row.circle_id as number) ?? null,
    circleName: (row.circle_name as string) ?? null,
    divisionId: (row.division_id as number) ?? null,
    divisionName: (row.division_name as string) ?? null,
    subDivisionId: (row.sub_division_id as number) ?? null,
    subDivisionName: (row.sub_division_name as string) ?? null,
    contractorId: (row.contractor_id as number) ?? null,
    contractorName: (row.contractor_name as string) ?? null,
    status: row.status as string,
    lastLoginAt: (row.last_login_at as string) ?? null,
    createdAt: row.created_at as string,
  };
}

export function findAuthUserById(id: number): AuthUser | null {
  const row = getDb()
    .prepare<[number], UserRow>(`SELECT * FROM users WHERE id = ? AND status = 'ACTIVE'`)
    .get(id);
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    fullName: row.full_name,
    email: row.email,
    roleCode: row.role_code,
    designation: row.designation,
    zoneId: row.zone_id,
    circleId: row.circle_id,
    divisionId: row.division_id,
    subDivisionId: row.sub_division_id,
    contractorId: row.contractor_id,
  };
}

export function findByLogin(login: string): UserRow | null {
  return (
    getDb()
      .prepare<[string, string], UserRow>(
        `SELECT * FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)`,
      )
      .get(login, login) ?? null
  );
}

export function findRowById(id: number): UserRow | null {
  return getDb().prepare<[number], UserRow>(`SELECT * FROM users WHERE id = ?`).get(id) ?? null;
}

export function findSummaryById(id: number): UserSummary | null {
  const row = getDb().prepare(`${SUMMARY_SELECT} WHERE u.id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSummary(row) : null;
}

export function findSummaryByContractorId(contractorId: number): UserSummary | null {
  const row = getDb().prepare(`${SUMMARY_SELECT} WHERE u.contractor_id = ?`).get(contractorId) as
    | Record<string, unknown>
    | undefined;
  return row ? mapSummary(row) : null;
}

export interface ListUsersOptions {
  search?: string;
  roleCode?: string;
  divisionId?: number;
  status?: string;
  limit: number;
  offset: number;
}

export function listUsers(options: ListUsersOptions): { rows: UserSummary[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(u.full_name LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.employee_code LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like, like);
  }
  if (options.roleCode) {
    where.push(`u.role_code = ?`);
    params.push(options.roleCode);
  }
  if (options.divisionId) {
    where.push(`u.division_id = ?`);
    params.push(options.divisionId);
  }
  if (options.status) {
    where.push(`u.status = ?`);
    params.push(options.status);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM users u ${clause}`).get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${SUMMARY_SELECT} ${clause} ORDER BY u.full_name LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as Record<string, unknown>[];

  return { rows: rows.map(mapSummary), total };
}

/** Users holding a role, optionally narrowed to a division — used to route approvals. */
export function findUsersByRole(roleCode: string, divisionId?: number | null): UserSummary[] {
  const params: unknown[] = [roleCode];
  let clause = `WHERE u.role_code = ? AND u.status = 'ACTIVE'`;
  if (divisionId) {
    clause += ` AND (u.division_id = ? OR u.division_id IS NULL)`;
    params.push(divisionId);
  }
  const rows = getDb()
    .prepare(`${SUMMARY_SELECT} ${clause} ORDER BY u.full_name`)
    .all(...params) as Record<string, unknown>[];
  return rows.map(mapSummary);
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
  fullName: string;
  employeeCode?: string | null;
  designation?: string | null;
  roleCode: string;
  phone?: string | null;
  zoneId?: number | null;
  circleId?: number | null;
  divisionId?: number | null;
  subDivisionId?: number | null;
  contractorId?: number | null;
  mustChangePassword?: boolean;
}

export function insertUser(input: CreateUserInput): number {
  const result = getDb()
    .prepare(
      `INSERT INTO users (username, email, password_hash, full_name, employee_code, designation,
                          role_code, phone, zone_id, circle_id, division_id, sub_division_id,
                          contractor_id, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.username,
      input.email,
      input.passwordHash,
      input.fullName,
      input.employeeCode ?? null,
      input.designation ?? null,
      input.roleCode,
      input.phone ?? null,
      input.zoneId ?? null,
      input.circleId ?? null,
      input.divisionId ?? null,
      input.subDivisionId ?? null,
      input.contractorId ?? null,
      input.mustChangePassword ? 1 : 0,
    );
  return Number(result.lastInsertRowid);
}

export function updateUserFields(id: number, fields: Record<string, unknown>): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  const set = entries.map(([k]) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE users SET ${set} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export function recordSuccessfulLogin(id: number): void {
  getDb()
    .prepare(`UPDATE users SET last_login_at = datetime('now'), failed_attempts = 0 WHERE id = ?`)
    .run(id);
}

export function recordFailedLogin(id: number): number {
  const db = getDb();
  db.prepare(`UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?`).run(id);
  const row = db
    .prepare<[number], { failed_attempts: number }>(`SELECT failed_attempts FROM users WHERE id = ?`)
    .get(id);
  return row?.failed_attempts ?? 0;
}

export function setPasswordHash(id: number, passwordHash: string): void {
  getDb()
    .prepare(`UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?`)
    .run(passwordHash, id);
}

export function listRoles(): { code: string; name: string; description: string | null; scope: string }[] {
  return getDb()
    .prepare(`SELECT code, name, description, scope FROM roles ORDER BY hierarchy DESC, name`)
    .all() as { code: string; name: string; description: string | null; scope: string }[];
}

/** How many active accounts hold a role — shown on the role access screen. */
export function countByRole(roleCode: string): number {
  const row = getDb()
    .prepare<[string], { n: number }>(
      `SELECT COUNT(*) AS n FROM users WHERE role_code = ? AND status = 'ACTIVE'`,
    )
    .get(roleCode);
  return row?.n ?? 0;
}

/** The active holders of a role, so they can be told when their access changes. */
export function listByRoleCode(roleCode: string): { id: number; full_name: string }[] {
  return getDb()
    .prepare(
      `SELECT id, full_name FROM users WHERE role_code = ? AND status = 'ACTIVE'`,
    )
    .all(roleCode) as { id: number; full_name: string }[];
}
