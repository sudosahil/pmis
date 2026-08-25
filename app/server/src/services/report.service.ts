import { z } from 'zod';
import * as reportModel from '../models/report.model.js';
import * as srHistoryModel from '../models/sr-history.model.js';
import { presentHistoryEntry } from './master.service.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { financialYear } from '../utils/codes.js';
import { badRequest, forbidden } from '../utils/errors.js';
import { fromQty, toRupees } from '../utils/money.js';
import { isoDate } from '../middleware/validate.js';

/**
 * The departmental reports — the MIS layer over everything the system records.
 *
 * Each report is a question the department already asks: who has billed what,
 * what is sitting unpaid and for how long, how far agreements sit from the
 * approved rates, how the rate book has moved, and where files are stuck. They
 * read the same rows the screens do, through the same scoping, so a division's
 * report can never show another division's work.
 */

export const REPORTS = [
  {
    key: 'contractor-bills',
    label: 'Contractor-wise bill submission',
    description:
      'Every contractor against what they have billed: bills raised, value claimed, what has been ' +
      'paid, what is still with the department, and how long payment has taken on average.',
    group: 'Bills and payments',
  },
  {
    key: 'bill-ageing',
    label: 'Ageing analysis of bills',
    description:
      'Bills still unpaid, bucketed by how long they have waited — and separately by how long they ' +
      'have sat at the desk they are on now, which is where the delay actually is.',
    group: 'Bills and payments',
  },
  {
    key: 'boq-analysis',
    label: 'BOQ analysis',
    description:
      'Each agreement read against the Schedule of Rates: what it was signed at, what the same work ' +
      'comes to at approved rates, and how much of it has been billed.',
    group: 'Procurement',
  },
  {
    key: 'sr-rates',
    label: 'SR rates analysis',
    description:
      'The rate book by chapter — spread of rates, editions in force, how heavily each rate is used ' +
      'in live agreements, and how often it has been revised.',
    group: 'Procurement',
  },
  {
    key: 'sr-rate-history',
    label: 'Change history of SR rates',
    description:
      'Every movement of every rate: what it was, what it became, when it took effect, under which ' +
      'circular, and who recorded it.',
    group: 'Procurement',
  },
  {
    key: 'approval-analysis',
    label: 'Approval analysis',
    description:
      'Where files are held and by whom, how long finished files actually took, and what each ' +
      'officer has approved, returned or rejected.',
    group: 'Administration',
  },
] as const;

export type ReportKey = (typeof REPORTS)[number]['key'];

const REPORT_KEYS = REPORTS.map((report) => report.key) as unknown as [string, ...string[]];

export const reportQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  financialYear: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Use the form 2026-27.').optional(),
  divisionId: z.coerce.number().int().positive().optional(),
  /** BOQ analysis: drill into the lines of one agreement. */
  packageId: z.coerce.number().int().positive().optional(),
  /** SR analysis: narrow to one chapter of the rate book. */
  chapter: z.string().trim().max(120).optional(),
  /** Rate history: narrow to one kind of change. */
  changeKind: z.enum(srHistoryModel.CHANGE_KINDS).optional(),
  search: z.string().trim().max(120).optional(),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

// --- Scope -------------------------------------------------------------------

/**
 * A contractor has no business in the departmental reports — their own position
 * is on their dashboard, and these aggregate across firms.
 */
function resolveScope(user: AuthUser, query: ReportQuery): reportModel.ScopeParams {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined) {
    throw forbidden('The departmental reports are not available to contractor accounts.');
  }

  // An explicit division filter narrows, but only inside what the reader may
  // already see: asking for another division's report must not widen anything.
  if (query.divisionId) {
    if (scope.divisionId && query.divisionId !== scope.divisionId) {
      throw forbidden('That division is outside your jurisdiction.');
    }
    return { divisionId: query.divisionId };
  }
  return { divisionId: scope.divisionId, circleId: scope.circleId, zoneId: scope.zoneId };
}

function period(query: ReportQuery): reportModel.PeriodParams {
  if (query.from && query.to && query.to < query.from) {
    throw badRequest('The closing date cannot be before the opening date.');
  }
  return { from: query.from, to: query.to, financialYear: query.financialYear };
}

