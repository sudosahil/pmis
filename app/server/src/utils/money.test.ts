import { describe, expect, it } from 'vitest';
import {
  amountInWords,
  applyBps,
  formatIndian,
  fromBps,
  fromQty,
  lineAmount,
  toBps,
  toPaise,
  toQty,
  toRupees,
} from './money.js';

describe('rupee and paise conversion', () => {
  it('converts a whole rupee amount to paise', () => {
    expect(toPaise(5000)).toBe(500_000);
  });

  it('converts a two-decimal string without losing the last paisa', () => {
    expect(toPaise('18420.45')).toBe(1_842_045);
  });

  it('pads a single decimal place to two', () => {
    expect(toPaise('12.5')).toBe(1250);
  });

  it('keeps negative amounts negative', () => {
    expect(toPaise('-99.99')).toBe(-9999);
  });

  it('rejects an amount with more than two decimals', () => {
    expect(() => toPaise('10.005')).toThrow(/Invalid rupee amount/);
  });

  it('rejects anything that is not a number', () => {
    expect(() => toPaise('1,000')).toThrow(/Invalid rupee amount/);
    expect(() => toPaise('')).toThrow(/Invalid rupee amount/);
  });

  it('round-trips through paise unchanged', () => {
    for (const amount of ['0.01', '0.99', '1', '1234567.89']) {
      expect(toRupees(toPaise(amount))).toBe(Number(amount));
    }
  });

  it('sums a long list of line items exactly, with no float drift', () => {
    // 0.1 + 0.2 !== 0.3 in floating point; in paise it is exact.
    const total = ['0.10', '0.20'].reduce((sum, value) => sum + toPaise(value), 0);
    expect(total).toBe(30);
    expect(toRupees(total)).toBe(0.3);
  });
});

describe('percentage and basis points', () => {
  it('converts a whole percentage', () => {
    expect(toBps(2)).toBe(200);
  });

  it('converts a fractional percentage', () => {
    expect(toBps('2.5')).toBe(250);
    expect(toBps('0.05')).toBe(5);
  });

  it('rejects a percentage with more than two decimals', () => {
    expect(() => toBps('2.505')).toThrow(/Invalid percentage/);
  });

  it('round-trips back to a percentage', () => {
    expect(fromBps(toBps('9.75'))).toBe(9.75);
  });
});

describe('applyBps', () => {
  it('reproduces the ETP worked example from the departmental bill form', () => {
    // Source document: on an admissible amount of ₹5,000, establishment 2%,
    // tools & plant 3% and contingency 4% together come to ₹450.
    const admissible = toPaise(5000);
    const establishment = applyBps(admissible, toBps(2));
    const toolsAndPlant = applyBps(admissible, toBps(3));
    const contingency = applyBps(admissible, toBps(4));

    expect(toRupees(establishment)).toBe(100);
    expect(toRupees(toolsAndPlant)).toBe(150);
    expect(toRupees(contingency)).toBe(200);
    expect(toRupees(establishment + toolsAndPlant + contingency)).toBe(450);
    expect(toRupees(applyBps(admissible, toBps(9)))).toBe(450);
  });

  it('rounds half away from zero at the paisa', () => {
    // ₹1.005 worth of tax: 100.5 paise rounds up to 101.
    expect(applyBps(toPaise('100.50'), toBps(1))).toBe(101);
  });

  it('keeps the sign of a negative amount', () => {
    expect(applyBps(-10_000, toBps(2))).toBe(-200);
  });

  it('returns zero when the rate is zero', () => {
    expect(applyBps(toPaise(999_999), 0)).toBe(0);
  });

  it('is exact for a large bill', () => {
    // 2% TDS on ₹1,84,20,000 is ₹3,68,400 exactly.
    expect(toRupees(applyBps(toPaise(18_420_000), toBps(2)))).toBe(368_400);
  });
});

describe('quantities and line amounts', () => {
  it('scales a three-decimal quantity to an integer', () => {
    expect(toQty('12.345')).toBe(12_345);
    expect(fromQty(toQty('12.345'))).toBe(12.345);
  });

  it('rejects a quantity with more than three decimals', () => {
    expect(() => toQty('1.2345')).toThrow(/Invalid quantity/);
  });

  it('prices a line to the paisa', () => {
    // 850 rmt at ₹2,450.00 = ₹20,82,500.
    expect(toRupees(lineAmount(toQty(850), toPaise(2450)))).toBe(2_082_500);
  });

  it('rounds a fractional quantity to the nearest paisa', () => {
    // 12.345 cu.m at ₹100.10 = ₹1,235.73 (1235.7345 rounded).
    expect(toRupees(lineAmount(toQty('12.345'), toPaise('100.10')))).toBe(1235.73);
  });

  it('handles a zero quantity', () => {
    expect(lineAmount(0, toPaise(2450))).toBe(0);
  });
});

describe('amountInWords', () => {
  it('renders zero', () => {
    expect(amountInWords(0)).toBe('Rupees Zero Only');
  });

  it('groups in the Indian system', () => {
    expect(amountInWords(toPaise(16_578_000))).toBe(
      'Rupees One Crore Sixty Five Lakh Seventy Eight Thousand Only',
    );
  });

  it('includes paise when there is a fraction', () => {
    expect(amountInWords(toPaise('450000.50'))).toBe(
      'Rupees Four Lakh Fifty Thousand and Paise Fifty Only',
    );
  });

  it('renders hundreds and teens', () => {
    expect(amountInWords(toPaise(1915))).toBe('Rupees One Thousand Nine Hundred Fifteen Only');
  });

  it('marks a negative amount', () => {
    expect(amountInWords(toPaise(-500))).toBe('Minus Rupees Five Hundred Only');
  });
});

describe('formatIndian', () => {
  it('groups by lakh and crore', () => {
    expect(formatIndian(toPaise(12_345_678))).toBe('1,23,45,678.00');
  });

  it('leaves amounts under a thousand ungrouped', () => {
    expect(formatIndian(toPaise('999.05'))).toBe('999.05');
  });

  it('marks a negative amount', () => {
    expect(formatIndian(toPaise('-1500.25'))).toBe('-1,500.25');
  });
});
