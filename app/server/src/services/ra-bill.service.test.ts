import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as raBillService from './ra-bill.service.js';
import type { AuthUser } from '../types/auth.js';

/**
 * These run against a real seeded database. The RA bill is the most
 * arithmetic-heavy record in PMIS, and the figures below come from the
 * departmental bill form in the source requirements.
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

/** An awarded package the Executive Engineer's division can bill against. */
function billablePackageId(): number {
  const row = getDb()
    .prepare<[], { id: number }>(
      `SELECT pk.id FROM packages pk
        WHERE pk.contractor_id IS NOT NULL
          AND pk.status IN ('AWARDED', 'IN_PROGRESS', 'COMPLETED')
        ORDER BY pk.id LIMIT 1`,
    )
    .get();
  if (!row) throw new Error('Seed produced no awarded package.');
  return row.id;
}

let ee: AuthUser;
let accountClerk: AuthUser;
let packageId: number;

beforeAll(() => {
  seed();
  ee = userByUsername('ee.kumar');
  accountClerk = userByUsername('ac.nair');
  packageId = billablePackageId();
});

afterAll(() => {
  closeDb();
});

/** Creates a fresh draft bill for one line of work. */
function createDraft(quantityUptoDate: string, quantityPrevious: string, rate: string) {
  const input = raBillService.createRaBillSchema.parse({
    packageId,
    billType: 'RA',
    items: [
      {
        description: 'Laying 300 mm DI pipeline including jointing and testing',
        uom: 'rmt',
        quantityUptoDate,
        quantityPrevious,
        rate,
      },
    ],
  });
  return raBillService.create(input, ee);
}

describe('creating a running account bill', () => {
  it('prices the present quantity, not the cumulative one', () => {
    const bill = createDraft('1250', '400', '2450');

    expect(bill.items).toHaveLength(1);
    expect(bill.items[0]!.quantityPresent).toBe(850);
    // 850 rmt at ₹2,450 = ₹20,82,500.
    expect(bill.items[0]!.amount).toBe(2_082_500);
    expect(bill.amounts.presentBillAmount).toBe(2_082_500);
  });

  it('allots a bill number and starts as a draft', () => {
    const bill = createDraft('100', '0', '1000');

    expect(bill.billNo).toMatch(/^[A-Z-]+\/RA\/\d{4}-\d{2}\/\d{4}$/);
    expect(bill.status).toBe('DRAFT');
    expect(bill.dbrNo).toBeNull();
  });

  it('numbers each bill of a package in sequence', () => {
    const first = createDraft('10', '0', '100');
    const second = createDraft('20', '10', '100');

    expect(second.raSequence).toBe(first.raSequence + 1);
    expect(second.billNo).not.toBe(first.billNo);
  });

  it('seeds the statutory deduction schedule and nets it off', () => {
    const bill = createDraft('1000', '0', '1000');

    expect(bill.deductions.length).toBeGreaterThan(0);
    const summed = bill.deductions.reduce((total, d) => total + d.amount, 0);
    expect(bill.amounts.totalDeduction).toBeCloseTo(summed, 2);
    expect(bill.amounts.netPayableAmount).toBeCloseTo(
      bill.amounts.presentBillAmount - bill.amounts.totalDeduction,
      2,
    );
  });

  it('states the net payable in words for the voucher', () => {
    const bill = createDraft('1000', '0', '1000');
    expect(bill.amounts.netPayableInWords).toMatch(/^Rupees .+ Only$/);
  });

  it('refuses a bill whose cumulative quantity is below what was already billed', () => {
    expect(() => createDraft('100', '400', '2450')).toThrow(
      /cannot be less than the quantity already billed/,
    );
  });

  it('refuses a bill worth nothing', () => {
    expect(() => createDraft('100', '100', '2450')).toThrow(/greater than zero/);
  });
});