function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 10_000) / 100 : null;
}

function round(value: number | null | undefined, digits = 1): number | null {
  if (value === null || value === undefined) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// --- 1. Contractor-wise bill submission --------------------------------------

function contractorBills(user: AuthUser, query: ReportQuery) {
  const rows = reportModel.contractorBills(resolveScope(user, query), period(query));

  const items = rows.map((row) => ({
    contractorId: row.contractor_id,
    code: row.contractor_code,
    name: row.contractor_name,
    registrationClass: row.registration_class,
    isBlacklisted: Boolean(row.is_blacklisted),
    packageCount: row.package_count,
    awardedValue: toRupees(row.awarded_value),
    billCount: row.bill_count,
    claimedAmount: toRupees(row.claimed_amount),
    netPayable: toRupees(row.net_payable),
    paidCount: row.paid_count,
    paidAmount: toRupees(row.paid_amount),
    inApprovalCount: row.in_approval_count,
    pendingAmount: toRupees(row.pending_amount),
    rejectedCount: row.rejected_count,
    firstBillDate: row.first_bill_date,
    lastBillDate: row.last_bill_date,
    avgDaysToPay: round(row.avg_days_to_pay),
    /** What proportion of the value billed has actually been paid out. */
    settlementPercent: percentOf(row.paid_amount, row.net_payable),
  }));

  return {
    columns: [
      { key: 'name', label: 'Contractor' },
      { key: 'billCount', label: 'Bills', numeric: true },
      { key: 'netPayable', label: 'Value billed', numeric: true, money: true },
      { key: 'paidAmount', label: 'Paid', numeric: true, money: true },
      { key: 'pendingAmount', label: 'Pending', numeric: true, money: true },
      { key: 'settlementPercent', label: 'Settled', numeric: true, percent: true },
      { key: 'avgDaysToPay', label: 'Avg days to pay', numeric: true },
    ],
    items,
    totals: {
      contractors: items.length,
      bills: items.reduce((sum, row) => sum + row.billCount, 0),
      billed: items.reduce((sum, row) => sum + row.netPayable, 0),
      paid: items.reduce((sum, row) => sum + row.paidAmount, 0),
      pending: items.reduce((sum, row) => sum + row.pendingAmount, 0),
    },
  };
}

// --- 2. Ageing analysis of bills ---------------------------------------------

/**
 * The buckets a treasury register is ruled into. A bill crossing 90 days is the
 * one an officer is asked about, so it gets its own open-ended column.
 */
const AGEING_BUCKETS = [
  { key: '0-15', label: '0–15 days', upto: 15 },
  { key: '16-30', label: '16–30 days', upto: 30 },
  { key: '31-60', label: '31–60 days', upto: 60 },
  { key: '61-90', label: '61–90 days', upto: 90 },
  { key: '90+', label: 'Over 90 days', upto: Number.POSITIVE_INFINITY },
] as const;

function bucketFor(days: number): string {
  return (AGEING_BUCKETS.find((bucket) => days <= bucket.upto) ?? AGEING_BUCKETS.at(-1)!).key;
}

function billAgeing(user: AuthUser, query: ReportQuery) {
  const rows = reportModel.billAgeing(resolveScope(user, query), period(query));

  const items = rows.map((row) => ({
    kind: row.kind,
    id: row.id,
    billNo: row.bill_no,
    reference: row.reference,
    payee: row.payee,
    division: { code: row.division_code, name: row.division_name },
    status: row.status,
    amount: toRupees(row.amount),
    raisedOn: row.raised_on,
    daysPending: row.days_pending,
    daysAtStage: row.days_at_stage,
    bucket: bucketFor(row.days_pending),
    currentStage: row.current_stage,
    pendingWith: row.pending_with_name ?? row.pending_with_role,
    dueAt: row.due_at,
    isOverdue: Boolean(row.is_overdue),
    /** Where a bill opens when the row is clicked. */
    link: row.kind === 'RA' ? `/ra-bills/${row.id}` : `/misc-bills/${row.id}`,
  }));

  const buckets = AGEING_BUCKETS.map((bucket) => {
    const inBucket = items.filter((item) => item.bucket === bucket.key);
    return {
      key: bucket.key,
      label: bucket.label,
      count: inBucket.length,
      amount: inBucket.reduce((sum, item) => sum + item.amount, 0),
    };
  });

  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return {
    columns: [
      { key: 'billNo', label: 'Bill' },
      { key: 'payee', label: 'Payee' },
      { key: 'amount', label: 'Amount', numeric: true, money: true },
      { key: 'raisedOn', label: 'Raised', date: true },
      { key: 'daysPending', label: 'Days waiting', numeric: true },
      { key: 'daysAtStage', label: 'Days at stage', numeric: true },
      { key: 'currentStage', label: 'Stage' },
      { key: 'pendingWith', label: 'Pending with' },
    ],
    items,
    buckets,
    totals: {
      bills: items.length,
      amount: total,
      overdue: items.filter((item) => item.isOverdue).length,
      beyond90: buckets.at(-1)!.count,
      oldestDays: items.length ? Math.max(...items.map((item) => item.daysPending)) : 0,
    },
  };
}

// --- 3. BOQ analysis ----------------------------------------------------------

function boqAnalysis(user: AuthUser, query: ReportQuery) {
  const rows = reportModel.boqAnalysis(resolveScope(user, query));

  const items = rows.map((row) => ({
    packageId: row.package_id,
    packageCode: row.package_code,
    packageName: row.package_name,
    projectCode: row.project_code,
    projectName: row.project_name,
    divisionCode: row.division_code,
    contractorName: row.contractor_name,
    itemCount: row.item_count,
    matchedCount: row.matched_count,
    aboveSrCount: row.above_sr_count,
    agreementValue: toRupees(row.agreement_value),
    srValue: toRupees(row.sr_value),
    billedValue: toRupees(row.billed_value),
    /** How far the agreement sits above or below the approved rates. */
    variancePercent: percentOf(row.agreement_value - row.sr_value, row.sr_value),
    varianceAmount: toRupees(row.agreement_value - row.sr_value),
    /** What proportion of the rate book the agreement could be matched to. */
    matchedPercent: percentOf(row.matched_count, row.item_count),
    billedPercent: percentOf(row.billed_value, row.agreement_value),
    link: `/packages/${row.package_id}`,
  }));

  const agreementTotal = items.reduce((sum, row) => sum + row.agreementValue, 0);
  const srTotal = items.reduce((sum, row) => sum + row.srValue, 0);

  // The drill-down: the lines of one agreement, when the caller asked for one.
  const lines = query.packageId
    ? reportModel.boqAnalysisItems(query.packageId).map((row) => ({
        id: row.id,
        slNo: row.sl_no,
        itemCode: row.item_code,
        srCode: row.sr_code,
        description: row.description,
        uom: row.uom,
        quantity: fromQty(row.quantity),
        agreedRate: toRupees(row.agreed_rate),
        srRate: row.sr_rate > 0 ? toRupees(row.sr_rate) : null,
        amount: toRupees(row.amount),
        variancePercent:
          row.sr_rate > 0
            ? Math.round(((row.agreed_rate - row.sr_rate) / row.sr_rate) * 10_000) / 100
            : null,
      }))
    : [];

  return {
    columns: [
      { key: 'packageCode', label: 'Package' },
      { key: 'contractorName', label: 'Contractor' },
      { key: 'itemCount', label: 'Items', numeric: true },
      { key: 'agreementValue', label: 'Agreement', numeric: true, money: true },
      { key: 'srValue', label: 'At SR rates', numeric: true, money: true },
      { key: 'variancePercent', label: 'Variance', numeric: true, percent: true },
      { key: 'aboveSrCount', label: 'Lines above SR', numeric: true },
      { key: 'billedPercent', label: 'Billed', numeric: true, percent: true },
    ],
    items,
    lines,
    totals: {
      packages: items.length,
      items: items.reduce((sum, row) => sum + row.itemCount, 0),
      linesAboveSr: items.reduce((sum, row) => sum + row.aboveSrCount, 0),
      agreementValue: agreementTotal,
      srValue: srTotal,
      varianceAmount: agreementTotal - srTotal,
      variancePercent: percentOf(agreementTotal - srTotal, srTotal),
      billedValue: items.reduce((sum, row) => sum + row.billedValue, 0),
    },
  };
}

// --- 4. Schedule of Rates analysis --------------------------------------------

function srRates(user: AuthUser, query: ReportQuery) {
  // The rate book is departmental, not divisional — but the caller still has to
  // hold the report permission, and a contractor is refused here as elsewhere.
  resolveScope(user, query);

  const chapters = reportModel.srRatesByChapter().map((row) => ({
    chapter: row.chapter ?? 'Unclassified',
    itemCount: row.item_count,
    activeCount: row.active_count,
    minRate: toRupees(row.min_rate),
    maxRate: toRupees(row.max_rate),
    avgRate: toRupees(row.avg_rate),
    editionCount: row.edition_count,
    usageCount: row.usage_count,
    revisionCount: row.revision_count,
    lastRevisedOn: row.last_revised_on,
  }));

  const items = reportModel.srRateUsage(query.chapter).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    chapter: row.chapter,
    uom: row.uom,
    rate: toRupees(row.rate),
    srYear: row.sr_year,
    status: row.status,
    effectiveDate: row.effective_date,
    govtReference: row.govt_reference,
    agreementLines: row.agreement_lines,
    aboveCount: row.above_count,
    belowCount: row.below_count,
    agreementValue: toRupees(row.agreement_value),
    srValue: toRupees(row.sr_value),
    variancePercent: percentOf(row.agreement_value - row.sr_value, row.sr_value),
    revisionCount: row.revision_count,
    lastRevisedOn: row.last_revised_on,
  }));

  const filtered = query.search
    ? items.filter((item) =>
        `${item.code} ${item.name}`.toLowerCase().includes(query.search!.toLowerCase()),
      )
    : items;

  return {
    columns: [
      { key: 'code', label: 'SR item' },
      { key: 'name', label: 'Item of work' },
      { key: 'uom', label: 'Unit' },
      { key: 'rate', label: 'Rate', numeric: true, money: true },
      { key: 'srYear', label: 'Edition' },
      { key: 'agreementLines', label: 'Used in', numeric: true },
      { key: 'variancePercent', label: 'Agreements vs SR', numeric: true, percent: true },
      { key: 'revisionCount', label: 'Revisions', numeric: true },
    ],
    items: filtered,
    chapters,
    totals: {
      items: items.length,
      chapters: chapters.length,
      active: items.filter((item) => item.status === 'ACTIVE').length,
      inUse: items.filter((item) => item.agreementLines > 0).length,
      revised: items.filter((item) => item.revisionCount > 0).length,
    },
  };
}

