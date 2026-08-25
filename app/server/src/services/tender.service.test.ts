import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as tenderService from './tender.service.js';
import * as recordService from './record.service.js';
import { toPaise } from '../utils/money.js';
import type { AuthUser } from '../types/auth.js';

/**
 * The Schedule of Rates ceiling, and the report-to-tender conversion it comes
 * from. Both run against the real seeded department, because both are about how
 * rows in three tables line up rather than about arithmetic in isolation.
 */

function userByUsername(username: string): AuthUser {
  const row = getDb()
    .prepare<[string], { id: number }>(`SELECT id FROM users WHERE username = ?`)
    .get(username);
  if (!row) throw new Error(`Seed is missing the user "${username}".`);
  const user = findAuthUserById(row.id);
  if (!user) throw new Error(`User "${username}" is not active.`);
  return user;
}

function contractorUser(email: string): AuthUser {
  const row = getDb()
    .prepare<[string], { id: number }>(`SELECT id FROM users WHERE email = ?`)
    .get(email);
  if (!row) throw new Error(`Seed is missing the contractor account "${email}".`);
  return findAuthUserById(row.id)!;
}

/** The published item-rate tender, which is the one that carries a ceiling. */
function publishedTenderId(): number {
  const row = getDb()
    .prepare<[], { id: number }>(
      `SELECT id FROM tenders WHERE status = 'PUBLISHED' AND bid_type = 'ITEM_RATE' ORDER BY id LIMIT 1`,
    )
    .get();
  if (!row) throw new Error('Seed produced no published item-rate tender.');
  return row.id;
}

let chiefEngineer: AuthUser;
let executiveEngineer: AuthUser;
let bidder: AuthUser;
let tenderId: number;

beforeAll(() => {
  seed();
  chiefEngineer = userByUsername('ce.sharma');
  executiveEngineer = userByUsername('ee.kumar');
  bidder = contractorUser('office@gangabuilders.example');
  tenderId = publishedTenderId();
});

afterAll(() => {
  closeDb();
});

/**
 * Quotes every line of a tender at a multiple of its Schedule of Rates rate.
 *
 * The presenter hands rupees out and the service takes paise in — the zod layer
 * converts between them on a real request, and these tests call the service
 * directly, so they convert here.
 */
function quoteAt(id: number, multiplier: number) {
  const tender = tenderService.getOne(id, executiveEngineer);
  return tender.boqItems.map((item) => ({
    boqItemId: item.id,
    quotedRate: toPaise(Math.round((item.sr?.rate ?? item.estimatedRate) * multiplier * 100) / 100),
  }));
}

describe('the Schedule of Rates ceiling', () => {
  it('publishes the ceiling alongside the estimate', () => {
    const tender = tenderService.getOne(tenderId, executiveEngineer);

    expect(tender.srCeiling.enforced).toBe(true);
    expect(tender.srCeiling.baselineAmount).toBeGreaterThan(0);
    // Every line of the seeded tender is priced from the rate book.
    expect(tender.boqItems.every((item) => item.sr !== null)).toBe(true);
    expect(tender.boqItems.every((item) => (item.ceilingRate ?? 0) > 0)).toBe(true);
  });

  it('counts relief into the ceiling a bidder is actually measured against', () => {
    const tender = tenderService.getOne(tenderId, executiveEngineer);
    const relief = tender.srCeiling.relief;

    expect(relief).not.toBeNull();
    expect(relief!.capPercent).toBe(8);
    expect(tender.srCeiling.effectiveAmount).toBeGreaterThan(tender.srCeiling.baselineAmount);
    // 8% above the baseline, to the paisa.
    expect(tender.srCeiling.effectiveAmount).toBeCloseTo(tender.srCeiling.baselineAmount * 1.08, 1);
  });

  it('refuses a bid quoted above the ceiling, naming the line and the limit', () => {
    expect(() =>
      tenderService.submitBid(
        tenderId,
        { emdReference: 'EMD/TEST/OVER', items: quoteAt(tenderId, 1.5) },
        bidder,
      ),
    ).toThrowError(/Schedule of Rates/);
  });

  it('accepts a bid at the schedule, and records how it sat against it', () => {
    const bid = tenderService.submitBid(
      tenderId,
      { emdReference: 'EMD/TEST/AT-SR', items: quoteAt(tenderId, 0.97) },
      bidder,
    );

    expect(bid.isAboveSr).toBe(false);
    // The bid is on record, whatever the two-envelope rules show of it.
    const stored = getDb()
      .prepare<[number], { sr_variation_bps: number; is_above_sr: number }>(
        `SELECT sr_variation_bps, is_above_sr FROM bids WHERE id = ?`,
      )
      .get(bid.id)!;
    expect(stored.is_above_sr).toBe(0);
    expect(stored.sr_variation_bps).toBeLessThan(0);
  });

  it('lets a bid inside the granted relief through, and marks it as above the schedule', () => {
    // A second firm, since one contractor may bid only once.
    const other = contractorUser('contracts@shakticonstructions.example');
    const bid = tenderService.submitBid(
      tenderId,
      { emdReference: 'EMD/TEST/RELIEF', items: quoteAt(tenderId, 1.05) },
      other,
    );

    expect(bid.isAboveSr).toBe(true);
  });

  it('refuses relief once bidding has closed', () => {
    const closed = getDb()
      .prepare<[], { id: number }>(
        `SELECT id FROM tenders WHERE status = 'FINANCIAL_EVALUATION' ORDER BY id LIMIT 1`,
      )
      .get()!;

    expect(() =>
      tenderService.grantSrRelief(
        closed.id,
        { capPercent: 500, ground: 'WAR', authority: 'PWD/TEST/1' },
        chiefEngineer,
      ),
    ).toThrowError(/before bids are invited/);
  });
});

