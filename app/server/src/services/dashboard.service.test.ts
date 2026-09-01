import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as dashboardService from './dashboard.service.js';
import type { AuthUser } from '../types/auth.js';

/**
 * The analytics run against the seeded department rather than fixtures, for the
 * same reason the reports do: what is under test is that the aggregation adds
 * up and that the scoping holds. A chart that quietly shows another division's
 * money is worse than one that shows none at all.
 */

function userByUsername(username: string): AuthUser {
  const row = getDb()
    .prepare<[string], { id: number }>(`SELECT id FROM users WHERE username = ?`)
    .get(username);
  if (!row) throw new Error(`Seed is missing the user "${username}".`);
  return findAuthUserById(row.id)!;
}

let chiefEngineer: AuthUser;
let executiveEngineer: AuthUser;

beforeAll(() => {
  seed();
  chiefEngineer = userByUsername('ce.sharma');
  executiveEngineer = userByUsername('ee.kumar');
});

afterAll(() => {
  closeDb();
});

type Staff = ReturnType<typeof dashboardService.getDashboard> & {
  billTrend: { month: string; billCount: number; amount: number; paidAmount: number }[];
  billAgeing: { key: string; label: string; count: number; amount: number }[];
  projectMix: { status: string; label: string; count: number }[];
  tenderPipeline: { stage: string; label: string; count: number }[];
  spendByScheme: { schemeCode: string; sanctioned: number; paid: number; utilisation: number }[];
  divisionPerformance: { divisionCode: string; sanctioned: number; paid: number; utilisation: number }[];
  cards: { raBills: { inApproval: number } };
};

const dashboard = (user: AuthUser) => dashboardService.getDashboard(user) as Staff;

describe('the bill trend', () => {
  it('returns an unbroken run of months, oldest first', () => {
    const { billTrend } = dashboard(chiefEngineer);

    expect(billTrend.length).toBeGreaterThan(12);

    // Every step is exactly one month: a chart that skips an empty month draws
    // a straight line across it and misreports when the work happened.
    for (let i = 1; i < billTrend.length; i += 1) {
      const [prevYear, prevMonth] = billTrend[i - 1]!.month.split('-').map(Number);
      const [year, month] = billTrend[i]!.month.split('-').map(Number);
      const gap = (year! - prevYear!) * 12 + (month! - prevMonth!);
      expect(gap).toBe(1);
    }
  });

  it('counts what was raised in a month against what was actually paid out in it', () => {
    const { billTrend } = dashboard(chiefEngineer);

    const raised = billTrend.reduce((sum, row) => sum + row.amount, 0);
    const paid = billTrend.reduce((sum, row) => sum + row.paidAmount, 0);

    expect(raised).toBeGreaterThan(0);
    expect(paid).toBeGreaterThan(0);
    // Payments are booked in the month the money went out, not the month the
    // claim arrived, so the two series must not be the same figure repeated.
    expect(paid).not.toBe(raised);
  });

  it('shows a division officer only their own division', () => {
    const mine = dashboard(executiveEngineer).billTrend.reduce((s, r) => s + r.amount, 0);
    const all = dashboard(chiefEngineer).billTrend.reduce((s, r) => s + r.amount, 0);

    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(all);
  });
});

