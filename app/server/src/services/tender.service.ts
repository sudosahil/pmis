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
import * as boqModel from '../models/boq.model.js';
import * as contractorModel from '../models/contractor.model.js';
import * as userModel from '../models/user.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { insertManyNotifications } from '../models/notification.model.js';
import { assertVisible as assertProjectVisible, scopeFilter } from './project.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import {
  financialYear,
  generateBidNo,
  generateLoaNo,
  generateTenderNo,
  generateWorkOrderNo,
} from '../utils/codes.js';
import * as recordModel from '../models/record.model.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { applyBps, formatIndian, fromBps, fromQty, lineAmount, toRupees } from '../utils/money.js';
import { percent, quantity, rupees } from '../middleware/validate.js';

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
  /** The Schedule of Rates line this item is priced from — the bidding ceiling. */
  srItemId: z.coerce.number().int().positive().optional().nullable(),
});

/** The grounds on which a department may permit a bid above the schedule. */
export const ABOVE_SR_GROUNDS = [
  'WAR',
  'PANDEMIC',
  'PRICE_ESCALATION',
  'NATURAL_CALAMITY',
  'OTHER',
] as const;

export const ABOVE_SR_GROUND_LABELS: Record<string, string> = {
  WAR: 'War or armed conflict',
  PANDEMIC: 'Pandemic',
  PRICE_ESCALATION: 'Market price escalation since the SR edition',
  NATURAL_CALAMITY: 'Natural calamity',
  OTHER: 'Other special consideration',
};

/**
 * Relief from the Schedule of Rates ceiling.
 *
 * The schedule is a price list fixed at a point in time. When a war, a pandemic
 * or a price shock postdates the edition an estimate was built from, holding
 * bidders to it produces no bids at all — so the department may lift the
 * ceiling by a stated margin. That is a decision, not a workaround: it names a
 * ground, cites the order granting it, applies to every bidder equally, and is
 * declared on the tender before bidding rather than claimed by one bidder
 * afterwards.
 */
export const srReliefSchema = z.object({
  capPercent: percent,
  ground: z.enum(ABOVE_SR_GROUNDS),
  authority: z.string().trim().min(3, 'Cite the circular or order permitting this.').max(200),
  remarks: z.string().trim().max(1000).optional(),
});

export const criterionSchema = z.object({
  kind: z.enum(['PQ', 'TQ']),
  title: z.string().trim().min(3, 'Name the criterion.').max(200),
  requirement: z.string().trim().min(3, 'State what the bidder must demonstrate.').max(2000),
  evidence: z.string().trim().max(500).optional(),
  isMandatory: z.coerce.boolean().default(true),
  /** Technical criteria are scored; pre-qualification criteria are pass or fail. */
  maxScore: z.coerce.number().int().min(0).max(100).default(0),
});

export const replaceCriteriaSchema = z.object({
  criteria: z.array(criterionSchema).max(60),
});

