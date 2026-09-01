import { ROLES } from '../config/constants.js';
import * as dashboardModel from '../models/dashboard.model.js';
import * as contractorModel from '../models/contractor.model.js';
import * as tenderModel from '../models/tender.model.js';
import * as raBillModel from '../models/ra-bill.model.js';
import * as packageModel from '../models/package.model.js';
import * as workflowModel from '../models/workflow.model.js';
import { hasGlobalScope } from '../middleware/auth.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { financialYear } from '../utils/codes.js';
import { toRupees } from '../utils/money.js';
import { forbidden } from '../utils/errors.js';

function inboxFilterFor(user: AuthUser, limit = 5) {
  return {
    userId: user.id,
    roleCode: user.roleCode,
    divisionId: user.divisionId,
    circleId: user.circleId,
    zoneId: user.zoneId,
    globalScope: hasGlobalScope(user.roleCode),
    limit,
    offset: 0,
  };
}

/**
 * The dashboard is assembled per role: a contractor sees their own work and
 * payments, departmental staff see their scope's portfolio, and senior roles
 * additionally get the division league table.
 */
export function getDashboard(user: AuthUser) {
  if (user.roleCode === ROLES.CONTRACTOR) return contractorDashboard(user);
  return staffDashboard(user);
}

/** How many complete months the dashboard's trend chart covers. */
const TREND_MONTHS = 18;

/**
 * Fills in the months the department raised nothing, and stops at the last
 * complete one.
 *
 * Two corrections, and without either the chart misreports. SQL returns only
 * the months that have rows, so a quiet month vanishes and the line is drawn
 * straight across it, showing steady work through a period when nothing
 * happened. And the month in progress is only ever partly counted — on the
 * first of the month it is nearly empty — so a reader sees a cliff at the
 * right-hand edge and reads it as a collapse in activity rather than as a
 * month that has barely started.
 */
