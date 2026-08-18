import { getDb } from '../db/index.js';

export interface TenderRow {
  id: number;
  tender_no: string;
  title: string;
  description: string | null;
  project_id: number;
  package_id: number | null;
  division_id: number;
  tender_type: string;
  bid_type: string;
  estimated_value: number;
  emd_amount: number;
  tender_fee: number;
  completion_period_days: number;
  min_registration_class: string | null;
  eligibility_criteria: string | null;
  publish_date: string | null;
  bid_start_at: string | null;
  bid_end_at: string | null;
  technical_open_at: string | null;
  financial_open_at: string | null;
  status: string;
  workflow_instance_id: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface TenderDetailRow extends TenderRow {
  project_code: string;
  project_name: string;
  package_code: string | null;
  division_code: string;
  division_name: string;
  circle_id: number;
  zone_id: number;
  created_by_name: string | null;
  bid_count: number;
  submitted_bid_count: number;
}

const DETAIL_SELECT = `
  SELECT t.*,
         p.project_code, p.name AS project_name, p.circle_id, p.zone_id,
         pk.package_code,
         d.code AS division_code, d.name AS division_name,
         u.full_name AS created_by_name,
         (SELECT COUNT(*) FROM bids b WHERE b.tender_id = t.id) AS bid_count,
         (SELECT COUNT(*) FROM bids b WHERE b.tender_id = t.id AND b.status != 'DRAFT')
           AS submitted_bid_count
  FROM tenders t
  JOIN projects p ON p.id = t.project_id
  JOIN divisions d ON d.id = t.division_id
  LEFT JOIN packages pk ON pk.id = t.package_id
  LEFT JOIN users u ON u.id = t.created_by
`;

export function findById(id: number): TenderDetailRow | null {
  return (
    (getDb().prepare(`${DETAIL_SELECT} WHERE t.id = ?`).get(id) as TenderDetailRow | undefined) ?? null
  );
}

export interface ListTendersOptions {
  search?: string;
  status?: string;
  statuses?: string[];
  projectId?: number;
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
  /** Only tenders this contractor has bid on. */
  bidderContractorId?: number;
  limit: number;
  offset: number;
}

export function listTenders(options: ListTendersOptions): { rows: TenderDetailRow[]; total: number } {
  const where: string[] = [];
  const params: unknown[] = [];

  if (options.search) {
    where.push(`(t.title LIKE ? OR t.tender_no LIKE ? OR p.name LIKE ?)`);
    const like = `%${options.search}%`;
    params.push(like, like, like);
  }
  if (options.status) {
    where.push(`t.status = ?`);
    params.push(options.status);
  }
  if (options.statuses?.length) {
    where.push(`t.status IN (${options.statuses.map(() => '?').join(', ')})`);
    params.push(...options.statuses);
  }
  if (options.projectId) {
    where.push(`t.project_id = ?`);
    params.push(options.projectId);
  }
  if (options.divisionId) {
    where.push(`t.division_id = ?`);
    params.push(options.divisionId);
  }
  if (options.circleId) {
    where.push(`p.circle_id = ?`);
    params.push(options.circleId);
  }
  if (options.zoneId) {
    where.push(`p.zone_id = ?`);
    params.push(options.zoneId);
  }
  if (options.bidderContractorId) {
    where.push(`EXISTS (SELECT 1 FROM bids b WHERE b.tender_id = t.id AND b.contractor_id = ?)`);
    params.push(options.bidderContractorId);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const db = getDb();
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM tenders t JOIN projects p ON p.id = t.project_id ${clause}`)
      .get(...params) as { n: number }
  ).n;
  const rows = db
    .prepare(`${DETAIL_SELECT} ${clause} ORDER BY t.id DESC LIMIT ? OFFSET ?`)
    .all(...params, options.limit, options.offset) as TenderDetailRow[];

  return { rows, total };
}

export function insertTender(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO tenders (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateTender(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE tenders SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

// --- Bill of Quantities ----------------------------------------------------

export interface BoqItemRow {
  id: number;
  tender_id: number;
  sl_no: number;
  item_code: string | null;
  description: string;
  uom: string;
  quantity: number;
  estimated_rate: number;
}

export function listBoqItems(tenderId: number): BoqItemRow[] {
  return getDb()
    .prepare(`SELECT * FROM tender_boq_items WHERE tender_id = ? ORDER BY sl_no`)
    .all(tenderId) as BoqItemRow[];
}

export function replaceBoqItems(
  tenderId: number,
  items: Omit<BoqItemRow, 'id' | 'tender_id'>[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM tender_boq_items WHERE tender_id = ?`).run(tenderId);
    const stmt = db.prepare(
      `INSERT INTO tender_boq_items (tender_id, sl_no, item_code, description, uom, quantity, estimated_rate)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    items.forEach((item, index) => {
      stmt.run(
        tenderId,
        item.sl_no || index + 1,
        item.item_code,
        item.description,
        item.uom,
        item.quantity,
        item.estimated_rate,
      );
    });
  })();
}

// --- Bids ------------------------------------------------------------------

export interface BidRow {
  id: number;
  bid_no: string;
  tender_id: number;
  contractor_id: number;
  emd_reference: string | null;
  emd_paid: number;
  quoted_amount: number;
  variation_bps: number;
  technical_score: number | null;
  technical_status: string;
  technical_remarks: string | null;
  financial_status: string;
  rank: number | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BidDetailRow extends BidRow {
  contractor_name: string;
  contractor_code: string;
  contractor_class: string | null;
  tender_no: string;
  tender_title: string;
  tender_status: string;
  estimated_value: number;
}

const BID_SELECT = `
  SELECT b.*, c.name AS contractor_name, c.code AS contractor_code,
         c.registration_class AS contractor_class,
         t.tender_no, t.title AS tender_title, t.status AS tender_status, t.estimated_value
  FROM bids b
  JOIN contractors c ON c.id = b.contractor_id
  JOIN tenders t ON t.id = b.tender_id
`;

export function findBidById(id: number): BidDetailRow | null {
  return (
    (getDb().prepare(`${BID_SELECT} WHERE b.id = ?`).get(id) as BidDetailRow | undefined) ?? null
  );
}

export function findBidByTenderAndContractor(
  tenderId: number,
  contractorId: number,
): BidDetailRow | null {
  return (
    (getDb()
      .prepare(`${BID_SELECT} WHERE b.tender_id = ? AND b.contractor_id = ?`)
      .get(tenderId, contractorId) as BidDetailRow | undefined) ?? null
  );
}

/**
 * Bids for a tender. `includeFinancials` is false until the financial opening
 * date, so quoted amounts cannot be read during technical evaluation.
 */
export function listBidsForTender(tenderId: number): BidDetailRow[] {
  return getDb()
    .prepare(`${BID_SELECT} WHERE b.tender_id = ? ORDER BY b.rank IS NULL, b.rank, b.id`)
    .all(tenderId) as BidDetailRow[];
}

export function listBidsForContractor(
  contractorId: number,
  limit: number,
  offset: number,
): { rows: BidDetailRow[]; total: number } {
  const db = getDb();
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM bids WHERE contractor_id = ?`).get(contractorId) as {
      n: number;
    }
  ).n;
  const rows = db
    .prepare(`${BID_SELECT} WHERE b.contractor_id = ? ORDER BY b.id DESC LIMIT ? OFFSET ?`)
    .all(contractorId, limit, offset) as BidDetailRow[];
  return { rows, total };
}