/** Turns an approved Detailed Project Report into a draft tender document. */
export const convertDprSchema = z.object({
  title: z.string().trim().min(5, 'Enter a tender title.').max(250).optional(),
  packageId: z.coerce.number().int().positive().optional(),
  tenderType: z.enum(['OPEN', 'LIMITED', 'EOI', 'GEM', 'SINGLE']).default('OPEN'),
  bidType: z.enum(['ITEM_RATE', 'PERCENTAGE', 'LUMPSUM']).default('ITEM_RATE'),
  emdPercent: percent.optional(),
  tenderFee: rupees.optional(),
  completionPeriodDays: z.coerce.number().int().min(1).max(3650).default(180),
  minRegistrationClass: z.enum(['Class A', 'Class B', 'Class C', 'Class D']).optional(),
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
  /** Off only for a procurement genuinely outside the schedule, e.g. an EOI. */
  srCeilingEnforced: z.coerce.boolean().default(true),
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
        /**
         * How the bid answered each published criterion. Where these are given
         * the technical score is totalled from them rather than typed, and a
         * mandatory criterion the bid fails disqualifies it outright.
         */
        criteria: z
          .array(
            z.object({
              criterionId: z.coerce.number().int().positive(),
              isMet: z.coerce.boolean(),
              score: z.coerce.number().int().min(0).max(100).default(0),
              remarks: z.string().trim().max(500).optional(),
            }),
          )
          .max(60)
          .optional(),
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

// --- The Schedule of Rates ceiling -------------------------------------------

/**
 * A bidder may quote below the government's approved rate but not above it.
 *
 * The ceiling for a line is the Schedule of Rates rate the item was priced
 * from; a line that never matched the schedule falls back to the departmental
 * estimate, which is the only baseline there is for it. The tender's ceiling is
 * the sum of its lines, or — for a tender with no bill of quantities — its
 * estimated value.
 *
 * The figure is stored on the tender rather than recomputed at bid time,
 * because a revision of the rate book must not move the ceiling under a bid
 * already being prepared.
 */
function ceilingRateFor(item: tenderModel.BoqItemRow): number {
  return item.sr_rate > 0 ? item.sr_rate : item.estimated_rate;
}

function computeSrCeiling(tenderId: number, estimatedValue: number): number {
  const boq = tenderModel.listBoqItems(tenderId);
  if (!boq.length) return estimatedValue;
  return boq.reduce((sum, item) => sum + lineAmount(item.quantity, ceilingRateFor(item)), 0);
}

/** The ceiling as it actually applies, once any relief granted is added on. */
function effectiveCeiling(amount: number, tender: tenderModel.TenderRow): number {
  if (!tender.above_sr_permitted) return amount;
  return amount + applyBps(amount, tender.above_sr_cap_bps);
}

function presentSrCeiling(row: tenderModel.TenderDetailRow) {
  const base = row.sr_ceiling_amount;
  const effective = effectiveCeiling(base, row);

  return {
    enforced: Boolean(row.sr_ceiling_enforced),
    /** The Schedule of Rates baseline: what the work is worth at approved rates. */
    baselineAmount: toRupees(base),
    /** What a bid may actually reach, once relief is counted. */
    effectiveAmount: toRupees(effective),
    relief: row.above_sr_permitted
      ? {
          capPercent: fromBps(row.above_sr_cap_bps),
          ground: row.above_sr_ground,
          groundLabel: ABOVE_SR_GROUND_LABELS[row.above_sr_ground ?? ''] ?? row.above_sr_ground,
          authority: row.above_sr_authority,
          remarks: row.above_sr_remarks,
          grantedBy: row.above_sr_granted_by_name,
          grantedAt: row.above_sr_granted_at,
        }
      : null,
  };
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
    srCeiling: presentSrCeiling(row),
    /** Set when the tender was converted from a Detailed Project Report. */
    dpr: row.dpr_id
      ? { id: row.dpr_id, dprNo: row.dpr_no, version: row.dpr_version }
      : null,
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

function presentBoq(item: tenderModel.BoqItemRow, tender: tenderModel.TenderRow) {
  const ceilingRate = effectiveCeiling(ceilingRateFor(item), tender);
  return {
    id: item.id,
    slNo: item.sl_no,
    itemCode: item.item_code,
    description: item.description,
    uom: item.uom,
    quantity: fromQty(item.quantity),
    estimatedRate: toRupees(item.estimated_rate),
    estimatedAmount: toRupees(lineAmount(item.quantity, item.estimated_rate)),
    sr: item.sr_rate > 0
      ? { id: item.sr_item_id, code: item.sr_code, name: item.sr_name, rate: toRupees(item.sr_rate) }
      : null,
    /** The most a bid may quote against this line. */
    ceilingRate: tender.sr_ceiling_enforced ? toRupees(ceilingRate) : null,
  };
}

function presentCriterion(row: tenderModel.CriterionRow) {
  return {
    id: row.id,
    kind: row.kind,
    slNo: row.sl_no,
    title: row.title,
    requirement: row.requirement,
    evidence: row.evidence,
    isMandatory: Boolean(row.is_mandatory),
    maxScore: row.max_score,
  };
}

function presentCriterionResponse(row: tenderModel.CriterionResponseRow) {
  return {
    criterionId: row.criterion_id,
    kind: row.kind,
    slNo: row.sl_no,
    title: row.title,
    requirement: row.requirement,
    isMandatory: Boolean(row.is_mandatory),
    maxScore: row.max_score,
    isMet: Boolean(row.is_met),
    score: row.score,
    remarks: row.remarks,
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
    /** How the bid sat against the approved rates, not against the estimate. */
    srVariation: revealFinancials ? fromBps(row.sr_variation_bps) : null,
    srCeilingAmount: revealFinancials ? toRupees(row.sr_ceiling_amount) : null,
    /**
     * True when the bid was quoted above the Schedule of Rates baseline under
     * the relief granted on the tender. Visible before the financial opening,
     * because it is a fact about how the bid was accepted rather than a price.
     */
    isAboveSr: Boolean(row.is_above_sr),
    financialsSealed: !revealFinancials,
    criteria: tenderModel.listCriterionResponses(row.id).map(presentCriterionResponse),
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

  const criteria = tenderModel.listCriteria(id).map(presentCriterion);

  return {
    ...present(row),
    boqItems: tenderModel.listBoqItems(id).map((item) => presentBoq(item, row)),
    criteria: {
      pq: criteria.filter((c) => c.kind === 'PQ'),
      tq: criteria.filter((c) => c.kind === 'TQ'),
      /** What a bid can score technically, which is what the committee marks out of. */
      tqMaxScore: criteria
        .filter((c) => c.kind === 'TQ')
        .reduce((sum, c) => sum + c.maxScore, 0),
    },
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

/**
 * Resolves each bill-of-quantities line to the Schedule of Rates line behind
 * it, and copies that rate onto the line. Chosen explicitly where the form
 * named an SR item; otherwise matched on the item code, which is how a
 * department writes a BOQ in practice. The rate is read from the rate book, not
 * taken from the form.
 */
function resolveBoqRows(items: z.infer<typeof boqItemSchema>[]) {
  return items.map((item, index) => {
    const sr = item.srItemId
      ? recordModel.findScheduleOfRatesItem(item.srItemId)
      : item.itemCode
        ? recordModel.findScheduleOfRatesItemByCode(item.itemCode)
        : null;

    return {
      sl_no: item.slNo ?? index + 1,
      item_code: item.itemCode ?? sr?.code ?? null,
      description: item.description,
      uom: item.uom,
      quantity: item.quantity,
      estimated_rate: item.estimatedRate,
      sr_item_id: sr?.id ?? null,
      sr_rate: sr?.rate ?? 0,
    };
  });
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
      sr_ceiling_enforced: input.srCeilingEnforced ? 1 : 0,
      bid_start_at: input.bidStartAt ?? null,
      bid_end_at: input.bidEndAt ?? null,
      technical_open_at: input.technicalOpenAt ?? null,
      financial_open_at: input.financialOpenAt ?? null,
      status: TENDER_STATUS.DRAFT,
      created_by: user.id,
    });

    if (input.boqItems?.length) {
      tenderModel.replaceBoqItems(id, resolveBoqRows(input.boqItems));
    }
    // The ceiling is frozen onto the tender the moment it has something to
    // compute from, so it cannot drift when the rate book is next revised.
    tenderModel.updateTender(id, {
      sr_ceiling_amount: computeSrCeiling(id, input.estimatedValue),
    });

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
      sr_ceiling_enforced: input.srCeilingEnforced === undefined ? undefined : input.srCeilingEnforced ? 1 : 0,
      bid_start_at: input.bidStartAt,
      bid_end_at: input.bidEndAt,
      technical_open_at: input.technicalOpenAt,
      financial_open_at: input.financialOpenAt,
    });

    if (input.boqItems) {
      tenderModel.replaceBoqItems(id, resolveBoqRows(input.boqItems));
    }
    tenderModel.updateTender(id, {
      sr_ceiling_amount: computeSrCeiling(id, input.estimatedValue ?? existing.estimated_value),
    });

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

    const notified = notifyEligibleContractors(tender, {
      title: 'New tender published',
      message: `${tender.tender_no} — ${tender.title}. Bids close ${tender.bid_end_at ?? 'soon'}.`,
      severity: 'INFO',
    });

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_PUBLISHED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tender.tender_no} notified to ${notified} contractors`,
    });

    return getOne(id, user);
  });
}

function findContractorAccount(contractorId: number): { id: number } | null {
  return userModel.findSummaryByContractorId(contractorId);
}

/** Reaches every contractor eligible to bid. Returns how many were told. */
function notifyEligibleContractors(
  tender: tenderModel.TenderDetailRow,
  notice: { title: string; message: string; severity: 'INFO' | 'WARNING' | 'SUCCESS' },
): number {
  const accounts = contractorModel
    .listEligible(tender.min_registration_class)
    .map((contractor) => findContractorAccount(contractor.id))
    .filter((account): account is { id: number } => Boolean(account));

  insertManyNotifications(
    accounts.map((account) => ({
      userId: account.id,
      title: notice.title,
      message: notice.message,
      severity: notice.severity,
      entityType: ENTITY_TYPES.TENDER,
      entityId: tender.id,
      link: `/tenders/${tender.id}`,
    })),
  );

  return accounts.length;
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

// --- Relief from the Schedule of Rates ceiling -------------------------------

/**
 * Permits bidding above the approved rates on this tender, by a stated margin
 * and on a stated ground.
 *
 * Granted before bidding opens, so every bidder prices against the same
 * ceiling — relief claimed after the envelopes are in would favour whoever
 * asked. It is recorded against the officer who granted it and the order that
 * authorised it, and it appears on the published notice.
 */
export function grantSrRelief(id: number, input: z.infer<typeof srReliefSchema>, user: AuthUser) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);

    if (!tender.sr_ceiling_enforced) {
      throw conflict('This tender does not enforce the Schedule of Rates ceiling, so there is nothing to relieve.');
    }
    const closed: string[] = [
      TENDER_STATUS.BIDDING_CLOSED,
      TENDER_STATUS.TECHNICAL_EVALUATION,
      TENDER_STATUS.FINANCIAL_EVALUATION,
      TENDER_STATUS.AWARDED,
      TENDER_STATUS.CANCELLED,
    ];
    if (closed.includes(tender.status)) {
      throw conflict(
        'Bidding has closed on this tender. Relief has to be granted before bids are invited, ' +
          'so that every bidder prices against the same ceiling.',
      );
    }
    if (input.capPercent <= 0) {
      throw badRequest('Enter how far above the Schedule of Rates bidding is permitted.');
    }

    tenderModel.updateTender(id, {
      above_sr_permitted: 1,
      above_sr_cap_bps: input.capPercent,
      above_sr_ground: input.ground,
      above_sr_authority: input.authority,
      above_sr_remarks: input.remarks ?? null,
      above_sr_granted_by: user.id,
      above_sr_granted_at: nowStamp(),
    });

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_ABOVE_SR_PERMITTED',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail:
        `${tender.tender_no}: bidding permitted up to ${fromBps(input.capPercent)}% above the ` +
        `Schedule of Rates — ${ABOVE_SR_GROUND_LABELS[input.ground]}, per ${input.authority}`,
    });

    // Bidders already looking at this tender need to know the ceiling moved.
    if (tender.status === TENDER_STATUS.PUBLISHED) {
      notifyEligibleContractors(tender, {
        title: 'Bidding ceiling revised',
        message:
          `${tender.tender_no} — bids may now be quoted up to ${fromBps(input.capPercent)}% above ` +
          `the Schedule of Rates (${ABOVE_SR_GROUND_LABELS[input.ground]}).`,
        severity: 'WARNING',
      });
    }

    return getOne(id, user);
  });
}

/** Withdraws relief. Refused once a bid has been priced against it. */
export function withdrawSrRelief(id: number, user: AuthUser) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    if (!tender.above_sr_permitted) throw conflict('This tender carries no relief to withdraw.');

    const priced = tenderModel
      .listBidsForTender(id)
      .filter((bid) => bid.is_above_sr && bid.status !== 'DRAFT');
    if (priced.length) {
      throw conflict(
        `${priced.length} bid(s) have already been quoted above the Schedule of Rates under this relief. ` +
          'Cancel the tender instead — withdrawing it now would invalidate bids already submitted.',
      );
    }

    tenderModel.updateTender(id, {
      above_sr_permitted: 0,
      above_sr_cap_bps: 0,
      above_sr_ground: null,
      above_sr_authority: null,
      above_sr_remarks: null,
      above_sr_granted_by: null,
      above_sr_granted_at: null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_ABOVE_SR_WITHDRAWN',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tender.tender_no}: the Schedule of Rates ceiling applies again in full`,
    });

    return getOne(id, user);
  });
}

