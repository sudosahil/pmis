import type { Request, Response } from 'express';
import { z } from 'zod';
import * as dashboardService from '../services/dashboard.service.js';
import * as notificationModel from '../models/notification.model.js';
import * as auditModel from '../models/audit.model.js';
import { ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const markReadSchema = z.object({
  ids: z.array(z.coerce.number().int().positive()).max(200).optional(),
  all: z.boolean().optional(),
});

export const auditQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  userId: z.coerce.number().int().positive().optional(),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  action: z.string().trim().max(60).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function dashboard(req: Request, res: Response): void {
  ok(res, dashboardService.getDashboard(requireUser(req)));
}

export function notifications(req: Request, res: Response): void {
  const user = requireUser(req);
  const query = req.query as unknown as z.infer<typeof notificationQuerySchema>;
  const result = notificationModel.listNotifications(user.id, {
    unreadOnly: query.unreadOnly,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });
  ok(res, {
    items: result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      message: row.message,
      severity: row.severity,
      entityType: row.entity_type,
      entityId: row.entity_id,
      link: row.link,
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
    })),
    total: result.total,
    unread: result.unread,
    page: query.page,
    pageSize: query.pageSize,
  });
}

export function markNotificationsRead(req: Request, res: Response): void {
  const user = requireUser(req);
  const body = req.body as z.infer<typeof markReadSchema>;
  if (body.all) notificationModel.markAllRead(user.id);
  else if (body.ids?.length) notificationModel.markRead(user.id, body.ids);
  ok(res, { message: 'Notifications updated.' });
}

/** The audit trail. Restricted to administrators and auditors by the router. */
export function auditLog(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof auditQuerySchema>;
  const result = auditModel.listAuditEntries({
    userId: query.userId,
    entityType: query.entityType,
    entityId: query.entityId,
    action: query.action,
    from: query.from,
    to: query.to,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });
  ok(res, {
    items: result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      detail: row.detail,
      ipAddress: row.ip_address,
      createdAt: row.created_at,
    })),
    total: result.total,
    page: query.page,
    pageSize: query.pageSize,
  });
}
