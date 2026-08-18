import { z } from 'zod';
import { getDb, transaction } from '../db/index.js';
import { ROLES, type RoleCode } from '../config/constants.js';
import {
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS,
  PERMISSION_KEYS,
  findPermission,
  isPermissionKey,
} from '../config/permissions.js';
import { insertAuditEntry } from '../models/audit.model.js';
import * as userModel from '../models/user.model.js';
import { insertNotification } from '../models/notification.model.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, notFound } from '../utils/errors.js';

/**
 * Reads and writes what each role may do.
 *
 * Grants are cached, because every authenticated request asks this question and
 * the answer changes only when an administrator edits it. The cache is cleared
 * on every write, and the process is single-instance per deployment, so there
 * is nothing to invalidate across machines.
 */

let cache: Map<string, Set<string>> | null = null;

function loadGrants(): Map<string, Set<string>> {
  if (cache) return cache;

  const db = getDb();
  const configured = new Set(
    (db.prepare(`SELECT role_code FROM role_permission_state WHERE configured = 1`).all() as {
      role_code: string;
    }[]).map((row) => row.role_code),
  );
  const rows = db
    .prepare(`SELECT role_code, permission_key FROM role_permissions`)
    .all() as { role_code: string; permission_key: string }[];

  const map = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!map.has(row.role_code)) map.set(row.role_code, new Set());
    map.get(row.role_code)!.add(row.permission_key);
  }

  // A role nobody has configured keeps the built-in defaults, so adding a role
  // code — or a permission — never silently strips access.
  for (const [role, defaults] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    if (configured.has(role)) {
      if (!map.has(role)) map.set(role, new Set());
      continue;
    }
    map.set(role, new Set(defaults));
  }

  cache = map;
  return map;
}

export function clearCache(): void {
  cache = null;
}

export function permissionsFor(roleCode: string): string[] {
  return [...(loadGrants().get(roleCode) ?? new Set<string>())].sort();
}

export function roleHasPermission(roleCode: string, permission: string): boolean {
  return loadGrants().get(roleCode)?.has(permission) ?? false;
}

export function userHasPermission(user: AuthUser, permission: string): boolean {
  return roleHasPermission(user.roleCode, permission);
}

// --- Schemas ---------------------------------------------------------------

export const updateRoleSchema = z.object({
  permissions: z.array(z.string().trim().min(1).max(60)).max(PERMISSION_KEYS.length + 10),
});

// --- Presentation ----------------------------------------------------------

export function catalogue() {
  const grants = loadGrants();
  const roles = userModel.listRoles();

  return {
    permissions: PERMISSIONS.map((permission) => ({
      key: permission.key,
      label: permission.label,
      description: permission.description,
      group: permission.group,
      lockedForAdmin: Boolean(permission.lockedForAdmin),
    })),
    groups: [...new Set(PERMISSIONS.map((permission) => permission.group))],
    roles: roles.map((role) => {
      const held = [...(grants.get(role.code) ?? new Set<string>())];
      const defaults = DEFAULT_ROLE_PERMISSIONS[role.code as RoleCode] ?? [];
      return {
        code: role.code,
        name: role.name,
        description: role.description,
        scope: role.scope,
        userCount: userModel.countByRole(role.code),
        permissions: held.sort(),
        defaultPermissions: [...defaults].sort(),
        isDefault:
          held.length === defaults.length && held.every((key) => defaults.includes(key)),
      };
    }),
  };
}

// --- Writes ----------------------------------------------------------------

/**
 * Replaces a role's grants outright. The administrator cannot be stripped of
 * the two permissions that would leave nobody able to grant them back.
 */
export function setRolePermissions(
  roleCode: string,
  input: z.infer<typeof updateRoleSchema>,
  actor: AuthUser,
) {
  const role = userModel.listRoles().find((candidate) => candidate.code === roleCode);
  if (!role) throw notFound('Role');

  const unknown = input.permissions.filter((key) => !isPermissionKey(key));
  if (unknown.length) {
    throw badRequest(`These are not permissions this system knows about: ${unknown.join(', ')}.`);
  }

  let requested = [...new Set(input.permissions)];

  if (roleCode === ROLES.ADMIN) {
    const locked = PERMISSIONS.filter((permission) => permission.lockedForAdmin).map((p) => p.key);
    const missing = locked.filter((key) => !requested.includes(key));
    if (missing.length) {
      const names = missing.map((key) => findPermission(key)?.label ?? key);
      throw badRequest(
        `The administrator cannot give up: ${names.join(', ')}. ` +
          'Removing them would leave nobody able to grant them back.',
      );
    }
  }

  const previous = new Set(permissionsFor(roleCode));

  transaction(() => {
    const db = getDb();
    db.prepare(`DELETE FROM role_permissions WHERE role_code = ?`).run(roleCode);

    const insert = db.prepare(
      `INSERT INTO role_permissions (role_code, permission_key, granted_by) VALUES (?, ?, ?)`,
    );
    for (const key of requested) insert.run(roleCode, key, actor.id);

    // Mark the role configured, so revoking everything is respected rather than
    // read as "never set up".
    db.prepare(
      `INSERT INTO role_permission_state (role_code, configured, updated_by)
       VALUES (?, 1, ?)
       ON CONFLICT(role_code) DO UPDATE SET configured = 1, updated_by = excluded.updated_by`,
    ).run(roleCode, actor.id);
  });

  clearCache();

  const added = requested.filter((key) => !previous.has(key));
  const removed = [...previous].filter((key) => !requested.includes(key));

  insertAuditEntry({
    userId: actor.id,
    action: 'ROLE_PERMISSIONS_CHANGED',
    entityType: 'ROLE',
    entityId: null,
    detail:
      `${roleCode}: ` +
      [
        added.length ? `granted ${added.join(', ')}` : null,
        removed.length ? `revoked ${removed.join(', ')}` : null,
      ]
        .filter(Boolean)
        .join('; ') || `${roleCode}: no change`,
  });

  // Anyone currently holding the role should know their access moved under them.
  if (added.length || removed.length) {
    for (const holder of userModel.listByRoleCode(roleCode)) {
      if (holder.id === actor.id) continue;
      insertNotification({
        userId: holder.id,
        title: 'What you can do has changed',
        message:
          `${actor.fullName} changed the access held by ${role.name}. ` +
          'Sign out and back in if a screen looks wrong.',
        severity: 'INFO',
        entityType: 'ROLE',
        entityId: null,
        link: '/profile',
      });
    }
  }

  return catalogue();
}

/** Puts a role back to the access it shipped with. */
export function resetRole(roleCode: string, actor: AuthUser) {
  const defaults = DEFAULT_ROLE_PERMISSIONS[roleCode as RoleCode];
  if (!defaults) throw notFound('Role');
  return setRolePermissions(roleCode, { permissions: [...defaults] }, actor);
}
