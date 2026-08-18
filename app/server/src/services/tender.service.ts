import { z } from 'zod';
import {
  ENTITY_TYPES,
  PACKAGE_STATUS,
  ROLES,
  TENDER_STATUS,
  WORKFLOWS,
} from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as tenderModel from '../models/tender.model.js';
import * as projectModel from '../models/project.model.js';
import * as packageModel from '../models/package.model.js';
import * as contractorModel from '../models/contractor.model.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { insertManyNotifications } from '../models/notification.model.js';
import { scopeFilter } from './project.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import {
  financialYear,
  generateBidNo,
  generateLoaNo,
  generateTenderNo,
  generateWorkOrderNo,
} from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { fromBps, fromQty, lineAmount, toRupees } from '../utils/money.js';
import { quantity, rupees } from '../middleware/validate.js';

const dateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/, 'Use the format YYYY-MM-DD HH:MM.')
  .transform((v) => v.replace('T', ' ').slice(0, 19).padEnd(19, ':00').slice(0, 19));

export const boqItemSchema = z.object({
  slNo: z.coerce.number().int().min(1).optional(),
  itemCode: z.string().trim().max(40).optional(),
  description: z.string().trim().min(3, 'Describe the item.').max(500),
  uom: z.string().trim().min(1).max(20),
  quantity,
  estimatedRate: rupees,
});

export const createTenderSchema = z.object({
  title: z.string().trim().min(5, 'Enter a tender title.').max(250),
  description: z.string().trim().max(4000).optional(),
  projectId: z.coerce.number().int().positive(),
  packageId: z.coerce.number().int().positive().optional(),
  tenderType: z.enum(['OPEN', 'LIMITED', 'EOI', 'GEM', 'SINGLE']).default('OPEN'),
  bidType: z.enum(['ITEM_RATE', 'PERCENTAGE', 'LUMPSUM']).default('ITEM_RATE'),
  estimatedValue: rupees,
  emdAmount: rupees.optional(),
  tenderFee: rupees.optional(),
  completionPeriodDays: z.coerce.number().int().min(1).max(3650).default(180),
  minRegistrationClass: z.enum(['Class A', 'Class B', 'Class C', 'Class D']).optional(),
  eligibilityCriteria: z.string().trim().max(4000).optional(),
  bidStartAt: dateTime.optional(),
  bidEndAt: dateTime.optional(),
  technicalOpenAt: dateTime.optional(),
  financialOpenAt: dateTime.optional(),
  boqItems: z.array(boqItemSchema).max(500).optional(),
});

export const updateTenderSchema = createTenderSchema.partial().omit({ projectId: true });

export const submitBidSchema = z.object({
  emdReference: z.string().trim().min(3, 'Enter the EMD payment reference.').max(80),
  /** Item-rate bids price each BOQ line; percentage/lumpsum bids quote a single figure. */
  items: z
    .array(z.object({ boqItemId: z.coerce.number().int().positive(), quotedRate: rupees }))
    .max(500)
    .optional(),
  quotedAmount: rupees.optional(),
});

export const technicalEvaluationSchema = z.object({
  evaluations: z
    .array(
      z.object({
        bidId: z.coerce.number().int().positive(),
        technicalStatus: z.enum(['QUALIFIED', 'DISQUALIFIED']),
        technicalScore: z.coerce.number().int().min(0).max(100).optional(),
        remarks: z.string().trim().max(1000).optional(),
      }),
    )
    .min(1),
});

export const awardSchema = z.object({
  bidId: z.coerce.number().int().positive(),
  negotiatedValue: rupees.optional(),
  remarks: z.string().trim().max(1000).optional(),
});

// --- Presentation ----------------------------------------------------------

