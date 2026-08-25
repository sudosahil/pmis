import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as reportService from './report.service.js';
import * as masterService from './master.service.js';
import type { AuthUser } from '../types/auth.js';

/**
 * The reports run against the seeded department rather than fixtures, because
 * what they are actually being tested for is that the joins and the scoping
 * hold — a report that shows another division's bills is worse than one that
 * shows none at all.
 */

function userByUsername(username: string): AuthUser {
  const row = getDb()
    .prepare<[string], { id: number }>(`SELECT id FROM users WHERE username = ?`)
    .get(username);
  if (!row) throw new Error(`Seed is missing the user "${username}".`);
  return findAuthUserById(row.id)!;
}

function contractorUser(): AuthUser {
  const row = getDb()
    .prepare<[], { id: number }>(`SELECT id FROM users WHERE contractor_id IS NOT NULL LIMIT 1`)
    .get()!;
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

interface Report {
  key: string;
  items: Record<string, unknown>[];
  totals: Record<string, number | null>;
  columns: { key: string }[];
}

const run = (key: string, user: AuthUser, query: Record<string, unknown> = {}) =>
  reportService.run(key, user, query as never) as unknown as Report;

describe('the report catalogue', () => {
  it('offers every report, with the filters they take', () => {
    const catalogue = reportService.catalogue(chiefEngineer);

    expect(catalogue.reports).toHaveLength(6);
    expect(catalogue.reports.map((report) => report.key)).toEqual([
      'contractor-bills',
      'bill-ageing',
      'boq-analysis',
      'sr-rates',
      'sr-rate-history',
      'approval-analysis',
    ]);
    expect(catalogue.divisions.length).toBeGreaterThan(0);
  });

  it('is closed to contractor accounts', () => {
    expect(() => reportService.catalogue(contractorUser())).toThrowError(/contractor/i);
    expect(() => run('contractor-bills', contractorUser())).toThrowError(/contractor/i);
  });

  it('refuses an unknown report rather than returning an empty one', () => {
    expect(() => run('invented-report', chiefEngineer)).toThrowError(/no report/);
  });

  it('refuses a division outside the reader’s jurisdiction', () => {
    const otherDivision = getDb()
      .prepare<[number], { id: number }>(`SELECT id FROM divisions WHERE id <> ? LIMIT 1`)
      .get(executiveEngineer.divisionId!)!;

    expect(() => run('bill-ageing', executiveEngineer, { divisionId: otherDivision.id })).toThrowError(
      /jurisdiction/,
    );
  });
});

describe('contractor-wise bill submission', () => {
  it('totals each contractor’s billing and reconciles against the whole', () => {
    const report = run('contractor-bills', chiefEngineer);

    expect(report.items.length).toBeGreaterThan(0);
    const billed = report.items.reduce((sum, row) => sum + (row.netPayable as number), 0);
    expect(report.totals.billed).toBeCloseTo(billed, 2);

    for (const row of report.items) {
      // Paid and pending are subsets of what was billed, never more than it.
      expect(row.paidAmount as number).toBeLessThanOrEqual(row.netPayable as number);
      expect(row.paidCount as number).toBeLessThanOrEqual(row.billCount as number);
    }
  });
});

describe('ageing analysis of bills', () => {
  it('places every unsettled bill in exactly one bucket', () => {
    const report = run('bill-ageing', chiefEngineer) as Report & {
      buckets: { key: string; count: number; amount: number }[];
    };

    expect(report.items.length).toBeGreaterThan(0);
    const bucketed = report.buckets.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(bucketed).toBe(report.items.length);
    expect(report.totals.bills).toBe(report.items.length);
  });

  it('leaves out bills that are already paid or rejected', () => {
    const report = run('bill-ageing', chiefEngineer);
    const settled = report.items.filter((row) =>
      ['PAID', 'REJECTED', 'DRAFT'].includes(row.status as string),
    );
    expect(settled).toHaveLength(0);
  });

  it('shows a division officer only their own division', () => {
    const report = run('bill-ageing', executiveEngineer);
    const divisions = new Set(
      report.items.map((row) => (row.division as { code: string }).code),
    );
    expect(divisions.size).toBeLessThanOrEqual(1);
  });

  it('reports the wait in days, and where the file is sitting', () => {
    const report = run('bill-ageing', chiefEngineer);
    const oldest = report.items[0]!;

    // The seed backdates the unsettled bills, so the register has real spread.
    expect(oldest.daysPending as number).toBeGreaterThan(0);
    expect(oldest.daysAtStage as number).toBeLessThanOrEqual(oldest.daysPending as number);
    expect(report.totals.oldestDays as number).toBe(oldest.daysPending as number);
  });
});

describe('BOQ analysis', () => {
  it('reads each agreement against the Schedule of Rates', () => {
    const report = run('boq-analysis', chiefEngineer);

    expect(report.items.length).toBeGreaterThan(0);
    for (const row of report.items) {
      expect(row.srValue as number).toBeGreaterThan(0);
      expect(row.matchedCount as number).toBeLessThanOrEqual(row.itemCount as number);
    }
    // The variance is the difference between the two totals, not a separate sum.
    expect(report.totals.varianceAmount).toBeCloseTo(
      (report.totals.agreementValue as number) - (report.totals.srValue as number),
      2,
    );
  });

  it('drills into the lines of one agreement when asked', () => {
    const summary = run('boq-analysis', chiefEngineer);
    const packageId = summary.items[0]!.packageId as number;
    const drill = run('boq-analysis', chiefEngineer, { packageId }) as Report & {
      lines: Record<string, unknown>[];
    };

    expect(drill.lines.length).toBeGreaterThan(0);
    expect(drill.lines.every((line) => typeof line.description === 'string')).toBe(true);
  });
});

describe('Schedule of Rates analysis and its history', () => {
  it('summarises the rate book by chapter, and shows where it is used', () => {
    const report = run('sr-rates', chiefEngineer) as Report & {
      chapters: { chapter: string; itemCount: number }[];
    };

    expect(report.chapters.length).toBeGreaterThan(0);
    expect(report.totals.items).toBe(report.items.length);
    expect(report.totals.inUse as number).toBeGreaterThan(0);
  });

  it('carries the whole movement of every rate', () => {
    const report = run('sr-rate-history', chiefEngineer);

    expect(report.totals.revisions as number).toBeGreaterThan(0);
    const revision = report.items.find((row) => row.changeKind === 'RATE_REVISED')!;
    expect(revision.oldRate).not.toBeNull();
    expect(revision.newRate).not.toBeNull();
    // A revision without the order behind it is not a record of anything.
    expect(revision.govtReference).toBeTruthy();
  });

  it('records a rate change as it happens, with what it was before', () => {
    const item = getDb()
      .prepare<[], { id: number; rate: number }>(
        `SELECT id, rate FROM schedule_of_rates ORDER BY id LIMIT 1`,
      )
      .get()!;

    masterService.update(
      'schedule-of-rates',
      item.id,
      { rate: 999, govt_reference: 'PWD/TEST/REVISION-1', effective_date: '2026-09-01' },
      chiefEngineer,
    );

    const history = masterService.history('schedule-of-rates', item.id);
    const latest = history[0]!;

    expect(latest.changeKind).toBe('RATE_REVISED');
    expect(latest.oldRate).toBeCloseTo(item.rate / 100, 2);
    expect(latest.newRate).toBe(999);
    expect(latest.govtReference).toBe('PWD/TEST/REVISION-1');
    expect(latest.changedBy).toBe(chiefEngineer.fullName);
  });

  it('does not write an entry for an edit that moved nothing worth recording', () => {
    const item = getDb()
      .prepare<[], { id: number }>(`SELECT id FROM schedule_of_rates ORDER BY id DESC LIMIT 1`)
      .get()!;
    const before = masterService.history('schedule-of-rates', item.id).length;

    masterService.update('schedule-of-rates', item.id, { uom: 'each' }, chiefEngineer);

    expect(masterService.history('schedule-of-rates', item.id)).toHaveLength(before);
  });
});

describe('approval analysis', () => {
  it('shows where files are held, and what each officer has done', () => {
    const report = run('approval-analysis', chiefEngineer) as Report & {
      turnaround: Record<string, unknown>[];
      officers: Record<string, unknown>[];
    };

    expect(report.items.length).toBeGreaterThan(0);
    expect(report.totals.filesPending as number).toBeGreaterThan(0);
    expect(report.officers.length).toBeGreaterThan(0);

    const pending = report.items.reduce((sum, row) => sum + (row.fileCount as number), 0);
    expect(report.totals.filesPending).toBe(pending);
  });
});
