import { getDb } from '../db/index.js';

/**
 * The queries behind the departmental reports.
 *
 * Every report answers a question an officer already asks on paper: who has
 * billed what, what is sitting unpaid and for how long, how far agreements sit
 * from the approved rates, how the rate book has moved, and where files are
 * stuck. Money comes back in paise and is converted at the presenter, as
 * everywhere else below the HTTP boundary.
 */

export interface ScopeParams {
  divisionId?: number;
  circleId?: number;
  zoneId?: number;
}

export interface PeriodParams {
  from?: string;
  to?: string;
  financialYear?: string;
}

/**
 * A predicate builder that keeps clauses and their parameters together.
 *
 * SQLite binds by position, so a clause added without its parameter — or in a
 * different order — silently filters on the wrong value. Pushing both through
 * one object is what stops that.
 */
class Predicate {
  private readonly clauses: string[] = [];
  readonly params: unknown[] = [];

  add(clause: string, ...params: unknown[]): this {
    this.clauses.push(clause);
    this.params.push(...params);
    return this;
  }

  /** Narrows to the user's own division, circle or zone — the widest wins. */
  scope(alias: string, scope: ScopeParams, { viaProject = true } = {}): this {
    if (scope.divisionId) return this.add(`${alias}.division_id = ?`, scope.divisionId);
    if (!viaProject) return this;
    if (scope.circleId) return this.add(`${alias}.circle_id = ?`, scope.circleId);
    if (scope.zoneId) return this.add(`${alias}.zone_id = ?`, scope.zoneId);
    return this;
  }

  period(column: string, period: PeriodParams): this {
    if (period.from) this.add(`date(${column}) >= ?`, period.from);
    if (period.to) this.add(`date(${column}) <= ?`, period.to);
    return this;
  }

  toString(): string {
    return this.clauses.length ? `WHERE ${this.clauses.join(' AND ')}` : '';
  }
}

/**
 * Days a file has sat where it is now: since the last action taken on it, or
 * since it was raised if nobody has touched it yet.
 */
const DAYS_AT_STAGE = `julianday('now') - julianday(COALESCE(
  (SELECT MAX(wa.created_at) FROM workflow_actions wa WHERE wa.instance_id = wi.id),
  wi.created_at))`;

// --- 1. Contractor-wise bill submission --------------------------------------

export interface ContractorBillRow {
  contractor_id: number;
  contractor_code: string;
  contractor_name: string;
  registration_class: string | null;
  is_blacklisted: number;
  bill_count: number;
  claimed_amount: number;
  net_payable: number;
  paid_count: number;
  paid_amount: number;
  in_approval_count: number;
  pending_amount: number;
  rejected_count: number;
  first_bill_date: string | null;
  last_bill_date: string | null;
  /** Mean days from raising a bill to paying it, over bills actually paid. */
  avg_days_to_pay: number | null;
  package_count: number;
  awarded_value: number;
}

export function contractorBills(scope: ScopeParams, period: PeriodParams): ContractorBillRow[] {
  const predicate = new Predicate().scope('p', scope).period('rb.created_at', period);
  if (period.financialYear) predicate.add('rb.financial_year = ?', period.financialYear);

  return getDb()
    .prepare(
      `SELECT c.id AS contractor_id, c.code AS contractor_code, c.name AS contractor_name,
              c.registration_class, c.is_blacklisted,
              COUNT(rb.id) AS bill_count,
              COALESCE(SUM(rb.contractor_claim_amount), 0) AS claimed_amount,
              COALESCE(SUM(rb.net_payable_amount), 0) AS net_payable,
              COALESCE(SUM(CASE WHEN rb.status = 'PAID' THEN 1 ELSE 0 END), 0) AS paid_count,
              COALESCE(SUM(CASE WHEN rb.status = 'PAID' THEN rb.net_payable_amount ELSE 0 END), 0)
                AS paid_amount,
              COALESCE(SUM(CASE WHEN rb.status IN ('SUBMITTED','IN_APPROVAL','APPROVED','SENT_TO_TALLY')
                           THEN 1 ELSE 0 END), 0) AS in_approval_count,
              COALESCE(SUM(CASE WHEN rb.status IN ('SUBMITTED','IN_APPROVAL','APPROVED','SENT_TO_TALLY')
                           THEN rb.net_payable_amount ELSE 0 END), 0) AS pending_amount,
              COALESCE(SUM(CASE WHEN rb.status = 'REJECTED' THEN 1 ELSE 0 END), 0) AS rejected_count,
              MIN(date(rb.created_at)) AS first_bill_date,
              MAX(date(rb.created_at)) AS last_bill_date,
              AVG(CASE WHEN rb.status = 'PAID' AND rb.payment_date IS NOT NULL
                       THEN julianday(rb.payment_date) - julianday(date(rb.created_at)) END)
                AS avg_days_to_pay,
              (SELECT COUNT(*) FROM packages pk WHERE pk.contractor_id = c.id) AS package_count,
              (SELECT COALESCE(SUM(pk.awarded_value), 0) FROM packages pk WHERE pk.contractor_id = c.id)
                AS awarded_value
         FROM contractors c
         JOIN ra_bills rb ON rb.contractor_id = c.id
         JOIN projects p ON p.id = rb.project_id
         ${predicate}
        GROUP BY c.id
        ORDER BY net_payable DESC`,
    )
    .all(...predicate.params) as ContractorBillRow[];
}