function nowStamp(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function present(row: tenderModel.TenderDetailRow) {
  return {
    id: row.id,
    tenderNo: row.tender_no,
    title: row.title,
    description: row.description,
    project: { id: row.project_id, code: row.project_code, name: row.project_name },
    packageId: row.package_id,
    packageCode: row.package_code,
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    tenderType: row.tender_type,
    bidType: row.bid_type,
    estimatedValue: toRupees(row.estimated_value),
    emdAmount: toRupees(row.emd_amount),
    tenderFee: toRupees(row.tender_fee),
    completionPeriodDays: row.completion_period_days,
    minRegistrationClass: row.min_registration_class,
    eligibilityCriteria: row.eligibility_criteria,
    publishDate: row.publish_date,
    bidStartAt: row.bid_start_at,
    bidEndAt: row.bid_end_at,
    technicalOpenAt: row.technical_open_at,
    financialOpenAt: row.financial_open_at,
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    bidCount: row.bid_count,
    submittedBidCount: row.submitted_bid_count,
    isBiddingOpen:
      row.status === TENDER_STATUS.PUBLISHED &&
      (!row.bid_start_at || row.bid_start_at <= nowStamp()) &&
      (!row.bid_end_at || row.bid_end_at >= nowStamp()),
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

function presentBoq(item: tenderModel.BoqItemRow) {
  return {
    id: item.id,
    slNo: item.sl_no,
    itemCode: item.item_code,
    description: item.description,
    uom: item.uom,
    quantity: fromQty(item.quantity),
    estimatedRate: toRupees(item.estimated_rate),
    estimatedAmount: toRupees(lineAmount(item.quantity, item.estimated_rate)),
  };
}

/**
 * Financial figures stay hidden until the tender reaches financial evaluation,
 * which is what keeps a two-envelope process meaningful.
 */
function presentBid(row: tenderModel.BidDetailRow, revealFinancials: boolean) {
  return {
    id: row.id,
    bidNo: row.bid_no,
    tenderId: row.tender_id,
    tenderNo: row.tender_no,
    tenderTitle: row.tender_title,
    tenderStatus: row.tender_status,
    contractor: {
      id: row.contractor_id,
      code: row.contractor_code,
      name: row.contractor_name,
      registrationClass: row.contractor_class,
    },
    emdReference: row.emd_reference,
    emdPaid: toRupees(row.emd_paid),
    technicalScore: row.technical_score,
    technicalStatus: row.technical_status,
    technicalRemarks: row.technical_remarks,
    financialStatus: row.financial_status,
    rank: revealFinancials ? row.rank : null,
    status: row.status,
    submittedAt: row.submitted_at,
    quotedAmount: revealFinancials ? toRupees(row.quoted_amount) : null,
    variation: revealFinancials ? fromBps(row.variation_bps) : null,
    financialsSealed: !revealFinancials,
  };
}

const FINANCIALS_VISIBLE = new Set<string>([
  TENDER_STATUS.FINANCIAL_EVALUATION,
  TENDER_STATUS.AWARDED,
]);

// --- Reading ---------------------------------------------------------------

export function list(
  user: AuthUser,
  options: { search?: string; status?: string; projectId?: number; page: number; pageSize: number },
) {
  const scope = scopeFilter(user);
  const isContractor = user.roleCode === ROLES.CONTRACTOR;

  const { rows, total } = tenderModel.listTenders({
    search: options.search,
    status: options.status,
    // Contractors browse the public notice board: only live tenders are listed.
    statuses:
      isContractor && !options.status
        ? [
            TENDER_STATUS.PUBLISHED,
            TENDER_STATUS.BIDDING_CLOSED,
            TENDER_STATUS.TECHNICAL_EVALUATION,
            TENDER_STATUS.FINANCIAL_EVALUATION,
            TENDER_STATUS.AWARDED,
          ]
        : undefined,
    projectId: options.projectId,
    divisionId: isContractor ? undefined : scope.divisionId,
    circleId: isContractor ? undefined : scope.circleId,
    zoneId: isContractor ? undefined : scope.zoneId,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });

  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

function assertTenderVisible(row: tenderModel.TenderDetailRow, user: AuthUser): void {
  if (user.roleCode === ROLES.CONTRACTOR) {
    const publicStatuses: string[] = [
      TENDER_STATUS.PUBLISHED,
      TENDER_STATUS.BIDDING_CLOSED,
      TENDER_STATUS.TECHNICAL_EVALUATION,
      TENDER_STATUS.FINANCIAL_EVALUATION,
      TENDER_STATUS.AWARDED,
    ];
    if (!publicStatuses.includes(row.status)) throw notFound('Tender');
    return;
  }
  const scope = scopeFilter(user);
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This tender belongs to another division.');
  }
  if (scope.circleId && row.circle_id !== scope.circleId) {
    throw forbidden('This tender belongs to another circle.');
  }
  if (scope.zoneId && row.zone_id !== scope.zoneId) {
    throw forbidden('This tender belongs to another zone.');
  }
}

export function getOne(id: number, user: AuthUser) {
  const row = tenderModel.findById(id);
  if (!row) throw notFound('Tender');
  assertTenderVisible(row, user);

  const isContractor = user.roleCode === ROLES.CONTRACTOR;
  const reveal = FINANCIALS_VISIBLE.has(row.status);
  const award = tenderModel.findAwardByTender(id);

  // A contractor sees only their own bid; departmental users see the full list.
  const bids = isContractor
    ? [tenderModel.findBidByTenderAndContractor(id, user.contractorId ?? -1)].filter(
        (b): b is tenderModel.BidDetailRow => Boolean(b),
      )
    : tenderModel.listBidsForTender(id);

  return {
    ...present(row),
    boqItems: tenderModel.listBoqItems(id).map(presentBoq),
    bids: bids.map((b) => presentBid(b, reveal || (isContractor && b.status !== 'DRAFT'))),
    award: award
      ? {
          id: award.id,
          loaNo: award.loa_no,
          loaDate: award.loa_date,
          awardedValue: toRupees(award.awarded_value),
          negotiatedValue: award.negotiated_value == null ? null : toRupees(award.negotiated_value),
          contractor: { id: award.contractor_id, code: award.contractor_code, name: award.contractor_name },
          awardedBy: award.awarded_by_name,
          remarks: award.remarks,
        }
      : null,
  };
}

// --- Authoring -------------------------------------------------------------

function assertEditable(row: tenderModel.TenderDetailRow): void {
  const editable: string[] = [TENDER_STATUS.DRAFT, TENDER_STATUS.REJECTED];
  if (!editable.includes(row.status)) {
    throw conflict('A tender can only be edited while it is a draft.');
  }
}

export function create(input: z.infer<typeof createTenderSchema>, user: AuthUser) {
  return transaction(() => {
    const project = projectModel.findById(input.projectId);
    if (!project) throw notFound('Project');

    if (input.packageId) {
      const pkg = packageModel.findById(input.packageId);
      if (!pkg) throw badRequest('Select a valid package.');
      if (pkg.project_id !== input.projectId) {
        throw badRequest('That package does not belong to the selected project.');
      }
    }

    if (input.bidStartAt && input.bidEndAt && input.bidEndAt <= input.bidStartAt) {
      throw badRequest('The bid closing time must be after the opening time.');
    }

    const tenderNo = generateTenderNo(project.division_code);
    const id = tenderModel.insertTender({
      tender_no: tenderNo,
      title: input.title,
      description: input.description ?? null,
      project_id: input.projectId,
      package_id: input.packageId ?? null,
      division_id: project.division_id,
      tender_type: input.tenderType,
      bid_type: input.bidType,
      estimated_value: input.estimatedValue,
      emd_amount: input.emdAmount ?? 0,
      tender_fee: input.tenderFee ?? 0,
      completion_period_days: input.completionPeriodDays,
      min_registration_class: input.minRegistrationClass ?? null,
      eligibility_criteria: input.eligibilityCriteria ?? null,
      bid_start_at: input.bidStartAt ?? null,
      bid_end_at: input.bidEndAt ?? null,
      technical_open_at: input.technicalOpenAt ?? null,
      financial_open_at: input.financialOpenAt ?? null,
      status: TENDER_STATUS.DRAFT,
      created_by: user.id,
    });

    if (input.boqItems?.length) {
      tenderModel.replaceBoqItems(
        id,
        input.boqItems.map((item, index) => ({
          sl_no: item.slNo ?? index + 1,
          item_code: item.itemCode ?? null,
          description: item.description,
          uom: item.uom,
          quantity: item.quantity,
          estimated_rate: item.estimatedRate,
        })),
      );
    }

    if (input.packageId) {
      packageModel.updatePackage(input.packageId, { status: PACKAGE_STATUS.TENDERING });
    }

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_CREATED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tenderNo} — ${input.title}`,
    });

    return getOne(id, user);
  });
}

export function update(id: number, input: z.infer<typeof updateTenderSchema>, user: AuthUser) {
  return transaction(() => {
    const existing = tenderModel.findById(id);
    if (!existing) throw notFound('Tender');
    assertTenderVisible(existing, user);
    assertEditable(existing);

    const start = input.bidStartAt ?? existing.bid_start_at;
    const end = input.bidEndAt ?? existing.bid_end_at;
    if (start && end && end <= start) {
      throw badRequest('The bid closing time must be after the opening time.');
    }

    tenderModel.updateTender(id, {
      title: input.title,
      description: input.description,
      package_id: input.packageId,
      tender_type: input.tenderType,
      bid_type: input.bidType,
      estimated_value: input.estimatedValue,
      emd_amount: input.emdAmount,
      tender_fee: input.tenderFee,
      completion_period_days: input.completionPeriodDays,
      min_registration_class: input.minRegistrationClass,
      eligibility_criteria: input.eligibilityCriteria,
      bid_start_at: input.bidStartAt,
      bid_end_at: input.bidEndAt,
      technical_open_at: input.technicalOpenAt,
      financial_open_at: input.financialOpenAt,
    });

    if (input.boqItems) {
      tenderModel.replaceBoqItems(
        id,
        input.boqItems.map((item, index) => ({
          sl_no: item.slNo ?? index + 1,
          item_code: item.itemCode ?? null,
          description: item.description,
          uom: item.uom,
          quantity: item.quantity,
          estimated_rate: item.estimatedRate,
        })),
      );
    }

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_UPDATED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: existing.tender_no,
    });

    return getOne(id, user);
  });
}

/** Sends a draft tender for administrative approval before publication. */
export function submitForApproval(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    assertEditable(tender);

    if (!tender.bid_start_at || !tender.bid_end_at) {
      throw badRequest('Set the bid opening and closing times before seeking approval.');
    }
    const boq = tenderModel.listBoqItems(id);
    if (tender.bid_type === 'ITEM_RATE' && !boq.length) {
      throw badRequest('An item-rate tender needs at least one bill-of-quantities line.');
    }

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.TENDER_APPROVAL,
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      entityRef: tender.tender_no,
      title: tender.title,
      amount: tender.estimated_value,
      divisionId: tender.division_id,
      circleId: tender.circle_id,
      zoneId: tender.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    tenderModel.updateTender(id, {
      status: TENDER_STATUS.PENDING_APPROVAL,
      workflow_instance_id: instance.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_SUBMITTED_FOR_APPROVAL',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: tender.tender_no,
    });

    return getOne(id, user);
  });
}

/** Publishes an approved tender to the contractor portal. */
export function publish(id: number, user: AuthUser) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    if (tender.status !== TENDER_STATUS.APPROVED) {
      throw conflict('Only an approved tender can be published.');
    }

    tenderModel.updateTender(id, {
      status: TENDER_STATUS.PUBLISHED,
      publish_date: new Date().toISOString().slice(0, 10),
    });

    // Notify every contractor eligible to bid.
    const eligible = contractorModel.listEligible(tender.min_registration_class);
    const accounts = eligible
      .map((c) => ({ contractor: c, account: findContractorAccount(c.id) }))
      .filter((entry) => entry.account);

    insertManyNotifications(
      accounts.map(({ account }) => ({
        userId: account!.id,
        title: 'New tender published',
        message: `${tender.tender_no} — ${tender.title}. Bids close ${tender.bid_end_at ?? 'soon'}.`,
        severity: 'INFO' as const,
        entityType: ENTITY_TYPES.TENDER,
        entityId: id,
        link: `/tenders/${id}`,
      })),
    );

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_PUBLISHED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tender.tender_no} notified to ${accounts.length} contractors`,
    });

    return getOne(id, user);
  });
}

