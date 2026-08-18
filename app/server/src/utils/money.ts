/**
 * Money is kept as integer paise everywhere below the HTTP boundary, and
 * percentages as integer basis points (1% = 100 bps). Nothing in the money path
 * ever touches a float, so totals stay exact regardless of how many line items
 * a bill carries.
 */

export const PAISE_PER_RUPEE = 100;
export const BPS_PER_PERCENT = 100;

/** Converts a rupee value (number or numeric string) to integer paise. */
export function toPaise(rupees: number | string): number {
  const value = typeof rupees === 'string' ? rupees.trim() : String(rupees);
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const paise = Number(whole) * PAISE_PER_RUPEE + Number(fraction.padEnd(2, '0'));
  return negative ? -paise : paise;
}

/** Converts integer paise back to a rupee number for API responses. */
export function toRupees(paise: number): number {
  return Math.round(paise) / PAISE_PER_RUPEE;
}

/** Converts a percentage (e.g. 2.5) to integer basis points (250). */
export function toBps(percent: number | string): number {
  const value = typeof percent === 'string' ? percent.trim() : String(percent);
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error(`Invalid percentage: ${percent}`);
  }
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  const bps = Number(whole) * BPS_PER_PERCENT + Number(fraction.padEnd(2, '0'));
  return negative ? -bps : bps;
}

/** Converts integer basis points back to a percentage number. */
export function fromBps(bps: number): number {
  return Math.round(bps) / BPS_PER_PERCENT;
}

/**
 * Applies a basis-point rate to a paise amount, rounding half-up to the nearest
 * paisa. Government bills round to the paisa at each individual head rather
 * than only on the grand total, so this is applied per line.
 */
export function applyBps(amountPaise: number, bps: number): number {
  const product = amountPaise * bps;
  const divisor = BPS_PER_PERCENT * 100; // bps -> fraction
  return Math.sign(product) * Math.round(Math.abs(product) / divisor);
}

/** Quantities carry three decimals (e.g. 12.345 cu.m), stored as integers x1000. */
export const QTY_SCALE = 1000;

export function toQty(value: number | string): number {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^-?\d+(\.\d{1,3})?$/.test(text)) {
    throw new Error(`Invalid quantity: ${value}`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace('-', '').split('.');
  const scaled = Number(whole) * QTY_SCALE + Number(fraction.padEnd(3, '0'));
  return negative ? -scaled : scaled;
}

export function fromQty(scaled: number): number {
  return Math.round(scaled) / QTY_SCALE;
}

/** Line amount = quantity (x1000) * rate (paise), rounded to the paisa. */
export function lineAmount(quantityScaled: number, ratePaise: number): number {
  const product = quantityScaled * ratePaise;
  return Math.sign(product) * Math.round(Math.abs(product) / QTY_SCALE);
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  const rest = n % 10;
  return rest ? `${tens} ${ONES[rest]}` : tens;
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest) parts.push(twoDigits(rest));
  return parts.join(' ');
}

/**
 * Renders paise as the Indian-numbering words required on a bill voucher,
 * e.g. "Rupees Four Lakh Fifty Thousand and Paise Fifty Only".
 */
export function amountInWords(paise: number): string {
  if (paise === 0) return 'Rupees Zero Only';
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = Math.floor(abs / PAISE_PER_RUPEE);
  const fraction = abs % PAISE_PER_RUPEE;

  const groups: string[] = [];
  const crore = Math.floor(rupees / 10_000_000);
  const lakh = Math.floor((rupees % 10_000_000) / 100_000);
  const thousand = Math.floor((rupees % 100_000) / 1000);
  const hundred = rupees % 1000;

  if (crore) groups.push(`${threeDigits(crore)} Crore`);
  if (lakh) groups.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) groups.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) groups.push(threeDigits(hundred));

  const rupeeWords = groups.length ? groups.join(' ') : 'Zero';
  const parts = [`Rupees ${rupeeWords}`];
  if (fraction) parts.push(`and Paise ${twoDigits(fraction)}`);
  return `${negative ? 'Minus ' : ''}${parts.join(' ')} Only`;
}

/** Formats paise for display, e.g. 12345678 -> "1,23,456.78" (Indian grouping). */
export function formatIndian(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(Math.round(paise));
  const rupees = String(Math.floor(abs / PAISE_PER_RUPEE));
  const fraction = String(abs % PAISE_PER_RUPEE).padStart(2, '0');

  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3;
  return `${negative ? '-' : ''}${grouped}.${fraction}`;
}
