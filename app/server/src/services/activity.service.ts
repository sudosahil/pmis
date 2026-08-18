import { z } from 'zod';
import * as activityModel from '../models/activity.model.js';

/** Matches the window the chat service uses to decide who is online. */
const ONLINE_WINDOW_SECONDS = 120;

export const activityQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sinceId: z.coerce.number().int().min(0).optional(),
  userId: z.coerce.number().int().positive().optional(),
  roleCode: z.string().trim().max(20).optional(),
  method: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).optional(),
  only: z.enum(['errors', 'writes']).optional(),
  search: z.string().trim().max(120).optional(),
});

export const pruneSchema = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
});

function present(row: activityModel.ActivityRow) {
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    fullName: row.full_name,
    roleCode: row.role_code,
    method: row.method,
    path: row.path,
    action: row.action,
    statusCode: row.status_code,
    durationMs: row.duration_ms,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

export function list(query: z.infer<typeof activityQuerySchema>) {
  const { rows, total } = activityModel.listActivity({
    sinceId: query.sinceId,
    userId: query.userId,
    roleCode: query.roleCode,
    method: query.method,
    only: query.only,
    search: query.search,
    limit: query.pageSize,
    offset: query.sinceId ? 0 : (query.page - 1) * query.pageSize,
  });

  return {
    items: rows.map(present),
    total,
    page: query.page,
    pageSize: query.pageSize,
    // The client tails from here on the next poll.
    latestId: activityModel.latestId(),
  };
}

export function online() {
  return activityModel.listOnlineUsers(ONLINE_WINDOW_SECONDS).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    roleCode: row.role_code,
    designation: row.designation,
    divisionName: row.division_name,
    lastSeenAt: row.last_seen_at,
    requestsToday: row.requests_today,
  }));
}

export function overview() {
  return {
    ...activityModel.stats(),
    onlineNow: activityModel.listOnlineUsers(ONLINE_WINDOW_SECONDS).length,
    topUsers: activityModel.topUsers(6),
  };
}

export function prune(days: number): { removed: number } {
  return { removed: activityModel.pruneOlderThanDays(days) };
}