// --- 5. Change history of SR rates -------------------------------------------

function srRateHistory(user: AuthUser, query: ReportQuery) {
  resolveScope(user, query);

  const { rows, total } = srHistoryModel.listHistory({
    chapter: query.chapter,
    changeKind: query.changeKind,
    search: query.search,
    from: query.from,
    to: query.to,
    limit: 1000,
    offset: 0,
  });

  const items = rows.map(presentHistoryEntry);
  const revisions = items.filter((item) => item.changeKind === 'RATE_REVISED');
  const increases = revisions.filter((item) => (item.changeAmount ?? 0) > 0);

  return {
    columns: [
      { key: 'code', label: 'SR item' },
      { key: 'name', label: 'Item of work' },
      { key: 'changeKind', label: 'Change' },
      { key: 'oldRate', label: 'Was', numeric: true, money: true },
      { key: 'newRate', label: 'Now', numeric: true, money: true },
      { key: 'changePercent', label: 'Movement', numeric: true, percent: true },
      { key: 'effectiveDate', label: 'Effective', date: true },
      { key: 'govtReference', label: 'Authority' },
      { key: 'changedBy', label: 'Recorded by' },
    ],
    items,
    totals: {
      entries: total,
      revisions: revisions.length,
      increases: increases.length,
      decreases: revisions.length - increases.length,
      /** The mean movement across revisions, which is the headline figure. */
      averageMovement: revisions.length
        ? round(
            revisions.reduce((sum, item) => sum + (item.changePercent ?? 0), 0) / revisions.length,
            2,
          )
        : null,
    },
  };
}

