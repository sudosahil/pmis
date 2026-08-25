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
  // Chains are versioned, so the lookup must find the version in force rather
  // than any row that happens to share the code.
  const current = db
    .prepare(`SELECT id FROM workflow_definitions WHERE code = ? AND is_current = 1`)
    .get(code) as { id: number } | undefined;
  const definitionId =
    current?.id ??
    Number(
      db
        .prepare(
          `INSERT INTO workflow_definitions (code, version, is_current, name, entity_type, description)
           VALUES (?, 1, 1, ?, ?, ?)`,
        )
        .run(code, name, entityType, description).lastInsertRowid,
    );

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

  // An award binds the department to pay a stated sum for land it does not yet
  // hold, so it is checked in the division, reviewed in the circle and sanctioned
  // by the accounts cadre before a paisa of compensation moves.
  seedWorkflow(
    WORKFLOWS.LAND_ACQUISITION,
    'Land Acquisition Award',
    ENTITY_TYPES.LAND_PARCEL,
    'Approval of the compensation award passed under Section 23 of the 2013 Act, '
      + 'before compensation is disbursed and possession taken.',
    [
      { code: 'EE_VERIFY', name: 'Divisional Verification (EE)', role: ROLES.EE, scope: 'DIVISION', slaDays: 5 },
      { code: 'SE_REVIEW', name: 'Circle Review (SE)', role: ROLES.SE, scope: 'CIRCLE', slaDays: 5 },
      { code: 'CAO_SANCTION', name: 'Compensation Sanction (CAO)', role: ROLES.CAO, scope: 'GLOBAL', slaDays: 7 },
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

/**
 * A starting filing structure and a couple of live conversations, so the file
 * manager and the chat open on something real rather than an empty screen.
 * No bytes are written — the folders are what a division would set up on day
 * one, and files arrive when someone uploads them.
 */
/**
 * The Schedule of Rates, and the agreement BOQ for the two live packages.
 *
 * Every BOQ line is priced against an SR item, so the agreed rate can be read
 * against the sanctioned rate — which is the comparison the department actually
 * makes when scrutinising a bill.
 */
export type SrIds = Record<string, { id: number; rate: number; uom: string; name: string }>;

function seedRatesAndBoq(pkgs: { pkgRoadId: number; pkgWaterId: number }): SrIds {
  const db = getDb();
  const already = db.prepare(`SELECT COUNT(*) AS n FROM schedule_of_rates`).get() as { n: number };
  if (already.n > 0) return readSrIds();

  const insertSr = db.prepare(
    `INSERT INTO schedule_of_rates (code, name, chapter, uom, rate, sr_year, effective_date, govt_reference)
     VALUES (?, ?, ?, ?, ?, '2024-25', '2024-04-01', 'PWD/SR/2024-25/CIRC-01')`,
  );

  // code, item of work, chapter, unit, rate in rupees
  const rates: [string, string, string, string, number][] = [
    ['2.8.1', 'Earthwork excavation in ordinary soil, including disposal up to 50 m', 'Earthwork', 'cum', 285],
    ['2.8.4', 'Earthwork excavation in hard rock requiring blasting', 'Earthwork', 'cum', 640],
    ['2.14.2', 'Filling in embankment with approved excavated earth, compacted in layers', 'Earthwork', 'cum', 198],
    ['4.1.3', 'Providing and laying granular sub-base, Grade II', 'Roadwork', 'cum', 1_845],
    ['4.4.1', 'Wet mix macadam, laid and compacted to specification', 'Roadwork', 'cum', 2_260],
    ['4.11.2', 'Bituminous macadam, 50 mm compacted thickness', 'Roadwork', 'sqm', 412],
    ['4.12.6', 'Semi dense bituminous concrete, 30 mm compacted thickness', 'Roadwork', 'sqm', 348],
    ['5.3.2', 'Plain cement concrete M15, in foundation and plinth', 'Concrete', 'cum', 5_420],
    ['5.6.1', 'Reinforced cement concrete M25, in situ, excluding steel', 'Concrete', 'cum', 7_180],
    ['5.9.4', 'Thermo-mechanically treated reinforcement steel, cut, bent and placed', 'Concrete', 'MT', 78_500],
    ['7.2.5', 'Providing and laying 300 mm dia DI pipe, K-9, including jointing', 'Pipeline', 'rmt', 2_450],
    ['7.2.7', 'Providing and laying 450 mm dia DI pipe, K-9, including jointing', 'Pipeline', 'rmt', 3_890],
    ['7.6.1', 'Providing and fixing 300 mm dia sluice valve with chamber', 'Pipeline', 'Nos', 46_200],
    ['7.9.3', 'Hydraulic testing and disinfection of laid pipeline', 'Pipeline', 'rmt', 62],
    ['9.4.2', 'Providing and fixing MS railing, painted, as per drawing', 'Miscellaneous', 'rmt', 1_240],
  ];
  const srIds: SrIds = {};
  for (const [code, name, chapter, uom, rate] of rates) {
    const id = Number(insertSr.run(code, name, chapter, uom, toPaise(rate)).lastInsertRowid);
    srIds[code] = { id, rate: toPaise(rate), uom, name };
  }

  seedRateHistory(rates, srIds);

  const insertBoq = db.prepare(
    `INSERT INTO package_boq_items
       (package_id, sl_no, item_code, description, uom, quantity, agreed_rate, amount, sr_item_id, sr_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  /** Agreed rates sit a little off the SR, which is what a real tender produces. */
  const addBoq = (
    packageId: number,
    lines: [string, number, number][], // SR code, quantity, agreed rate in rupees
  ) => {
    lines.forEach(([code, qty, agreed], index) => {
      const sr = srIds[code]!;
      const quantity = Math.round(qty * 1000);
      const agreedRate = toPaise(agreed);
      insertBoq.run(
        packageId,
        index + 1,
        code,
        rates.find((r) => r[0] === code)![1],
        rates.find((r) => r[0] === code)![3],
        quantity,
        agreedRate,
        Math.round((quantity * agreedRate) / 1000),
        sr.id,
        sr.rate,
      );
    });
  };

  // Ring road widening — earthwork through to the wearing course.
  addBoq(pkgs.pkgRoadId, [
    ['2.8.1', 18_400, 279],
    ['2.8.4', 2_150, 655],
    ['2.14.2', 12_600, 202],
    ['4.1.3', 4_820, 1_798],
    ['4.4.1', 3_940, 2_310],
    ['4.11.2', 62_000, 405],
    ['4.12.6', 62_000, 356],
    ['5.6.1', 640, 7_050],
    ['5.9.4', 48, 79_200],
    ['9.4.2', 2_400, 1_215],
  ]);

  // Water supply distribution network — pipeline and appurtenances.
  addBoq(pkgs.pkgWaterId, [
    ['2.8.1', 9_800, 291],
    ['7.2.5', 11_500, 2_398],
    ['7.2.7', 3_200, 3_950],
    ['7.6.1', 34, 45_800],
    ['7.9.3', 14_700, 64],
    ['5.3.2', 380, 5_310],
  ]);

  return srIds;
}

/** The rate book as it stands, for a run against an already-seeded database. */
function readSrIds(): SrIds {
  const rows = getDb()
    .prepare(`SELECT code, id, rate, uom, name FROM schedule_of_rates`)
    .all() as { code: string; id: number; rate: number; uom: string; name: string }[];
  return Object.fromEntries(
    rows.map((row) => [row.code, { id: row.id, rate: row.rate, uom: row.uom, name: row.name }]),
  );
}

/**
 * How the rate book got to where it is.
 *
 * The 2024-25 edition is the baseline, and a mid-year escalation order revised
 * the bitumen and steel rates upward — the kind of movement that happens when
 * commodity prices run ahead of a schedule fixed a year earlier, and exactly
 * the situation that forces a department to permit bidding above the schedule.
 * Without this the change-history report would open on an empty screen.
 */
function seedRateHistory(
  rates: [string, string, string, string, number][],
  srIds: SrIds,
): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO schedule_of_rate_history
       (sr_item_id, sr_code, sr_name, chapter, uom, change_kind, old_rate, new_rate,
        old_sr_year, new_sr_year, old_status, new_status, effective_date, govt_reference,
        remarks, changed_by, changed_by_name, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  );

  const byCode = new Map(rates.map((rate) => [rate[0], rate]));
  const CHIEF = 'Er. Anil Sharma';

  // The edition itself: every item entered when the 2024-25 schedule was adopted.
  for (const [code, name, chapter, uom] of rates) {
    insert.run(
      srIds[code]!.id, code, name, chapter, uom, 'CREATED',
      null, srIds[code]!.rate, null, '2024-25', null, 'ACTIVE',
      '2024-04-01', 'PWD/SR/2024-25/CIRC-01',
      'Item adopted with the 2024-25 Schedule of Rates.', CHIEF, '2024-04-01 10:00:00',
    );
  }

  /** code, rate before the revision (rupees), when it took effect, why. */
  const revisions: [string, number, string, string, string][] = [
    ['4.11.2', 366, '2025-10-01', 'PWD/SR/2025/ESC-14',
      'Bitumen price escalation — VG-30 landed cost up 12.6% over the quarter.'],
    ['4.12.6', 309, '2025-10-01', 'PWD/SR/2025/ESC-14',
      'Bitumen price escalation, applied to the wearing course rate on the same order.'],
    ['5.9.4', 71_400, '2025-10-01', 'PWD/SR/2025/ESC-14',
      'TMT steel escalation — mill prices up 9.9% since the edition was fixed.'],
    ['7.2.7', 3_640, '2026-02-15', 'PWD/SR/2026/ESC-03',
      'Ductile iron pipe rates revised on the strength of three fresh market quotations.'],
    ['2.8.4', 618, '2026-02-15', 'PWD/SR/2026/ESC-03',
      'Explosive and drilling costs revised for hard rock excavation.'],
  ];

  for (const [code, oldRupees, effective, reference, remarks] of revisions) {
    const item = byCode.get(code)!;
    insert.run(
      srIds[code]!.id, code, item[1], item[2], item[3], 'RATE_REVISED',
      toPaise(oldRupees), srIds[code]!.rate, '2024-25', '2024-25', 'ACTIVE', 'ACTIVE',
      effective, reference, remarks, CHIEF, `${effective} 11:30:00`,
    );
  }

  // One line withdrawn rather than repriced, so the report shows both kinds.
  insert.run(
    srIds['9.4.2']!.id, '9.4.2', byCode.get('9.4.2')![1], 'Miscellaneous', 'rmt', 'STATUS_CHANGED',
    srIds['9.4.2']!.rate, srIds['9.4.2']!.rate, '2024-25', '2024-25', 'ACTIVE', 'ACTIVE',
    '2026-04-01', 'PWD/SR/2026/CIRC-09',
    'Specification reworded to require galvanised sections; rate unchanged.',
    CHIEF, '2026-04-01 09:15:00',
  );
}

function seedWorkspace(ids: Ids, userIds: Ids): void {
  const db = getDb();
  const already = db.prepare(`SELECT COUNT(*) AS n FROM document_folders`).get() as { n: number };
  if (already.n > 0) return;

  const insertFolder = db.prepare(
    `INSERT INTO document_folders (name, parent_id, description, division_id, created_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const folder = (
    name: string,
    parent: number | null,
    description: string,
    divisionId: number | null,
  ) => Number(insertFolder.run(name, parent, description, divisionId, userIds.admin!).lastInsertRowid);

  const circulars = folder('Circulars and orders', null, 'Government orders, departmental circulars and office memoranda.', null);
  folder('Government orders', circulars, 'Orders issued by the department.', null);
  folder('Office memoranda', circulars, 'Internal memoranda and standing instructions.', null);

  const standards = folder('Standards and schedules', null, 'Schedule of rates, specifications and standard drawings.', null);
  folder('Schedule of rates', standards, 'The current and previous schedules of rates.', null);
  folder('Standard specifications', standards, 'Material and workmanship specifications.', null);

  const templates = folder('Forms and templates', null, 'Blank departmental forms for site and office use.', null);
  folder('Bill forms', templates, 'RA bill, miscellaneous bill and voucher templates.', null);
  folder('Tender documents', templates, 'Model tender documents and bid forms.', null);

  const division = folder('North Gandhinagar Division', null, 'Files belonging to the division office.', ids.divNgr ?? null);
  folder('Measurement books', division, 'Scanned measurement books, by work.', ids.divNgr ?? null);
  folder('Agreements', division, 'Executed agreements and work orders.', ids.divNgr ?? null);
  folder('Site photographs', division, 'Progress photographs, by package.', ids.divNgr ?? null);

  // --- Conversations -------------------------------------------------------

  const insertConversation = db.prepare(
    `INSERT INTO conversations (kind, name, topic, direct_key, created_by, last_message_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', ?))`,
  );
  const insertMember = db.prepare(
    `INSERT INTO conversation_members (conversation_id, user_id, is_admin) VALUES (?, ?, ?)`,
  );
  const insertMessage = db.prepare(
    `INSERT INTO messages (conversation_id, sender_id, body, created_at)
     VALUES (?, ?, ?, datetime('now', ?))`,
  );

  const billsGroup = Number(
    insertConversation.run(
      'GROUP',
      'Divisional bills desk',
      'Coordination between the division office and the accounts wing on bills in approval.',
      null,
      userIds['ee.kumar']!,
      '-35 minutes',
    ).lastInsertRowid,
  );
  for (const [username, isAdmin] of [
    ['ee.kumar', 1], ['ae.reddy', 0], ['ac.nair', 0], ['as.gupta', 0], ['aao.menon', 0], ['cao.desai', 0],
  ] as [string, number][]) {
    if (userIds[username]) insertMember.run(billsGroup, userIds[username]!, isAdmin);
  }
  const groupThread: [string, string, string][] = [
    ['ee.kumar', 'Bills for the ring road package are with the accounts wing. Please take them up today.', '-3 hours'],
    ['ac.nair', 'Noted sir. Deductions schedule checked for RA 2, security deposit and labour cess applied.', '-2 hours'],
    ['as.gupta', 'Scrutiny done on my side. One query on the measurement book reference, raising it on the file.', '-95 minutes'],
    ['cao.desai', 'Once the query is settled send it up, we can clear it in this week’s batch.', '-35 minutes'],
  ];
  for (const [username, body, offset] of groupThread) {
    if (userIds[username]) insertMessage.run(billsGroup, userIds[username]!, body, offset);
  }

  const direct = Number(
    insertConversation.run(
      'DIRECT',
      null,
      null,
      [userIds['ee.kumar']!, userIds['ae.reddy']!].sort((a, b) => a - b).join(':'),
      userIds['ee.kumar']!,
      '-20 minutes',
    ).lastInsertRowid,
  );
  insertMember.run(direct, userIds['ee.kumar']!, 1);
  insertMember.run(direct, userIds['ae.reddy']!, 1);
  const directThread: [string, string, string][] = [
    ['ee.kumar', 'Reddy, have the measurements for chainage 4.200 onwards been recorded?', '-50 minutes'],
    ['ae.reddy', 'Yes sir, recorded on Tuesday. Uploading the measurement book scan to the division folder now.', '-20 minutes'],
  ];
  for (const [username, body, offset] of directThread) {
    insertMessage.run(direct, userIds[username]!, body, offset);
  }
}

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

  // The rate book comes first: estimates are priced from it, tenders take their
  // ceiling from it, and agreements are read against it.
  const srIds = seedRatesAndBoq({ pkgRoadId, pkgWaterId });
  const dprIds = seedDprs(userIds, projectIds, srIds);
  seedTenders(ids, userIds, contractorIds, projectIds, { pkgRoad2Id, pkgBldgId }, srIds, dprIds);
  seedBills(ids, userIds, contractorIds, projectIds, { pkgRoadId, pkgWaterId });
  seedFunds(ids, userIds, projectIds);
  seedCasework(ids, userIds, contractorIds, projectIds);
  seedApprovalFlows(userIds, contractorIds);
  ageWorkflowInstances();
}

/**
 * Puts the approval engine's clock in step with the bills it is carrying.
 *
 * The workflow rows are written a moment ago, so without this every file would
 * look as though it arrived today and both the ageing analysis and the pendency
 * report would read as a department that never keeps anyone waiting. Each
 * in-flight file is dated from the record it belongs to, and the actions taken
 * on it are spread across the time since — leaving it sitting at its current
 * desk for the balance, which is where the delay shows.
 */
function ageWorkflowInstances(): void {
  const db = getDb();

  // Each file inherits the date of the record it carries.
  for (const [entityType, table] of [
    ['RA_BILL', 'ra_bills'],
    ['MISC_BILL', 'misc_bills'],
  ] as const) {
    db.prepare(
      `UPDATE workflow_instances
          SET created_at = COALESCE(
                (SELECT e.created_at FROM ${table} e WHERE e.id = workflow_instances.entity_id),
                created_at)
        WHERE entity_type = ? AND status = 'IN_PROGRESS'`,
    ).run(entityType);
  }

  const instances = db
    .prepare(
      `SELECT id, created_at FROM workflow_instances WHERE status = 'IN_PROGRESS'`,
    )
    .all() as { id: number; created_at: string }[];

  const setAction = db.prepare(`UPDATE workflow_actions SET created_at = ? WHERE id = ?`);

  for (const instance of instances) {
    const actions = db
      .prepare(`SELECT id FROM workflow_actions WHERE instance_id = ? ORDER BY id`)
      .all(instance.id) as { id: number }[];
    if (!actions.length) continue;

    const started = new Date(`${instance.created_at.replace(' ', 'T')}Z`).getTime();
    const elapsed = Date.now() - started;
    if (!Number.isFinite(elapsed) || elapsed <= 0) continue;

    // The actions fill the first 60% of the wait; the file has been sitting
    // where it is now for the remaining 40%.
    actions.forEach((action, index) => {
      const at = started + (elapsed * 0.6 * (index + 1)) / actions.length;
      setAction.run(new Date(at).toISOString().replace('T', ' ').slice(0, 19), action.id);
    });
  }
}

/**
 * The department's own casework: land being acquired for the ring road, the
 * litigation that acquisition attracted, the committees that sit on tenders and
 * grievances, and the information the public has asked for.
 *
 * All four are register modules, and a register nobody has written in reads as
 * a broken screen rather than an empty one — so each carries enough to show what
 * it is for, including the awkward cases: a parcel stuck in court, a sitting held
 * short of quorum, and an RTI application already past its statutory date.
 */
function seedCasework(ids: Ids, userIds: Ids, contractorIds: Ids, projectIds: Ids): void {
  const db = getDb();
  const already = db.prepare(`SELECT COUNT(*) AS n FROM land_parcels`).get() as { n: number };
  if (already.n > 0) return;

  /** A date this many days before today, as YYYY-MM-DD. */
  const daysAgo = (days: number): string =>
    new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const daysAhead = (days: number): string => daysAgo(-days);

  // --- Land acquisition ------------------------------------------------------

  const insertParcel = db.prepare(
    `INSERT INTO land_parcels
       (parcel_no, project_id, division_id, district_id, village, survey_no, khata_no,
        land_type, area_sqm, owner_name, owner_address, owner_contact,
        notification_no, notification_date, declaration_no, declaration_date,
        award_no, award_date, market_value, solatium_amount, interest_amount, other_amount,
        total_compensation, paid_amount, possession_date, status, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertLandPayment = db.prepare(
    `INSERT INTO land_compensation_payments
       (parcel_id, payment_date, amount, mode, reference_no, payee_name, remarks, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  interface ParcelSpec {
    survey: string;
    khata: string;
    village: string;
    landType: string;
    /** Square metres. */
    area: number;
    owner: string;
    contact: string;
    /** Market value in rupees; solatium is the statutory hundred per cent. */
    market: number;
    other: number;
    interest: number;
    status: string;
    /** How many days ago each statutory stage was recorded, where reached. */
    notifiedDaysAgo?: number;
    declaredDaysAgo?: number;
    awardedDaysAgo?: number;
    possessedDaysAgo?: number;
    /** Instalments of compensation actually paid, in rupees. */
    payments?: [number, number][];   // [rupees, days ago]
    remarks?: string;
  }

  const parcels: ParcelSpec[] = [
    {
      survey: '114/2', khata: 'KH-114-2-BSV', village: 'Basavanahalli', landType: 'AGRICULTURAL',
      area: 4_860, owner: 'Shri Ramachandra Gowda', contact: '+91 98450 11223',
      market: 3_402_000, other: 186_000, interest: 0, status: 'POSSESSED',
      notifiedDaysAgo: 320, declaredDaysAgo: 250, awardedDaysAgo: 180, possessedDaysAgo: 120,
      payments: [[4_000_000, 160], [2_990_000, 130]],
      remarks: 'Possession taken after the award was satisfied in full. Boundary handed over to the contractor.',
    },
    {
      survey: '118/1', khata: 'KH-118-1-BSV', village: 'Basavanahalli', landType: 'AGRICULTURAL',
      area: 2_240, owner: 'Smt. Lakshmamma', contact: '+91 99862 33447',
      market: 1_568_000, other: 94_000, interest: 21_000, status: 'COMPENSATED',
      notifiedDaysAgo: 320, declaredDaysAgo: 250, awardedDaysAgo: 175,
      payments: [[3_251_000, 90]],
      remarks: 'Compensation paid in one instalment. Possession to be taken after the standing crop is harvested.',
    },
    {
      survey: '9/3B', khata: 'KH-9-3B-KDL', village: 'Kadlapura', landType: 'RESIDENTIAL',
      area: 610, owner: 'Shri Imran Pasha', contact: '+91 90084 55219',
      market: 4_270_000, other: 812_000, interest: 0, status: 'DISPUTED',
      notifiedDaysAgo: 320, declaredDaysAgo: 250, awardedDaysAgo: 168,
      remarks: 'Owner has moved the High Court disputing the market value adopted. Compensation withheld pending orders.',
    },
    {
      survey: '47/1', khata: 'KH-47-1-KDL', village: 'Kadlapura', landType: 'COMMERCIAL',
      area: 380, owner: 'M/s Kadlapura Traders', contact: '+91 80 2233 8890',
      market: 5_320_000, other: 1_240_000, interest: 0, status: 'AWARDED',
      notifiedDaysAgo: 300, declaredDaysAgo: 220, awardedDaysAgo: 40,
      remarks: 'Award passed. Compensation awaiting sanction before disbursement.',
    },
    {
      survey: '203/4', khata: 'KH-203-4-HLG', village: 'Halage', landType: 'AGRICULTURAL',
      area: 7_120, owner: 'Shri Basavaraj Patil', contact: '+91 94488 77120',
      market: 4_272_000, other: 0, interest: 0, status: 'DECLARED',
      notifiedDaysAgo: 210, declaredDaysAgo: 95,
      remarks: 'Declaration published. Award enquiry under Section 21 in progress.',
    },
    {
      survey: '203/6', khata: 'KH-203-6-HLG', village: 'Halage', landType: 'AGRICULTURAL',
      area: 3_450, owner: 'Shri Mallikarjuna Swamy', contact: '+91 97400 21188',
      market: 2_070_000, other: 0, interest: 0, status: 'NOTIFIED',
      notifiedDaysAgo: 210,
      remarks: 'Objections under Section 15 received and being heard.',
    },
    {
      survey: '77/2', khata: 'KH-77-2-HLG', village: 'Halage', landType: 'GOVERNMENT',
      area: 1_980, owner: 'Revenue Department, Government of Karnataka', contact: '—',
      market: 0, other: 0, interest: 0, status: 'IDENTIFIED',
      remarks: 'Government land. Transfer being sought by administrative order rather than acquisition.',
    },
  ];

  const parcelIds: Record<string, number> = {};

  parcels.forEach((spec, index) => {
    // Section 30(1): solatium is one hundred per cent of the market value.
    const market = toPaise(spec.market);
    const solatium = market;
    const other = toPaise(spec.other);
    const interest = toPaise(spec.interest);
    const total = market + solatium + other + interest;

    const parcelNo = `DIV-NGR/LA/2026-27/${String(index + 1).padStart(4, '0')}`;
    const id = Number(
      insertParcel.run(
        parcelNo, projectIds.projRoad!, ids.divNgr!, ids.distKlb!,
        spec.village, spec.survey, spec.khata, spec.landType, Math.round(spec.area * 1000),
        spec.owner, `${spec.village} village, Kalburgi taluk`, spec.contact,
        spec.notifiedDaysAgo ? `PWD/LA/S11/2025/${100 + index}` : null,
        spec.notifiedDaysAgo ? daysAgo(spec.notifiedDaysAgo) : null,
        spec.declaredDaysAgo ? `PWD/LA/S19/2025/${200 + index}` : null,
        spec.declaredDaysAgo ? daysAgo(spec.declaredDaysAgo) : null,
        spec.awardedDaysAgo ? `PWD/LA/S23/2026/${300 + index}` : null,
        spec.awardedDaysAgo ? daysAgo(spec.awardedDaysAgo) : null,
        market, solatium, interest, other, total,
        0, spec.possessedDaysAgo ? daysAgo(spec.possessedDaysAgo) : null,
        spec.status, spec.remarks ?? null, userIds['ae.reddy']!,
      ).lastInsertRowid,
    );
    parcelIds[spec.survey] = id;

    let paid = 0;
    for (const [rupees, ago] of spec.payments ?? []) {
      const amount = toPaise(rupees);
      paid += amount;
      insertLandPayment.run(
        id, daysAgo(ago), amount, 'RTGS',
        `RTGS/LA/${daysAgo(ago).replace(/-/g, '')}/${index + 1}`,
        spec.owner, 'Compensation disbursed against the award.', userIds['aao.menon']!,
      );
    }
    if (paid > 0) db.prepare(`UPDATE land_parcels SET paid_amount = ? WHERE id = ?`).run(paid, id);
  });

  // --- Court cases -----------------------------------------------------------

  const insertCase = db.prepare(
    `INSERT INTO court_cases
       (case_no, internal_ref, court_name, court_type, case_type, filed_by, petitioner, respondent,
        subject, filing_date, division_id, project_id, parcel_id, contractor_id, claim_amount,
        decree_amount, advocate_name, advocate_fee, dealing_officer_id, next_hearing_date,
        status, outcome, disposal_date, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHearing = db.prepare(
    `INSERT INTO court_hearings
       (case_id, hearing_date, purpose, appeared_by, proceedings, order_summary, next_date, recorded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  interface CaseSpec {
    caseNo: string;
    court: string;
    courtType: string;
    caseType: string;
    filedBy: string;
    petitioner: string;
    respondent: string;
    subject: string;
    filedDaysAgo: number;
    parcelSurvey?: string;
    contractorCode?: string;
    claim: number;
    advocate: string;
    status: string;
    outcome?: string;
    decree?: number;
    disposedDaysAgo?: number;
    nextHearingInDays?: number;
    remarks?: string;
    /** [days ago, purpose, proceedings, next date in days from that hearing] */
    hearings: [number, string, string, number | null][];
  }

  const cases: CaseSpec[] = [
    {
      caseNo: 'WP 41822/2026', court: 'High Court of Karnataka, Kalaburagi Bench',
      courtType: 'HIGH_COURT', caseType: 'LAND_ACQUISITION', filedBy: 'AGAINST_DEPARTMENT',
      petitioner: 'Shri Imran Pasha',
      respondent: 'State of Karnataka & Others',
      subject:
        'Writ petition challenging the market value adopted in the award under Section 23 for '
        + 'survey number 9/3B of Kadlapura, and seeking enhanced compensation.',
      filedDaysAgo: 150, parcelSurvey: '9/3B', claim: 12_400_000,
      advocate: 'Shri K. Venkatesh, Government Pleader',
      status: 'PENDING', nextHearingInDays: 9,
      remarks: 'Statement of objections filed. Valuation report of the Sub-Registrar produced.',
      hearings: [
        [140, 'Admission', 'Notice ordered to the respondents. No interim stay granted on the acquisition.', 100],
        [100, 'Objections', 'Statement of objections filed on behalf of the department and taken on record.', 55],
        [55, 'Arguments', 'Part heard. The court called for the Sub-Registrar valuation for the relevant period.', 9],
      ],
    },
    {
      caseNo: 'ARB 17/2026', court: 'Sole Arbitrator, Bengaluru',
      courtType: 'ARBITRATION', caseType: 'ARBITRATION', filedBy: 'AGAINST_DEPARTMENT',
      petitioner: 'Ganga Builders & Developers',
      respondent: 'Executive Engineer, North Gandhinagar Division',
      subject:
        'Claim for idling charges and price escalation on the water supply distribution package, '
        + 'arising from delayed handover of the pipeline corridor.',
      filedDaysAgo: 95, contractorCode: 'C-10003', claim: 8_640_000,
      advocate: 'M/s Rao & Associates',
      status: 'PENDING', nextHearingInDays: 23,
      remarks: 'Claim statement and counter-statement exchanged. Departmental records summoned.',
      hearings: [
        [88, 'Preliminary meeting', 'Terms of reference settled. Schedule of pleadings fixed by consent.', 45],
        [45, 'Pleadings', 'Claim statement filed by the claimant; time granted to the department to reply.', 23],
      ],
    },
    {
      caseNo: 'OS 288/2025', court: 'Principal Civil Judge, Kalaburagi',
      courtType: 'DISTRICT_COURT', caseType: 'CIVIL', filedBy: 'BY_DEPARTMENT',
      petitioner: 'Executive Engineer, North Gandhinagar Division',
      respondent: 'M/s Vishwa Infra Projects',
      subject:
        'Suit for recovery of mobilisation advance and liquidated damages on a rescinded contract, '
        + 'with interest from the date of rescission.',
      filedDaysAgo: 400, contractorCode: 'C-10002', claim: 5_180_000,
      advocate: 'Shri K. Venkatesh, Government Pleader',
      status: 'DISPOSED', outcome: 'PARTLY_IN_FAVOUR', decree: 3_920_000, disposedDaysAgo: 60,
      remarks: 'Decreed in part. Recovery of the advance allowed with interest; liquidated damages scaled down.',
      hearings: [
        [380, 'Summons', 'Summons served on the defendant. Written statement called for.', 300],
        [300, 'Written statement', 'Written statement filed. Issues framed by the court.', 180],
        [180, 'Evidence', 'Departmental witness examined and cross-examined. Documents exhibited.', 90],
        [90, 'Arguments', 'Arguments heard on both sides. Judgment reserved.', 60],
        [60, 'Judgment', 'Suit decreed in part. Recovery of ₹39.20 lakh allowed with interest at 6 per cent.', null],
      ],
    },
    {
      caseNo: 'WP 9014/2026', court: 'High Court of Karnataka, Kalaburagi Bench',
      courtType: 'HIGH_COURT', caseType: 'WRIT', filedBy: 'AGAINST_DEPARTMENT',
      petitioner: 'Kalaburagi Citizens Welfare Forum',
      respondent: 'State of Karnataka & Others',
      subject:
        'Public interest petition seeking restoration of storm water drains disturbed during the '
        + 'ring road widening, and a direction to complete the reach before the monsoon.',
      filedDaysAgo: 62, claim: 0,
      advocate: 'Shri K. Venkatesh, Government Pleader',
      status: 'PENDING', nextHearingInDays: 2,
      remarks: 'Compliance affidavit on the drainage restoration to be filed before the next date.',
      hearings: [
        [55, 'Admission', 'Notice ordered. The department directed to file a compliance affidavit.', 2],
      ],
    },
  ];

  for (const spec of cases) {
    const caseId = Number(
      insertCase.run(
        spec.caseNo, `PWD/NGR/LEGAL/${spec.caseNo.replace(/[^0-9]/g, '').slice(0, 6)}`,
        spec.court, spec.courtType, spec.caseType, spec.filedBy,
        spec.petitioner, spec.respondent, spec.subject, daysAgo(spec.filedDaysAgo),
        ids.divNgr!, projectIds.projRoad!,
        spec.parcelSurvey ? parcelIds[spec.parcelSurvey]! : null,
        spec.contractorCode ? contractorIds[spec.contractorCode]! : null,
        toPaise(spec.claim), toPaise(spec.decree ?? 0),
        spec.advocate, toPaise(spec.claim > 0 ? Math.round(spec.claim * 0.02) : 25_000),
        userIds['ee.kumar']!,
        spec.nextHearingInDays !== undefined ? daysAhead(spec.nextHearingInDays) : null,
        spec.status, spec.outcome ?? null,
        spec.disposedDaysAgo ? daysAgo(spec.disposedDaysAgo) : null,
        spec.remarks ?? null, userIds['ee.kumar']!,
      ).lastInsertRowid,
    );

    for (const [ago, purpose, proceedings, nextIn] of spec.hearings) {
      insertHearing.run(
        caseId, daysAgo(ago), purpose, spec.advocate, proceedings, proceedings,
        nextIn === null ? null : daysAgo(ago - nextIn), userIds['ee.kumar']!,
      );
    }
  }

  // --- Committees and meetings -----------------------------------------------

  const insertCommittee = db.prepare(
    `INSERT INTO committees (code, name, kind, purpose, division_id, quorum, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
  );
  const insertMember = db.prepare(
    `INSERT INTO committee_members (committee_id, user_id, member_role, designation)
     VALUES (?, ?, ?, ?)`,
  );
  const insertMeeting = db.prepare(
    `INSERT INTO meetings
       (committee_id, meeting_no, title, scheduled_at, venue, mode, agenda, status,
        held_at, minutes, minutes_by, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAttendance = db.prepare(
    `INSERT INTO meeting_attendance (meeting_id, user_id, is_present, remarks) VALUES (?, ?, ?, ?)`,
  );
  const insertDecision = db.prepare(
    `INSERT INTO meeting_decisions
       (meeting_id, seq, subject, decision, action_by_id, due_date, status, closed_on, closing_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  interface CommitteeSpec {
    code: string;
    name: string;
    kind: string;
    purpose: string;
    divisional: boolean;
    quorum: number;
    members: [string, string, string][];   // username, role in committee, designation
  }

  const committees: CommitteeSpec[] = [
    {
      code: 'DTC-NGR', name: 'Divisional Tender Committee, North Gandhinagar',
      kind: 'TENDER', quorum: 3, divisional: true,
      purpose:
        'Scrutiny of tender notices and bid conditions, and recommendation on the technical '
        + 'evaluation of bids received in the division.',
      members: [
        ['se.iyer', 'CHAIRPERSON', 'Superintending Engineer, Civil Circle'],
        ['ee.kumar', 'MEMBER_SECRETARY', 'Executive Engineer, North Gandhinagar Division'],
        ['cao.desai', 'MEMBER', 'Chief Accounts Officer'],
        ['aee.singh', 'MEMBER', 'Assistant Executive Engineer'],
      ],
    },
    {
      code: 'TSC-HO', name: 'Technical Sanction Committee',
      kind: 'TECHNICAL', quorum: 3, divisional: false,
      purpose:
        'Technical vetting of detailed project reports and estimates above the delegated '
        + 'financial powers of the circle.',
      members: [
        ['ce.sharma', 'CHAIRPERSON', 'Chief Engineer'],
        ['se.iyer', 'MEMBER_SECRETARY', 'Superintending Engineer, Civil Circle'],
        ['ee.kumar', 'MEMBER', 'Executive Engineer, North Gandhinagar Division'],
        ['cao.desai', 'MEMBER', 'Chief Accounts Officer'],
      ],
    },
    {
      code: 'GRC-HO', name: 'Grievance Redressal Committee',
      kind: 'GRIEVANCE', quorum: 2, divisional: false,
      purpose:
        'Hearing of grievances from contractors, land losers and the public, and disposal of '
        + 'first appeals under the Right to Information Act.',
      members: [
        ['md.rao', 'CHAIRPERSON', 'Managing Director'],
        ['ce.sharma', 'MEMBER_SECRETARY', 'Chief Engineer'],
        ['auditor.bose', 'SPECIAL_INVITEE', 'Auditor'],
      ],
    },
  ];

  const committeeIds: Record<string, number> = {};
  for (const spec of committees) {
    const id = Number(
      insertCommittee.run(
        spec.code, spec.name, spec.kind, spec.purpose,
        spec.divisional ? ids.divNgr! : null, spec.quorum, userIds.admin!,
      ).lastInsertRowid,
    );
    committeeIds[spec.code] = id;
    for (const [username, memberRole, designation] of spec.members) {
      insertMember.run(id, userIds[username]!, memberRole, designation);
    }
  }

  interface MeetingSpec {
    committee: string;
    no: string;
    title: string;
    daysAgo: number;
    venue: string;
    status: string;
    agenda: string;
    minutes?: string;
    /** username -> attended. Anyone omitted was invited and did not attend. */
    present?: string[];
    decisions?: [string, string, string, number, string][];
      // subject, decision, owner username, due in days from the sitting, status
  }

  const meetings: MeetingSpec[] = [
    {
      committee: 'DTC-NGR', no: 'DTC-NGR/2026-27/001',
      title: 'Technical evaluation of bids — divisional office building, Gandhinagar',
      daysAgo: 34, venue: 'Divisional Office, North Gandhinagar', status: 'HELD',
      agenda:
        '1. Confirmation of the minutes of the previous sitting.\n'
        + '2. Technical evaluation of the three bids received against DIV-SGR/TEN/2026-27/0001.\n'
        + '3. Recommendation on opening the financial envelopes.',
      minutes:
        'The committee took up the technical evaluation of the three bids received. Each bid was '
        + 'marked against the published technical criteria and the marks recorded on the evaluation '
        + 'sheet. All three bidders were found to satisfy every pre-qualification criterion. The '
        + 'committee recommended that the financial envelopes be opened.',
      present: ['se.iyer', 'ee.kumar', 'cao.desai', 'aee.singh'],
      decisions: [
        [
          'Technical evaluation of the three bids',
          'All three bids found technically qualified. Marks as recorded on the evaluation sheet '
          + 'annexed to these minutes.',
          'ee.kumar', 7, 'DONE',
        ],
        [
          'Opening of financial envelopes',
          'Recommended that the financial envelopes be opened on the notified date and the bids '
          + 'ranked L1 to L3.',
          'ee.kumar', 10, 'DONE',
        ],
      ],
    },
    {
      committee: 'TSC-HO', no: 'TSC-HO/2026-27/002',
      title: 'Technical sanction — ring road widening, chainage 6.200 to 12.400 km',
      daysAgo: 21, venue: 'Head Office Conference Room', status: 'HELD',
      agenda:
        '1. Detailed project report DPR/NGR/2026/011 and its estimate.\n'
        + '2. Relief from the Schedule of Rates ceiling on account of bitumen escalation.\n'
        + '3. Any other item with the permission of the chair.',
      minutes:
        'The committee examined the estimate priced against the 2024-25 Schedule of Rates and '
        + 'noted that bitumen and steel rates have moved materially since that edition was fixed. '
        + 'It recorded that inviting bids at the schedule would draw no response, and recommended '
        + 'relief of eight per cent under the escalation order already in force. The estimate was '
        + 'otherwise found in order.',
      present: ['ce.sharma', 'se.iyer', 'ee.kumar', 'cao.desai'],
      decisions: [
        [
          'Estimate of ₹7.23 crore for the balance reach',
          'Estimate found in order and recommended for technical sanction as priced.',
          'se.iyer', 5, 'DONE',
        ],
        [
          'Relief from the Schedule of Rates ceiling',
          'Relief of eight per cent recommended on the ground of bitumen and steel escalation, '
          + 'under order PWD/SR/2026/ESC-03.',
          'ce.sharma', 7, 'DONE',
        ],
        [
          'Revision of the Schedule of Rates for bituminous items',
          'The rate book to be re-examined for the whole bituminous chapter before the next '
          + 'tendering season, rather than relief being granted tender by tender.',
          'ce.sharma', 90, 'OPEN',
        ],
      ],
    },
    {
      committee: 'GRC-HO', no: 'GRC-HO/2026-27/001',
      title: 'Grievances of land losers, Basavanahalli and Kadlapura',
      daysAgo: 12, venue: 'Head Office Conference Room', status: 'HELD',
      agenda:
        '1. Representation of the land losers of Kadlapura on the market value adopted.\n'
        + '2. Delay in disbursement of compensation for survey number 118/1.',
      minutes:
        'Only the chairperson and the special invitee were present; the member secretary was on '
        + 'tour. The committee heard the representations but, being short of its quorum, recorded '
        + 'no decision and adjourned the sitting to a date to be fixed.',
      present: ['md.rao', 'auditor.bose'],
    },
    {
      committee: 'DTC-NGR', no: 'DTC-NGR/2026-27/002',
      title: 'Bid conditions — ring road widening, balance reach',
      daysAgo: -8, venue: 'Divisional Office, North Gandhinagar', status: 'SCHEDULED',
      agenda:
        '1. Pre-qualification and technical criteria for DIV-NGR/TEN/2026-27/0001.\n'
        + '2. Bid validity and earnest money.\n'
        + '3. Pre-bid queries received from intending bidders.',
    },
  ];

  for (const spec of meetings) {
    const committeeId = committeeIds[spec.committee]!;
    const scheduled = `${daysAgo(spec.daysAgo)} 11:00`;
    const meetingId = Number(
      insertMeeting.run(
        committeeId, spec.no, spec.title, scheduled, spec.venue, 'IN_PERSON', spec.agenda,
        spec.status, spec.status === 'HELD' ? scheduled : null, spec.minutes ?? null,
        spec.status === 'HELD' ? userIds['ee.kumar']! : null, userIds['ee.kumar']!,
      ).lastInsertRowid,
    );

    const roll = committees.find((c) => c.code === spec.committee)!.members;
    for (const [username] of roll) {
      const present = spec.present?.includes(username) ? 1 : 0;
      insertAttendance.run(
        meetingId, userIds[username]!, present,
        spec.status === 'HELD' && !present ? 'On tour.' : null,
      );
    }

    (spec.decisions ?? []).forEach(([subject, decision, owner, dueIn, status], index) => {
      insertDecision.run(
        meetingId, index + 1, subject, decision, userIds[owner]!,
        daysAgo(spec.daysAgo - dueIn), status,
        status === 'DONE' ? daysAgo(Math.max(spec.daysAgo - dueIn - 2, 0)) : null,
        status === 'DONE' ? 'Complied with and reported to the committee.' : null,
      );
    });
  }

  // --- Right to Information --------------------------------------------------

  const insertRti = db.prepare(
    `INSERT INTO rti_requests
       (request_no, applicant_name, applicant_address, applicant_email, applicant_phone,
        is_bpl, fee_paid, received_on, received_via, subject, information_sought,
        is_life_or_liberty, division_id, pio_user_id, due_date, status, reply_date,
        reply_summary, rejection_section, rejection_ground, remarks, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertAppeal = db.prepare(
    `INSERT INTO rti_appeals
       (request_id, appeal_no, appeal_level, filed_on, grounds, appellate_authority,
        authority_user_id, due_date, status, decided_on, decision, penalty_imposed, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  interface RtiSpec {
    applicant: string;
    address: string;
    email: string;
    isBpl: boolean;
    receivedDaysAgo: number;
    via: string;
    subject: string;
    sought: string;
    status: string;
    repliedDaysAgo?: number;
    replySummary?: string;
    rejectionSection?: string;
    rejectionGround?: string;
    /** [level, days ago filed, status, decision, penalty in rupees] */
    appeal?: [string, number, string, string, number];
  }

  const rtis: RtiSpec[] = [
    {
      applicant: 'Shri Prakash Kulkarni',
      address: 'Station Road, Kalaburagi', email: 'prakash.kulkarni@example.com', isBpl: false,
      receivedDaysAgo: 58, via: 'RTI_PORTAL',
      subject: 'Expenditure on the ring road widening, phase II',
      sought:
        'Certified copies of all running account bills paid to the contractor on package 01 of '
        + 'the ring road widening, together with the measurement book entries against each.',
      status: 'REPLIED', repliedDaysAgo: 34,
      replySummary:
        'Certified copies of three running account bills supplied on payment of copying charges. '
        + 'Measurement book entries supplied for the corresponding periods.',
    },
    {
      applicant: 'Smt. Sunanda Deshpande',
      address: 'Basavanahalli village, Kalburgi taluk', email: 'sunanda.d@example.com', isBpl: true,
      receivedDaysAgo: 44, via: 'COUNTER',
      subject: 'Basis of the market value adopted for land acquisition at Basavanahalli',
      sought:
        'The valuation report and the Sub-Registrar guidance values relied on in fixing the '
        + 'market value in the awards passed for survey numbers 114/2 and 118/1.',
      status: 'PARTLY_REJECTED', repliedDaysAgo: 20,
      replySummary:
        'Valuation report and guidance values supplied. The names, holdings and bank particulars '
        + 'of the other land losers were withheld.',
      rejectionSection: '8(1)(j)',
      rejectionGround:
        'The particulars of other land losers are personal information with no bearing on any '
        + 'public activity, and disclosing them would be an unwarranted invasion of their privacy.',
    },
    {
      applicant: 'Shri Mohan Rao',
      address: 'Jayanagar, Bengaluru', email: 'mohan.rao@example.com', isBpl: false,
      receivedDaysAgo: 41, via: 'POST',
      subject: 'Technical evaluation of bids for the divisional office building',
      sought:
        'The marks awarded to each bidder against each technical criterion, and the minutes of '
        + 'the tender committee that evaluated the bids.',
      status: 'IN_PROGRESS',
      // Past its thirty days: this is the one an officer is asked about.
    },
    {
      applicant: 'Kalaburagi Citizens Welfare Forum',
      address: 'Court Circle, Kalaburagi', email: 'forum@example.com', isBpl: false,
      receivedDaysAgo: 16, via: 'ONLINE',
      subject: 'Storm water drain restoration along the ring road',
      sought:
        'The schedule for restoring the storm water drains disturbed during the widening, and the '
        + 'inspection notes of the Assistant Engineer for the last six months.',
      status: 'IN_PROGRESS',
    },
    {
      applicant: 'Shri Nagesh Bhat',
      address: 'Halage village, Kalburgi taluk', email: 'nagesh.bhat@example.com', isBpl: false,
      receivedDaysAgo: 4, via: 'RTI_PORTAL',
      subject: 'Status of the declaration under Section 19 for Halage village',
      sought:
        'The date of publication of the declaration under Section 19 for survey numbers 203/4 and '
        + '203/6, and the schedule for the award enquiry under Section 21.',
      status: 'RECEIVED',
    },
    {
      applicant: 'Shri Iqbal Ahmed',
      address: 'Kadlapura, Kalburgi taluk', email: 'iqbal.ahmed@example.com', isBpl: false,
      receivedDaysAgo: 120, via: 'POST',
      subject: 'File notings on the rescission of the contract with Vishwa Infra Projects',
      sought: 'All file notings and correspondence leading to the rescission of the contract.',
      status: 'REJECTED', repliedDaysAgo: 96,
      replySummary: 'Refused. The matter is sub judice in OS 288/2025 before the Civil Judge, Kalaburagi.',
      rejectionSection: '8(1)(b)',
      rejectionGround:
        'The information sought relates to a matter pending before a competent court, and its '
        + 'disclosure has been expressly forbidden pending disposal.',
      appeal: [
        'FIRST', 80, 'REJECTED',
        'The first appellate authority upheld the refusal, holding that the record sought is '
        + 'directly in issue in the pending suit. The appellant was advised to seek the record '
        + 'through the court.',
        0,
      ],
    },
  ];

  rtis.forEach((spec, index) => {
    const received = daysAgo(spec.receivedDaysAgo);
    // Section 7(1): thirty days from receipt.
    const due = daysAgo(spec.receivedDaysAgo - 30);
    const requestId = Number(
      insertRti.run(
        `DIV-NGR/RTI/2026-27/${String(index + 1).padStart(4, '0')}`,
        spec.applicant, spec.address, spec.email, '+91 98800 00000',
        spec.isBpl ? 1 : 0, spec.isBpl ? 0 : toPaise(10),
        received, spec.via, spec.subject, spec.sought, 0,
        ids.divNgr!, userIds['aee.singh']!, due, spec.status,
        spec.repliedDaysAgo ? daysAgo(spec.repliedDaysAgo) : null,
        spec.replySummary ?? null, spec.rejectionSection ?? null, spec.rejectionGround ?? null,
        null, userIds['ac.nair']!,
      ).lastInsertRowid,
    );

    if (spec.appeal) {
      const [level, filedAgo, status, decision, penalty] = spec.appeal;
      insertAppeal.run(
        requestId, `DIV-NGR/RTI/2026-27/${String(index + 1).padStart(4, '0')}/AP1-01`,
        level, daysAgo(filedAgo), 'The refusal is not sustainable and the record is severable.',
        'Chief Engineer, First Appellate Authority', userIds['ce.sharma']!,
        daysAgo(filedAgo - 30), status, daysAgo(filedAgo - 26), decision, toPaise(penalty),
        userIds['ac.nair']!,
      );
      db.prepare(`UPDATE rti_requests SET status = 'CLOSED' WHERE id = ?`).run(requestId);
    }
  });
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

/**
 * The Detailed Project Reports, priced item by item from the Schedule of Rates.
 *
 * This is where a work actually begins: the estimate is built line by line at
 * approved rates, contingency and work-charged establishment are added on top,
 * and the total is what an administrative approval is granted against. Two of
 * these reports have been approved and converted into tender documents; the
 * third is still being prepared, which is what most reports look like most of
 * the time.
 */
function seedDprs(userIds: Ids, projectIds: Ids, srIds: SrIds): Ids {
  const db = getDb();
  const already = db.prepare(`SELECT COUNT(*) AS n FROM project_dprs`).get() as { n: number };
  if (already.n > 0) return {};

  const insertDpr = db.prepare(
    `INSERT INTO project_dprs
       (project_id, dpr_no, version, title, prepared_by, consultant, estimated_cost,
        submission_date, scope, justification, sr_edition, items_total, contingency_bps,
        establishment_bps, status, approved_by, approval_date, remarks, created_by)
     VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '2024-25', ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertItem = db.prepare(
    `INSERT INTO project_dpr_items
       (dpr_id, sl_no, sr_item_id, item_code, description, uom, quantity, rate, sr_rate, amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const CONTINGENCY = toBps(3);
  const ESTABLISHMENT = toBps(2);

  /**
   * Prices an estimate at the schedule and books it. The rate is read from the
   * rate book rather than typed, which is the whole point of an SR estimate.
   */
  function addDpr(spec: {
    projectKey: string;
    dprNo: string;
    title: string;
    preparedBy: string;
    consultant: string | null;
    submissionDate: string;
    scope: string;
    justification: string;
    status: string;
    approvedBy: string | null;
    approvalDate: string | null;
    remarks: string | null;
    /** SR code and quantity — the rate comes from the schedule. */
    lines: [string, number][];
  }): number {
    const priced = spec.lines.map(([code, qty]) => {
      const sr = srIds[code]!;
      const quantity = Math.round(qty * 1000);
      return {
        code,
        sr,
        quantity,
        amount: Math.round((quantity * sr.rate) / 1000),
      };
    });
    const itemsTotal = priced.reduce((sum, line) => sum + line.amount, 0);
    const contingency = Math.round((itemsTotal * CONTINGENCY) / 10_000);
    const establishment = Math.round((itemsTotal * ESTABLISHMENT) / 10_000);

    const dprId = Number(
      insertDpr.run(
        projectIds[spec.projectKey]!, spec.dprNo, spec.title,
        spec.preparedBy, spec.consultant,
        itemsTotal + contingency + establishment,
        spec.submissionDate, spec.scope, spec.justification,
        itemsTotal, CONTINGENCY, ESTABLISHMENT,
        spec.status, spec.approvedBy, spec.approvalDate, spec.remarks,
        userIds['ae.reddy']!,
      ).lastInsertRowid,
    );

    priced.forEach((line, index) => {
      insertItem.run(
        dprId, index + 1, line.sr.id, line.code, line.sr.name, line.sr.uom,
        line.quantity, line.sr.rate, line.sr.rate, line.amount,
      );
    });

    return dprId;
  }

  const dprIds: Ids = {};

  dprIds.dprRoad = addDpr({
    projectKey: 'projRoad',
    dprNo: 'DPR/NGR/2026/011',
    title: 'Ring road widening — Chainage 6.200 to 12.400 km',
    preparedBy: 'Er. Divya Reddy, Assistant Engineer',
    consultant: 'Meridian Infra Consultants Pvt Ltd',
    submissionDate: '2026-06-18',
    scope:
      'Widening of the existing two-lane carriageway to four lanes over 6.2 km, with granular and ' +
      'bituminous layers to IRC specification, RCC cross drainage at four locations, and safety railing ' +
      'along the embankment reach.',
    justification:
      'The reach carries 18,400 PCU per day against a two-lane design capacity of 10,000. Phase I ' +
      'has been completed to chainage 6.200 km, and leaving the balance reach unwidened would strand ' +
      'that investment.',
    status: 'APPROVED',
    approvedBy: 'Er. Anil Sharma, Chief Engineer',
    approvalDate: '2026-07-10',
    remarks: 'Approved for tendering. Priced against the 2024-25 Schedule of Rates as revised to date.',
    lines: [
      ['2.8.1', 48_500], ['2.8.4', 1_200], ['2.14.2', 62_400],
      ['4.1.3', 4_200], ['4.4.1', 3_600],
      ['4.11.2', 24_000], ['4.12.6', 24_000],
      ['5.6.1', 420], ['5.9.4', 32], ['9.4.2', 1_800],
    ],
  });

  dprIds.dprBldg = addDpr({
    projectKey: 'projBldg',
    dprNo: 'DPR/SGR/2026/004',
    title: 'Divisional office building, Gandhinagar — G+3 block',
    preparedBy: 'Er. Rakesh Patel, Executive Engineer',
    consultant: null,
    submissionDate: '2026-04-22',
    scope:
      'G+3 office block of 2,850 sq.m with structural frame, finishing, plumbing and electrical works, ' +
      'parking apron and rainwater harvesting.',
    justification:
      'The division office presently works from three rented premises at an annual outgo of ₹41 lakh. ' +
      'The proposed block recovers its cost in rent avoided within eleven years.',
    status: 'APPROVED',
    approvedBy: 'Er. Anil Sharma, Chief Engineer',
    approvalDate: '2026-05-30',
    remarks: 'Approved. Tendered as a lump sum contract on the strength of this estimate.',
    lines: [
      ['2.8.1', 4_600], ['5.3.2', 820], ['5.6.1', 2_150],
      ['5.9.4', 148], ['9.4.2', 1_250],
    ],
  });

  // Still on the preparing engineer's desk — no approval, so nothing to tender.
  dprIds.dprDrain = addDpr({
    projectKey: 'projDrain',
    dprNo: 'DPR/URB/2026/002',
    title: 'Storm water drain improvement, Devanahalli town',
    preparedBy: 'Er. Divya Reddy, Assistant Engineer',
    consultant: null,
    submissionDate: '2026-08-14',
    scope:
      'Reconstruction of 6.8 km of primary and secondary storm water drains in RCC, with desilting ' +
      'chambers at 200 m intervals.',
    justification:
      'Three wards flooded in each of the last two monsoons. The existing masonry drains have lost ' +
      'section to silt and encroachment and cannot be rehabilitated in place.',
    status: 'DRAFT',
    approvedBy: null,
    approvalDate: null,
    remarks: 'Quantities being checked against the survey before submission.',
    lines: [['2.8.1', 12_400], ['5.3.2', 1_850], ['5.6.1', 1_240], ['5.9.4', 86]],
  });

  return dprIds;
}

function seedTenders(
  ids: Ids,
  userIds: Ids,
  contractorIds: Ids,
  projectIds: Ids,
  pkgs: { pkgRoad2Id: number; pkgBldgId: number },
  srIds: SrIds,
  dprIds: Ids,
): void {
  const db = getDb();

  const insertTender = db.prepare(
    `INSERT INTO tenders
       (tender_no, title, description, project_id, package_id, division_id, tender_type, bid_type,
        estimated_value, emd_amount, tender_fee, completion_period_days, min_registration_class,
        eligibility_criteria, publish_date, bid_start_at, bid_end_at, technical_open_at,
        financial_open_at, status, created_by, dpr_id, sr_ceiling_enforced, sr_ceiling_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
  );

  /** The estimate a report was approved at, which is what the tender is worth. */
  const dprTotal = (key: string): number =>
    (db.prepare(`SELECT estimated_cost AS c FROM project_dprs WHERE id = ?`)
      .get(dprIds[key] ?? -1) as { c: number } | undefined)?.c ?? 0;

  /**
   * Carries an approved report's estimate onto a tender as its bill of
   * quantities, and freezes the Schedule of Rates ceiling from it. This is the
   * conversion the department actually performs: nothing is retyped, so the
   * tender cannot drift from the estimate that was sanctioned.
   */
  const insertBoq = db.prepare(
    `INSERT INTO tender_boq_items
       (tender_id, sl_no, item_code, description, uom, quantity, estimated_rate, sr_item_id, sr_rate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function convertDpr(tenderId: number, dprKey: string): void {
    const items = db
      .prepare(
        `SELECT sl_no, sr_item_id, item_code, description, uom, quantity, rate, sr_rate
           FROM project_dpr_items WHERE dpr_id = ? ORDER BY sl_no`,
      )
      .all(dprIds[dprKey] ?? -1) as {
      sl_no: number;
      sr_item_id: number | null;
      item_code: string | null;
      description: string;
      uom: string;
      quantity: number;
      rate: number;
      sr_rate: number;
    }[];

    let ceiling = 0;
    for (const item of items) {
      insertBoq.run(
        tenderId, item.sl_no, item.item_code, item.description, item.uom,
        item.quantity, item.rate, item.sr_item_id, item.sr_rate,
      );
      ceiling += Math.round((item.quantity * (item.sr_rate || item.rate)) / 1000);
    }

    db.prepare(`UPDATE tenders SET sr_ceiling_amount = ? WHERE id = ?`).run(ceiling, tenderId);
    db.prepare(`UPDATE project_dprs SET tender_id = ? WHERE id = ?`).run(tenderId, dprIds[dprKey]!);
  }

  /** The pre-qualification and technical criteria a tender document adds. */
  const insertCriterion = db.prepare(
    `INSERT INTO tender_criteria (tender_id, kind, sl_no, title, requirement, evidence, is_mandatory, max_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function addCriteria(
    tenderId: number,
    criteria: [string, string, string, string, number][], // kind, title, requirement, evidence, marks
  ): void {
    let pq = 0;
    let tq = 0;
    for (const [kind, title, requirement, evidence, marks] of criteria) {
      insertCriterion.run(
        tenderId, kind, kind === 'PQ' ? (pq += 1) : (tq += 1),
        title, requirement, evidence, 1, kind === 'TQ' ? marks : 0,
      );
    }
  }

  // A live tender contractors can still bid on, raised from the approved report.
  const roadEstimate = dprTotal('dprRoad');
  const openTenderId = Number(
    insertTender.run(
      'DIV-NGR/TEN/2026-27/0001',
      'Ring road widening — Chainage 6.200 to 12.400 km',
      'Item rate tender for earthwork, granular layers and bituminous surfacing over 6.2 km, including cross drainage works. Raised from the approved Detailed Project Report DPR/NGR/2026/011.',
      projectIds.projRoad!, pkgs.pkgRoad2Id, ids.divNgr!, 'OPEN', 'ITEM_RATE',
      roadEstimate, Math.round(roadEstimate / 50), toPaise(11_800), 540, 'Class A',
      'Bidders must satisfy every pre-qualification criterion below. Technical bids are marked out of 100 and a bid scoring under 60 is not carried to the financial stage.',
      '2026-08-01', '2026-08-01 10:00:00', '2026-09-30 17:00:00',
      '2026-10-01 11:00:00', '2026-10-08 11:00:00',
      'PUBLISHED', userIds['ee.kumar']!, dprIds.dprRoad ?? null,
    ).lastInsertRowid,
  );
  convertDpr(openTenderId, 'dprRoad');

  addCriteria(openTenderId, [
    ['PQ', 'Average annual turnover',
      'Average annual turnover of at least ₹25 crore over the last three financial years.',
      'Audited balance sheets, certified by a chartered accountant.', 0],
    ['PQ', 'Similar work completed',
      'At least one road work of ₹28 crore or more, completed in the last five years.',
      'Completion certificate issued by the client department.', 0],
    ['PQ', 'Registration class',
      'Valid Class A registration with the department, current on the date of bid opening.',
      'Registration certificate and its renewal.', 0],
    ['PQ', 'No adverse standing',
      'Not blacklisted or debarred by any state or central government body.',
      'Self-declaration on ₹100 stamp paper.', 0],
    ['TQ', 'Similar works in the last five years',
      'Number and value of comparable road widening works completed.',
      'Completion certificates.', 30],
    ['TQ', 'Plant and machinery held',
      'Ownership or firm lease of a hot mix plant, paver finisher, tandem roller and pneumatic tyred roller.',
      'Invoices, registration books or lease agreements.', 25],
    ['TQ', 'Technical personnel',
      'A graduate engineer with ten years of highway experience, and two diploma holders.',
      'Curricula vitae and appointment letters.', 20],
    ['TQ', 'Financial standing',
      'Solvency of at least ₹7 crore and an unutilised bank credit line.',
      'Banker’s solvency certificate, issued within the last six months.', 15],
    ['TQ', 'Quality and safety systems',
      'A documented quality assurance plan and a site safety plan for the work.',
      'The plans themselves, signed by the authorised signatory.', 10],
  ]);

  /**
   * The 2024-25 schedule was fixed before the bitumen and steel escalation of
   * late 2025, and this reach is bitumen-heavy — so bidding at the schedule
   * would draw no bids at all. The Chief Engineer has permitted quoting up to
   * 8% above it, on the same order that revised the rates.
   */
  db.prepare(
    `UPDATE tenders
        SET above_sr_permitted = 1, above_sr_cap_bps = ?, above_sr_ground = 'PRICE_ESCALATION',
            above_sr_authority = ?, above_sr_remarks = ?,
            above_sr_granted_by = ?, above_sr_granted_at = ?
      WHERE id = ?`,
  ).run(
    toBps(8), 'PWD/SR/2026/ESC-03 dated 15 February 2026',
    'Bitumen and TMT steel have moved ahead of the 2024-25 schedule the estimate was priced from. ' +
      'Relief of 8% is permitted on this tender so that bids can be invited at a workable price. ' +
      'Bids above that margin will still be refused.',
    userIds['ce.sharma']!, '2026-07-28 12:40:00', openTenderId,
  );

  // A completed procurement, sitting at financial evaluation with ranked bids.
  const bldgEstimate = dprTotal('dprBldg');
  const evalTenderId = Number(
    insertTender.run(
      'DIV-SGR/TEN/2026-27/0001',
      'Construction of divisional office building, Gandhinagar',
      'Lump sum tender for civil, plumbing and electrical works of the G+3 divisional office block. Raised from the approved Detailed Project Report DPR/SGR/2026/004.',
      projectIds.projBldg!, pkgs.pkgBldgId, ids.divSgr!, 'OPEN', 'LUMPSUM',
      bldgEstimate, Math.round(bldgEstimate / 50), toPaise(11_800), 480, 'Class B',
      'Bidders must satisfy every pre-qualification criterion below. Technical bids are marked out of 100.',
      '2026-06-15', '2026-06-15 10:00:00', '2026-07-20 17:00:00',
      '2026-07-21 11:00:00', '2026-07-28 11:00:00',
      'FINANCIAL_EVALUATION', userIds['ee.patel']!, dprIds.dprBldg ?? null,
    ).lastInsertRowid,
  );
  convertDpr(evalTenderId, 'dprBldg');

  addCriteria(evalTenderId, [
    ['PQ', 'Average annual turnover',
      'Average annual turnover of at least ₹12 crore over the last three financial years.',
      'Audited balance sheets, certified by a chartered accountant.', 0],
    ['PQ', 'Similar work completed',
      'At least one building work of ₹15 crore or more, completed in the last five years.',
      'Completion certificate issued by the client department.', 0],
    ['PQ', 'Registration class',
      'Valid Class B registration or higher with the department.',
      'Registration certificate and its renewal.', 0],
    ['TQ', 'Building works in the last five years',
      'Number and value of comparable G+ structures completed.',
      'Completion certificates.', 35],
    ['TQ', 'Technical personnel',
      'A graduate civil engineer with eight years of building experience, and a site safety officer.',
      'Curricula vitae and appointment letters.', 25],
    ['TQ', 'Plant and formwork systems',
      'Ownership or lease of batching plant capacity and a modular formwork system.',
      'Invoices or lease agreements.', 20],
    ['TQ', 'Financial standing',
      'Solvency of at least ₹4 crore.',
      'Banker’s solvency certificate, issued within the last six months.', 20],
  ]);

  const evalCriteria = db
    .prepare(`SELECT id, kind, sl_no, max_score FROM tender_criteria WHERE tender_id = ? ORDER BY kind, sl_no`)
    .all(evalTenderId) as { id: number; kind: string; sl_no: number; max_score: number }[];

  const insertBid = db.prepare(
    `INSERT INTO bids (bid_no, tender_id, contractor_id, emd_reference, emd_paid, quoted_amount,
                       variation_bps, sr_ceiling_amount, sr_variation_bps, is_above_sr,
                       technical_score, technical_status, technical_remarks,
                       financial_status, rank, status, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertResponse = db.prepare(
    `INSERT INTO bid_criteria_responses (bid_id, criterion_id, is_met, score, remarks)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const ceilingRow = db
    .prepare(`SELECT sr_ceiling_amount AS c FROM tenders WHERE id = ?`)
    .get(evalTenderId) as { c: number };
  const ceiling = ceilingRow.c || bldgEstimate;
  const emd = Math.round(bldgEstimate / 50);

  /**
   * Every bid sits at or below the Schedule of Rates ceiling, which is what the
   * system now enforces. The technical scores are the totals of the criterion
   * marks recorded underneath them, not figures typed by the committee.
   */
  const bids: [string, number, number, string, string, number, number[]][] = [
    ['C-10003', 95, 1, 'QUALIFIED', 'Meets every pre-qualification criterion. Strongest on plant and formwork.', 1,
      [33, 21, 20, 18]],
    ['C-10001', 98, 2, 'QUALIFIED', 'Strong technical capacity; all documents in order.', 2,
      [35, 24, 18, 20]],
    ['C-10002', 100, 3, 'QUALIFIED', 'Qualified on the strength of a single similar completed work.', 3,
      [26, 19, 14, 16]],
  ];

  bids.forEach(([code, quotePercent, index, status, remarks, rank, marks]) => {
    // Quoted as a percentage of the ceiling, so no seeded bid breaches it.
    const quoted = Math.round((ceiling * quotePercent) / 100);
    const score = marks.reduce((sum, mark) => sum + mark, 0);

    const bidId = Number(
      insertBid.run(
        `DIV-SGR/TEN/2026-27/0001/BID/${String(index).padStart(3, '0')}`,
        evalTenderId, contractorIds[code]!,
        `EMD/${code}/2026/${index}`, emd, quoted,
        bldgEstimate > 0 ? Math.round(((quoted - bldgEstimate) / bldgEstimate) * 10_000) : 0,
        ceiling, ceiling > 0 ? Math.round(((quoted - ceiling) / ceiling) * 10_000) : 0,
        quoted > ceiling ? 1 : 0,
        score, status, remarks, 'EVALUATED', rank, 'TECHNICALLY_QUALIFIED',
        `2026-07-${String(14 + index).padStart(2, '0')} 15:${String(20 + index * 7)}:00`,
      ).lastInsertRowid,
    );

    // Pre-qualification is pass or fail; the technical criteria carry the marks.
    for (const criterion of evalCriteria.filter((c) => c.kind === 'PQ')) {
      insertResponse.run(bidId, criterion.id, 1, 0, 'Documents verified.');
    }
    evalCriteria
      .filter((c) => c.kind === 'TQ')
      .forEach((criterion, position) => {
        const mark = marks[position] ?? 0;
        insertResponse.run(
          bidId, criterion.id, 1, mark,
          `${mark} of ${criterion.max_score} on the evidence produced.`,
        );
      });
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

  // Land parcels: <DIVISION>/LA/<FY>/<SERIAL>.
  for (const row of rows(
    `SELECT lp.parcel_no AS code, d.code AS division
       FROM land_parcels lp JOIN divisions d ON d.id = lp.division_id
      WHERE lp.parcel_no LIKE '%/LA/%'`,
  )) {
    set(`LAND_PARCEL:${row.division}:${row.code!.split('/')[2]!}`, tail(row.code!));
  }

  // Meeting numbers: <COMMITTEE>/<FY>/<SERIAL>.
  for (const row of rows(
    `SELECT m.meeting_no AS code, c.code AS committee
       FROM meetings m JOIN committees c ON c.id = m.committee_id`,
  )) {
    set(`MEETING:${row.committee}:${row.code!.split('/')[1]!}`, tail(row.code!));
  }

  // RTI applications: <DIVISION>/RTI/<FY>/<SERIAL>.
  for (const row of rows(
    `SELECT r.request_no AS code, d.code AS division
       FROM rti_requests r JOIN divisions d ON d.id = r.division_id
      WHERE r.request_no LIKE '%/RTI/%'`,
  )) {
    set(`RTI:${row.division}:${row.code!.split('/')[2]!}`, tail(row.code!));
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

  // Bills inserted a moment ago all look a day old, which would make the ageing
  // analysis read as though nothing in the department ever waits. Backdating
  // the unsettled ones puts them across the register's buckets, which is what
  // an office actually looks like.
  backdate('ra_bills', billIds[1]!, 34);
  backdate('ra_bills', billIds[2]!, 71);
  backdate('ra_bills', waterBillId, 118);

  seedMiscBills(ids, userIds, projectIds);

  // The one miscellaneous bill still under approval has been waiting a while.
  const pendingMisc = db
    .prepare(`SELECT id FROM misc_bills WHERE status = 'IN_APPROVAL' ORDER BY id LIMIT 1`)
    .get() as { id: number } | undefined;
  if (pendingMisc) backdate('misc_bills', pendingMisc.id, 52);
}

/** Moves a row's creation date back, so ageing figures mean something. */
function backdate(table: string, id: number, days: number): void {
  getDb()
    .prepare(`UPDATE ${table} SET created_at = datetime('now', ?) WHERE id = ?`)
    .run(`-${days} days`, id);
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

/**
 * The reference data the system cannot function without — roles, the approval
 * chains and the master lists — with no demonstration records and no accounts.
 * Used when deploying an instance that will hold real work.
 */
export function seedEssentials(): void {
  const db = getDb();
  db.transaction(() => {
    seedRoles();
    seedWorkflows();
    seedMasters();
  })();
  console.log('Reference data installed: roles, approval chains and master lists.');
}

export function seed(): void {
  const db = getDb();
  db.transaction(() => {
    seedRoles();
    seedWorkflows();
    const ids = seedMasters();
    const userIds = seedUsers(ids);
    const contractorIds = seedContractors(ids);
    seedDemoRecords(ids, userIds, contractorIds);
    seedWorkspace(ids, userIds);
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