// --- Qualification criteria ---------------------------------------------------

export function listCriteria(id: number, user: AuthUser) {
  const tender = tenderModel.findById(id);
  if (!tender) throw notFound('Tender');
  assertTenderVisible(tender, user);
  return tenderModel.listCriteria(id).map(presentCriterion);
}

/**
 * Sets the pre-qualification and technical qualification criteria.
 *
 * These are what turn a Detailed Project Report into a tender document: the
 * report says what is to be built and what it should cost, the criteria say who
 * is fit to build it. They are fixed while the tender is a draft, because a
 * criterion added after publication changes the terms bidders responded to.
 */
export function replaceCriteria(
  id: number,
  input: z.infer<typeof replaceCriteriaSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const tender = tenderModel.findById(id);
    if (!tender) throw notFound('Tender');
    assertTenderVisible(tender, user);
    assertEditable(tender);

    const tqTotal = input.criteria
      .filter((c) => c.kind === 'TQ')
      .reduce((sum, c) => sum + c.maxScore, 0);
    if (tqTotal > 100) {
      throw badRequest(
        `The technical criteria add up to ${tqTotal} marks. A technical score is out of 100.`,
      );
    }
    for (const criterion of input.criteria) {
      if (criterion.kind === 'TQ' && criterion.maxScore <= 0) {
        throw badRequest(
          `"${criterion.title}" is a technical criterion, so it needs marks. ` +
            'A pass-or-fail requirement belongs under pre-qualification.',
        );
      }
    }

    // Numbered within each kind, the way a tender document lists them.
    let pq = 0;
    let tq = 0;
    tenderModel.replaceCriteria(
      id,
      input.criteria.map((criterion) => ({
        kind: criterion.kind,
        sl_no: criterion.kind === 'PQ' ? (pq += 1) : (tq += 1),
        title: criterion.title,
        requirement: criterion.requirement,
        evidence: criterion.evidence ?? null,
        is_mandatory: criterion.isMandatory ? 1 : 0,
        max_score: criterion.kind === 'TQ' ? criterion.maxScore : 0,
      })),
    );

    insertAuditEntry({
      userId: user.id,
      action: 'TENDER_CRITERIA_SET',
      entityType: ENTITY_TYPES.TENDER,
      entityId: id,
      detail: `${tender.tender_no}: ${pq} PQ, ${tq} TQ criteria`,
    });

    return getOne(id, user);
  });
}