function findContractorAccount(contractorId: number): { id: number } | null {
  return userModel.findSummaryByContractorId(contractorId);
}

export function closeBidding(id: number, user: AuthUser) {
  const tender = tenderModel.findById(id);
  if (!tender) throw notFound('Tender');
  assertTenderVisible(tender, user);
  if (tender.status !== TENDER_STATUS.PUBLISHED) {
    throw conflict('Only a published tender can be closed for bidding.');
  }

  tenderModel.updateTender(id, { status: TENDER_STATUS.BIDDING_CLOSED });
  insertAuditEntry({
    userId: user.id,
    action: 'TENDER_BIDDING_CLOSED',
    entityType: ENTITY_TYPES.TENDER,
    entityId: id,
    detail: `${tender.tender_no}, ${tender.submitted_bid_count} bids received`,
  });
  return getOne(id, user);
}

export function cancelTender(id: number, reason: string, user: AuthUser) {
  const tender = tenderModel.findById(id);
  if (!tender) throw notFound('Tender');
  assertTenderVisible(tender, user);
  if (tender.status === TENDER_STATUS.AWARDED) {
    throw conflict('An awarded tender cannot be cancelled.');
  }
  if (!reason.trim()) throw badRequest('A reason is required.');

  tenderModel.updateTender(id, { status: TENDER_STATUS.CANCELLED });
  if (tender.package_id) {
    packageModel.updatePackage(tender.package_id, { status: PACKAGE_STATUS.DRAFT });
  }
  insertAuditEntry({
    userId: user.id,
    action: 'TENDER_CANCELLED',
    entityType: ENTITY_TYPES.TENDER,
    entityId: id,
    detail: `${tender.tender_no}: ${reason}`,
  });
  return getOne(id, user);
}