// --- 2. Ageing analysis of bills ---------------------------------------------

export interface BillAgeingRow {
  kind: string;
  id: number;
  bill_no: string;
  reference: string | null;
  payee: string | null;
  division_code: string;
  division_name: string;
  status: string;
  amount: number;
  raised_on: string;
  /** Days since the bill was raised — the figure a contractor chases on. */
  days_pending: number;
  /** Days it has sat at the desk it is on now. */
  days_at_stage: number;
  current_stage: string | null;
  pending_with_role: string | null;
  pending_with_name: string | null;
  due_at: string | null;
  is_overdue: number;
}

/** The columns both bill kinds contribute to the ageing register. */
const AGEING_COLUMNS = (dateColumn: string) => `
  date(${dateColumn}) AS raised_on,
  CAST(julianday('now') - julianday(date(${dateColumn})) AS INTEGER) AS days_pending,
  CAST(COALESCE(${DAYS_AT_STAGE}, julianday('now') - julianday(date(${dateColumn}))) AS INTEGER)
    AS days_at_stage,
  ws.name AS current_stage,
  wi.assigned_role AS pending_with_role,
  u.full_name AS pending_with_name,
  wi.due_at,
  CASE WHEN wi.due_at IS NOT NULL AND wi.due_at < datetime('now') THEN 1 ELSE 0 END AS is_overdue`;

/** Bills that are neither paid nor rejected — the ones still owing an action. */
const UNSETTLED = `status NOT IN ('PAID', 'REJECTED', 'DRAFT')`;

/**
 * Every bill still waiting, with how long it has been waiting.
 *
 * Two clocks matter, and they answer different questions: how long the money
 * has been owed, and how long the file has sat on the desk it is on now. The
 * first is what a contractor asks about; the second is what says where the
 * delay actually is.
 */
export function billAgeing(scope: ScopeParams, period: PeriodParams): BillAgeingRow[] {
  const db = getDb();

  const raWhere = new Predicate()
    .add(`rb.${UNSETTLED}`)
    .scope('p', scope)
    .period('rb.created_at', period);
  if (period.financialYear) raWhere.add('rb.financial_year = ?', period.financialYear);

  const ra = db
    .prepare(
      `SELECT 'RA' AS kind, rb.id, rb.bill_no, rb.dbr_no AS reference,
              c.name AS payee,
              d.code AS division_code, d.name AS division_name,
              rb.status, rb.net_payable_amount AS amount,
              ${AGEING_COLUMNS('rb.created_at')}
         FROM ra_bills rb
         JOIN projects p ON p.id = rb.project_id
         JOIN divisions d ON d.id = rb.division_id
         LEFT JOIN contractors c ON c.id = rb.contractor_id
         LEFT JOIN workflow_instances wi ON wi.id = rb.workflow_instance_id
         LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
         LEFT JOIN users u ON u.id = wi.assigned_user_id
         ${raWhere}`,
    )
    .all(...raWhere.params) as BillAgeingRow[];

  // Miscellaneous bills belong to a division directly; they have no project to
  // widen the scope through, so a circle or zone officer sees all of theirs.
  const miscWhere = new Predicate()
    .add(`mb.${UNSETTLED}`)
    .scope('mb', scope, { viaProject: false })
    .period('mb.created_at', period);
  if (period.financialYear) miscWhere.add('mb.financial_year = ?', period.financialYear);

  const misc = db
    .prepare(
      `SELECT 'MISC' AS kind, mb.id, mb.bill_no, mb.tally_voucher_no AS reference,
              mb.payee_name AS payee,
              d.code AS division_code, d.name AS division_name,
              mb.status, mb.net_payable_amount AS amount,
              ${AGEING_COLUMNS('mb.created_at')}
         FROM misc_bills mb
         JOIN divisions d ON d.id = mb.division_id
         LEFT JOIN workflow_instances wi ON wi.id = mb.workflow_instance_id
         LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
         LEFT JOIN users u ON u.id = wi.assigned_user_id
         ${miscWhere}`,
    )
    .all(...miscWhere.params) as BillAgeingRow[];

  return [...ra, ...misc].sort((a, b) => b.days_pending - a.days_pending);
}