// --- From report to tender document -------------------------------------------

/**
 * Converts an approved Detailed Project Report into a draft tender document.
 *
 * This is the step the whole procurement turns on: the report's item-wise
 * estimate becomes the bill of quantities, its abstract of cost becomes the
 * estimated value, and the Schedule of Rates lines it was priced from become
 * the bidding ceiling. Nothing is retyped, so the tender cannot quietly diverge
 * from the estimate that was sanctioned. What the officer adds afterwards is the
 * qualification criteria — that, and only that, is what a tender document has
 * that the report did not.
 */
export function createFromDpr(
  dprId: number,
  input: z.infer<typeof convertDprSchema>,
  user: AuthUser,
) {
  return transaction(() => {
    const dpr = recordModel.findDpr(dprId);
    if (!dpr) throw notFound('DPR');

    const project = projectModel.findById(dpr.project_id);
    if (!project) throw notFound('Project');
    // The tender is raised in the project's division, so the officer raising it
    // has to be able to see that project in the first place.
    assertProjectVisible(project, user);

    if (dpr.status !== 'APPROVED') {
      throw conflict(
        'Only an approved Detailed Project Report can be converted into a tender document. ' +
          `This report is ${dpr.status.toLowerCase()}.`,
      );
    }
    if (dpr.tender_id) {
      throw conflict(
        'This report has already been converted into a tender. Raise a revision of the report to tender again.',
      );
    }

    const items = recordModel.listDprItems(dprId);
    if (!items.length) {
      throw conflict(
        'This report carries no item-wise estimate, so there is nothing to tender. ' +
          'Prepare the estimate first — a tender document is the estimate plus its qualification criteria.',
      );
    }

    if (input.packageId) {
      const pkg = packageModel.findById(input.packageId);
      if (!pkg) throw badRequest('Select a valid package.');
      if (pkg.project_id !== dpr.project_id) {
        throw badRequest('That package does not belong to this report’s project.');
      }
    }

    const estimatedValue = dpr.estimated_cost;
    const tenderNo = generateTenderNo(project.division_code);
    const tenderId = tenderModel.insertTender({
      tender_no: tenderNo,
      title: input.title ?? dpr.title,
      // The report's own scope and justification are what a bidder needs to
      // read, so they travel rather than being summarised.
      description: [dpr.scope, dpr.justification].filter(Boolean).join('\n\n') || null,
      project_id: dpr.project_id,
      package_id: input.packageId ?? null,
      division_id: project.division_id,
      tender_type: input.tenderType,
      bid_type: input.bidType,
      estimated_value: estimatedValue,
      emd_amount: input.emdPercent ? applyBps(estimatedValue, input.emdPercent) : 0,
      tender_fee: input.tenderFee ?? 0,
      completion_period_days: input.completionPeriodDays,
      min_registration_class: input.minRegistrationClass ?? null,
      dpr_id: dprId,
      sr_ceiling_enforced: 1,
      status: TENDER_STATUS.DRAFT,
      created_by: user.id,
    });

    // The estimate becomes the bill of quantities, carrying the Schedule of
    // Rates line and the rate it was priced at — which is the bidding ceiling.
    tenderModel.replaceBoqItems(
      tenderId,
      items.map((item) => ({
        sl_no: item.sl_no,
        item_code: item.item_code,
        description: item.description,
        uom: item.uom,
        quantity: item.quantity,
        estimated_rate: item.rate,
        sr_item_id: item.sr_item_id,
        sr_rate: item.sr_rate,
      })),
    );
    tenderModel.updateTender(tenderId, {
      sr_ceiling_amount: computeSrCeiling(tenderId, estimatedValue),
    });

    recordModel.updateDpr(dprId, { tender_id: tenderId });
    if (input.packageId) {
      packageModel.updatePackage(input.packageId, { status: PACKAGE_STATUS.TENDERING });
    }

    insertAuditEntry({
      userId: user.id,
      action: 'DPR_CONVERTED_TO_TENDER',
      entityType: ENTITY_TYPES.TENDER,
      entityId: tenderId,
      detail:
        `${tenderNo} raised from DPR ${dpr.dpr_no} v${dpr.version} — ` +
        `${items.length} item(s), ₹${toRupees(estimatedValue)}`,
    });

    return getOne(tenderId, user);
  });
}