// --- Bidding ---------------------------------------------------------------

/** Contractor-side bid submission. One bid per contractor per tender. */
export function submitBid(tenderId: number, input: z.infer<typeof submitBidSchema>, user: AuthUser) {
  return transaction(() => {
    if (user.roleCode !== ROLES.CONTRACTOR || !user.contractorId) {
      throw forbidden('Only a registered contractor can submit a bid.');
    }

    const tender = tenderModel.findById(tenderId);
    if (!tender) throw notFound('Tender');
    if (tender.status !== TENDER_STATUS.PUBLISHED) {
      throw conflict('This tender is not open for bidding.');
    }

    const now = nowStamp();
    if (tender.bid_start_at && now < tender.bid_start_at) {
      throw conflict(`Bidding opens on ${tender.bid_start_at}.`);
    }
    if (tender.bid_end_at && now > tender.bid_end_at) {
      throw conflict(`Bidding closed on ${tender.bid_end_at}.`);
    }

    const contractor = contractorModel.findById(user.contractorId);
    if (!contractor) throw notFound('Contractor');
    if (contractor.is_blacklisted) throw forbidden('Blacklisted contractors cannot bid.');
    if (contractor.registration_status !== 'APPROVED') {
      throw forbidden('Your registration must be approved before you can bid.');
    }
    if (contractor.validity_date && contractor.validity_date < now.slice(0, 10)) {
      throw forbidden('Your registration has expired. Renew it before bidding.');
    }
    if (
      tender.min_registration_class &&
      (contractor.registration_class ?? 'Class D') > tender.min_registration_class
    ) {
      throw forbidden(
        `This tender is restricted to ${tender.min_registration_class} contractors and above.`,
      );
    }

    if (tenderModel.findBidByTenderAndContractor(tenderId, user.contractorId)) {
      throw conflict('You have already submitted a bid for this tender.');
    }

    // Price the bid: item-rate bids sum their lines, others use the quoted figure.
    let quotedAmount = input.quotedAmount ?? 0;
    let bidItems: { boqItemId: number; quotedRate: number; amount: number }[] = [];

    if (tender.bid_type === 'ITEM_RATE') {
      const boq = tenderModel.listBoqItems(tenderId);
      if (!input.items?.length) throw badRequest('Quote a rate against every bill-of-quantities line.');
      const byId = new Map(boq.map((item) => [item.id, item]));
      if (input.items.length !== boq.length) {
        throw badRequest('Quote a rate against every bill-of-quantities line.');
      }

      quotedAmount = 0;
      for (const entry of input.items) {
        const item = byId.get(entry.boqItemId);
        if (!item) throw badRequest('A quoted line does not belong to this tender.');
        if (entry.quotedRate <= 0) throw badRequest('Every quoted rate must be greater than zero.');
        const amount = lineAmount(item.quantity, entry.quotedRate);
        bidItems.push({ boqItemId: item.id, quotedRate: entry.quotedRate, amount });
        quotedAmount += amount;
      }
    } else if (quotedAmount <= 0) {
      throw badRequest('Enter your quoted amount.');
    }

    const variationBps =
      tender.estimated_value > 0
        ? Math.round(((quotedAmount - tender.estimated_value) / tender.estimated_value) * 10_000)
        : 0;

    const bidNo = generateBidNo(tender.tender_no);
    const bidId = tenderModel.insertBid({
      bid_no: bidNo,
      tender_id: tenderId,
      contractor_id: user.contractorId,
      emd_reference: input.emdReference,
      emd_paid: tender.emd_amount,
      quoted_amount: quotedAmount,
      variation_bps: variationBps,
      status: 'SUBMITTED',
      submitted_at: now,
    });

    if (bidItems.length) tenderModel.replaceBidItems(bidId, bidItems);

    insertAuditEntry({
      userId: user.id,
      action: 'BID_SUBMITTED',
      entityType: 'BID',
      entityId: bidId,
      detail: `${bidNo} against ${tender.tender_no}`,
    });

    return presentBid(tenderModel.findBidById(bidId)!, true);
  });
}