// --- 3. BOQ analysis ----------------------------------------------------------

export interface BoqAnalysisRow {
  package_id: number;
  package_code: string;
  package_name: string;
  project_code: string;
  project_name: string;
  division_code: string;
  contractor_name: string | null;
  item_count: number;
  matched_count: number;
  above_sr_count: number;
  agreement_value: number;
  sr_value: number;
  billed_value: number;
}

/**
 * Each agreement read against the Schedule of Rates: what it was signed at,
 * what the same work comes to at approved rates, and how much has been billed.
 */
export function boqAnalysis(scope: ScopeParams): BoqAnalysisRow[] {
  const predicate = new Predicate().scope('p', scope);

  return getDb()
    .prepare(
      `SELECT pk.id AS package_id, pk.package_code, pk.name AS package_name,
              p.project_code, p.name AS project_name,
              d.code AS division_code,
              c.name AS contractor_name,
              COUNT(b.id) AS item_count,
              COALESCE(SUM(CASE WHEN b.sr_rate > 0 THEN 1 ELSE 0 END), 0) AS matched_count,
              COALESCE(SUM(CASE WHEN b.sr_rate > 0 AND b.agreed_rate > b.sr_rate THEN 1 ELSE 0 END), 0)
                AS above_sr_count,
              COALESCE(SUM(b.amount), 0) AS agreement_value,
              COALESCE(SUM(CASE WHEN b.sr_rate > 0
                           THEN CAST(b.quantity AS INTEGER) * b.sr_rate / 1000
                           ELSE b.amount END), 0) AS sr_value,
              COALESCE((
                SELECT SUM(i.amount) FROM ra_bill_items i
                  JOIN ra_bills rb ON rb.id = i.ra_bill_id
                  JOIN package_boq_items bb ON bb.id = i.boq_item_id
                 WHERE bb.package_id = pk.id AND rb.status NOT IN ('REJECTED','CANCELLED')
              ), 0) AS billed_value
         FROM packages pk
         JOIN projects p ON p.id = pk.project_id
         JOIN divisions d ON d.id = p.division_id
         LEFT JOIN contractors c ON c.id = pk.contractor_id
         JOIN package_boq_items b ON b.package_id = pk.id
         ${predicate}
        GROUP BY pk.id
        ORDER BY agreement_value DESC`,
    )
    .all(...predicate.params) as BoqAnalysisRow[];
}

/** The lines of one agreement, for the drill-down under a package row. */
export interface BoqAnalysisItemRow {
  id: number;
  sl_no: number;
  item_code: string | null;
  description: string;
  uom: string;
  quantity: number;
  agreed_rate: number;
  sr_rate: number;
  sr_code: string | null;
  amount: number;
}

export function boqAnalysisItems(packageId: number): BoqAnalysisItemRow[] {
  return getDb()
    .prepare(
      `SELECT b.id, b.sl_no, b.item_code, b.description, b.uom, b.quantity,
              b.agreed_rate, b.sr_rate, sr.code AS sr_code, b.amount
         FROM package_boq_items b
         LEFT JOIN schedule_of_rates sr ON sr.id = b.sr_item_id
        WHERE b.package_id = ? ORDER BY b.sl_no`,
    )
    .all(packageId) as BoqAnalysisItemRow[];
}

// --- 4. Schedule of Rates analysis --------------------------------------------

export interface SrChapterRow {
  chapter: string | null;
  item_count: number;
  active_count: number;
  min_rate: number;
  max_rate: number;
  avg_rate: number;
  edition_count: number;
  /** Live agreement lines priced against this chapter. */
  usage_count: number;
  revision_count: number;
  last_revised_on: string | null;
}