// --- 6. Approval analysis -----------------------------------------------------

function approvalAnalysis(user: AuthUser, query: ReportQuery) {
  const scope = resolveScope(user, query);
  const periodParams = period(query);

  const items = reportModel.pendency(scope).map((row) => ({
    roleCode: row.role_code,
    roleName: row.role_name ?? row.role_code,
    entityType: row.entity_type,
    stepName: row.step_name,
    fileCount: row.file_count,
    valueHeld: toRupees(row.value_held),
    avgDaysPending: round(row.avg_days_pending),
    oldestDays: round(row.oldest_days, 0),
    overdueCount: row.overdue_count,
  }));

  const turnaround = reportModel.turnaround(scope, periodParams).map((row) => ({
    entityType: row.entity_type,
    completedCount: row.completed_count,
    approvedCount: row.approved_count,
    rejectedCount: row.rejected_count,
    avgDays: round(row.avg_days),
    fastestDays: round(row.fastest_days),
    slowestDays: round(row.slowest_days),
    approvalRate: percentOf(row.approved_count, row.completed_count),
  }));

  const officers = reportModel.officerActions(scope, periodParams).map((row) => ({
    userId: row.user_id,
    name: row.actor_name,
    role: row.actor_role,
    approved: row.approved,
    returned: row.returned,
    rejected: row.rejected,
    totalActions: row.total_actions,
    pendingNow: row.pending_now,
    /** How often this officer sends a file back rather than passing it on. */
    returnRate: percentOf(row.returned + row.rejected, row.total_actions),
  }));

  return {
    columns: [
      { key: 'roleName', label: 'Pending with' },
      { key: 'stepName', label: 'Stage' },
      { key: 'entityType', label: 'Record type' },
      { key: 'fileCount', label: 'Files', numeric: true },
      { key: 'valueHeld', label: 'Value held', numeric: true, money: true },
      { key: 'avgDaysPending', label: 'Avg days waiting', numeric: true },
      { key: 'oldestDays', label: 'Oldest', numeric: true },
      { key: 'overdueCount', label: 'Overdue', numeric: true },
    ],
    items,
    turnaround,
    officers,
    totals: {
      filesPending: items.reduce((sum, row) => sum + row.fileCount, 0),
      valueHeld: items.reduce((sum, row) => sum + row.valueHeld, 0),
      overdue: items.reduce((sum, row) => sum + row.overdueCount, 0),
      oldestDays: items.reduce((max, row) => Math.max(max, row.oldestDays ?? 0), 0),
      completed: turnaround.reduce((sum, row) => sum + row.completedCount, 0),
    },
  };
}

