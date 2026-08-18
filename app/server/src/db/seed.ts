/**
 * Seeds a working PMIS instance: the role catalogue, the approval chains from
 * the source workflow documents, every master listed in the Project Masters
 * specification, one demo user per role, and enough live records to exercise
 * procurement and billing end to end.
 *
 * Safe to re-run — every insert is keyed on a natural code and skipped if the
 * row already exists.
 */
import { getDb, nextSequence } from './index.js';
import { hashPassword } from '../services/auth.service.js';
import { act, startWorkflow } from '../services/workflow.service.js';
import { findAuthUserById } from '../models/user.model.js';
import { ROLES, WORKFLOWS, ENTITY_TYPES, WORKFLOW_ACTIONS } from '../config/constants.js';
import type { AuthUser } from '../types/auth.js';
import { toBps, toPaise } from '../utils/money.js';
import { slug } from '../utils/codes.js';

// Domain services register their workflow outcome handlers on import, so a
// seeded approval updates the underlying bill exactly as a live one would.
import '../services/ra-bill.service.js';
import '../services/misc-bill.service.js';
import '../services/contractor.service.js';
import '../services/tender.service.js';
import '../services/project.service.js';
import '../services/fund.service.js';

const DEMO_PASSWORD = 'Pmis@12345';

type Ids = Record<string, number>;

function upsert(
  table: string,
  code: string,
  values: Record<string, unknown>,
): number {
  const db = getDb();
  const existing = db.prepare(`SELECT id FROM ${table} WHERE code = ?`).get(code) as
    | { id: number }
    | undefined;
  if (existing) return existing.id;

  const payload = { code, ...values };
  const entries = Object.entries(payload).filter(([, v]) => v !== undefined);
  const result = db
    .prepare(
      `INSERT INTO ${table} (${entries.map(([k]) => k).join(', ')})
       VALUES (${entries.map(() => '?').join(', ')})`,
    )
    .run(...entries.map(([, v]) => v));
  return Number(result.lastInsertRowid);
}

// --- 1. Roles --------------------------------------------------------------

function seedRoles(): void {
  const db = getDb();
  const roles: [string, string, string, string, number][] = [
    [ROLES.ADMIN, 'System Administrator', 'Manages users, masters and system configuration.', 'SYSTEM', 100],
    [ROLES.MD, 'Managing Director', 'Head of the board. Final authority on sanction and payment release.', 'STAFF', 90],
    [ROLES.CE, 'Chief Engineer', 'Technical head of a zone. Sanctions major works.', 'STAFF', 80],
    [ROLES.SE, 'Superintending Engineer', 'Heads a circle. Reviews sanctions and tenders.', 'STAFF', 70],
    [ROLES.EE, 'Executive Engineer', 'Heads a division. Certifies works bills and runs tenders.', 'STAFF', 60],
    [ROLES.AEE, 'Assistant Executive Engineer', 'Supports the division on technical scrutiny.', 'STAFF', 50],
    [ROLES.AE, 'Assistant Engineer', 'Sub-divisional officer. Records and checks measurements.', 'STAFF', 40],
    [ROLES.AC, 'Account Clerk', 'Compiles bills and raises miscellaneous expenditure claims.', 'STAFF', 30],
    [ROLES.AS, 'Account Superintendent', 'Verifies divisional accounts entries.', 'STAFF', 35],
    [ROLES.AAO, 'Assistant Accounts Officer', 'Conducts internal audit of bills before payment.', 'STAFF', 45],
    [ROLES.CAO, 'Chief Accounts Officer', 'Head of accounts. Approves payment and Tally export.', 'STAFF', 75],
    [ROLES.AUDITOR, 'Auditor', 'Read-only access across the organisation for audit purposes.', 'STAFF', 20],
    [ROLES.CONTRACTOR, 'Contractor', 'External vendor. Bids for tenders and raises works bills.', 'EXTERNAL', 10],
  ];

  const stmt = db.prepare(
    `INSERT INTO roles (code, name, description, scope, hierarchy) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, description = excluded.description`,
  );
  for (const role of roles) stmt.run(...role);
}

// --- 2. Approval workflows -------------------------------------------------

interface StepSpec {
  code: string;
  name: string;
  role: string;
  scope: 'DIVISION' | 'CIRCLE' | 'ZONE' | 'GLOBAL';
  slaDays: number;
}