export function srRatesByChapter(): SrChapterRow[] {
  return getDb()
    .prepare(
      `SELECT sr.chapter,
              COUNT(*) AS item_count,
              SUM(CASE WHEN sr.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_count,
              MIN(sr.rate) AS min_rate,
              MAX(sr.rate) AS max_rate,
              CAST(AVG(sr.rate) AS INTEGER) AS avg_rate,
              COUNT(DISTINCT sr.sr_year) AS edition_count,
              COALESCE((
                SELECT COUNT(*) FROM package_boq_items b
                  JOIN schedule_of_rates s2 ON s2.id = b.sr_item_id
                 WHERE s2.chapter IS sr.chapter
              ), 0) AS usage_count,
              COALESCE((
                SELECT COUNT(*) FROM schedule_of_rate_history h
                 WHERE h.chapter IS sr.chapter AND h.change_kind = 'RATE_REVISED'
              ), 0) AS revision_count,
              (SELECT MAX(date(h.created_at)) FROM schedule_of_rate_history h
                WHERE h.chapter IS sr.chapter) AS last_revised_on
         FROM schedule_of_rates sr
        GROUP BY sr.chapter
        ORDER BY sr.chapter`,
    )
    .all() as SrChapterRow[];
}

export interface SrItemUsageRow {
  id: number;
  code: string;
  name: string;
  chapter: string | null;
  uom: string;
  rate: number;
  sr_year: string;
  status: string;
  effective_date: string | null;
  govt_reference: string | null;
  agreement_lines: number;
  above_count: number;
  below_count: number;
  agreement_value: number;
  sr_value: number;
  revision_count: number;
  last_revised_on: string | null;
}

/** Each rate, and how the agreements priced against it actually came out. */
export function srRateUsage(chapter?: string): SrItemUsageRow[] {
  const predicate = new Predicate();
  if (chapter) predicate.add('sr.chapter = ?', chapter);

  return getDb()
    .prepare(
      `SELECT sr.id, sr.code, sr.name, sr.chapter, sr.uom, sr.rate, sr.sr_year, sr.status,
              sr.effective_date, sr.govt_reference,
              COALESCE((SELECT COUNT(*) FROM package_boq_items b WHERE b.sr_item_id = sr.id), 0)
                AS agreement_lines,
              COALESCE((SELECT COUNT(*) FROM package_boq_items b
                         WHERE b.sr_item_id = sr.id AND b.agreed_rate > b.sr_rate), 0) AS above_count,
              COALESCE((SELECT COUNT(*) FROM package_boq_items b
                         WHERE b.sr_item_id = sr.id AND b.agreed_rate < b.sr_rate), 0) AS below_count,
              COALESCE((SELECT SUM(b.amount) FROM package_boq_items b WHERE b.sr_item_id = sr.id), 0)
                AS agreement_value,
              COALESCE((SELECT SUM(CAST(b.quantity AS INTEGER) * b.sr_rate / 1000)
                          FROM package_boq_items b WHERE b.sr_item_id = sr.id), 0) AS sr_value,
              COALESCE((SELECT COUNT(*) FROM schedule_of_rate_history h
                         WHERE h.sr_item_id = sr.id AND h.change_kind = 'RATE_REVISED'), 0)
                AS revision_count,
              (SELECT MAX(date(h.created_at)) FROM schedule_of_rate_history h WHERE h.sr_item_id = sr.id)
                AS last_revised_on
         FROM schedule_of_rates sr
         ${predicate}
        ORDER BY agreement_lines DESC, sr.code`,
    )
    .all(...predicate.params) as SrItemUsageRow[];
}

// --- 6. Approval analysis -----------------------------------------------------

export interface PendencyRow {
  role_code: string | null;
  role_name: string | null;
  entity_type: string;
  step_name: string | null;
  file_count: number;
  value_held: number;
  avg_days_pending: number | null;
  oldest_days: number | null;
  overdue_count: number;
}

/** Where files are sitting now, by the desk that owes the next action. */
export function pendency(scope: ScopeParams): PendencyRow[] {
  const predicate = new Predicate().add(`wi.status = 'IN_PROGRESS'`).scope('wi', scope);

  return getDb()
    .prepare(
      `SELECT wi.assigned_role AS role_code, r.name AS role_name,
              wi.entity_type, ws.name AS step_name,
              COUNT(*) AS file_count,
              COALESCE(SUM(wi.amount), 0) AS value_held,
              AVG(${DAYS_AT_STAGE}) AS avg_days_pending,
              MAX(${DAYS_AT_STAGE}) AS oldest_days,
              SUM(CASE WHEN wi.due_at IS NOT NULL AND wi.due_at < datetime('now') THEN 1 ELSE 0 END)
                AS overdue_count
         FROM workflow_instances wi
         LEFT JOIN roles r ON r.code = wi.assigned_role
         LEFT JOIN workflow_steps ws ON ws.id = wi.current_step_id
         ${predicate}
        GROUP BY wi.assigned_role, wi.entity_type, ws.name
        ORDER BY overdue_count DESC, file_count DESC`,
    )
    .all(...predicate.params) as PendencyRow[];
}