describe('the ageing of unsettled bills', () => {
  it('places every unpaid bill in exactly one bucket', () => {
    const { billAgeing, cards } = dashboard(chiefEngineer);
    const counted = billAgeing.reduce((sum, bucket) => sum + bucket.count, 0);

    const unsettled = getDb()
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM ra_bills
          WHERE status IN ('IN_APPROVAL', 'APPROVED', 'SENT_TO_TALLY')`,
      )
      .get()!.n;

    expect(counted).toBe(unsettled);
    expect(cards.raBills.inApproval).toBeGreaterThan(0);
  });

  it('offers the four buckets in order, oldest last', () => {
    const { billAgeing } = dashboard(chiefEngineer);

    expect(billAgeing.map((bucket) => bucket.key)).toEqual(['0-15', '16-30', '31-60', '60+']);
    // The seed is expected to keep files at every age; an empty bucket here
    // means the demonstration department no longer shows what ageing is for.
    for (const bucket of billAgeing) expect(bucket.count).toBeGreaterThan(0);
  });

  it('leaves out bills that are paid, rejected or still in draft', () => {
    const { billAgeing } = dashboard(chiefEngineer);
    const counted = billAgeing.reduce((sum, bucket) => sum + bucket.count, 0);

    const settled = getDb()
      .prepare<[], { n: number }>(
        `SELECT COUNT(*) AS n FROM ra_bills WHERE status IN ('PAID', 'REJECTED', 'DRAFT')`,
      )
      .get()!.n;
    const all = getDb().prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ra_bills`).get()!.n;

    expect(settled).toBeGreaterThan(0);
    expect(counted).toBe(all - settled);
  });

  it('scopes to the officer, like every other figure on the page', () => {
    const mine = dashboard(executiveEngineer).billAgeing.reduce((s, b) => s + b.count, 0);
    const all = dashboard(chiefEngineer).billAgeing.reduce((s, b) => s + b.count, 0);

    expect(mine).toBeGreaterThan(0);
    expect(mine).toBeLessThan(all);
  });
});

describe('the project and tender mixes', () => {
  it('accounts for every project exactly once', () => {
    const { projectMix } = dashboard(chiefEngineer);
    const counted = projectMix.reduce((sum, slice) => sum + slice.count, 0);

    const total = getDb().prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM projects`).get()!.n;
    expect(counted).toBe(total);
  });

  it('drops the statuses nothing sits in, so the chart carries no empty slices', () => {
    const { projectMix } = dashboard(chiefEngineer);
    for (const slice of projectMix) expect(slice.count).toBeGreaterThan(0);
    expect(projectMix.length).toBeGreaterThan(1);
  });

  it('reads the tender pipeline in the order a tender moves through it', () => {
    const { tenderPipeline } = dashboard(chiefEngineer);
    expect(tenderPipeline.map((stage) => stage.stage)).toEqual([
      'PENDING_APPROVAL',
      'PUBLISHED',
      'UNDER_EVALUATION',
      'AWARDED',
    ]);
  });
});

describe('utilisation', () => {
  it('is what was paid as a percentage of what was sanctioned', () => {
    const { spendByScheme, divisionPerformance } = dashboard(chiefEngineer);

    expect(spendByScheme.length).toBeGreaterThan(0);
    for (const row of [...spendByScheme, ...divisionPerformance]) {
      const expected = row.sanctioned > 0 ? Math.round((row.paid / row.sanctioned) * 100) : 0;
      expect(row.utilisation).toBe(expected);
    }
  });

  it('gives a scheme with nothing sanctioned a utilisation of zero, not a divide by zero', () => {
    const { spendByScheme } = dashboard(chiefEngineer);
    const unsanctioned = spendByScheme.filter((row) => row.sanctioned === 0);

    for (const row of spendByScheme) expect(Number.isFinite(row.utilisation)).toBe(true);
    for (const row of unsanctioned) expect(row.utilisation).toBe(0);
  });

  it('counts a division officer only their own division against their own sanctions', () => {
    // Reading the paid figure across the whole scheme while sanctioning only
    // the officer's own projects reports somebody else's spending as theirs,
    // and pushes utilisation past 100%.
    const mine = dashboard(executiveEngineer).spendByScheme;
    const all = dashboard(chiefEngineer).spendByScheme;

    expect(mine.length).toBeGreaterThan(0);
    for (const row of mine) {
      const departmental = all.find((r) => r.schemeCode === row.schemeCode)!;
      expect(row.paid).toBeLessThanOrEqual(departmental.paid);
      expect(row.sanctioned).toBeLessThanOrEqual(departmental.sanctioned);
    }
    // At least one scheme must actually be smaller for the check to mean anything.
    expect(mine.some((row) => {
      const departmental = all.find((r) => r.schemeCode === row.schemeCode)!;
      return row.paid < departmental.paid;
    })).toBe(true);
  });
});
