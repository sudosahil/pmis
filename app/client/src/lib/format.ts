/**
 * Display helpers. Money is formatted with Indian digit grouping
 * (lakh/crore) because that is what every register, voucher and report in
 * the department uses.
 */

const inr = new Intl.NumberFormat('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const inrCompact = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** "12,34,567.00" — no symbol, for table cells that already have a ₹ header. */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return inr.format(value);
}

/** "₹ 12,34,567.00" */
export function rupees(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `₹ ${inr.format(value)}`;
}

/**
 * Condenses large figures the way departmental summaries do:
 * ₹ 1.41 Cr, ₹ 24.50 L, ₹ 8,400.
 */
export function rupeesShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 10_000_000) return `₹ ${(value / 10_000_000).toFixed(2)} Cr`;
  if (abs >= 100_000) return `₹ ${(value / 100_000).toFixed(2)} L`;
  return `₹ ${inrCompact.format(value)}`;
}

export function percent(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function quantity(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(value);
}

/** "18 Aug 2026" */
export function date(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** "18 Aug 2026, 3:40 pm" */
export function dateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

/** "3 days ago", "in 2 days" — used for approval due dates. */
export function relativeTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value.length <= 10 ? `${value}T00:00:00` : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) return value;

  const diffMs = parsed.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);
  const rtf = new Intl.RelativeTimeFormat('en-IN', { numeric: 'auto' });

  if (Math.abs(diffDays) >= 1) return rtf.format(diffDays, 'day');
  const diffHours = Math.round(diffMs / 3_600_000);
  if (Math.abs(diffHours) >= 1) return rtf.format(diffHours, 'hour');
  return rtf.format(Math.round(diffMs / 60_000), 'minute');
}

/** Turns SCREAMING_SNAKE codes into readable words: "IN_APPROVAL" -> "In approval". */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  const words = value.replace(/_/g, ' ').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Initials for an avatar chip. */
export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name
    .replace(/^(Er\.|Dr\.|Shri|Smt\.|Mr\.|Ms\.|Mrs\.)\s+/i, '')
    .trim()
    .split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}

/** Today as YYYY-MM-DD, for date input defaults. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Current Indian financial year, e.g. "2026-27". */
export function currentFinancialYear(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