export interface TurnaroundRow {
  entity_type: string;
  completed_count: number;
  approved_count: number;
  rejected_count: number;
  avg_days: number | null;
  fastest_days: number | null;
  slowest_days: number | null;
}

/** How long finished files actually took, end to end. */
export function turnaround(scope: ScopeParams, period: PeriodParams): TurnaroundRow[] {
  const predicate = new Predicate()
    .add(`wi.status IN ('APPROVED', 'REJECTED')`)
    .add(`wi.completed_at IS NOT NULL`)
    .scope('wi', scope)
    .period('wi.completed_at', period);

  return getDb()
    .prepare(
      `SELECT wi.entity_type,
              COUNT(*) AS completed_count,
              SUM(CASE WHEN wi.status = 'APPROVED' THEN 1 ELSE 0 END) AS approved_count,
              SUM(CASE WHEN wi.status = 'REJECTED' THEN 1 ELSE 0 END) AS rejected_count,
              AVG(julianday(wi.completed_at) - julianday(wi.created_at)) AS avg_days,
              MIN(julianday(wi.completed_at) - julianday(wi.created_at)) AS fastest_days,
              MAX(julianday(wi.completed_at) - julianday(wi.created_at)) AS slowest_days
         FROM workflow_instances wi
         ${predicate}
        GROUP BY wi.entity_type
        ORDER BY completed_count DESC`,
    )
    .all(...predicate.params) as TurnaroundRow[];
}

export interface OfficerActionRow {
  user_id: number | null;
  actor_name: string | null;
  actor_role: string | null;
  approved: number;
  returned: number;
  rejected: number;
  total_actions: number;
  /** Files still on this officer's desk right now. */
  pending_now: number;
}

/** What each officer has actually done, and what is still waiting on them. */
export function officerActions(scope: ScopeParams, period: PeriodParams): OfficerActionRow[] {
  const predicate = new Predicate()
    .add(`wa.action IN ('APPROVE', 'RETURN', 'REJECT')`)
    .scope('wi', scope)
    .period('wa.created_at', period);

  return getDb()
    .prepare(
      `SELECT wa.actor_user_id AS user_id, wa.actor_name, wa.actor_role,
              SUM(CASE WHEN wa.action = 'APPROVE' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN wa.action = 'RETURN' THEN 1 ELSE 0 END) AS returned,
              SUM(CASE WHEN wa.action = 'REJECT' THEN 1 ELSE 0 END) AS rejected,
              COUNT(*) AS total_actions,
              COALESCE((
                SELECT COUNT(*) FROM workflow_instances w2
                 WHERE w2.status = 'IN_PROGRESS'
                   AND (w2.assigned_user_id = wa.actor_user_id
                        OR (w2.assigned_user_id IS NULL AND w2.assigned_role = wa.actor_role))
              ), 0) AS pending_now
         FROM workflow_actions wa
         JOIN workflow_instances wi ON wi.id = wa.instance_id
         ${predicate}
        GROUP BY wa.actor_user_id
        ORDER BY total_actions DESC`,
    )
    .all(...predicate.params) as OfficerActionRow[];
}

/** The divisions a report may be narrowed to, within the reader's own scope. */
export function divisionsInScope(scope: ScopeParams): { id: number; code: string; name: string }[] {
  const predicate = new Predicate().add(`d.status = 'ACTIVE'`);
  if (scope.divisionId) predicate.add('d.id = ?', scope.divisionId);
  else if (scope.circleId) predicate.add('d.circle_id = ?', scope.circleId);
  else if (scope.zoneId) predicate.add('c.zone_id = ?', scope.zoneId);

  return getDb()
    .prepare(
      `SELECT d.id, d.code, d.name FROM divisions d
         JOIN circles c ON c.id = d.circle_id
         ${predicate} ORDER BY d.name`,
    )
    .all(...predicate.params) as { id: number; code: string; name: string }[];
}
