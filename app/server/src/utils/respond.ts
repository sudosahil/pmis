import type { Response } from 'express';

/**
 * Every successful response uses the same envelope as the error middleware:
 * { data, error }. Clients can therefore read one shape regardless of route.
 */
export function ok<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ data, error: null });
}

export function created<T>(res: Response, data: T): void {
  ok(res, data, 201);
}

export function noContent(res: Response): void {
  res.status(204).end();
}
