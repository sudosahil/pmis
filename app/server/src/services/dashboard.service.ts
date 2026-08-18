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
      utilisation: row.sanctioned > 0 ? Math.round((row.paid / row.sanctioned) * 100) : 0,
    })),
    billTrend: dashboardModel.billTrend(scope).map((row) => ({
      ...row,
      amount: toRupees(row.amount),
      paidAmount: toRupees(row.paidAmount),
    })),
    divisionPerformance: isSenior
      ? dashboardModel.divisionPerformance(scope).map((row) => ({
          ...row,
          sanctioned: toRupees(row.sanctioned),
          paid: toRupees(row.paid),
          utilisation: row.sanctioned > 0 ? Math.round((row.paid / row.sanctioned) * 100) : 0,
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
