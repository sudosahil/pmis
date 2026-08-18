import { nextSequence } from '../db/index.js';

/**
 * The Indian financial year runs April to March. Bills, DBR numbers and LOC
 * requests are all numbered against it, so it is derived in one place.
 */
export function financialYear(date: Date = new Date()): string {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

/** Short form used inside DBR numbers, e.g. "23-24". */
export function financialYearShort(date: Date = new Date()): string {
  return financialYear(date).slice(2);
}

export function slug(text: string, maxLength = 12): string {
  return text
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '')
    .slice(0, maxLength)
    .toUpperCase();
}

const pad = (n: number, width = 4) => String(n).padStart(width, '0');

/**
 * Project code follows the departmental convention seen in the source
 * documents: <SCHEME>-<TOWN/DISTRICT>-<SERIAL>, e.g. "U-PLAN-KALBURGI-0615".
 * Generated exactly once — updating a project never regenerates it.
 */
export function generateProjectCode(schemeCode: string, locationName: string): string {
  const key = `PROJECT:${schemeCode}:${slug(locationName)}`;
  return `${slug(schemeCode, 10)}-${slug(locationName)}-${pad(nextSequence(key))}`;
}

/** Package code is scoped to its project: <PROJECT_CODE>/PKG-01. */
export function generatePackageCode(projectCode: string): string {
  const serial = nextSequence(`PACKAGE:${projectCode}`);
  return `${projectCode}/PKG-${pad(serial, 2)}`;
}

/** Tender number: <DIVISION>/TEN/<FY>/<SERIAL>. */
export function generateTenderNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`TENDER:${divisionCode}:${fy}`);
  return `${divisionCode}/TEN/${fy}/${pad(serial)}`;
}

/** Bid number: <TENDER_NO>/BID/<SERIAL>. */
export function generateBidNo(tenderNo: string): string {
  const serial = nextSequence(`BID:${tenderNo}`);
  return `${tenderNo}/BID/${pad(serial, 3)}`;
}

/** RA bill number: <DIVISION>/RA/<FY>/<SERIAL>. */
export function generateRaBillNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`RA_BILL:${divisionCode}:${fy}`);
  return `${divisionCode}/RA/${fy}/${pad(serial)}`;
}

/**
 * DBR (Divisional Bill Register) number. Per the source documents this is a
 * running number within a division for a financial year: "1/23-24".
 */
export function generateDbrNo(divisionCode: string, date: Date = new Date()): string {
  const fy = financialYear(date);
  const serial = nextSequence(`DBR:${divisionCode}:${fy}`);
  return `${serial}/${financialYearShort(date)}`;
}

/** Sequence of an RA bill within its package (RA Bill No. 1, 2, 3 ...). */
export function nextRaSequence(packageCode: string): number {
  return nextSequence(`RA_SEQ:${packageCode}`);
}

/** Miscellaneous bill number: <DIVISION>/<CATEGORY>/<FY>/<SERIAL>. */
export function generateMiscBillNo(
  divisionCode: string,
  category: string,
  fy = financialYear(),
): string {
  const short = { PROJECT_EXPENSE: 'PE', REVENUE_EXPENSE: 'RE', REFUND: 'RF' }[category] ?? 'MB';
  const serial = nextSequence(`MISC_BILL:${divisionCode}:${short}:${fy}`);
  return `${divisionCode}/${short}/${fy}/${pad(serial)}`;
}

/** Contractor code, e.g. "C-10025". */
export function generateContractorCode(): string {
  return `C-${10000 + nextSequence('CONTRACTOR')}`;
}

/** Letter of Acceptance number issued on tender award. */
export function generateLoaNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`LOA:${divisionCode}:${fy}`);
  return `${divisionCode}/LOA/${fy}/${pad(serial, 3)}`;
}

/** Work order number issued once an award is converted into a package. */
export function generateWorkOrderNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`WO:${divisionCode}:${fy}`);
  return `${divisionCode}/WO/${fy}/${pad(serial, 3)}`;
}

/** LOC request number: <DIVISION>/LOC/<FY>/<SERIAL>. */
export function generateLocNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`LOC:${divisionCode}:${fy}`);
  return `${divisionCode}/LOC/${fy}/${pad(serial, 3)}`;
}

/** Fund release reference: <SCHEME>/FR/<FY>/<SERIAL>. */
export function generateFundReleaseNo(schemeCode: string, fy = financialYear()): string {
  const serial = nextSequence(`FUND_RELEASE:${schemeCode}:${fy}`);
  return `${slug(schemeCode, 10)}/FR/${fy}/${pad(serial, 3)}`;
}

/** Tally voucher reference stamped when a bill is exported to accounting. */
export function generateTallyVoucherNo(divisionCode: string, fy = financialYear()): string {
  const serial = nextSequence(`TALLY:${divisionCode}:${fy}`);
  return `TV/${divisionCode}/${fy}/${pad(serial, 5)}`;
}
