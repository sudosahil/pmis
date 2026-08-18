import crypto from 'node:crypto';
import { z } from 'zod';
import { ROLES, STAFF_ROLES } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { hashPassword } from './auth.service.js';
import { revokeAllUserTokens } from './token.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { phone } from '../middleware/validate.js';

export const createUserSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, 'Use at least 3 characters.')
    .max(60)
    .regex(/^[a-z0-9._-]+$/, 'Use letters, numbers, dots, hyphens or underscores only.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  fullName: z.string().trim().min(3, 'Enter the officer’s full name.').max(160),
  employeeCode: z.string().trim().max(40).optional(),
  designation: z.string().trim().max(120).optional(),
  roleCode: z.enum(STAFF_ROLES as unknown as [string, ...string[]]),
  phone: phone.optional(),
  zoneId: z.coerce.number().int().positive().optional(),
  circleId: z.coerce.number().int().positive().optional(),
  divisionId: z.coerce.number().int().positive().optional(),
  subDivisionId: z.coerce.number().int().positive().optional(),
});

export const updateUserSchema = createUserSchema.partial().omit({ username: true }).extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
});

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  roleCode: z.string().trim().max(20).optional(),
  divisionId: z.coerce.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
});

/**
 * Roles that operate inside a division need one assigned, otherwise their
 * approval inbox would never match anything.
 */
const DIVISION_SCOPED_ROLES: string[] = [ROLES.EE, ROLES.AEE, ROLES.AE, ROLES.AC, ROLES.AS];

function assertPosting(input: {
  roleCode?: string;
  divisionId?: number | null;
  circleId?: number | null;
}): void {
  if (input.roleCode && DIVISION_SCOPED_ROLES.includes(input.roleCode) && !input.divisionId) {
    throw badRequest(`A ${input.roleCode} must be posted to a division.`);
  }
  if (input.roleCode === ROLES.SE && !input.circleId) {
    throw badRequest('A Superintending Engineer must be posted to a circle.');
  }
}

export function list(options: z.infer<typeof listUsersQuerySchema>) {
  const { rows, total } = userModel.listUsers({
    search: options.search,
    roleCode: options.roleCode,
    divisionId: options.divisionId,
    status: options.status,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows, total, page: options.page, pageSize: options.pageSize };
}

export function getOne(id: number) {
  const user = userModel.findSummaryById(id);
  if (!user) throw notFound('User');
  return user;
}

/**
 * Creates a staff account with a generated temporary password. The password is
 * returned once, to the administrator, and the user must change it at first
 * sign-in.
 */
export function create(input: z.infer<typeof createUserSchema>, actor: AuthUser) {
  return transaction(() => {
    if (userModel.findByLogin(input.username)) throw conflict('That username is already taken.');
    if (userModel.findByLogin(input.email)) throw conflict('That email address is already in use.');
    assertPosting(input);

    const temporaryPassword = `Pmis-${crypto.randomBytes(6).toString('base64url')}`;
    const id = userModel.insertUser({
      username: input.username,
      email: input.email,
      passwordHash: hashPassword(temporaryPassword),
      fullName: input.fullName,
      employeeCode: input.employeeCode ?? null,
      designation: input.designation ?? null,
      roleCode: input.roleCode,
      phone: input.phone ?? null,
      zoneId: input.zoneId ?? null,
      circleId: input.circleId ?? null,
      divisionId: input.divisionId ?? null,
      subDivisionId: input.subDivisionId ?? null,
      mustChangePassword: true,
    });

    insertAuditEntry({
      userId: actor.id,
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: id,
      detail: `${input.username} (${input.roleCode})`,
    });

    return { user: userModel.findSummaryById(id)!, temporaryPassword };
  });
}

export function update(id: number, input: z.infer<typeof updateUserSchema>, actor: AuthUser) {
  const existing = userModel.findSummaryById(id);
  if (!existing) throw notFound('User');

  if (input.email && input.email !== existing.email) {
    const clash = userModel.findByLogin(input.email);
    if (clash && clash.id !== id) throw conflict('That email address is already in use.');
  }
  assertPosting({
    roleCode: input.roleCode ?? existing.roleCode,
    divisionId: input.divisionId ?? existing.divisionId,
    circleId: input.circleId ?? existing.circleId,
  });

  userModel.updateUserFields(id, {
    email: input.email,
    full_name: input.fullName,
    employee_code: input.employeeCode,
    designation: input.designation,
    role_code: input.roleCode,
    phone: input.phone,
    zone_id: input.zoneId,
    circle_id: input.circleId,
    division_id: input.divisionId,
    sub_division_id: input.subDivisionId,
    status: input.status,
  });

  // A role change or deactivation must not leave live sessions behind.
  if (input.roleCode || (input.status && input.status !== 'ACTIVE')) {
    revokeAllUserTokens(id);
  }

  insertAuditEntry({
    userId: actor.id,
    action: 'USER_UPDATED',
    entityType: 'USER',
    entityId: id,
    detail: existing.username,
  });

  return userModel.findSummaryById(id)!;
}

/** Issues a fresh temporary password and unlocks the account. */
export function resetPassword(id: number, actor: AuthUser) {
  const existing = userModel.findSummaryById(id);
  if (!existing) throw notFound('User');

  const temporaryPassword = `Pmis-${crypto.randomBytes(6).toString('base64url')}`;
  userModel.setPasswordHash(id, hashPassword(temporaryPassword));
  userModel.updateUserFields(id, {
    must_change_password: 1,
    failed_attempts: 0,
    status: existing.status === 'LOCKED' ? 'ACTIVE' : existing.status,
  });
  revokeAllUserTokens(id);

  insertAuditEntry({
    userId: actor.id,
    action: 'USER_PASSWORD_RESET',
    entityType: 'USER',
    entityId: id,
    detail: existing.username,
  });

  return { user: userModel.findSummaryById(id)!, temporaryPassword };
}

/** Officers holding a role, used to populate the "assign to" picker. */
export function listByRole(roleCode: string, divisionId?: number) {
  return userModel.findUsersByRole(roleCode, divisionId ?? null);
}