describe('the approval and certification chain', () => {
  it('allots a DBR number on submission and locks the bill for editing', () => {
    const draft = createDraft('500', '0', '1000');
    const submitted = raBillService.submit(draft.id, ee, 'Measurements checked at site.');

    expect(submitted.status).toBe('IN_APPROVAL');
    // The source documents number the divisional bill register as "1/23-24".
    expect(submitted.dbrNo).toMatch(/^\d+\/\d{2}-\d{2}$/);
    expect(submitted.workflowInstanceId).not.toBeNull();

    expect(() =>
      raBillService.update(draft.id, raBillService.updateRaBillSchema.parse({}), ee),
    ).toThrow(/can no longer be edited/);
  });

  it('applies the ETP percentages to the admissible amount on certification', () => {
    const draft = createDraft('1000', '0', '5');
    raBillService.submit(draft.id, ee);

    // The worked example in the source form: 2% + 3% + 4% on ₹5,000 is ₹450.
    const certified = raBillService.certify(
      draft.id,
      raBillService.certifySchema.parse({
        admissibleAmount: '5000',
        etpEstablishment: '2',
        etpToolsPlant: '3',
        etpContingency: '4',
      }),
      ee,
    );

    expect(certified.amounts.admissibleAmount).toBe(5000);
    expect(certified.etp.establishmentAmount).toBe(100);
    expect(certified.etp.toolsPlantAmount).toBe(150);
    expect(certified.etp.contingencyAmount).toBe(200);
    expect(certified.etp.totalPercent).toBe(9);
    expect(certified.etp.totalAmount).toBe(450);
    expect(certified.etp.basis).toBe('Admissible Amount');
  });

  it('refuses an admissible amount above what the contractor claimed', () => {
    const draft = createDraft('1000', '0', '5');
    raBillService.submit(draft.id, ee);

    expect(() =>
      raBillService.certify(
        draft.id,
        raBillService.certifySchema.parse({ admissibleAmount: '9999999' }),
        ee,
      ),
    ).toThrow(/cannot exceed the amount claimed/);
  });

  it('lets only the Executive Engineer certify', () => {
    const draft = createDraft('1000', '0', '5');
    raBillService.submit(draft.id, ee);

    expect(() =>
      raBillService.certify(
        draft.id,
        raBillService.certifySchema.parse({ admissibleAmount: '5000' }),
        accountClerk,
      ),
    ).toThrow(/Only the Executive Engineer/);
  });
});

describe('revising the deduction schedule', () => {
  it('recomputes percentage heads against the present bill amount', () => {
    const draft = createDraft('1000', '0', '100');
    raBillService.submit(draft.id, ee);

    const revised = raBillService.setDeductions(
      draft.id,
      raBillService.deductionsSchema.parse({
        deductions: [
          { code: 'IT-TDS', description: 'Income Tax TDS (194C)', basis: 'PERCENT', rate: '2' },
          { code: 'SD', description: 'Security Deposit', basis: 'PERCENT', rate: '5' },
          { code: 'ADV', description: 'Recovery of mobilisation advance', basis: 'AMOUNT', amount: '1500' },
        ],
      }),
      accountClerk,
    );

    // ₹1,00,000 gross: 2% = ₹2,000, 5% = ₹5,000, plus a flat ₹1,500.
    expect(revised.amounts.presentBillAmount).toBe(100_000);
    expect(revised.amounts.totalDeduction).toBe(8500);
    expect(revised.amounts.netPayableAmount).toBe(91_500);
  });

  it('refuses deductions that would swallow the whole bill', () => {
    const draft = createDraft('1000', '0', '100');
    raBillService.submit(draft.id, ee);

    expect(() =>
      raBillService.setDeductions(
        draft.id,
        raBillService.deductionsSchema.parse({
          deductions: [
            { code: 'ADV', description: 'Recovery of advance', basis: 'AMOUNT', amount: '200000' },
          ],
        }),
        accountClerk,
      ),
    ).toThrow(/cannot exceed the gross bill amount/);
  });

  it('refuses a percentage head with no rate', () => {
    const draft = createDraft('1000', '0', '100');
    raBillService.submit(draft.id, ee);

    expect(() =>
      raBillService.setDeductions(
        draft.id,
        raBillService.deductionsSchema.parse({
          deductions: [{ code: 'IT-TDS', description: 'Income Tax TDS', basis: 'PERCENT' }],
        }),
        accountClerk,
      ),
    ).toThrow(/Enter a rate/);
  });

  it('keeps the accounts cadre in sole charge of deductions', () => {
    const draft = createDraft('1000', '0', '100');
    raBillService.submit(draft.id, ee);

    const contractor = userByUsername('contracts@shakticonstructions.example');
    expect(() =>
      raBillService.setDeductions(
        draft.id,
        raBillService.deductionsSchema.parse({ deductions: [] }),
        contractor,
      ),
    ).toThrow(/accounts cadre/);
  });
});