export function listMyBids(user: AuthUser, page: number, pageSize: number) {
  if (!user.contractorId) throw forbidden('This view is for contractor accounts.');
  const { rows, total } = tenderModel.listBidsForContractor(
    user.contractorId,
    pageSize,
    (page - 1) * pageSize,
  );
  return { items: rows.map((b) => presentBid(b, true)), total, page, pageSize };
}

/** Opens technical envelopes. Financial figures remain sealed at this stage. */
export function startTechnicalEvaluation(id: number, user: AuthUser) {
  const tender = tenderModel.findById(id);
  if (!tender) throw notFound('Tender');
  assertTenderVisible(tender, user);
  if (tender.status !== TENDER_STATUS.BIDDING_CLOSED) {
    throw conflict('Close bidding before starting technical evaluation.');
  }
  if (tender.submitted_bid_count === 0) throw conflict('No bids were received for this tender.');

  tenderModel.updateTender(id, { status: TENDER_STATUS.TECHNICAL_EVALUATION });
  insertAuditEntry({
    userId: user.id,
    action: 'TENDER_TECHNICAL_EVALUATION_STARTED',
    entityType: ENTITY_TYPES.TENDER,
    entityId: id,
    detail: tender.tender_no,
  });
  return getOne(id, user);
}

export function recordTechnicalEvaluation(
  id: number,
  input: z.infer<typeof technicalEvaluationSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    if (tender.status !== TENDER_STATUS.TECHNICAL_EVALUATION) {
      throw conflict('This tender is not in technical evaluation.');
    }

    const bids = tenderModel.listBidsForTender(id);
    const byId = new Map(bids.map((b) => [b.id, b]));

    for (const entry of input.evaluations) {
      const bid = byId.get(entry.bidId);
      if (!bid) throw badRequest('A bid in the evaluation does not belong to this tender.');
      tenderModel.updateBid(bid.id, {
        technical_status: entry.technicalStatus,
        technical_score: entry.technicalScore ?? null,
        technical_remarks: entry.remarks ?? null,
        status: entry.technicalStatus === 'QUALIFIED' ? 'TECHNICALLY_QUALIFIED' : 'DISQUALIFIED',
      });
    }

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_TECHNICAL_EVALUATION_RECORDED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${input.evaluations.length} bids evaluated`,
    });

    return getOne(id, user);
  });
}

/**
 * Opens financial envelopes for technically qualified bids and ranks them by
 * quoted amount — L1 is the lowest.
 */
export function openFinancialBids(id: number, user: AuthUser) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    if (tender.status !== TENDER_STATUS.TECHNICAL_EVALUATION) {
      throw conflict('Complete technical evaluation before opening financial bids.');
    }

    const bids = tenderModel.listBidsForTender(id);
    const pending = bids.filter((b) => b.technical_status === 'PENDING');
    if (pending.length) {
      throw conflict(`${pending.length} bid(s) still need a technical decision.`);
    }

    const qualified = bids
      .filter((b) => b.technical_status === 'QUALIFIED')
      .sort((a, b) => a.quoted_amount - b.quoted_amount);
    if (!qualified.length) throw conflict('No bid qualified technically. Cancel or re-tender.');

    qualified.forEach((bid, index) => {
      tenderModel.updateBid(bid.id, { rank: index + 1, financial_status: 'EVALUATED' });
    });
    for (const bid of bids.filter((b) => b.technical_status !== 'QUALIFIED')) {
      tenderModel.updateBid(bid.id, { financial_status: 'REJECTED', rank: null });
    }

    tenderModel.updateTender(id, { status: TENDER_STATUS.FINANCIAL_EVALUATION });
    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_FINANCIAL_BIDS_OPENED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${qualified.length} qualified bids ranked; L1 is ${qualified[0]!.contractor_name}`,
    });

    return getOne(id, user);
  });
}

