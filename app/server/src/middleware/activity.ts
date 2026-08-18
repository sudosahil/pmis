import type { NextFunction, Request, Response } from 'express';
import * as activityModel from '../models/activity.model.js';
import { describeRequest } from './describe-request.js';

/**
 * Records every authenticated API call so an administrator can watch the system
 * live. This is the technical log; `audit_log` remains the permanent record of
 * business events in the department's own language.
 */

/** Endpoints the client polls. Logging them would drown the feed in its own noise. */
const IGNORED_PATHS = [
  '/api/activity',          // the live tail itself, and its polling
  '/api/health',
  '/api/notifications',     // header badge, polled every minute
  '/api/approvals/inbox',   // sidebar count, polled every minute
  '/api/chat/unread',       // chat pip, polled every few seconds
];

/** Presence is written at most once a minute per user rather than per request. */
const PRESENCE_THROTTLE_MS = 60_000;
const lastTouched = new Map<number, number>();

function isIgnored(path: string): boolean {
  return IGNORED_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function activityLogger(req: Request, res: Response, next: NextFunction): void {
  // `req.path` is the path within the mounted router, so use originalUrl and
  // strip the query string, which can carry search terms we would rather not log.
  const fullPath = req.originalUrl.split('?')[0] ?? req.originalUrl;
  if (isIgnored(fullPath)) {
    next();
    return;
  }

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    // The user is attached by `authenticate`, which runs after this middleware,
    // so it is only readable once the response is on its way out.
    const user = req.user;
    if (!user) return;

    const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

    try {
      activityModel.insertActivity({
        user_id: user.id,
        username: user.username,
        full_name: user.fullName,
        role_code: user.roleCode,
        method: req.method,
        path: fullPath,
        action: describeRequest(req.method, fullPath),
        status_code: res.statusCode,
        duration_ms: durationMs,
        ip_address: req.ip ?? null,
        user_agent: req.get('user-agent') ?? null,
      });

      const now = Date.now();
      const last = lastTouched.get(user.id) ?? 0;
      if (now - last > PRESENCE_THROTTLE_MS) {
        lastTouched.set(user.id, now);
        activityModel.touchLastSeen(user.id);
      }
    } catch {
      // Logging must never take a request down with it.
    }
  });

  next();
}