describe('converting a report into a tender document', () => {
  it('refuses a report that has not been approved', () => {
    const draft = getDb()
      .prepare<[], { id: number }>(`SELECT id FROM project_dprs WHERE status = 'DRAFT' LIMIT 1`)
      .get()!;

    expect(() =>
      tenderService.createFromDpr(draft.id, { tenderType: 'OPEN', bidType: 'ITEM_RATE', completionPeriodDays: 180 }, chiefEngineer),
    ).toThrowError(/approved/i);
  });

  it('refuses a report that has already been tendered', () => {
    const converted = getDb()
      .prepare<[], { id: number }>(`SELECT id FROM project_dprs WHERE tender_id IS NOT NULL LIMIT 1`)
      .get()!;

    expect(() =>
      tenderService.createFromDpr(converted.id, { tenderType: 'OPEN', bidType: 'ITEM_RATE', completionPeriodDays: 180 }, chiefEngineer),
    ).toThrowError(/already been converted/);
  });

  it('carries the estimate across as the bill of quantities and the ceiling', () => {
    // Approve the report still in preparation, then convert it.
    const draft = getDb()
      .prepare<[], { id: number; project_id: number }>(
        `SELECT id, project_id FROM project_dprs WHERE status = 'DRAFT' LIMIT 1`,
      )
      .get()!;
    const before = recordService.listDprItems(draft.id, chiefEngineer);

    recordService.decideDpr(draft.id, { status: 'APPROVED' }, chiefEngineer);
    const tender = tenderService.createFromDpr(
      draft.id,
      { tenderType: 'OPEN', bidType: 'ITEM_RATE', completionPeriodDays: 240, emdPercent: 200 },
      chiefEngineer,
    );

    expect(tender.boqItems).toHaveLength(before.items.length);
    expect(tender.estimatedValue).toBe(before.abstract.total);
    expect(tender.dpr).not.toBeNull();
    // The ceiling is the estimate at schedule rates, which is what it was priced at.
    expect(tender.srCeiling.baselineAmount).toBeCloseTo(before.abstract.itemsTotal, 1);
    // EMD at 2% of the estimate.
    expect(tender.emdAmount).toBeCloseTo(before.abstract.total * 0.02, 1);
  });
});

/** A draft tender to hang criteria on. Criteria are fixed while a tender drafts. */
function draftTender(): { id: number } {
  const project = getDb()
    .prepare<[], { id: number }>(`SELECT id FROM projects WHERE division_id IS NOT NULL LIMIT 1`)
    .get()!;
  const tender = tenderService.create(
    {
      title: 'Test tender for qualification criteria',
      projectId: project.id,
      tenderType: 'OPEN',
      bidType: 'ITEM_RATE',
      estimatedValue: toPaise(1_000_000),
      completionPeriodDays: 180,
      srCeilingEnforced: true,
    },
    chiefEngineer,
  );
  return { id: tender.id };
}

describe('qualification criteria', () => {
  it('publishes the criteria a bidder is judged against', () => {
    const tender = tenderService.getOne(tenderId, executiveEngineer);

    expect(tender.criteria.pq.length).toBeGreaterThan(0);
    expect(tender.criteria.tq.length).toBeGreaterThan(0);
    expect(tender.criteria.tqMaxScore).toBe(100);
    // Pre-qualification is pass or fail, so it carries no marks.
    expect(tender.criteria.pq.every((criterion) => criterion.maxScore === 0)).toBe(true);
  });

  it('refuses technical criteria adding up to more than a hundred marks', () => {
    const draft = draftTender();

    expect(() =>
      tenderService.replaceCriteria(
        draft.id,
        {
          criteria: [
            { kind: 'TQ', title: 'Experience', requirement: 'Comparable works.', isMandatory: true, maxScore: 70 },
            { kind: 'TQ', title: 'Plant held', requirement: 'Plant and machinery.', isMandatory: true, maxScore: 60 },
          ],
        },
        executiveEngineer,
      ),
    ).toThrowError(/out of 100/);
  });

  it('refuses a technical criterion carrying no marks', () => {
    const draft = draftTender();

    expect(() =>
      tenderService.replaceCriteria(
        draft.id,
        {
          criteria: [
            { kind: 'TQ', title: 'Experience', requirement: 'Comparable works.', isMandatory: true, maxScore: 0 },
          ],
        },
        executiveEngineer,
      ),
    ).toThrowError(/pre-qualification/);
  });
});
