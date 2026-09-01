/**
 * Shared machinery for the dashboard charts.
 *
 * The charts are hand-drawn SVG rather than a charting library: the department
 * stylesheet already carries the type, colour and spacing decisions, the bill
 * screens print, and a chart that cannot be printed or read at 200% zoom is not
 * much use in a government office. Every colour here is a CSS custom property
 * so a chart never hard-codes a hex value.
 */

/** The categorical slots, in the fixed order they must be assigned in. */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)',
  'var(--series-4)', 'var(--series-5)', 'var(--series-6)'] as const;

/**
 * A fixed hue per status, keyed on the status itself rather than on its
 * position in the data.
 *
 * The colour has to follow the thing, not its rank. These lists drop the
 * statuses nothing sits in, so indexing into the palette by array position
 * would repaint whatever survived: a division with no draft works would show
 * its works in progress in the colour head office uses for drafts, and two
 * officers comparing screens would be reading different charts.
 */
export const PROJECT_STATUS_COLOUR: Record<string, string> = {
  DRAFT: SERIES[0],
  PENDING_SANCTION: SERIES[1],
  SANCTIONED: SERIES[2],
  IN_PROGRESS: SERIES[3],
  COMPLETED: SERIES[4],
};

export const TENDER_STAGE_COLOUR: Record<string, string> = {
  PENDING_APPROVAL: SERIES[0],
  PUBLISHED: SERIES[1],
  UNDER_EVALUATION: SERIES[2],
  AWARDED: SERIES[3],
};

/**
 * Ageing is an ordered severity, not an identity, so it takes its own ramp
 * running from settled to serious rather than a categorical hue per bucket.
 */
export const AGE_RAMP = ['var(--age-1)', 'var(--age-2)', 'var(--age-3)', 'var(--age-4)'] as const;

/**
 * Rounds an axis maximum up to a readable number, so the top gridline reads
 * "1.5 Cr" rather than "1.47385 Cr". Returns 1 for an all-zero series, which
 * keeps the axis from collapsing and the bars from dividing by zero.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  // A fine ladder on purpose: rounding 2.6 up to 5 would leave the series
  // drawn across the bottom half of a chart that is mostly empty space.
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((s) => scaled <= s) ?? 10;
  return step * magnitude;
}

/** Evenly spaced axis values from zero to `max`, inclusive of both ends. */
export function ticks(max: number, count = 4): number[] {
  return Array.from({ length: count + 1 }, (_, i) => (max / count) * i);
}

/** "2026-04" -> "Apr 26". Kept short: an 18-month axis has no room for more. */
export function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  const name = new Date(Date.UTC(year, index - 1, 1))
    .toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  return `${name} ${String(year).slice(2)}`;
}

/** "2026-04" -> "April 2026", for tooltips, which have room for the whole word. */
export function monthLabelLong(month: string): string {
  const [year, index] = month.split('-').map(Number);
  if (!year || !index) return month;
  return new Date(Date.UTC(year, index - 1, 1))
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** Axis money, deliberately coarser than the table figures: "1.4 Cr", "60 L". */
export function axisMoney(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `${Number((value / 10_000_000).toFixed(2))} Cr`;
  if (abs >= 100_000) return `${Number((value / 100_000).toFixed(1))} L`;
  if (abs >= 1_000) return `${Math.round(value / 1_000)} K`;
  return String(Math.round(value));
}

/** A share of a total as a percentage, with an empty total reading as zero. */
export function share(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}