export function insertBid(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO bids (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

export function updateBid(id: number, values: Record<string, unknown>): void {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  if (!entries.length) return;
  getDb()
    .prepare(`UPDATE bids SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id);
}

export interface BidItemRow {
  id: number;
  bid_id: number;
  boq_item_id: number;
  quoted_rate: number;
  amount: number;
  sl_no: number;
  description: string;
  uom: string;
  quantity: number;
  estimated_rate: number;
}

export function listBidItems(bidId: number): BidItemRow[] {
  return getDb()
    .prepare(
      `SELECT bi.*, q.sl_no, q.description, q.uom, q.quantity, q.estimated_rate
       FROM bid_items bi
       JOIN tender_boq_items q ON q.id = bi.boq_item_id
       WHERE bi.bid_id = ? ORDER BY q.sl_no`,
    )
    .all(bidId) as BidItemRow[];
}

export function replaceBidItems(
  bidId: number,
  items: { boqItemId: number; quotedRate: number; amount: number }[],
): void {
  const db = getDb();
  db.transaction(() => {
    db.prepare(`DELETE FROM bid_items WHERE bid_id = ?`).run(bidId);
    const stmt = db.prepare(
      `INSERT INTO bid_items (bid_id, boq_item_id, quoted_rate, amount) VALUES (?, ?, ?, ?)`,
    );
    for (const item of items) stmt.run(bidId, item.boqItemId, item.quotedRate, item.amount);
  })();
}

// --- Award -----------------------------------------------------------------

export interface AwardRow {
  id: number;
  tender_id: number;
  bid_id: number;
  contractor_id: number;
  loa_no: string;
  loa_date: string;
  awarded_value: number;
  negotiated_value: number | null;
  remarks: string | null;
  awarded_by: number | null;
  created_at: string;
}

export interface AwardDetailRow extends AwardRow {
  contractor_name: string;
  contractor_code: string;
  awarded_by_name: string | null;
}

export function findAwardByTender(tenderId: number): AwardDetailRow | null {
  return (
    (getDb()
      .prepare(
        `SELECT a.*, c.name AS contractor_name, c.code AS contractor_code, u.full_name AS awarded_by_name
         FROM tender_awards a
         JOIN contractors c ON c.id = a.contractor_id
         LEFT JOIN users u ON u.id = a.awarded_by
         WHERE a.tender_id = ?`,
      )
      .get(tenderId) as AwardDetailRow | undefined) ?? null
  );
}

export function insertAward(values: Record<string, unknown>): number {
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  const result = getDb()
    .prepare(
      `INSERT INTO tender_awards (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}