// --- The catalogue -----------------------------------------------------------

const RUNNERS: Record<string, (user: AuthUser, query: ReportQuery) => unknown> = {
  'contractor-bills': contractorBills,
  'bill-ageing': billAgeing,
  'boq-analysis': boqAnalysis,
  'sr-rates': srRates,
  'sr-rate-history': srRateHistory,
  'approval-analysis': approvalAnalysis,
};

export const reportKeySchema = z.enum(REPORT_KEYS);

/** The reports a reader may open, and the filters they can be narrowed by. */
export function catalogue(user: AuthUser) {
  const scope = scopeFilter(user);
  if (scope.contractorId !== undefined) {
    throw forbidden('The departmental reports are not available to contractor accounts.');
  }

  return {
    reports: REPORTS.map((report) => ({ ...report })),
    financialYear: financialYear(),
    divisions: reportModel.divisionsInScope(scope),
    changeKinds: srHistoryModel.CHANGE_KINDS,
    ageingBuckets: AGEING_BUCKETS.map((bucket) => ({ key: bucket.key, label: bucket.label })),
  };
}

export function run(key: string, user: AuthUser, query: ReportQuery) {
  const definition = REPORTS.find((report) => report.key === key);
  const runner = RUNNERS[key];
  if (!definition || !runner) throw badRequest(`There is no report called "${key}".`);

  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    generatedAt: new Date().toISOString(),
    filters: {
      from: query.from ?? null,
      to: query.to ?? null,
      financialYear: query.financialYear ?? null,
      divisionId: query.divisionId ?? null,
      chapter: query.chapter ?? null,
      changeKind: query.changeKind ?? null,
      packageId: query.packageId ?? null,
      search: query.search ?? null,
    },
    ...(runner(user, query) as object),
  };
}