/**
 * Awards the tender. A Letter of Acceptance is issued and the work package is
 * created (or updated) so RA billing can begin against it.
 */
export function award(id: number, input: z.infer<typeof awardSchema>, user: AuthUser) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    if (tender.status !== TENDER_STATUS.FINANCIAL_EVALUATION) {
      throw conflict('Open the financial bids before awarding this tender.');
    }
    if (tenderModel.findAwardByTender(id)) throw conflict('This tender has already been awarded.');

    const bid = tenderModel.findBidById(input.bidId);
    if (!bid || bid.tender_id !== id) throw badRequest('Select a bid from this tender.');
    if (bid.technical_status !== 'QUALIFIED') {
      throw badRequest('Only a technically qualified bid can be awarded.');
    }

    const awardedValue = input.negotiatedValue ?? bid.quoted_amount;
    if (input.negotiatedValue && input.negotiatedValue > bid.quoted_amount) {
      throw badRequest('A negotiated value cannot exceed the quoted amount.');
    }
    // Awarding above L1 has to be justified in writing.
    if (bid.rank !== 1 && !input.remarks?.trim()) {
      throw badRequest('Record the justification for not awarding to the lowest bidder (L1).');
    }

    const loaNo = generateLoaNo(tender.division_code);
    const loaDate = new Date().toISOString().slice(0, 10);

    tenderModel.insertAward({
      tender_id: id,
      bid_id: bid.id,
      contractor_id: bid.contractor_id,
      loa_no: loaNo,
      loa_date: loaDate,
      awarded_value: awardedValue,
      negotiated_value: input.negotiatedValue ?? null,
      remarks: input.remarks ?? null,
      awarded_by: user.id,
    });

    tenderModel.updateBid(bid.id, { status: 'AWARDED' });
    for (const other of tenderModel.listBidsForTender(id).filter((b) => b.id !== bid.id)) {
      tenderModel.updateBid(other.id, { status: 'NOT_AWARDED' });
    }
    tenderModel.updateTender(id, { status: TENDER_STATUS.AWARDED });

    // Attach the award to a work package so RA bills have something to bill against.
    let packageId = tender.package_id;
    if (packageId) {
      packageModel.updatePackage(packageId, {
        contractor_id: bid.contractor_id,
        awarded_value: awardedValue,
        status: PACKAGE_STATUS.AWARDED,
        work_order_no: generateWorkOrderNo(tender.division_code),
        work_order_date: loaDate,
        agreement_no: loaNo,
        agreement_date: loaDate,
      });
    } else {
      const project = projectModel.findById(tender.project_id)!;
      packageId = packageModel.insertPackage({
        package_code: `${project.project_code}/PKG-T${tender.id}`,
        project_id: tender.project_id,
        name: tender.title,
        description: tender.description,
        work_type_id: project.work_type_id,
        estimated_value: tender.estimated_value,
        awarded_value: awardedValue,
        contractor_id: bid.contractor_id,
        agreement_no: loaNo,
        agreement_date: loaDate,
        work_order_no: generateWorkOrderNo(tender.division_code),
        work_order_date: loaDate,
        status: PACKAGE_STATUS.AWARDED,
        created_by: user.id,
      });
      tenderModel.updateTender(id, { package_id: packageId });
    }

    const account = findContractorAccount(bid.contractor_id);
    if (account) {
      insertManyNotifications([
        {
          userId: account.id,
          title: 'Tender awarded to you',
          message: `${tender.tender_no} — ${tender.title}. LOA ${loaNo} for ₹${toRupees(awardedValue).toLocaleString('en-IN')}.`,
          severity: 'SUCCESS',
          entityType: ENTITY_TYPES.TENDER,
          entityId: id,
          link: `/tenders/${id}`,
        },
      ]);
    }

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_AWARDED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tender.tender_no} awarded to ${bid.contractor_name} (${loaNo}) for ₹${toRupees(awardedValue)}`,
    });

    return getOne(id, user);
  });
}

/** Applies the outcome of the tender approval workflow. */
registerOutcomeHandler(ENTITY_TYPES.TENDER, ({ instance, status }) => {
  if (status === 'IN_PROGRESS') return;
  const map: Record<string, string> = {
    APPROVED: TENDER_STATUS.APPROVED,
    REJECTED: TENDER_STATUS.REJECTED,
    CANCELLED: TENDER_STATUS.DRAFT,
  };
  tenderModel.updateTender(instance.entity_id, { status: map[status] ?? TENDER_STATUS.DRAFT });
});

export { financialYear };