function fillMonths(
  rows: { month: string; billCount: number; amount: number; paidAmount: number }[],
  months: number,
): { month: string; billCount: number; amount: number; paidAmount: number }[] {
  const byMonth = new Map(rows.map((row) => [row.month, row]));
  const now = new Date();
  const filled: typeof rows = [];

  for (let back = months; back >= 1; back -= 1) {
    const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const key = `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = byMonth.get(key);
    filled.push({
      month: key,
      billCount: row?.billCount ?? 0,
      amount: toRupees(row?.amount ?? 0),
      paidAmount: toRupees(row?.paidAmount ?? 0),
    });
  }
  return filled;
}

/** The ageing buckets, in order, so an empty one still holds its place. */
const AGEING_BUCKETS: { key: string; label: string }[] = [
  { key: '0-15', label: 'Up to 15 days' },
  { key: '16-30', label: '16 to 30 days' },
  { key: '31-60', label: '31 to 60 days' },
  { key: '60+', label: 'Over 60 days' },
];

/** Project statuses in the order a work passes through them. */
const PROJECT_STATUSES: { key: string; field: string; label: string }[] = [
  { key: 'DRAFT', field: 'draft', label: 'Draft' },
  { key: 'PENDING_SANCTION', field: 'pendingSanction', label: 'Awaiting sanction' },
  { key: 'SANCTIONED', field: 'sanctioned', label: 'Sanctioned' },
  { key: 'IN_PROGRESS', field: 'inProgress', label: 'In progress' },
  { key: 'COMPLETED', field: 'completed', label: 'Completed' },
];

/** Tender stages in the order a tender moves through them. */
const TENDER_STAGES: { key: string; field: string; label: string }[] = [
  { key: 'PENDING_APPROVAL', field: 'pendingApproval', label: 'Awaiting approval' },
  { key: 'PUBLISHED', field: 'published', label: 'Published' },
  { key: 'UNDER_EVALUATION', field: 'underEvaluation', label: 'Under evaluation' },
  { key: 'AWARDED', field: 'awarded', label: 'Awarded' },
];

/** Paid as a percentage of sanctioned, with nothing sanctioned reading as zero. */
function utilisationOf(paid: number, sanctioned: number): number {
  if (sanctioned <= 0) return 0;
  return Math.round((paid / sanctioned) * 100);
}

function staffDashboard(user: AuthUser) {
  const scope = scopeFilter(user);
  const fy = financialYear();

  const projects = dashboardModel.projectSummary(scope);
  const bills = dashboardModel.billSummary(scope);
  const misc = dashboardModel.miscBillSummary(scope);
  const tenders = dashboardModel.tenderSummary(scope);
  const funds = dashboardModel.fundPosition(scope, fy);
  const inbox = workflowModel.listInbox(inboxFilterFor(user));
  const pendingByType = workflowModel.countInboxByEntity(inboxFilterFor(user, 1));

  const isSenior = hasGlobalScope(user.roleCode) || user.roleCode === ROLES.SE;

  return {
    role: user.roleCode,
    financialYear: fy,
    cards: {
      projects: {
        total: projects.total ?? 0,
        inProgress: projects.inProgress ?? 0,
        pendingSanction: projects.pendingSanction ?? 0,
        completed: projects.completed ?? 0,
        sanctionedValue: toRupees(projects.sanctionedValue ?? 0),
      },
      raBills: {
        total: bills.total ?? 0,
        inApproval: bills.inApproval ?? 0,
        paid: bills.paid ?? 0,
        paidValue: toRupees(bills.paidValue ?? 0),
        pendingValue: toRupees(bills.pendingValue ?? 0),
      },
      miscBills: {
        total: misc.total ?? 0,
        inApproval: misc.inApproval ?? 0,
        paidValue: toRupees(misc.paidValue ?? 0),
        pendingValue: toRupees(misc.pendingValue ?? 0),
      },
      tenders: {
        total: tenders.total ?? 0,
        published: tenders.published ?? 0,
        underEvaluation: tenders.underEvaluation ?? 0,
        awarded: tenders.awarded ?? 0,
      },
      contractors: isSenior ? dashboardModel.contractorSummary() : null,
      funds: {
        released: toRupees(funds.released),
        locApproved: toRupees(funds.locApproved),
      },
    },
    myApprovals: {
      total: Object.values(pendingByType).reduce((sum, n) => sum + n, 0),
      byType: pendingByType,
      items: inbox.rows.map(presentInboxRow),
    },
    spendByScheme: dashboardModel.spendByScheme(scope).map((row) => ({
      ...row,
      sanctioned: toRupees(row.sanctioned),
      paid: toRupees(row.paid),
      utilisation: utilisationOf(row.paid, row.sanctioned),
    })),
    billTrend: fillMonths(dashboardModel.billTrend(scope, TREND_MONTHS + 1), TREND_MONTHS),
    billAgeing: (() => {
      const counted = new Map(
        dashboardModel.billAgeing(scope).map((row) => [row.bucket, row]),
      );
      return AGEING_BUCKETS.map((bucket) => ({
        key: bucket.key,
        label: bucket.label,
        count: counted.get(bucket.key)?.count ?? 0,
        amount: toRupees(counted.get(bucket.key)?.amount ?? 0),
      }));
    })(),
    // A status nothing sits in is left out rather than drawn as an empty slice.
    projectMix: PROJECT_STATUSES.map((status) => ({
      status: status.key,
      label: status.label,
      count: projects[status.field] ?? 0,
    })).filter((slice) => slice.count > 0),
    tenderPipeline: TENDER_STAGES.map((stage) => ({
      stage: stage.key,
      label: stage.label,
      count: tenders[stage.field] ?? 0,
    })),
    divisionPerformance: isSenior
      ? dashboardModel.divisionPerformance(scope).map((row) => ({
          ...row,
          sanctioned: toRupees(row.sanctioned),
          paid: toRupees(row.paid),
          utilisation: utilisationOf(row.paid, row.sanctioned),
        }))
      : [],
    overdueApprovals: dashboardModel.overdueApprovals(scope).map((row) => ({
      ...row,
      amount: toRupees(row.amount),
    })),
    recentActivity: isSenior ? dashboardModel.recentActivity() : [],
  };
}

function contractorDashboard(user: AuthUser) {
  if (!user.contractorId) throw forbidden('This account is not linked to a contractor.');

  const stats = contractorModel.getContractorStats(user.contractorId);
  const contractor = contractorModel.findById(user.contractorId);

  const openTenders = tenderModel.listTenders({
    statuses: ['PUBLISHED'],
    limit: 5,
    offset: 0,
  });
  const myBids = tenderModel.listBidsForContractor(user.contractorId, 5, 0);
  const myPackages = packageModel.listPackages({
    contractorId: user.contractorId,
    limit: 5,
    offset: 0,
  });
  const myBills = raBillModel.listRaBills({
    contractorId: user.contractorId,
    limit: 5,
    offset: 0,
  });

  return {
    role: user.roleCode,
    financialYear: financialYear(),
    registrationStatus: contractor?.registration_status ?? 'PENDING',
    cards: {
      packages: {
        active: stats.activePackages,
        completed: stats.completedPackages,
        awardedValue: toRupees(stats.awardedValue),
      },
      bills: {
        submitted: stats.billsSubmitted,
        paid: stats.billsPaid,
        amountPaid: toRupees(stats.amountPaid),
        amountPending: toRupees(stats.amountPending),
      },
      bids: {
        total: myBids.total,
        awarded: myBids.rows.filter((b) => b.status === 'AWARDED').length,
      },
    },
    openTenders: openTenders.rows.map((t) => ({
      id: t.id,
      tenderNo: t.tender_no,
      title: t.title,
      estimatedValue: toRupees(t.estimated_value),
      emdAmount: toRupees(t.emd_amount),
      bidEndAt: t.bid_end_at,
    })),
    myBids: myBids.rows.map((b) => ({
      id: b.id,
      bidNo: b.bid_no,
      tenderId: b.tender_id,
      tenderNo: b.tender_no,
      tenderTitle: b.tender_title,
      quotedAmount: toRupees(b.quoted_amount),
      status: b.status,
      rank: b.rank,
      submittedAt: b.submitted_at,
    })),
    myPackages: myPackages.rows.map((p) => ({
      id: p.id,
      packageCode: p.package_code,
      name: p.name,
      projectName: p.project_name,
      awardedValue: toRupees(p.awarded_value),
      physicalProgress: p.physical_progress_pct,
      status: p.status,
    })),
    myBills: myBills.rows.map((b) => ({
      id: b.id,
      billNo: b.bill_no,
      raSequence: b.ra_sequence,
      packageName: b.package_name,
      netPayableAmount: toRupees(b.net_payable_amount),
      status: b.status,
      createdAt: b.created_at,
    })),
  };
}

export function presentInboxRow(row: workflowModel.InboxRow) {
  return {
    instanceId: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    entityRef: row.entity_ref,
    title: row.title,
    amount: toRupees(row.amount),
    workflowName: row.definition_name,
    stepName: row.step_name,
    stepSeq: row.step_seq,
    status: row.status,
    divisionName: row.division_name,
    initiatedBy: row.initiator_name,
    dueAt: row.due_at,
    isOverdue: Boolean(row.due_at && row.due_at < new Date().toISOString().replace('T', ' ').slice(0, 19)),
    createdAt: row.created_at,
  };
}

export function getApprovalInbox(
  user: AuthUser,
  options: { entityType?: string; page: number; pageSize: number },
) {
  const { rows, total } = workflowModel.listInbox({
    ...inboxFilterFor(user, options.pageSize),
    entityType: options.entityType,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(presentInboxRow), total, page: options.page, pageSize: options.pageSize };
}

export function getMySubmissions(user: AuthUser, page: number, pageSize: number) {
  const { rows, total } = workflowModel.listInitiatedByUser(
    user.id,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map(presentInboxRow), total, page, pageSize };
}
