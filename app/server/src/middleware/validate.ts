import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, z } from 'zod';
import { badRequest } from '../utils/errors.js';
import { toBps, toPaise, toQty } from '../utils/money.js';

type Source = 'body' | 'query' | 'params';

/**
 * Validates and *replaces* the named request section with the parsed result, so
 * handlers downstream always receive coerced, trusted values.
 */
export function validate(schema: ZodTypeAny, source: Source = 'body') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(badRequest('Some fields need attention.', formatZodError(result.error)));
    }
    // req.query is a getter in Express 5; assign through defineProperty to stay safe.
    Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
    next();
  };
}

export function formatZodError(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

// --- Reusable field schemas ------------------------------------------------

/** Accepts rupees from the client and stores integer paise. */
export const rupees = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    try {
      return toPaise(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid amount (max 2 decimals).' });
      return z.NEVER;
    }
  });

/** Accepts a percentage from the client and stores integer basis points. */
export const percent = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    try {
      return toBps(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid percentage (max 2 decimals).' });
      return z.NEVER;
    }
  });

/** Accepts a quantity with up to 3 decimals and stores it scaled by 1000. */
export const quantity = z
  .union([z.number(), z.string()])
  .transform((value, ctx) => {
    try {
      return toQty(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid quantity (max 3 decimals).' });
      return z.NEVER;
    }
  });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.');

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  sort: z.string().trim().max(60).optional(),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export type PaginationQuery = z.infer<typeof paginationQuery>;

export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const pan = z.string().trim().toUpperCase().regex(PAN_REGEX, 'Enter a valid 10-character PAN.');
export const gstin = z.string().trim().toUpperCase().regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN.');
export const ifsc = z.string().trim().toUpperCase().regex(IFSC_REGEX, 'Enter a valid 11-character IFSC code.');
export const phone = z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid phone number.');
