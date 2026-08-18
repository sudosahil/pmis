import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/** Tags every request so a client-visible error can be traced in the logs. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const id = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    data: null,
    error: { message: `No route matches ${req.method} ${req.path}.`, code: 'NOT_FOUND' },
  });
}

/**
 * Central error middleware. Operational errors keep their message; anything
 * else is logged with full context and reported as a generic 500 so stack
 * traces never reach the client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const context = {
    requestId: req.requestId,
    userId: req.user?.id,
    method: req.method,
    path: req.originalUrl,
  };

  if (error instanceof AppError) {
    if (error.statusCode >= 500) console.error('[error]', context, error);
    res.status(error.statusCode).json({
      data: null,
      error: {
        message: error.message,
        code: error.code,
        ...(error.details ? { details: error.details } : {}),
      },
    });
    return;
  }

  console.error('[unhandled]', context, error);
  res.status(500).json({
    data: null,
    error: {
      message: 'Something went wrong on our side. Please try again.',
      code: 'INTERNAL_ERROR',
      ...(env.isProduction ? {} : { debug: error instanceof Error ? error.message : String(error) }),
    },
  });
}

/** Wraps an async handler so rejected promises reach the error middleware. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => unknown>(
  handler: T,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