// --- Bidding ---------------------------------------------------------------

/**
 * Explains a refusal in the bidder's own terms: what they quoted, what the
 * ceiling was, and — if relief has been granted — that it was already counted.
 * A bidder turned away by a rule they cannot see will simply try again.
 */
function describeCeilingRefusal(tender: tenderModel.TenderRow, overruns: string[]): string {
  const shown = overruns.slice(0, 5);
  const rest = overruns.length - shown.length;

  const preamble = tender.above_sr_permitted
    ? `This tender permits quoting up to ${fromBps(tender.above_sr_cap_bps)}% above the Schedule of Rates ` +
      `(${ABOVE_SR_GROUND_LABELS[tender.above_sr_ground ?? ''] ?? 'special consideration'}, ` +
      `${tender.above_sr_authority ?? 'by order'}). Your bid is above even that ceiling.`
    : 'A bid may not be quoted above the Schedule of Rates. You may quote at or below the approved rates.';

  // Semicolons between the lines, so a wall of overruns still reads as a list.
  const lines = shown.join('; ') + (rest > 0 ? `; and ${rest} more line(s)` : '');
  return `${preamble} ${lines}.`;
}

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

    // The Schedule of Rates ceiling. A bid may go as low as the contractor
    // likes; it may not go above the government's approved rates unless the
    // tender carries relief, and then only as far as that relief allows.
    const enforceCeiling = Boolean(tender.sr_ceiling_enforced);
    const overruns: string[] = [];

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

        if (enforceCeiling) {
          const ceiling = effectiveCeiling(ceilingRateFor(item), tender);
          if (entry.quotedRate > ceiling) {
            overruns.push(
              `Item ${item.sl_no} (${item.description}): quoted ₹${formatIndian(entry.quotedRate)} ` +
                `against a ceiling of ₹${formatIndian(ceiling)} per ${item.uom}`,
            );
          }
        }

        const amount = lineAmount(item.quantity, entry.quotedRate);
        bidItems.push({ boqItemId: item.id, quotedRate: entry.quotedRate, amount });
        quotedAmount += amount;
      }
    } else if (quotedAmount <= 0) {
      throw badRequest('Enter your quoted amount.');
    }

    const baseCeiling = tender.sr_ceiling_amount || tender.estimated_value;
    const ceilingAmount = effectiveCeiling(baseCeiling, tender);

    // A percentage or lump-sum bid has no lines to check, so the whole quote is
    // measured against the whole ceiling.
    if (enforceCeiling && tender.bid_type !== 'ITEM_RATE' && quotedAmount > ceilingAmount) {
      overruns.push(
        `Quoted ₹${formatIndian(quotedAmount)} against a ceiling of ₹${formatIndian(ceilingAmount)}`,
      );
    }

    if (overruns.length) throw badRequest(describeCeilingRefusal(tender, overruns));

    const variationBps =
      tender.estimated_value > 0
        ? Math.round(((quotedAmount - tender.estimated_value) / tender.estimated_value) * 10_000)
        : 0;
    const srVariationBps =
      baseCeiling > 0 ? Math.round(((quotedAmount - baseCeiling) / baseCeiling) * 10_000) : 0;

    const bidNo = generateBidNo(tender.tender_no);
    const bidId = tenderModel.insertBid({
      bid_no: bidNo,
      tender_id: tenderId,
      contractor_id: user.contractorId,
      emd_reference: input.emdReference,
      emd_paid: tender.emd_amount,
      quoted_amount: quotedAmount,
      variation_bps: variationBps,
      sr_ceiling_amount: ceilingAmount,
      sr_variation_bps: srVariationBps,
      // Recorded whenever the quote sits above the approved rates, which it can
      // only do under the relief granted on the tender.
      is_above_sr: quotedAmount > baseCeiling ? 1 : 0,
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
    const criteria = new Map(tenderModel.listCriteria(id).map((c) => [c.id, c]));

    for (const entry of input.evaluations) {
      const bid = byId.get(entry.bidId);
      if (!bid) throw badRequest('A bid in the evaluation does not belong to this tender.');

      let status = entry.technicalStatus;
      let score = entry.technicalScore ?? null;

      if (entry.criteria?.length) {
        let total = 0;
        const responses = entry.criteria.map((response) => {
          const criterion = criteria.get(response.criterionId);
          if (!criterion) {
            throw badRequest('A criterion in the evaluation does not belong to this tender.');
          }
          if (response.score > criterion.max_score) {
            throw badRequest(
              `"${criterion.title}" is marked out of ${criterion.max_score}; ${response.score} was given.`,
            );
          }
          // A mandatory criterion the bid does not meet ends the matter, whatever
          // the committee scored elsewhere.
          if (criterion.is_mandatory && !response.isMet) status = 'DISQUALIFIED';
          if (criterion.kind === 'TQ' && response.isMet) total += response.score;

          return {
            criterion_id: criterion.id,
            is_met: response.isMet ? 1 : 0,
            score: response.score,
            remarks: response.remarks ?? null,
          };
        });

        tenderModel.replaceCriterionResponses(bid.id, responses);
        score = total;
      }

      tenderModel.updateBid(bid.id, {
        technical_status: status,
        technical_score: score,
        technical_remarks: entry.remarks ?? null,
        status: status === 'QUALIFIED' ? 'TECHNICALLY_QUALIFIED' : 'DISQUALIFIED',
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

    // The winning bid's priced BOQ becomes the agreement BOQ, so every RA bill
    // from here on is measured against the rates that were actually agreed.
    const boqLines = boqModel.copyFromTender(id, bid.id, packageId);

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
      detail:
        `${tender.tender_no} awarded to ${bid.contractor_name} (${loaNo}) for ₹${toRupees(awardedValue)}` +
        `; ${boqLines} BOQ item(s) carried to the agreement`,
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
