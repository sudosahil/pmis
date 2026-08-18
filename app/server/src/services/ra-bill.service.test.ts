import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeDb, getDb } from '../db/index.js';
import { seed } from '../db/seed.js';
import { findAuthUserById } from '../models/user.model.js';
import * as raBillService from './ra-bill.service.js';
import * as boqService from './boq.service.js';
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
let boqLines: { id: number; agreedRate: number; uom: string; quantity: number }[];

beforeAll(() => {
  seed();
  ee = userByUsername('ee.kumar');
  accountClerk = userByUsername('ac.nair');
  packageId = billablePackageId();
  boqLines = boqService.listForPackage(packageId, ee).items.map((item) => ({
    id: item.id,
    agreedRate: item.agreedRate,
    uom: item.uom,
    quantity: item.quantity,
  }));
});

afterAll(() => {
  closeDb();
});

/**
 * Creates a draft measuring one line of the agreement BOQ. The rate is not
 * passed — it comes from the agreement, which is the point of having a BOQ.
 */
function createDraft(quantityUptoDate: string, quantityPrevious = '0', boqIndex = 0) {
  const line = boqLines[boqIndex]!;
  const input = raBillService.createRaBillSchema.parse({
    packageId,
    billType: 'RA',
    items: [{ boqItemId: line.id, quantityUptoDate, quantityPrevious }],
  });
  return raBillService.create(input, ee);
}

/** The agreed rate of the BOQ line a draft measures, for expected amounts. */
function agreedRate(boqIndex = 0): number {
  return boqLines[boqIndex]!.agreedRate;
}

describe('creating a running account bill', () => {
  it('prices the present quantity, not the cumulative one', () => {
    const bill = createDraft('1250', '400');

    expect(bill.items).toHaveLength(1);
    expect(bill.items[0]!.quantityPresent).toBe(850);
    expect(bill.items[0]!.amount).toBe(850 * agreedRate());
    expect(bill.amounts.presentBillAmount).toBe(850 * agreedRate());
  });

  it('takes the rate and the description from the agreement, not the form', () => {
    const bill = createDraft('100');
    const line = boqLines[0]!;

    expect(bill.items[0]!.boqItemId).toBe(line.id);
    expect(bill.items[0]!.rate).toBe(line.agreedRate);
    expect(bill.items[0]!.uom).toBe(line.uom);
  });

  it('refuses a measurement that is not against an agreement item', () => {
    expect(() =>
      raBillService.create(
        raBillService.createRaBillSchema.parse({
          packageId,
          items: [
            { description: 'Something not in the agreement', uom: 'cum', quantityUptoDate: 10, rate: 100 },
          ],
        }),
        ee,
      ),
    ).toThrow(/choose the agreement BOQ item/);
  });

  it('refuses to measure more than the agreement provides for', () => {
    const line = boqLines[0]!;
    expect(() => createDraft(String(line.quantity + 1))).toThrow(/remain against an agreement quantity/);
  });

  it('allots a bill number and starts as a draft', () => {
    const bill = createDraft('100');

    expect(bill.billNo).toMatch(/^[A-Z-]+\/RA\/\d{4}-\d{2}\/\d{4}$/);
    expect(bill.status).toBe('DRAFT');
    expect(bill.dbrNo).toBeNull();
  });

  it('numbers each bill of a package in sequence', () => {
    const first = createDraft('10');
    const second = createDraft('20', '10');

    expect(second.raSequence).toBe(first.raSequence + 1);
    expect(second.billNo).not.toBe(first.billNo);
  });

  it('seeds the statutory deduction schedule and nets it off', () => {
    const bill = createDraft('1000');

    expect(bill.deductions.length).toBeGreaterThan(0);
    const summed = bill.deductions.reduce((total, d) => total + d.amount, 0);
    expect(bill.amounts.totalDeduction).toBeCloseTo(summed, 2);
    expect(bill.amounts.netPayableAmount).toBeCloseTo(
      bill.amounts.presentBillAmount - bill.amounts.totalDeduction,
      2,
    );
  });

  it('states the net payable in words for the voucher', () => {
    const bill = createDraft('1000');
    expect(bill.amounts.netPayableInWords).toMatch(/^Rupees .+ Only$/);
  });

  it('refuses a bill whose cumulative quantity is below what was already billed', () => {
    expect(() => createDraft('100', '400')).toThrow(
      /cannot be less than the quantity already billed/,
    );
  });

  it('refuses a bill worth nothing', () => {
    expect(() => createDraft('100', '100')).toThrow(/greater than zero/);
  });
});

describe('the approval and certification chain', () => {
  it('allots a DBR number on submission and locks the bill for editing', () => {
    const draft = createDraft('500');
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
    const draft = createDraft('1000');
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
    const draft = createDraft('1000');
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
    const draft = createDraft('1000');
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
    const draft = createDraft('1000');
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

    // The gross comes from the agreement, so the expected deductions are
    // derived from it rather than assumed: 2% + 5% of gross, plus a flat ₹1,500.
    const gross = 1000 * agreedRate();
    const expectedDeduction = Math.round(gross * 0.02) + Math.round(gross * 0.05) + 1500;

    expect(revised.amounts.presentBillAmount).toBe(gross);
    expect(revised.amounts.totalDeduction).toBe(expectedDeduction);
    expect(revised.amounts.netPayableAmount).toBe(gross - expectedDeduction);
  });

  it('refuses deductions that would swallow the whole bill', () => {
    const draft = createDraft('1000');
    raBillService.submit(draft.id, ee);

    expect(() =>
      raBillService.setDeductions(
        draft.id,
        raBillService.deductionsSchema.parse({
          deductions: [
            {
              code: 'ADV',
              description: 'Recovery of advance',
              basis: 'AMOUNT',
              // Comfortably more than the bill is worth, whatever the agreed rate.
              amount: String(1000 * agreedRate() + 1),
            },
          ],
        }),
        accountClerk,
      ),
    ).toThrow(/cannot exceed the gross bill amount/);
  });

  it('refuses a percentage head with no rate', () => {
    const draft = createDraft('1000');
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
    const draft = createDraft('1000');
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
