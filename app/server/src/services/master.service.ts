import { z } from 'zod';
import {
  MASTER_DEFINITIONS,
  getMasterDefinition,
  type MasterDefinition,
  type MasterField,
} from '../config/masters.js';
import * as masterModel from '../models/master.model.js';
import { fromBps, toBps, toPaise, toRupees } from '../utils/money.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

/** Builds a zod schema from a master definition so validation follows the metadata. */
function fieldSchema(field: MasterField): z.ZodTypeAny {
  switch (field.type) {
    case 'number':
      return z.coerce.number().int();
    case 'money':
      return z.union([z.number(), z.string()]).transform((v, ctx) => {
        try {
          return toPaise(v);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid amount.' });
          return z.NEVER;
        }
      });
    case 'percent':
      return z.union([z.number(), z.string()]).transform((v, ctx) => {
        try {
          return toBps(v);
        } catch {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid percentage.' });
          return z.NEVER;
        }
      });
    case 'date':
      return z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date format YYYY-MM-DD.');
    case 'lookup':
      return z.coerce.number().int().positive();
    case 'boolean':
      return z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));
    case 'select':
      return field.options?.length
        ? z.enum(field.options as [string, ...string[]])
        : z.string().trim();
    case 'textarea':
      return z.string().trim().max(2000);
    default:
      return z.string().trim().max(field.maxLength ?? 255);
  }
}

export function buildMasterSchema(def: MasterDefinition, partial: boolean): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of def.fields) {
    const base = fieldSchema(field);
    shape[field.column] = field.required && !partial ? base : base.optional().nullable();
  }
  const object = z.object(shape).strict();
  return partial ? object.partial() : object;
}

/** Converts stored values back to the units the client works in. */
function presentRow(def: MasterDefinition, row: masterModel.MasterRow): Record<string, unknown> {
  const output: Record<string, unknown> = { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at };
  for (const field of def.fields) {
    const value = row[field.column];
    if (field.type === 'money') output[field.column] = toRupees(Number(value ?? 0));
    else if (field.type === 'percent') output[field.column] = fromBps(Number(value ?? 0));
    else if (field.type === 'boolean') output[field.column] = Boolean(value);
    else output[field.column] = value ?? null;

    if (field.type === 'lookup') {
      output[`${field.column}__label`] = row[`${field.column}__label`] ?? null;
      output[`${field.column}__code`] = row[`${field.column}__code`] ?? null;
    }
  }
  return output;
}

export function listDefinitions() {
  return MASTER_DEFINITIONS.map((def) => ({
    key: def.key,
    label: def.label,
    singular: def.singular,
    group: def.group,
    description: def.description,
    fields: def.fields,
  }));
}

export function requireDefinition(key: string): MasterDefinition {
  const def = getMasterDefinition(key);
  if (!def) throw notFound(`Master "${key}"`);
  return def;
}

export function list(
  key: string,
  options: { search?: string; status?: string; page: number; pageSize: number },
) {
  const def = requireDefinition(key);
  const { rows, total } = masterModel.listMasterRows(def, {
    search: options.search,
    status: options.status,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return {
    items: rows.map((row) => presentRow(def, row)),
    total,
    page: options.page,
    pageSize: options.pageSize,
  };
}

export function getOne(key: string, id: number) {
  const def = requireDefinition(key);
  const row = masterModel.findMasterRow(def, id);
  if (!row) throw notFound(def.singular);
  return presentRow(def, row);
}

export function create(key: string, payload: unknown) {
  const def = requireDefinition(key);
  const parsed = buildMasterSchema(def, false).safeParse(payload);
  if (!parsed.success) {
    throw badRequest('Some fields need attention.', formatIssues(parsed.error));
  }
  const values = parsed.data as Record<string, unknown>;

  if (typeof values.code === 'string' && masterModel.findMasterRowByCode(def, values.code)) {
    throw conflict(`A ${def.singular.toLowerCase()} with code "${values.code}" already exists.`);
  }

  const id = masterModel.insertMasterRow(def, values);
  return presentRow(def, masterModel.findMasterRow(def, id)!);
}

export function update(key: string, id: number, payload: unknown) {
  const def = requireDefinition(key);
  const existing = masterModel.findMasterRow(def, id);
  if (!existing) throw notFound(def.singular);

  const parsed = buildMasterSchema(def, true).safeParse(payload);
  if (!parsed.success) {
    throw badRequest('Some fields need attention.', formatIssues(parsed.error));
  }
  const values = parsed.data as Record<string, unknown>;

  if (typeof values.code === 'string' && values.code !== existing.code) {
    const clash = masterModel.findMasterRowByCode(def, values.code);
    if (clash && clash.id !== id) {
      throw conflict(`A ${def.singular.toLowerCase()} with code "${values.code}" already exists.`);
    }
  }

  masterModel.updateMasterRow(def, id, values);
  return presentRow(def, masterModel.findMasterRow(def, id)!);
}

/**
 * Masters are referenced by live records, so deletion relies on the database's
 * ON DELETE RESTRICT. A foreign-key failure is reported as a clear conflict
 * rather than a 500.
 */
export function remove(key: string, id: number): void {
  const def = requireDefinition(key);
  if (!masterModel.findMasterRow(def, id)) throw notFound(def.singular);
  try {
    masterModel.deleteMasterRow(def, id);
  } catch (error) {
    if (error instanceof Error && error.message.includes('FOREIGN KEY')) {
      throw conflict(
        `This ${def.singular.toLowerCase()} is in use and cannot be deleted. Set its status to Inactive instead.`,
      );
    }
    throw error;
  }
}

export function options(key: string, parentId?: number) {
  const def = requireDefinition(key);
  return masterModel.listMasterOptions(def, parentId);
}

function formatIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}
