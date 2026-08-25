import { z } from 'zod';
import {
  MASTER_DEFINITIONS,
  getMasterDefinition,
  type MasterDefinition,
  type MasterField,
} from '../config/masters.js';
import * as masterModel from '../models/master.model.js';
import * as srHistoryModel from '../models/sr-history.model.js';
import type { AuthUser } from '../types/auth.js';
import { fromBps, toBps, toPaise, toRupees } from '../utils/money.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';

/** The master whose every change is kept on record. */
const SCHEDULE_OF_RATES = 'schedule-of-rates';

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

export function create(key: string, payload: unknown, user?: AuthUser) {
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
  const row = masterModel.findMasterRow(def, id)!;

  if (key === SCHEDULE_OF_RATES) recordRateCreated(row, user);

  return presentRow(def, row);
}

export function update(key: string, id: number, payload: unknown, user?: AuthUser) {
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
  const updated = masterModel.findMasterRow(def, id)!;

  if (key === SCHEDULE_OF_RATES) recordRateChange(existing, updated, user);

  return presentRow(def, updated);
}

/**
 * Masters are referenced by live records, so deletion relies on the database's
 * ON DELETE RESTRICT. A foreign-key failure is reported as a clear conflict
 * rather than a 500.
 */
export function remove(key: string, id: number, user?: AuthUser): void {
  const def = requireDefinition(key);
  const existing = masterModel.findMasterRow(def, id);
  if (!existing) throw notFound(def.singular);
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

  if (key === SCHEDULE_OF_RATES) recordRateDeleted(existing, user);
}

// --- Schedule of Rates history ---------------------------------------------

/**
 * The rate book is the one master whose past matters as much as its present:
 * an agreement priced against last year's rate and a bid refused against this
 * year's both have to be explicable long afterwards. So every movement is
 * written to `schedule_of_rate_history` alongside the change itself.
 */

function text(value: unknown): string | null {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function baseEntry(row: masterModel.MasterRow, user?: AuthUser) {
  return {
    sr_item_id: row.id,
    sr_code: String(row.code ?? ''),
    sr_name: String(row.name ?? ''),
    chapter: text(row.chapter),
    uom: text(row.uom),
    effective_date: text(row.effective_date),
    govt_reference: text(row.govt_reference),
    changed_by: user?.id ?? null,
    changed_by_name: user?.fullName ?? null,
  };
}

function recordRateCreated(row: masterModel.MasterRow, user?: AuthUser): void {
  srHistoryModel.insertEntry({
    ...baseEntry(row, user),
    change_kind: 'CREATED',
    old_rate: null,
    new_rate: Number(row.rate ?? 0),
    old_sr_year: null,
    new_sr_year: text(row.sr_year),
    old_status: null,
    new_status: text(row.status),
    remarks: 'Item added to the Schedule of Rates.',
  });
}

/**
 * One entry per edit, named for the most significant thing that moved. A rate
 * revision is what a report is read for, so it outranks an edition change,
 * which outranks a status change, which outranks a rename. An edit that touched
 * none of those — a corrected unit, say — is not worth an entry.
 */
function recordRateChange(
  before: masterModel.MasterRow,
  after: masterModel.MasterRow,
  user?: AuthUser,
): void {
  const oldRate = Number(before.rate ?? 0);
  const newRate = Number(after.rate ?? 0);
  const oldYear = text(before.sr_year);
  const newYear = text(after.sr_year);
  const oldStatus = text(before.status);
  const newStatus = text(after.status);

  const kind: srHistoryModel.ChangeKind | null =
    oldRate !== newRate ? 'RATE_REVISED'
    : oldYear !== newYear ? 'EDITION_CHANGED'
    : oldStatus !== newStatus ? 'STATUS_CHANGED'
    : before.name !== after.name ? 'RENAMED'
    : null;

  if (!kind) return;

  srHistoryModel.insertEntry({
    ...baseEntry(after, user),
    change_kind: kind,
    old_rate: oldRate,
    new_rate: newRate,
    old_sr_year: oldYear,
    new_sr_year: newYear,
    old_status: oldStatus,
    new_status: newStatus,
    remarks: kind === 'RENAMED' ? `Renamed from "${String(before.name ?? '')}".` : null,
  });
}

function recordRateDeleted(row: masterModel.MasterRow, user?: AuthUser): void {
  srHistoryModel.insertEntry({
    ...baseEntry(row, user),
    // The master row is gone, so the entry can no longer point at it.
    sr_item_id: null,
    change_kind: 'DELETED',
    old_rate: Number(row.rate ?? 0),
    new_rate: null,
    old_sr_year: text(row.sr_year),
    new_sr_year: null,
    old_status: text(row.status),
    new_status: null,
    remarks: 'Item removed from the Schedule of Rates.',
  });
}

export function presentHistoryEntry(row: srHistoryModel.SrHistoryRow) {
  const hasBoth = row.old_rate !== null && row.new_rate !== null;
  return {
    id: row.id,
    srItemId: row.sr_item_id,
    code: row.sr_code,
    name: row.sr_name,
    chapter: row.chapter,
    uom: row.uom,
    changeKind: row.change_kind,
    oldRate: row.old_rate === null ? null : toRupees(row.old_rate),
    newRate: row.new_rate === null ? null : toRupees(row.new_rate),
    changeAmount: hasBoth ? toRupees(row.new_rate! - row.old_rate!) : null,
    /** How far the rate moved, which is what a revision is read for. */
    changePercent:
      hasBoth && row.old_rate! > 0
        ? Math.round(((row.new_rate! - row.old_rate!) / row.old_rate!) * 10_000) / 100
        : null,
    oldSrYear: row.old_sr_year,
    newSrYear: row.new_sr_year,
    oldStatus: row.old_status,
    newStatus: row.new_status,
    effectiveDate: row.effective_date,
    govtReference: row.govt_reference,
    remarks: row.remarks,
    changedBy: row.changed_by_name,
    changedAt: row.created_at,
  };
}

/** Everything that has happened to one Schedule of Rates line. */
export function history(key: string, id: number) {
  const def = requireDefinition(key);
  if (key !== SCHEDULE_OF_RATES) {
    throw badRequest(`${def.label} does not keep a change history.`);
  }
  if (!masterModel.findMasterRow(def, id)) throw notFound(def.singular);
  return srHistoryModel.listForItem(id).map(presentHistoryEntry);
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