function seedWorkflow(
  code: string,
  name: string,
  entityType: string,
  description: string,
  steps: StepSpec[],
): void {
  const db = getDb();
  const definitionId = upsert('workflow_definitions', code, {
    name,
    entity_type: entityType,
    description,
  });

  const existing = db
    .prepare(`SELECT COUNT(*) AS n FROM workflow_steps WHERE definition_id = ?`)
    .get(definitionId) as { n: number };
  if (existing.n > 0) return;

  const stmt = db.prepare(
    `INSERT INTO workflow_steps (definition_id, seq, code, name, role_code, scope, sla_days)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  steps.forEach((step, index) => {
    stmt.run(definitionId, index + 1, step.code, step.name, step.role, step.scope, step.slaDays);
  });
}

function seedWorkflows(): void {
  seedWorkflow(
    WORKFLOWS.PROJECT_SANCTION,
    'Project Administrative Sanction',
    ENTITY_TYPES.PROJECT,
    'Technical vetting and administrative sanction of a new work.',
    [
      { code: 'EE_SCRUTINY', name: 'Divisional Scrutiny (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 5 },
      { code: 'SE_REVIEW', name: 'Circle Review (SE)', role: ROLES.SE, scope: 'CIRCLE', slaDays: 5 },
      { code: 'CE_TECH', name: 'Technical Sanction (CE)', role: ROLES.CE, scope: 'GLOBAL', slaDays: 7 },
      { code: 'MD_SANCTION', name: 'Administrative Sanction (MD)', role: ROLES.MD, scope: 'GLOBAL', slaDays: 7 },
    ],
  );

  seedWorkflow(
    WORKFLOWS.TENDER_APPROVAL,
    'Tender Approval and Publication',
    ENTITY_TYPES.TENDER,
    'Approval of the tender notice, estimate and bid conditions before publication.',
    [
      { code: 'EE_PREP', name: 'Divisional Check (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 3 },
      { code: 'SE_REVIEW', name: 'Circle Review (SE)', role: ROLES.SE, scope: 'CIRCLE', slaDays: 3 },
      { code: 'CE_APPROVE', name: 'Approval to Invite Tenders (CE)', role: ROLES.CE, scope: 'GLOBAL', slaDays: 5 },
    ],
  );

  // Mirrors the RA bill chain in "Work Flow screenshot for RA Bills".
  seedWorkflow(
    WORKFLOWS.RA_BILL,
    'Running Account Bill',
    ENTITY_TYPES.RA_BILL,
    'Measurement check, divisional certification, accounts compilation, audit and payment release.',
    [
      { code: 'AE_CHECK', name: 'Measurement Check (AE)', role: ROLES.AE, scope: 'DIVISION', slaDays: 3 },
      { code: 'EE_CERTIFY', name: 'Divisional Certification (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 3 },
      { code: 'AC_COMPILE', name: 'Accounts Compilation (Account Clerk)', role: ROLES.AC, scope: 'DIVISION', slaDays: 2 },
      { code: 'AS_VERIFY', name: 'Accounts Verification (Account Superintendent)', role: ROLES.AS, scope: 'DIVISION', slaDays: 2 },
      { code: 'AAO_AUDIT', name: 'Internal Audit (AAO)', role: ROLES.AAO, scope: 'GLOBAL', slaDays: 3 },
      { code: 'CAO_APPROVE', name: 'Financial Approval (CAO)', role: ROLES.CAO, scope: 'GLOBAL', slaDays: 3 },
      { code: 'MD_RELEASE', name: 'Payment Release (MD)', role: ROLES.MD, scope: 'GLOBAL', slaDays: 5 },
    ],
  );

  // Mirrors "Work Flow screenshot for Mischellanous Bills".
  seedWorkflow(
    WORKFLOWS.MISC_BILL,
    'Miscellaneous Bill',
    ENTITY_TYPES.MISC_BILL,
    'Project, revenue and refund expenditure claims raised by the Account Clerk.',
    [
      { code: 'AS_VERIFY', name: 'Accounts Verification (Account Superintendent)', role: ROLES.AS, scope: 'DIVISION', slaDays: 2 },
      { code: 'EE_SANCTION', name: 'Divisional Sanction (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 3 },
      { code: 'AAO_AUDIT', name: 'Internal Audit (AAO)', role: ROLES.AAO, scope: 'GLOBAL', slaDays: 3 },
      { code: 'CAO_APPROVE', name: 'Financial Approval (CAO)', role: ROLES.CAO, scope: 'GLOBAL', slaDays: 3 },
      { code: 'MD_RELEASE', name: 'Payment Release (MD)', role: ROLES.MD, scope: 'GLOBAL', slaDays: 5 },
    ],
  );

  seedWorkflow(
    WORKFLOWS.CONTRACTOR_REGISTRATION,
    'Contractor Registration',
    ENTITY_TYPES.CONTRACTOR,
    'Verification of a contractor self-registration before the account is activated.',
    [
      { code: 'EE_VERIFY', name: 'Document Verification (EE)', role: ROLES.EE, scope: 'GLOBAL', slaDays: 5 },
      { code: 'CAO_APPROVE', name: 'Registration Approval (CAO)', role: ROLES.CAO, scope: 'GLOBAL', slaDays: 5 },
    ],
  );

  seedWorkflow(
    WORKFLOWS.LOC_APPROVAL,
    'Letter of Credit Approval',
    ENTITY_TYPES.LOC,
    'Divisional request for a letter of credit against the annual allocation.',
    [
      { code: 'EE_RECOMMEND', name: 'Divisional Recommendation (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 3 },
      { code: 'CAO_REVIEW', name: 'Accounts Review (CAO)', role: ROLES.CAO, scope: 'GLOBAL', slaDays: 3 },
      { code: 'MD_APPROVE', name: 'Approval (MD)', role: ROLES.MD, scope: 'GLOBAL', slaDays: 5 },
    ],
  );
}

// --- 3. Masters ------------------------------------------------------------

function seedMasters(): Ids {
  const ids: Ids = {};

  ids.zoneSouth = upsert('zones', 'ZN-SOUTH', {
    name: 'South Operations Zone',
    state_region: 'Karnataka',
    zone_head: 'Er. R. Venkatesh, Chief Engineer',
  });
  ids.zoneNorth = upsert('zones', 'ZN-NORTH', {
    name: 'North Operations Zone',
    state_region: 'Karnataka',
    zone_head: 'Er. S. Prabhakar, Chief Engineer',
  });

  ids.circleCivil = upsert('circles', 'C-CIVIL', {
    name: 'Civil Works Circle',
    zone_id: ids.zoneSouth,
    authority_level: 'Chief Engineer',
  });
  ids.circleUrban = upsert('circles', 'C-URBAN', {
    name: 'Urban Infrastructure Circle',
    zone_id: ids.zoneSouth,
    authority_level: 'Superintending Engineer',
  });

  ids.divNgr = upsert('divisions', 'DIV-NGR', {
    name: 'North Gandhinagar Division',
    circle_id: ids.circleCivil,
    head_of_division: 'Er. A. Kumar',
    contact_email: 'ee.ngr@pmis.gov.in',
    contact_phone: '080-22334455',
    effective_date: '2018-04-01',
  });
  ids.divSgr = upsert('divisions', 'DIV-SGR', {
    name: 'South Gandhinagar Division',
    circle_id: ids.circleCivil,
    head_of_division: 'Er. M. Patel',
    contact_email: 'ee.sgr@pmis.gov.in',
    contact_phone: '080-22334466',
    effective_date: '2018-04-01',
  });
  ids.divUrb = upsert('divisions', 'DIV-URB', {
    name: 'Urban Works Division',
    circle_id: ids.circleUrban,
    head_of_division: 'Er. K. Joshi',
    contact_email: 'ee.urb@pmis.gov.in',
    effective_date: '2020-04-01',
  });

  ids.sdNgr1 = upsert('sub_divisions', 'SD-NGR-01', {
    name: 'Gandhinagar West Sub Division',
    division_id: ids.divNgr,
    jurisdiction_area: 'West of the city bypass',
    reporting_officer: 'Er. P. Reddy',
  });
  ids.sdNgr2 = upsert('sub_divisions', 'SD-NGR-02', {
    name: 'Gandhinagar East Sub Division',
    division_id: ids.divNgr,
    jurisdiction_area: 'East of the city bypass',
    reporting_officer: 'Er. L. Shetty',
  });
  ids.sdSgr1 = upsert('sub_divisions', 'SD-SGR-01', {
    name: 'South Gandhinagar Sub Division',
    division_id: ids.divSgr,
    jurisdiction_area: 'Southern municipal wards',
    reporting_officer: 'Er. V. Rao',
  });

  ids.distGnr = upsert('districts', 'D-GNR', {
    name: 'Gandhinagar',
    state_name: 'Karnataka',
    pincode_from: '560001',
    pincode_to: '560099',
  });
  ids.distKlb = upsert('districts', 'D-KLB', {
    name: 'Kalaburagi',
    state_name: 'Karnataka',
    pincode_from: '585101',
    pincode_to: '585199',
  });
  ids.distBlr = upsert('districts', 'D-BLR', {
    name: 'Bengaluru Rural',
    state_name: 'Karnataka',
    pincode_from: '561201',
    pincode_to: '562163',
  });

  ids.townGnr = upsert('towns', 'T-GNR01', {
    name: 'Gandhinagar',
    district_id: ids.distGnr,
    classification: 'Municipality',
    population: 284000,
  });
  ids.townKlb = upsert('towns', 'T-KLB01', {
    name: 'Kalburgi',
    district_id: ids.distKlb,
    classification: 'Metropolitan',
    population: 543147,
  });
  ids.townDvn = upsert('towns', 'T-BLR01', {
    name: 'Devanahalli',
    district_id: ids.distBlr,
    classification: 'Town Panchayat',
    population: 30000,
  });

  ids.stCs = upsert('scheme_types', 'ST-CS', {
    name: 'Centrally Sponsored',
    category: 'Infrastructure',
  });
  ids.stSp = upsert('scheme_types', 'ST-SP', { name: 'State Plan', category: 'Urban Development' });
  ids.stExt = upsert('scheme_types', 'ST-EXT', {
    name: 'Externally Aided Project',
    category: 'Infrastructure',
  });

  ids.schemeUplan = upsert('schemes', 'U-PLAN', {
    name: 'Urban Development Plan',
    scheme_type_id: ids.stSp,
    funding_agency: 'State Govt',
    start_date: '2023-04-01',
    end_date: '2028-03-31',
    budget_head_code: '4217-60-051-0-01',
    objective: 'Urban infrastructure upgrades across municipal areas.',
  });
  ids.schemeAmrut = upsert('schemes', 'AMRUT', {
    name: 'Atal Mission for Rejuvenation and Urban Transformation',
    scheme_type_id: ids.stCs,
    funding_agency: 'Central Govt',
    start_date: '2021-04-01',
    end_date: '2026-03-31',
    budget_head_code: '2215-01-102-0-03',
    objective: 'Water supply, sewerage and urban transport infrastructure.',
  });
  ids.schemeJjm = upsert('schemes', 'JJM', {
    name: 'Jal Jeevan Mission',
    scheme_type_id: ids.stCs,
    funding_agency: 'Central Govt',
    start_date: '2020-04-01',
    end_date: '2027-03-31',
    budget_head_code: '2215-02-101-0-01',
    objective: 'Functional household tap connections in every rural home.',
  });
  ids.schemePmgsy = upsert('schemes', 'PMGSY', {
    name: 'Pradhan Mantri Gram Sadak Yojana',
    scheme_type_id: ids.stCs,
    funding_agency: 'Central Govt',
    start_date: '2019-04-01',
    end_date: '2027-03-31',
    budget_head_code: '5054-04-337-0-02',
    objective: 'All-weather road connectivity to unconnected habitations.',
  });

  ids.wtRoad = upsert('work_types', 'WT-ROAD', {
    name: 'New Road Construction',
    sector: 'PWD',
    uom: 'Km',
  });
  ids.wtBldg = upsert('work_types', 'WT-BLDG', {
    name: 'Building Construction',
    sector: 'Buildings',
    uom: 'Sq.m',
  });
  ids.wtWater = upsert('work_types', 'WT-WATER', {
    name: 'Water Supply Works',
    sector: 'Water Supply',
    uom: 'Meters',
  });
  ids.wtDrain = upsert('work_types', 'WT-DRAIN', {
    name: 'Storm Water Drain',
    sector: 'Drainage',
    uom: 'Meters',
  });

  ids.pcMajor = upsert('project_categories', 'PC-MAJ', {
    name: 'Major Project',
    threshold_value: toPaise(100_000_000),
    approval_authority: 'Managing Director',
  });
  ids.pcMedium = upsert('project_categories', 'PC-MED', {
    name: 'Medium Works',
    threshold_value: toPaise(10_000_000),
    approval_authority: 'Chief Engineer',
  });
  ids.pcMinor = upsert('project_categories', 'PC-MIN', {
    name: 'Minor Works',
    threshold_value: toPaise(0),
    approval_authority: 'Superintending Engineer',
  });

  ids.bankSbi = upsert('banks', 'SBI', {
    name: 'State Bank of India',
    short_name: 'State Bank',
    ifsc_code: 'SBIN0001234',
    micr_code: '560002001',
    head_office_address: 'Corporate Centre, Madame Cama Road, Mumbai 400021',
    official_contact: '1800-11-2211',
  });
  ids.bankCanara = upsert('banks', 'CANARA', {
    name: 'Canara Bank',
    short_name: 'Canara',
    ifsc_code: 'CNRB0002345',
    micr_code: '560015002',
    head_office_address: '112 J C Road, Bengaluru 560002',
  });
  ids.bankHdfc = upsert('banks', 'HDFC', {
    name: 'HDFC Bank Limited',
    short_name: 'HDFC',
    ifsc_code: 'HDFC0000123',
    micr_code: '560240002',
    head_office_address: 'Senapati Bapat Marg, Mumbai 400013',
  });

  // ETP heads, matching the worked example in the RA bill requirements.
  upsert('etp_charges', 'ESTABLISHMENT', {
    name: 'Establishment Charges',
    charge_type: 'RECOVERY',
    rate_bps: toBps(2),
    basis_of_calculation: 'Admissible Amount',
    effective_date: '2023-04-01',
    govt_reference: 'GO/PWD/ETP/2023/14',
    account_head: '2059-80-001',
  });
  upsert('etp_charges', 'TOOLS-PLANT', {
    name: 'Tools & Plants Charges',
    charge_type: 'RECOVERY',
    rate_bps: toBps(3),
    basis_of_calculation: 'Admissible Amount',
    effective_date: '2023-04-01',
    govt_reference: 'GO/PWD/ETP/2023/14',
    account_head: '2059-80-002',
  });
  upsert('etp_charges', 'CONTINGENCY', {
    name: 'Contingency Charges',
    charge_type: 'RECOVERY',
    rate_bps: toBps(4),
    basis_of_calculation: 'Admissible Amount',
    effective_date: '2023-04-01',
    govt_reference: 'GO/PWD/ETP/2023/14',
    account_head: '2059-80-003',
  });

  upsert('deduction_types', 'IT-TDS', {
    name: 'Income Tax TDS (194C)',
    basis: 'PERCENT',
    rate_bps: toBps(2),
    applies_to: 'BOTH',
    account_head: '8658-00-112',
    is_statutory: 1,
  });
  upsert('deduction_types', 'GST-TDS', {
    name: 'GST TDS',
    basis: 'PERCENT',
    rate_bps: toBps(2),
    applies_to: 'BOTH',
    account_head: '8658-00-113',
    is_statutory: 1,
  });
  upsert('deduction_types', 'SD', {
    name: 'Security Deposit',
    basis: 'PERCENT',
    rate_bps: toBps(5),
    applies_to: 'RA',
    account_head: '8443-00-103',
    is_statutory: 0,
  });
  upsert('deduction_types', 'LABOUR-CESS', {
    name: 'Labour Welfare Cess',
    basis: 'PERCENT',
    rate_bps: toBps(1),
    applies_to: 'RA',
    account_head: '8443-00-120',
    is_statutory: 1,
  });

  // Expense categories from the Miscellaneous Bill workbook, mapped to the
  // standard government object heads listed on its "cheat sheet" tab.
  const expenses: [string, string, string, string, string][] = [
    ['PE-ADVT', 'Advertisement', 'Project Expenses', 'Professional Services', 'PROJECT_EXPENSE'],
    ['PE-LEGAL', 'Legal Charges', 'Project Expenses', 'Professional Services', 'PROJECT_EXPENSE'],
    ['PE-INSP', 'Site Inspection', 'Project Expenses', 'Works Contingency', 'PROJECT_EXPENSE'],
    ['PE-OTHER', 'Other Project Charges', 'Project Expenses', 'Works Contingency', 'PROJECT_EXPENSE'],
    ['SF-CONSUM', 'Site Consumables / Stores', 'Site & Field Operations', 'Material & Supply (M&S)', 'PROJECT_EXPENSE'],
    ['SF-WATER', 'Drinking Water & Pantry', 'Site & Field Operations', 'Material & Supply (M&S)', 'PROJECT_EXPENSE'],
    ['SF-PPE', 'Safety Consumables (PPE)', 'Site & Field Operations', 'Material & Supply (M&S)', 'PROJECT_EXPENSE'],
    ['SF-FUEL', 'Fuel & Lubricants (POL)', 'Site & Field Operations', 'Material & Supply (M&S)', 'PROJECT_EXPENSE'],
    ['SF-UTIL', 'Electricity & Water Charges', 'Site & Field Operations', 'Office Expenses (OE)', 'PROJECT_EXPENSE'],
    ['OE-PRINT', 'Printing & Photocopying', 'Administrative & Office', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['OE-STAT', 'Stationery & Consumables', 'Administrative & Office', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['OE-POST', 'Postage & Courier', 'Administrative & Office', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['OE-COMM', 'Communication Charges', 'Administrative & Office', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['OE-NEWS', 'Newspapers & Periodicals', 'Administrative & Office', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['TC-LOCAL', 'Local Conveyance', 'Travel & Conveyance', 'Domestic Travel Expenses (DTE)', 'REVENUE_EXPENSE'],
    ['TC-TOLL', 'Toll & Parking Fees', 'Travel & Conveyance', 'Domestic Travel Expenses (DTE)', 'REVENUE_EXPENSE'],
    ['TC-CART', 'Cartage & Freight', 'Travel & Conveyance', 'Freight / Handling Charges', 'REVENUE_EXPENSE'],
    ['RM-IT', 'IT / Equipment Repair', 'Repairs & Maintenance', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['RM-VEH', 'Vehicle Maintenance', 'Repairs & Maintenance', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['RM-OFF', 'Site Office Maintenance', 'Repairs & Maintenance', 'Office Expenses (OE)', 'REVENUE_EXPENSE'],
    ['MH-MEET', 'Official Meeting Expense', 'Meeting & Hospitality', 'Hospitality / Sumptuary Allowance', 'REVENUE_EXPENSE'],
    ['MH-COORD', 'Client Coordination', 'Meeting & Hospitality', 'Hospitality / Sumptuary Allowance', 'REVENUE_EXPENSE'],
    ['RF-EMD', 'EMD Refund', 'Refunds', 'Works Contingency', 'REFUND'],
    ['RF-SD', 'Security Deposit Refund', 'Refunds', 'Works Contingency', 'REFUND'],
    ['RF-EXCESS', 'Excess Recovery Refund', 'Refunds', 'Works Contingency', 'REFUND'],
  ];
  for (const [code, name, parent, head, category] of expenses) {
    upsert('expense_categories', code, {
      name,
      parent_code: parent,
      govt_object_head: head,
      bill_category: category,
    });
  }

  return ids;
}

// --- 4. Users --------------------------------------------------------------

interface UserSpec {
  username: string;
  fullName: string;
  designation: string;
  role: string;
  zoneKey?: string;
  circleKey?: string;
  divisionKey?: string;
  subDivisionKey?: string;
}

function seedUsers(ids: Ids): Ids {
  const db = getDb();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const userIds: Ids = {};

  const specs: UserSpec[] = [
    { username: 'admin', fullName: 'System Administrator', designation: 'IT Administrator', role: ROLES.ADMIN },
    { username: 'md.rao', fullName: 'Dr. Suresh Rao', designation: 'Managing Director', role: ROLES.MD },
    { username: 'ce.sharma', fullName: 'Er. Anil Sharma', designation: 'Chief Engineer', role: ROLES.CE, zoneKey: 'zoneSouth' },
    { username: 'se.iyer', fullName: 'Er. Lakshmi Iyer', designation: 'Superintending Engineer', role: ROLES.SE, zoneKey: 'zoneSouth', circleKey: 'circleCivil' },
    { username: 'ee.kumar', fullName: 'Er. Arun Kumar', designation: 'Executive Engineer', role: ROLES.EE, zoneKey: 'zoneSouth', circleKey: 'circleCivil', divisionKey: 'divNgr' },
    { username: 'ee.patel', fullName: 'Er. Mahesh Patel', designation: 'Executive Engineer', role: ROLES.EE, zoneKey: 'zoneSouth', circleKey: 'circleCivil', divisionKey: 'divSgr' },
    { username: 'aee.singh', fullName: 'Er. Rajvir Singh', designation: 'Assistant Executive Engineer', role: ROLES.AEE, circleKey: 'circleCivil', divisionKey: 'divNgr' },
    { username: 'ae.reddy', fullName: 'Er. Praveen Reddy', designation: 'Assistant Engineer', role: ROLES.AE, circleKey: 'circleCivil', divisionKey: 'divNgr', subDivisionKey: 'sdNgr1' },
    { username: 'ac.nair', fullName: 'Smt. Deepa Nair', designation: 'Account Clerk', role: ROLES.AC, circleKey: 'circleCivil', divisionKey: 'divNgr' },
    { username: 'as.gupta', fullName: 'Shri Ramesh Gupta', designation: 'Account Superintendent', role: ROLES.AS, circleKey: 'circleCivil', divisionKey: 'divNgr' },
    { username: 'aao.menon', fullName: 'Smt. Kavitha Menon', designation: 'Assistant Accounts Officer', role: ROLES.AAO },
    { username: 'cao.desai', fullName: 'Shri Nitin Desai', designation: 'Chief Accounts Officer', role: ROLES.CAO },
    { username: 'auditor.bose', fullName: 'Shri Amit Bose', designation: 'Internal Auditor', role: ROLES.AUDITOR },
  ];

  const insert = db.prepare(
    `INSERT INTO users (username, email, password_hash, full_name, employee_code, designation,
                        role_code, phone, zone_id, circle_id, division_id, sub_division_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
  );

  specs.forEach((spec, index) => {
    const existing = db.prepare(`SELECT id FROM users WHERE username = ?`).get(spec.username) as
      | { id: number }
      | undefined;
    if (existing) {
      userIds[spec.username] = existing.id;
      return;
    }
    const result = insert.run(
      spec.username,
      `${spec.username}@pmis.gov.in`,
      passwordHash,
      spec.fullName,
      `EMP${String(1001 + index)}`,
      spec.designation,
      spec.role,
      `98${String(45000000 + index * 137)}`,
      spec.zoneKey ? ids[spec.zoneKey]! : null,
      spec.circleKey ? ids[spec.circleKey]! : null,
      spec.divisionKey ? ids[spec.divisionKey]! : null,
      spec.subDivisionKey ? ids[spec.subDivisionKey]! : null,
    );
    userIds[spec.username] = Number(result.lastInsertRowid);
  });

  return userIds;
}

// --- 5. Contractors --------------------------------------------------------

interface ContractorSpec {
  code: string;
  name: string;
  type: string;
  regClass: string;
  pan: string;
  gstin: string;
  email: string;
  phone: string;
  city: string;
  contact: string;
  bankKey: string;
  account: string;
  ifsc: string;
  status: string;
}

function seedContractors(ids: Ids): Ids {
  const db = getDb();
  const passwordHash = hashPassword(DEMO_PASSWORD);
  const contractorIds: Ids = {};

  const specs: ContractorSpec[] = [
    {
      code: 'C-10001', name: 'Shakti Constructions Pvt Ltd', type: 'Private Limited', regClass: 'Class A',
      pan: 'AABCS1429L', gstin: '29AABCS1429L1ZP', email: 'contracts@shakticonstructions.example',
      phone: '9845012345', city: 'Bengaluru', contact: 'Vikram Shetty', bankKey: 'bankSbi',
      account: '30124578963', ifsc: 'SBIN0001234', status: 'APPROVED',
    },
    {
      code: 'C-10002', name: 'Vishwa Infra Projects', type: 'Partnership', regClass: 'Class B',
      pan: 'AAEFV8821K', gstin: '29AAEFV8821K1Z4', email: 'tenders@vishwainfra.example',
      phone: '9845023456', city: 'Kalaburagi', contact: 'Sunil Kulkarni', bankKey: 'bankCanara',
      account: '11223344556', ifsc: 'CNRB0002345', status: 'APPROVED',
    },
    {
      code: 'C-10003', name: 'Ganga Builders & Developers', type: 'Proprietorship', regClass: 'Class A',
      pan: 'AKQPG3312M', gstin: '29AKQPG3312M1ZQ', email: 'office@gangabuilders.example',
      phone: '9845034567', city: 'Gandhinagar', contact: 'Ganesh Prasad', bankKey: 'bankHdfc',
      account: '50100234567', ifsc: 'HDFC0000123', status: 'APPROVED',
    },
    {
      code: 'C-10004', name: 'Deccan Engineering Works', type: 'Partnership', regClass: 'Class C',
      pan: 'AAGFD5567N', gstin: '29AAGFD5567N1ZR', email: 'info@deccanengg.example',
      phone: '9845045678', city: 'Devanahalli', contact: 'Mohan Rao', bankKey: 'bankSbi',
      account: '30987654321', ifsc: 'SBIN0001234', status: 'PENDING',
    },
  ];

  const insertContractor = db.prepare(
    `INSERT INTO contractors
       (code, name, contractor_type, registration_class, registration_no, eproc_no, pan, gstin,
        contact_person, email, phone, building, street, area, city, state, country, zip_code,
        bank_id, bank_branch, bank_account_no, bank_account_type, ifsc_code, tds_rate_bps,
        validity_date, registration_status, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'India', ?, ?, ?, ?, 'Current', ?, ?, ?, ?, 'ACTIVE')`,
  );
  const insertUser = db.prepare(
    `INSERT INTO users (username, email, password_hash, full_name, designation, role_code, phone,
                        contractor_id, status)
     VALUES (?, ?, ?, ?, 'Authorised Signatory', ?, ?, ?, ?)`,
  );

  for (const spec of specs) {
    const existing = db.prepare(`SELECT id FROM contractors WHERE code = ?`).get(spec.code) as
      | { id: number }
      | undefined;
    if (existing) {
      contractorIds[spec.code] = existing.id;
      continue;
    }

    const serial = nextSequence('CONTRACTOR');
    void serial; // keeps generated codes clear of the seeded range

    const result = insertContractor.run(
      spec.code, spec.name, spec.type, spec.regClass, `REG/${spec.code}`, `EP${spec.code.slice(2)}`,
      spec.pan, spec.gstin, spec.contact, spec.email, spec.phone,
      'Plot 14', 'Industrial Layout', 'Phase II', spec.city, 'Karnataka', '560068',
      ids[spec.bankKey]!, `${spec.city} Main Branch`, spec.account, spec.ifsc,
      toBps(2), '2027-03-31', spec.status,
    );
    const contractorId = Number(result.lastInsertRowid);
    contractorIds[spec.code] = contractorId;

    insertUser.run(
      spec.email,
      spec.email,
      passwordHash,
      spec.contact,
      ROLES.CONTRACTOR,
      spec.phone,
      contractorId,
      spec.status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',
    );
  }

  return contractorIds;
}

// --- 6. Demo operational records -------------------------------------------

function seedDemoRecords(ids: Ids, userIds: Ids, contractorIds: Ids): void {
  const db = getDb();
  const already = db.prepare(`SELECT COUNT(*) AS n FROM projects`).get() as { n: number };
  if (already.n > 0) return;

  const insertProject = db.prepare(
    `INSERT INTO projects
       (project_code, name, description, scheme_id, work_type_id, project_category_id,
        zone_id, circle_id, division_id, sub_division_id, district_id, town_id,
        estimated_cost, sanctioned_cost, sanction_no, sanction_date, start_date,
        target_completion_date, physical_progress_pct, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const projects: {
    key: string;
    code: string;
    name: string;
    description: string;
    scheme: string;
    workType: string;
    category: string;
    division: string;
    subDivision: string | null;
    district: string;
    town: string;
    estimate: number;
    sanctioned: number;
    progress: number;
    status: string;
  }[] = [
    {
      key: 'projRoad', code: 'U-PLAN-KALBURGI-0615',
      name: 'Widening and strengthening of Kalburgi ring road (Phase II)',
      description: 'Four-laning of 12.4 km of the outer ring road including two minor bridges and storm water drains.',
      scheme: 'schemeUplan', workType: 'wtRoad', category: 'pcMajor', division: 'divNgr',
      subDivision: 'sdNgr1', district: 'distKlb', town: 'townKlb',
      estimate: 141_300_000, sanctioned: 141_300_000, progress: 42, status: 'IN_PROGRESS',
    },
    {
      key: 'projWater', code: 'AMRUT-GANDHINAGAR-0001',
      name: 'Augmentation of water supply distribution network, Gandhinagar',
      description: 'Laying 38 km of DI pipeline, two overhead tanks and 4,200 household connections.',
      scheme: 'schemeAmrut', workType: 'wtWater', category: 'pcMajor', division: 'divNgr',
      subDivision: 'sdNgr2', district: 'distGnr', town: 'townGnr',
      estimate: 96_500_000, sanctioned: 94_000_000, progress: 18, status: 'IN_PROGRESS',
    },
    {
      key: 'projBldg', code: 'U-PLAN-GANDHINAGAR-0002',
      name: 'Construction of divisional office building, Gandhinagar',
      description: 'G+3 office block of 2,850 sq.m with parking and rainwater harvesting.',
      scheme: 'schemeUplan', workType: 'wtBldg', category: 'pcMedium', division: 'divSgr',
      subDivision: 'sdSgr1', district: 'distGnr', town: 'townGnr',
      estimate: 42_000_000, sanctioned: 42_000_000, progress: 0, status: 'SANCTIONED',
    },
    {
      key: 'projDrain', code: 'JJM-DEVANAHALLI-0001',
      name: 'Storm water drain improvement, Devanahalli town',
      description: 'Reconstruction of 6.8 km of primary and secondary storm water drains.',
      scheme: 'schemeJjm', workType: 'wtDrain', category: 'pcMedium', division: 'divUrb',
      subDivision: null, district: 'distBlr', town: 'townDvn',
      estimate: 28_400_000, sanctioned: 0, progress: 0, status: 'DRAFT',
    },
  ];

  const projectIds: Ids = {};
  for (const p of projects) {
    const result = insertProject.run(
      p.code, p.name, p.description,
      ids[p.scheme]!, ids[p.workType]!, ids[p.category]!,
      ids.zoneSouth!, p.division === 'divUrb' ? ids.circleUrban! : ids.circleCivil!,
      ids[p.division]!, p.subDivision ? ids[p.subDivision]! : null,
      ids[p.district]!, ids[p.town]!,
      toPaise(p.estimate), toPaise(p.sanctioned),
      p.sanctioned > 0 ? `GO/PWD/${p.code.slice(-4)}/2025` : null,
      p.sanctioned > 0 ? '2025-05-12' : null,
      p.status === 'IN_PROGRESS' ? '2025-06-01' : null,
      p.status === 'DRAFT' ? null : '2027-03-31',
      p.progress, p.status,
      userIds['ee.kumar']!,
    );
    projectIds[p.key] = Number(result.lastInsertRowid);
  }

  // Milestones give the road project a real progress figure.
  const insertMilestone = db.prepare(
    `INSERT INTO project_milestones (project_id, seq, name, planned_date, actual_date, weightage_pct, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const milestones: [string, string, string | null, number, string][] = [
    ['Site handover and mobilisation', '2025-06-15', '2025-06-20', 10, 'COMPLETED'],
    ['Earthwork and subgrade preparation', '2025-09-30', '2025-10-08', 25, 'COMPLETED'],
    ['Granular sub-base and base course', '2026-01-31', null, 25, 'IN_PROGRESS'],
    ['Bituminous surfacing', '2026-08-31', null, 25, 'PENDING'],
    ['Drains, signage and handover', '2027-02-28', null, 15, 'PENDING'],
  ];
  milestones.forEach((m, index) => {
    insertMilestone.run(projectIds.projRoad!, index + 1, m[0], m[1], m[2], m[3], m[4]);
  });

  // Packages, including two already awarded so bills can be raised.
  const insertPackage = db.prepare(
    `INSERT INTO packages
       (package_code, project_id, name, description, work_type_id, estimated_value, awarded_value,
        contractor_id, in_charge_user_id, agreement_no, agreement_date, work_order_no, work_order_date,
        commencement_date, completion_date, defect_liability_months, security_deposit_bps,
        retention_bps, physical_progress_pct, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const pkgRoadId = Number(
    insertPackage.run(
      'U-PLAN-KALBURGI-0615/PKG-01', projectIds.projRoad!,
      'Ring road widening — Chainage 0.000 to 6.200 km',
      'Earthwork, GSB, WMM and bituminous layers for the first 6.2 km reach.',
      ids.wtRoad!, toPaise(72_000_000), toPaise(69_840_000),
      contractorIds['C-10001']!, userIds['ee.kumar']!,
      'AGR/DIV-NGR/2025/018', '2025-05-28', 'DIV-NGR/WO/2025-26/001', '2025-05-30',
      '2025-06-05', '2027-01-31', 24, toBps(5), toBps(5), 46, 'IN_PROGRESS',
      userIds['ee.kumar']!,
    ).lastInsertRowid,
  );

  const pkgRoad2Id = Number(
    insertPackage.run(
      'U-PLAN-KALBURGI-0615/PKG-02', projectIds.projRoad!,
      'Ring road widening — Chainage 6.200 to 12.400 km',
      'Earthwork, GSB, WMM and bituminous layers for the remaining 6.2 km reach.',
      ids.wtRoad!, toPaise(69_300_000), 0, null, userIds['ee.kumar']!,
      null, null, null, null, null, null, 24, toBps(5), toBps(5), 0, 'DRAFT',
      userIds['ee.kumar']!,
    ).lastInsertRowid,
  );

  const pkgWaterId = Number(
    insertPackage.run(
      'AMRUT-GANDHINAGAR-0001/PKG-01', projectIds.projWater!,
      'Distribution network — North zone',
      'Laying 21 km of DI K9 pipeline with valves, chambers and house connections.',
      ids.wtWater!, toPaise(52_000_000), toPaise(50_960_000),
      contractorIds['C-10003']!, userIds['ee.kumar']!,
      'AGR/DIV-NGR/2025/024', '2025-07-14', 'DIV-NGR/WO/2025-26/004', '2025-07-16',
      '2025-07-25', '2026-12-31', 12, toBps(5), toBps(5), 22, 'IN_PROGRESS',
      userIds['ee.kumar']!,
    ).lastInsertRowid,
  );

  const pkgBldgId = Number(
    insertPackage.run(
      'U-PLAN-GANDHINAGAR-0002/PKG-01', projectIds.projBldg!,
      'Divisional office building — civil and finishing works',
      'Complete civil, plumbing and electrical works for the G+3 office block.',
      ids.wtBldg!, toPaise(38_500_000), 0, null, userIds['ee.patel']!,
      null, null, null, null, null, null, 12, toBps(5), toBps(5), 0, 'DRAFT',
      userIds['ee.patel']!,
    ).lastInsertRowid,
  );

  seedTenders(ids, userIds, contractorIds, projectIds, { pkgRoad2Id, pkgBldgId });
  seedBills(ids, userIds, contractorIds, projectIds, { pkgRoadId, pkgWaterId });
  seedFunds(ids, userIds, projectIds);
  seedApprovalFlows(userIds, contractorIds);
}

/**
 * Puts the in-flight records onto the approval engine and walks a few of them
 * partway down their chain, so that every role signs in to a realistic inbox
 * and the completed bills carry a genuine audit trail.
 */
function seedApprovalFlows(userIds: Ids, contractorIds: Ids): void {
  const db = getDb();
  const user = (username: string): AuthUser => findAuthUserById(userIds[username]!)!;

  interface BillRow {
    id: number;
    bill_no: string;
    ra_sequence: number;
    net_payable_amount: number;
    division_id: number;
    project_id: number;
    status: string;
  }

  const bills = db
    .prepare(
      `SELECT rb.id, rb.bill_no, rb.ra_sequence, rb.net_payable_amount, rb.division_id,
              rb.project_id, rb.status, p.circle_id, p.zone_id, pk.name AS package_name
       FROM ra_bills rb
       JOIN projects p ON p.id = rb.project_id
       JOIN packages pk ON pk.id = rb.package_id
       ORDER BY rb.id`,
    )
    .all() as (BillRow & { circle_id: number; zone_id: number; package_name: string })[];

  /** Starts an RA bill workflow and approves it through `steps` stages. */
  function runBill(
    bill: (typeof bills)[number],
    approvers: string[],
  ): void {
    const instance = startWorkflow({
      definitionCode: WORKFLOWS.RA_BILL,
      entityType: ENTITY_TYPES.RA_BILL,
      entityId: bill.id,
      entityRef: bill.bill_no,
      title: `RA ${bill.ra_sequence} — ${bill.package_name}`,
      amount: bill.net_payable_amount,
      divisionId: bill.division_id,
      circleId: bill.circle_id,
      zoneId: bill.zone_id,
      initiator: user('ac.nair'),
      remarks: 'Bill compiled and forwarded for check.',
    });
    db.prepare(`UPDATE ra_bills SET workflow_instance_id = ? WHERE id = ?`).run(instance.id, bill.id);

    const notes: Record<string, string> = {
      'ae.reddy': 'Measurements checked against the measurement book and found correct.',
      'ee.kumar': 'Admissible amount and ETP charges certified.',
      'ac.nair': 'Deduction schedule applied as per the standing heads.',
      'as.gupta': 'Divisional accounts entries verified.',
      'aao.menon': 'Internal audit completed. No observations.',
      'cao.desai': 'Financially approved for payment.',
      'md.rao': 'Payment released.',
    };
    for (const approver of approvers) {
      act({
        instanceId: instance.id,
        actor: user(approver),
        action: WORKFLOW_ACTIONS.APPROVE,
        remarks: notes[approver] ?? 'Approved.',
      });
    }
  }

  const fullChain = ['ae.reddy', 'ee.kumar', 'ac.nair', 'as.gupta', 'aao.menon', 'cao.desai', 'md.rao'];

  for (const bill of bills) {
    const originalStatus = bill.status;
    if (originalStatus === 'PAID' || originalStatus === 'SENT_TO_TALLY') {
      // Completed chain — the outcome handler sets APPROVED, so restore the
      // downstream status the record was seeded with.
      runBill(bill, fullChain);
      db.prepare(`UPDATE ra_bills SET status = ? WHERE id = ?`).run(originalStatus, bill.id);
    } else if (bill.bill_no.endsWith('0003')) {
      // Road bill 3 waits with the Assistant Engineer.
      runBill(bill, []);
    } else if (bill.bill_no.endsWith('0004')) {
      // Water supply bill has cleared the division and awaits the CAO.
      runBill(bill, ['ae.reddy', 'ee.kumar', 'ac.nair', 'as.gupta', 'aao.menon']);
    }
  }

  // Miscellaneous revenue bill waits with the Account Superintendent.
  const miscBill = db
    .prepare(
      `SELECT mb.id, mb.bill_no, mb.bill_category, mb.payee_name, mb.net_payable_amount,
              mb.division_id, d.circle_id, c.zone_id
       FROM misc_bills mb
       JOIN divisions d ON d.id = mb.division_id
       JOIN circles c ON c.id = d.circle_id
       WHERE mb.status = 'IN_APPROVAL' LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        bill_no: string;
        bill_category: string;
        payee_name: string;
        net_payable_amount: number;
        division_id: number;
        circle_id: number;
        zone_id: number;
      }
    | undefined;

  if (miscBill) {
    const instance = startWorkflow({
      definitionCode: WORKFLOWS.MISC_BILL,
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: miscBill.id,
      entityRef: miscBill.bill_no,
      title: `${miscBill.bill_category.replace('_', ' ')} — ${miscBill.payee_name}`,
      amount: miscBill.net_payable_amount,
      divisionId: miscBill.division_id,
      circleId: miscBill.circle_id,
      zoneId: miscBill.zone_id,
      initiator: user('ac.nair'),
      remarks: 'Original bills pasted and numbered as per the submission guidelines.',
    });
    db.prepare(`UPDATE misc_bills SET workflow_instance_id = ? WHERE id = ?`).run(
      instance.id,
      miscBill.id,
    );
  }

  // Pending contractor registration awaits departmental verification.
  const pending = db
    .prepare(`SELECT id, code, name FROM contractors WHERE registration_status = 'PENDING' LIMIT 1`)
    .get() as { id: number; code: string; name: string } | undefined;

  if (pending) {
    startWorkflow({
      definitionCode: WORKFLOWS.CONTRACTOR_REGISTRATION,
      entityType: ENTITY_TYPES.CONTRACTOR,
      entityId: pending.id,
      entityRef: pending.code,
      title: `Contractor registration — ${pending.name}`,
      amount: 0,
      divisionId: null,
      circleId: null,
      zoneId: null,
      initiator: user('admin'),
      remarks: 'Submitted through the contractor portal.',
    });
  }

  // Draft letter of credit request sent up for recommendation.
  const loc = db
    .prepare(
      `SELECT l.id, l.loc_no, l.purpose, l.requested_amount, l.division_id, d.circle_id, c.zone_id
       FROM loc_requests l
       JOIN divisions d ON d.id = l.division_id
       JOIN circles c ON c.id = d.circle_id
       WHERE l.status = 'DRAFT' LIMIT 1`,
    )
    .get() as
    | {
        id: number;
        loc_no: string;
        purpose: string;
        requested_amount: number;
        division_id: number;
        circle_id: number;
        zone_id: number;
      }
    | undefined;

  if (loc) {
    const instance = startWorkflow({
      definitionCode: WORKFLOWS.LOC_APPROVAL,
      entityType: ENTITY_TYPES.LOC,
      entityId: loc.id,
      entityRef: loc.loc_no,
      title: loc.purpose,
      amount: loc.requested_amount,
      divisionId: loc.division_id,
      circleId: loc.circle_id,
      zoneId: loc.zone_id,
      initiator: user('ac.nair'),
      remarks: 'Raised against the second quarter requirement.',
    });
    db.prepare(`UPDATE loc_requests SET status = 'IN_APPROVAL', workflow_instance_id = ? WHERE id = ?`)
      .run(instance.id, loc.id);
  }
}

function seedTenders(
  ids: Ids,
  userIds: Ids,
  contractorIds: Ids,
  projectIds: Ids,
  pkgs: { pkgRoad2Id: number; pkgBldgId: number },
): void {
  const db = getDb();

  const insertTender = db.prepare(
    `INSERT INTO tenders
       (tender_no, title, description, project_id, package_id, division_id, tender_type, bid_type,
        estimated_value, emd_amount, tender_fee, completion_period_days, min_registration_class,
        eligibility_criteria, publish_date, bid_start_at, bid_end_at, technical_open_at,
        financial_open_at, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // A live tender contractors can still bid on.
  const openTenderId = Number(
    insertTender.run(
      'DIV-NGR/TEN/2026-27/0001',
      'Ring road widening — Chainage 6.200 to 12.400 km',
      'Item rate tender for earthwork, granular layers and bituminous surfacing over 6.2 km, including cross drainage works.',
      projectIds.projRoad!, pkgs.pkgRoad2Id, ids.divNgr!, 'OPEN', 'ITEM_RATE',
      toPaise(69_300_000), toPaise(1_386_000), toPaise(11_800), 540, 'Class A',
      'Minimum average annual turnover of ₹25 crore over the last three financial years. At least one similar road work of ₹28 crore completed in the last five years. Valid Class A registration with the department.',
      '2026-08-01', '2026-08-01 10:00:00', '2026-09-30 17:00:00',
      '2026-10-01 11:00:00', '2026-10-08 11:00:00',
      'PUBLISHED', userIds['ee.kumar']!,
    ).lastInsertRowid,
  );

  const insertBoq = db.prepare(
    `INSERT INTO tender_boq_items (tender_id, sl_no, item_code, description, uom, quantity, estimated_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const boq: [string, string, string, number, number][] = [
    ['ERW-01', 'Excavation in ordinary soil including disposal within 1 km lead', 'Cu.m', 48_500, 182],
    ['ERW-02', 'Embankment construction with approved earth, compacted in layers', 'Cu.m', 62_400, 246],
    ['GSB-01', 'Granular sub-base, Grade III, laid and compacted', 'Cu.m', 18_600, 1_842],
    ['WMM-01', 'Wet mix macadam laid and compacted to 250 mm thickness', 'Cu.m', 14_200, 2_186],
    ['DBM-01', 'Dense bituminous macadam, 75 mm, with VG-30 bitumen', 'Cu.m', 6_820, 8_940],
    ['BC-01', 'Bituminous concrete wearing course, 40 mm', 'Cu.m', 3_640, 10_480],
    ['DRN-01', 'RCC storm water drain 600 x 600 mm including bedding', 'Metre', 4_200, 3_260],
    ['SGN-01', 'Retro-reflective cautionary and informatory signage', 'Nos', 180, 8_450],
  ];
  boq.forEach((item, index) => {
    insertBoq.run(
      openTenderId, index + 1, item[0], item[1], item[2],
      item[3] * 1000, toPaise(item[4]),
    );
  });

  // A completed procurement, sitting at financial evaluation with ranked bids.
  const evalTenderId = Number(
    insertTender.run(
      'DIV-SGR/TEN/2026-27/0001',
      'Construction of divisional office building, Gandhinagar',
      'Lump sum tender for civil, plumbing and electrical works of the G+3 divisional office block.',
      projectIds.projBldg!, pkgs.pkgBldgId, ids.divSgr!, 'OPEN', 'LUMPSUM',
      toPaise(38_500_000), toPaise(770_000), toPaise(11_800), 480, 'Class B',
      'Minimum average annual turnover of ₹12 crore. At least one building work of ₹15 crore completed in the last five years.',
      '2026-06-15', '2026-06-15 10:00:00', '2026-07-20 17:00:00',
      '2026-07-21 11:00:00', '2026-07-28 11:00:00',
      'FINANCIAL_EVALUATION', userIds['ee.patel']!,
    ).lastInsertRowid,
  );

  const insertBid = db.prepare(
    `INSERT INTO bids (bid_no, tender_id, contractor_id, emd_reference, emd_paid, quoted_amount,
                       variation_bps, technical_score, technical_status, technical_remarks,
                       financial_status, rank, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const estimate = toPaise(38_500_000);
  const bids: [string, number, number, number, string, string, number | null][] = [
    ['C-10003', 36_575_000, 88, 1, 'QUALIFIED', 'Meets all turnover and experience criteria.', 1],
    ['C-10001', 37_730_000, 92, 2, 'QUALIFIED', 'Strong technical capacity; all documents in order.', 2],
    ['C-10002', 39_655_000, 71, 3, 'QUALIFIED', 'Qualified on the strength of a similar completed work.', 3],
  ];
  bids.forEach(([code, amount, score, index, status, remarks, rank]) => {
    const quoted = toPaise(amount);
    insertBid.run(
      `DIV-SGR/TEN/2026-27/0001/BID/${String(index).padStart(3, '0')}`,
      evalTenderId, contractorIds[code]!,
      `EMD/${code}/2026/${index}`, toPaise(770_000), quoted,
      Math.round(((quoted - estimate) / estimate) * 10_000),
      score, status, remarks, 'EVALUATED', rank, 'TECHNICALLY_QUALIFIED',
      `2026-07-${String(14 + index).padStart(2, '0')} 15:${String(20 + index * 7)}:00`,
    );
  });
}

/**
 * The demo records above are inserted with hand-written reference numbers so
 * the fixtures read realistically. The live code generators draw their serials
 * from the `sequences` table, which knows nothing about those inserts — so
 * without this step the first bill or tender raised through the UI would reuse
 * a number that already exists and fail its UNIQUE constraint.
 *
 * Every counter is therefore advanced to the highest serial already on record,
 * using the same key each generator uses.
 */
function primeSequences(): void {
  const db = getDb();
  const bump = db.prepare(
    `INSERT INTO sequences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = MAX(value, excluded.value)`,
  );
  const set = (key: string, serial: number) => {
    if (Number.isFinite(serial) && serial > 0) bump.run(key, serial);
  };
  /** Serial is always the last path segment of a slash-delimited reference. */
  const tail = (reference: string) => Number(reference.slice(reference.lastIndexOf('/') + 1));

  type Row = Record<string, string | null>;
  const rows = (sql: string) => db.prepare(sql).all() as Row[];

  // Project codes: <SCHEME>-<LOCATION>-<SERIAL>, keyed on scheme and location.
  for (const row of rows(
    `SELECT p.project_code AS code, s.code AS scheme,
            COALESCE(t.name, ds.name, d.name) AS location
       FROM projects p
       JOIN schemes s ON s.id = p.scheme_id
       JOIN divisions d ON d.id = p.division_id
       LEFT JOIN towns t ON t.id = p.town_id
       LEFT JOIN districts ds ON ds.id = p.district_id`,
  )) {
    const code = row.code!;
    set(`PROJECT:${row.scheme}:${slug(row.location!)}`, Number(code.slice(code.lastIndexOf('-') + 1)));
  }

  // Package codes: <PROJECT_CODE>/PKG-<SERIAL>.
  for (const row of rows(
    `SELECT pk.package_code AS code, p.project_code AS project
       FROM packages pk JOIN projects p ON p.id = pk.project_id`,
  )) {
    set(`PACKAGE:${row.project}`, Number(row.code!.slice(row.code!.lastIndexOf('-') + 1)));
  }

  // Work order numbers are issued against a division and financial year.
  for (const row of rows(
    `SELECT pk.work_order_no AS code, d.code AS division
       FROM packages pk
       JOIN projects p ON p.id = pk.project_id
       JOIN divisions d ON d.id = p.division_id
      WHERE pk.work_order_no IS NOT NULL AND pk.work_order_no LIKE '%/WO/%'`,
  )) {
    const fy = row.code!.split('/')[2]!;
    set(`WO:${row.division}:${fy}`, tail(row.code!));
  }

  for (const row of rows(
    `SELECT t.tender_no AS code, d.code AS division FROM tenders t
       JOIN divisions d ON d.id = t.division_id`,
  )) {
    set(`TENDER:${row.division}:${row.code!.split('/')[2]!}`, tail(row.code!));
  }

  for (const row of rows(
    `SELECT b.bid_no AS code, t.tender_no AS tender FROM bids b
       JOIN tenders t ON t.id = b.tender_id`,
  )) {
    set(`BID:${row.tender}`, tail(row.code!));
  }

  for (const row of rows(
    `SELECT a.loa_no AS code, d.code AS division FROM tender_awards a
       JOIN tenders t ON t.id = a.tender_id
       JOIN divisions d ON d.id = t.division_id
      WHERE a.loa_no LIKE '%/LOA/%'`,
  )) {
    set(`LOA:${row.division}:${row.code!.split('/')[2]!}`, tail(row.code!));
  }

  for (const row of rows(
    `SELECT rb.bill_no AS code, rb.dbr_no AS dbr, rb.tally_voucher_no AS voucher,
            rb.financial_year AS fy, d.code AS division
       FROM ra_bills rb JOIN divisions d ON d.id = rb.division_id`,
  )) {
    set(`RA_BILL:${row.division}:${row.fy}`, tail(row.code!));
    // DBR numbers read "<serial>/<short financial year>".
    if (row.dbr) set(`DBR:${row.division}:${row.fy}`, Number(row.dbr.split('/')[0]));
    if (row.voucher) set(`TALLY:${row.division}:${row.fy}`, tail(row.voucher));
  }

  for (const row of rows(
    `SELECT mb.bill_no AS code, mb.tally_voucher_no AS voucher, mb.financial_year AS fy,
            d.code AS division
       FROM misc_bills mb JOIN divisions d ON d.id = mb.division_id`,
  )) {
    // <DIVISION>/<CATEGORY>/<FY>/<SERIAL> — the category short code is the key.
    const short = row.code!.split('/')[1]!;
    set(`MISC_BILL:${row.division}:${short}:${row.fy}`, tail(row.code!));
    if (row.voucher) set(`TALLY:${row.division}:${row.fy}`, tail(row.voucher));
  }

  // Contractor codes are "C-<10000 + serial>".
  for (const row of rows(`SELECT code FROM contractors WHERE code LIKE 'C-%'`)) {
    set('CONTRACTOR', Number(row.code!.slice(2)) - 10000);
  }

  for (const row of rows(
    `SELECT l.loc_no AS code, l.financial_year AS fy, d.code AS division
       FROM loc_requests l JOIN divisions d ON d.id = l.division_id`,
  )) {
    set(`LOC:${row.division}:${row.fy}`, tail(row.code!));
  }

  for (const row of rows(
    `SELECT f.release_no AS code, f.financial_year AS fy, s.code AS scheme
       FROM fund_releases f JOIN schemes s ON s.id = f.scheme_id`,
  )) {
    set(`FUND_RELEASE:${row.scheme}:${row.fy}`, tail(row.code!));
  }
}

function seedBills(
  ids: Ids,
  userIds: Ids,
  contractorIds: Ids,
  projectIds: Ids,
  pkgs: { pkgRoadId: number; pkgWaterId: number },
): void {
  const db = getDb();

  const insertBill = db.prepare(
    `INSERT INTO ra_bills
       (bill_no, dbr_no, financial_year, ra_sequence, bill_type, project_id, package_id,
        contractor_id, division_id, period_from, period_to, measurement_book_no,
        contractor_claim_amount, previous_paid_amount, present_bill_amount, admissible_amount,
        total_deduction, net_payable_amount, etp_establishment_bps, etp_tools_plant_bps,
        etp_contingency_bps, etp_total_bps, etp_amount, status, tally_voucher_no,
        eoffice_file_no, payment_date, payment_reference, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO ra_bill_items (ra_bill_id, sl_no, description, uom, quantity_upto_date,
                                quantity_previous, quantity_present, rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDeduction = db.prepare(
    `INSERT INTO ra_bill_deductions (ra_bill_id, deduction_code, description, basis, rate_bps, amount)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  /** Deduction schedule applied to every seeded works bill: 10% in total. */
  function addDeductions(billId: number, gross: number): number {
    const heads: [string, string, number][] = [
      ['IT-TDS', 'Income Tax TDS (194C)', 2],
      ['GST-TDS', 'GST TDS', 2],
      ['SD', 'Security Deposit', 5],
      ['LABOUR-CESS', 'Labour Welfare Cess', 1],
    ];
    let total = 0;
    for (const [code, name, pct] of heads) {
      const amount = Math.round((gross * pct) / 100);
      total += amount;
      insertDeduction.run(billId, code, name, 'PERCENT', toBps(pct), amount);
    }
    return total;
  }

  const ETP = { est: toBps(2), tp: toBps(3), cont: toBps(4) };
  const etpTotal = ETP.est + ETP.tp + ETP.cont;

  interface BillSpec {
    seq: number;
    dbr: string;
    gross: number;
    from: string;
    to: string;
    mb: string;
    status: string;
    tally: string | null;
    eoffice: string | null;
    paymentDate: string | null;
    paymentRef: string | null;
    items: [string, string, number, number, number][];
  }

  const roadBills: BillSpec[] = [
    {
      seq: 1, dbr: '1/26-27', gross: 18_420_000, from: '2026-04-01', to: '2026-06-30',
      mb: 'MB/NGR/2026/041', status: 'PAID',
      tally: 'TV/DIV-NGR/2026-27/00001', eoffice: 'PWD/NGR/RA/2026/0041',
      paymentDate: '2026-07-28', paymentRef: 'RTGS/SBIN/2026/778341',
      items: [
        ['Excavation in ordinary soil including disposal within 1 km lead', 'Cu.m', 22_400, 0, 182],
        ['Embankment construction with approved earth, compacted in layers', 'Cu.m', 31_800, 0, 246],
        ['Granular sub-base, Grade III, laid and compacted', 'Cu.m', 3_240, 0, 1_842],
      ],
    },
    {
      seq: 2, dbr: '2/26-27', gross: 14_860_000, from: '2026-07-01', to: '2026-09-30',
      mb: 'MB/NGR/2026/058', status: 'SENT_TO_TALLY',
      tally: 'TV/DIV-NGR/2026-27/00002', eoffice: 'PWD/NGR/RA/2026/0058',
      paymentDate: null, paymentRef: null,
      items: [
        ['Excavation in ordinary soil including disposal within 1 km lead', 'Cu.m', 31_600, 22_400, 182],
        ['Granular sub-base, Grade III, laid and compacted', 'Cu.m', 8_900, 3_240, 1_842],
        ['Wet mix macadam laid and compacted to 250 mm thickness', 'Cu.m', 1_820, 0, 2_186],
      ],
    },
    {
      seq: 3, dbr: '3/26-27', gross: 9_640_000, from: '2026-10-01', to: '2026-12-31',
      mb: 'MB/NGR/2026/071', status: 'IN_APPROVAL',
      tally: null, eoffice: null, paymentDate: null, paymentRef: null,
      items: [
        ['Wet mix macadam laid and compacted to 250 mm thickness', 'Cu.m', 5_940, 1_820, 2_186],
        ['RCC storm water drain 600 x 600 mm including bedding', 'Metre', 260, 0, 3_260],
      ],
    },
  ];

  const billIds: number[] = [];
  let cumulative = 0;
  for (const spec of roadBills) {
    const gross = toPaise(spec.gross);
    const admissible = gross;
    const billId = Number(
      insertBill.run(
        `DIV-NGR/RA/2026-27/${String(spec.seq).padStart(4, '0')}`, spec.dbr, '2026-27',
        spec.seq, 'RA', projectIds.projRoad!, pkgs.pkgRoadId,
        contractorIds['C-10001']!, ids.divNgr!,
        spec.from, spec.to, spec.mb,
        gross, cumulative, gross, admissible,
        0, gross,
        ETP.est, ETP.tp, ETP.cont, etpTotal, Math.round((admissible * etpTotal) / 10_000),
        spec.status, spec.tally, spec.eoffice, spec.paymentDate, spec.paymentRef,
        userIds['ac.nair']!,
      ).lastInsertRowid,
    );
    billIds.push(billId);
    cumulative += gross;

    spec.items.forEach((item, index) => {
      const present = item[2] - item[3];
      insertItem.run(
        billId, index + 1, item[0], item[1],
        item[2] * 1000, item[3] * 1000, present * 1000,
        toPaise(item[4]), Math.round((present * 1000 * toPaise(item[4])) / 1000),
      );
    });

    const deduction = addDeductions(billId, gross);
    db.prepare(
      `UPDATE ra_bills SET total_deduction = ?, net_payable_amount = ? WHERE id = ?`,
    ).run(deduction, gross - deduction, billId);
  }

  // A water-supply bill sitting in the middle of its approval chain.
  const waterGross = toPaise(11_240_000);
  const waterBillId = Number(
    insertBill.run(
      'DIV-NGR/RA/2026-27/0004', '4/26-27', '2026-27', 1, 'RA',
      projectIds.projWater!, pkgs.pkgWaterId, contractorIds['C-10003']!, ids.divNgr!,
      '2026-04-01', '2026-07-31', 'MB/NGR/2026/063',
      waterGross, 0, waterGross, waterGross, 0, waterGross,
      ETP.est, ETP.tp, ETP.cont, etpTotal, Math.round((waterGross * etpTotal) / 10_000),
      'IN_APPROVAL', null, null, null, null,
      userIds['ac.nair']!,
    ).lastInsertRowid,
  );
  const waterItems: [string, string, number, number, number][] = [
    ['Supplying and laying DI K9 pipe, 300 mm dia, including jointing', 'Metre', 4_820, 0, 1_640],
    ['Supplying and laying DI K9 pipe, 200 mm dia, including jointing', 'Metre', 3_240, 0, 980],
    ['Construction of RCC valve chamber 1.2 x 1.2 x 1.5 m', 'Nos', 46, 0, 18_400],
  ];
  waterItems.forEach((item, index) => {
    insertItem.run(
      waterBillId, index + 1, item[0], item[1],
      item[2] * 1000, item[3] * 1000, (item[2] - item[3]) * 1000,
      toPaise(item[4]), Math.round(((item[2] - item[3]) * 1000 * toPaise(item[4])) / 1000),
    );
  });
  const waterDeduction = addDeductions(waterBillId, waterGross);
  db.prepare(`UPDATE ra_bills SET total_deduction = ?, net_payable_amount = ? WHERE id = ?`).run(
    waterDeduction, waterGross - waterDeduction, waterBillId,
  );

  seedMiscBills(ids, userIds, projectIds);
}

function seedMiscBills(ids: Ids, userIds: Ids, projectIds: Ids): void {
  const db = getDb();
  const insertBill = db.prepare(
    `INSERT INTO misc_bills
       (bill_no, bill_category, financial_year, project_id, division_id, bill_date, period_from,
        period_to, site_id, payee_name, payee_type, submitted_by_user_id, submitted_by_designation,
        gross_amount, total_deduction, net_payable_amount, amount_in_words, refund_reference,
        status, tally_voucher_no, eoffice_file_no, payment_date, payment_reference, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO misc_bill_items (misc_bill_id, sl_no, expense_date, description, category_code,
                                  govt_object_head, invoice_no, gstin, amount, remarks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  interface MiscSpec {
    billNo: string;
    category: string;
    projectKey: string | null;
    date: string;
    site: string | null;
    payee: string;
    status: string;
    refund: string | null;
    /** expenseDate, description, categoryCode, invoiceNo, gstin, amountRupees */
    items: [string, string, string, string | null, string | null, number][];
  }

  const specs: MiscSpec[] = [
    {
      billNo: 'DIV-NGR/PE/2026-27/0001', category: 'PROJECT_EXPENSE', projectKey: 'projRoad',
      date: '2026-07-14', site: 'KLB-RR-02', payee: 'Er. Praveen Reddy', status: 'PAID',
      refund: null,
      items: [
        ['2026-07-02', 'Tender notice published in Deccan Herald and Prajavani', 'PE-ADVT', 'INV/DH/2026/2214', '29AABCD1234E1Z5', 86_400],
        ['2026-07-08', 'Purchase of 60 safety helmets and 40 reflective jackets for site staff', 'SF-PPE', 'INV/SS/2026/0911', '29AAFCS7788K1ZL', 74_200],
        ['2026-07-11', 'Diesel for departmental survey vehicle KA-32-G-1188', 'SF-FUEL', 'INV/IOC/2026/5521', '29AAACI1681G1ZP', 18_600],
      ],
    },
    {
      billNo: 'DIV-NGR/RE/2026-27/0001', category: 'REVENUE_EXPENSE', projectKey: null,
      date: '2026-08-05', site: null, payee: 'Smt. Deepa Nair', status: 'IN_APPROVAL',
      refund: null,
      items: [
        ['2026-07-22', 'Purchase of A4 paper, files and register books for the division office', 'OE-STAT', 'INV/BS/2026/1188', '29AAGFB4455M1ZN', 24_800],
        ['2026-07-26', 'Photocopying of tender documents and estimate volumes', 'OE-PRINT', 'INV/CP/2026/0342', null, 4_650],
        ['2026-07-29', 'Local conveyance for site visits to Kalburgi ring road', 'TC-LOCAL', null, null, 3_200],
        ['2026-08-01', 'Annual maintenance of two office printers', 'RM-IT', 'INV/TS/2026/0776', '29AAECT3322H1ZK', 12_400],
      ],
    },
    {
      billNo: 'DIV-NGR/RF/2026-27/0001', category: 'REFUND', projectKey: null,
      date: '2026-08-12', site: null, payee: 'Vishwa Infra Projects', status: 'DRAFT',
      refund: 'EMD/C-10002/2026/3',
      items: [
        ['2026-08-12', 'Refund of earnest money deposit against unsuccessful bid for the office building tender', 'RF-EMD', 'EMD/C-10002/2026/3', null, 770_000],
      ],
    },
  ];

  for (const spec of specs) {
    const gross = spec.items.reduce((sum, item) => sum + toPaise(item[5]), 0);
    const billId = Number(
      insertBill.run(
        spec.billNo, spec.category, '2026-27',
        spec.projectKey ? projectIds[spec.projectKey]! : null, ids.divNgr!,
        spec.date, spec.date, spec.date, spec.site,
        spec.payee, spec.category === 'REFUND' ? 'CONTRACTOR' : 'STAFF',
        userIds['ac.nair']!, 'Account Clerk',
        gross, 0, gross, amountInWordsLocal(gross), spec.refund,
        spec.status,
        spec.status === 'PAID' ? 'TV/DIV-NGR/2026-27/00003' : null,
        spec.status === 'PAID' ? 'PWD/NGR/MB/2026/0011' : null,
        spec.status === 'PAID' ? '2026-08-02' : null,
        spec.status === 'PAID' ? 'RTGS/SBIN/2026/779002' : null,
        null, userIds['ac.nair']!,
      ).lastInsertRowid,
    );

    spec.items.forEach((item, index) => {
      const category = db
        .prepare(`SELECT govt_object_head FROM expense_categories WHERE code = ?`)
        .get(item[2]) as { govt_object_head: string | null } | undefined;
      insertItem.run(
        billId, index + 1, item[0], item[1], item[2],
        category?.govt_object_head ?? null, item[3], item[4], toPaise(item[5]), null,
      );
    });
  }
}

/** Local copy so the seed does not import the whole money module surface. */
function amountInWordsLocal(paise: number): string {
  // The service layer regenerates this on read; a readable placeholder is enough here.
  return `Rupees ${Math.floor(paise / 100).toLocaleString('en-IN')} Only`;
}

function seedFunds(ids: Ids, userIds: Ids, projectIds: Ids): void {
  const db = getDb();
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM fund_releases`).get() as { n: number };
  if (existing.n > 0) return;

  const insertRelease = db.prepare(
    `INSERT INTO fund_releases (release_no, scheme_id, project_id, division_id, financial_year,
                                sanctioned_amount, released_amount, release_date, reference_no,
                                remarks, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RELEASED', ?)`,
  );
  insertRelease.run(
    'U-PLAN/FR/2026-27/001', ids.schemeUplan!, projectIds.projRoad!, ids.divNgr!, '2026-27',
    toPaise(141_300_000), toPaise(64_000_000), '2026-04-18', 'GO/FIN/2026/0412',
    'First instalment for the current financial year.', userIds['cao.desai']!,
  );
  insertRelease.run(
    'AMRUT/FR/2026-27/001', ids.schemeAmrut!, projectIds.projWater!, ids.divNgr!, '2026-27',
    toPaise(94_000_000), toPaise(32_000_000), '2026-05-06', 'GO/FIN/2026/0518',
    'Central share released against the approved annual action plan.', userIds['cao.desai']!,
  );

  const insertLoc = db.prepare(
    `INSERT INTO loc_requests (loc_no, division_id, scheme_id, financial_year, request_date,
                               requested_amount, approved_amount, purpose, status, approval_date,
                               created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insertLoc.run(
    'DIV-NGR/LOC/2026-27/001', ids.divNgr!, ids.schemeUplan!, '2026-27', '2026-07-01',
    toPaise(22_000_000), toPaise(20_000_000),
    'Letter of credit to clear pending running account bills for the ring road package.',
    'APPROVED', '2026-07-12', userIds['ee.kumar']!,
  );
  insertLoc.run(
    'DIV-NGR/LOC/2026-27/002', ids.divNgr!, ids.schemeAmrut!, '2026-27', '2026-08-04',
    toPaise(14_500_000), 0,
    'Letter of credit for the water supply distribution package, second quarter.',
    'DRAFT', null, userIds['ee.kumar']!,
  );
}

// --- Entry point -----------------------------------------------------------

export function seed(): void {
  const db = getDb();
  db.transaction(() => {
    seedRoles();
    seedWorkflows();
    const ids = seedMasters();
    const userIds = seedUsers(ids);
    const contractorIds = seedContractors(ids);
    seedDemoRecords(ids, userIds, contractorIds);
    primeSequences();
  })();

  console.log('Seed complete.');
  console.log(`\nSign in with any of these accounts — the password is: ${DEMO_PASSWORD}\n`);
  console.log('  admin           System Administrator');
  console.log('  md.rao          Managing Director');
  console.log('  ce.sharma       Chief Engineer');
  console.log('  se.iyer         Superintending Engineer');
  console.log('  ee.kumar        Executive Engineer, North Gandhinagar Division');
  console.log('  ae.reddy        Assistant Engineer, Gandhinagar West Sub Division');
  console.log('  ac.nair         Account Clerk');
  console.log('  as.gupta        Account Superintendent');
  console.log('  aao.menon       Assistant Accounts Officer');
  console.log('  cao.desai       Chief Accounts Officer');
  console.log('  auditor.bose    Auditor (read only)');
  console.log('\n  contracts@shakticonstructions.example   Contractor (Shakti Constructions)');
  console.log('  office@gangabuilders.example            Contractor (Ganga Builders)');
}

// Run directly: `npm run db:seed`
if (process.argv[1]?.includes('seed')) {
  seed();
}
