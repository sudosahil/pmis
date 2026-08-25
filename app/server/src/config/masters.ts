/**
 * Every master in the Project Masters specification shares the same shape:
 * a code, a name, some typed attributes and a status. Describing them as data
 * rather than as fourteen near-identical modules means one controller, one
 * service and — because the definitions are served to the client — one screen
 * renders them all.
 */

export type MasterFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'money'
  | 'percent'
  | 'date'
  | 'select'
  | 'lookup'
  | 'boolean';

export interface MasterField {
  column: string;
  label: string;
  type: MasterFieldType;
  required?: boolean;
  /** Shown in the list table. Long/rare fields stay form-only. */
  inList?: boolean;
  options?: string[];
  /** For `lookup`: the master key this field points at. */
  refKey?: string;
  help?: string;
  maxLength?: number;
}

export interface MasterDefinition {
  key: string;
  table: string;
  label: string;
  singular: string;
  group: 'Organisation' | 'Geography' | 'Classification' | 'Finance';
  description: string;
  fields: MasterField[];
  orderBy: string;
  /** Columns scanned by the list search box. */
  searchColumns: string[];
}

const STATUS_FIELD: MasterField = {
  column: 'status',
  label: 'Status',
  type: 'select',
  options: ['ACTIVE', 'INACTIVE'],
  required: true,
  inList: true,
};

const CODE = (help: string): MasterField => ({
  column: 'code',
  label: 'Code',
  type: 'text',
  required: true,
  inList: true,
  maxLength: 32,
  help,
});

const NAME: MasterField = {
  column: 'name',
  label: 'Name',
  type: 'text',
  required: true,
  inList: true,
  maxLength: 200,
};

export const MASTER_DEFINITIONS: MasterDefinition[] = [
  {
    key: 'zones',
    table: 'zones',
    label: 'Zones',
    singular: 'Zone',
    group: 'Organisation',
    description: 'Topmost administrative unit. Circles report into a zone.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'zone_head'],
    fields: [
      CODE('e.g. ZN-SOUTH'),
      NAME,
      { column: 'state_region', label: 'State / Region Covered', type: 'text', inList: true },
      { column: 'zone_head', label: 'Zone Head', type: 'text', inList: true },
      STATUS_FIELD,
    ],
  },
  {
    key: 'circles',
    table: 'circles',
    label: 'Circles',
    singular: 'Circle',
    group: 'Organisation',
    description: 'Reports to a zone. Headed by a Chief or Superintending Engineer.',
    orderBy: 'code',
    searchColumns: ['code', 'name'],
    fields: [
      CODE('e.g. C-CIVIL'),
      NAME,
      { column: 'zone_id', label: 'Zone', type: 'lookup', refKey: 'zones', required: true, inList: true },
      {
        column: 'authority_level',
        label: 'Authority Level',
        type: 'select',
        options: ['Chief Engineer', 'Superintending Engineer'],
        inList: true,
      },
      STATUS_FIELD,
    ],
  },
  {
    key: 'divisions',
    table: 'divisions',
    label: 'Divisions',
    singular: 'Division',
    group: 'Organisation',
    description: 'The unit that owns projects, bills and the divisional bill register.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'head_of_division'],
    fields: [
      CODE('e.g. DIV-NGR'),
      NAME,
      { column: 'circle_id', label: 'Circle', type: 'lookup', refKey: 'circles', required: true, inList: true },
      { column: 'head_of_division', label: 'Head of Division', type: 'text', inList: true },
      { column: 'contact_email', label: 'Contact Email', type: 'text' },
      { column: 'contact_phone', label: 'Contact Phone', type: 'text' },
      { column: 'effective_date', label: 'Effective Date', type: 'date' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'sub-divisions',
    table: 'sub_divisions',
    label: 'Sub Divisions',
    singular: 'Sub Division',
    group: 'Organisation',
    description: 'Field unit under a division, headed by a Sub-Divisional Engineer.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'reporting_officer'],
    fields: [
      CODE('e.g. SD-01-W'),
      NAME,
      { column: 'division_id', label: 'Division', type: 'lookup', refKey: 'divisions', required: true, inList: true },
      { column: 'jurisdiction_area', label: 'Jurisdiction Area', type: 'text', inList: true },
      { column: 'reporting_officer', label: 'Reporting Officer (SDE)', type: 'text' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'districts',
    table: 'districts',
    label: 'Districts',
    singular: 'District',
    group: 'Geography',
    description: 'Official district codes used for project location.',
    orderBy: 'name',
    searchColumns: ['code', 'name', 'state_name'],
    fields: [
      CODE('Census / state code, e.g. D-410'),
      NAME,
      { column: 'state_name', label: 'State', type: 'text', inList: true },
      { column: 'pincode_from', label: 'Pincode From', type: 'text' },
      { column: 'pincode_to', label: 'Pincode To', type: 'text' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'towns',
    table: 'towns',
    label: 'Towns / Cities',
    singular: 'Town',
    group: 'Geography',
    description: 'Town or city within a district. Used in the project code.',
    orderBy: 'name',
    searchColumns: ['code', 'name'],
    fields: [
      CODE('e.g. T-0010'),
      NAME,
      { column: 'district_id', label: 'District', type: 'lookup', refKey: 'districts', required: true, inList: true },
      {
        column: 'classification',
        label: 'Classification',
        type: 'select',
        options: ['Metropolitan', 'Municipality', 'Town Panchayat', 'Village'],
        inList: true,
      },
      { column: 'population', label: 'Population', type: 'number' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'scheme-types',
    table: 'scheme_types',
    label: 'Scheme Types',
    singular: 'Scheme Type',
    group: 'Classification',
    description: 'How a scheme is funded and classified.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'category'],
    fields: [
      CODE('e.g. ST-CS'),
      { ...NAME, help: 'e.g. Centrally Sponsored, State Plan' },
      {
        column: 'category',
        label: 'Category',
        type: 'select',
        options: ['Infrastructure', 'Social Sector', 'Education', 'Health', 'Urban Development'],
        inList: true,
      },
      STATUS_FIELD,
    ],
  },
  {
    key: 'schemes',
    table: 'schemes',
    label: 'Schemes',
    singular: 'Scheme',
    group: 'Classification',
    description: 'The government programme funding a project.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'funding_agency', 'budget_head_code'],
    fields: [
      CODE('e.g. PMSGY'),
      { ...NAME, help: 'e.g. Pradhan Mantri Gram Sadak Yojana' },
      { column: 'scheme_type_id', label: 'Scheme Type', type: 'lookup', refKey: 'scheme-types', required: true, inList: true },
      {
        column: 'funding_agency',
        label: 'Funding Agency',
        type: 'select',
        options: ['Central Govt', 'State Govt', 'World Bank', 'ADB', 'AIIB', 'Own Funds'],
        inList: true,
      },
      { column: 'start_date', label: 'Start Date', type: 'date' },
      { column: 'end_date', label: 'End Date', type: 'date' },
      { column: 'budget_head_code', label: 'Budget Head Code', type: 'text', inList: true },
      { column: 'objective', label: 'Objective / Description', type: 'textarea' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'work-types',
    table: 'work_types',
    label: 'Work Types',
    singular: 'Work Type',
    group: 'Classification',
    description: 'The kind of construction work and its default unit of measurement.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'sector'],
    fields: [
      CODE('e.g. WT-ROAD'),
      { ...NAME, help: 'e.g. New Road Construction' },
      {
        column: 'sector',
        label: 'Sector',
        type: 'select',
        options: ['PWD', 'Irrigation', 'Health', 'Water Supply', 'Drainage', 'Buildings', 'Electrical'],
        inList: true,
      },
      { column: 'uom', label: 'Unit of Measurement', type: 'text', inList: true, help: 'Km, Sq.m, Meters, Nos' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'project-categories',
    table: 'project_categories',
    label: 'Project Categories',
    singular: 'Project Category',
    group: 'Classification',
    description: 'Project size bands and the authority that may sanction them.',
    orderBy: 'threshold_value',
    searchColumns: ['code', 'name', 'approval_authority'],
    fields: [
      CODE('e.g. PC-MAJ'),
      { ...NAME, help: 'e.g. Major Project, Minor Works' },
      {
        column: 'threshold_value',
        label: 'Threshold Value',
        type: 'money',
        inList: true,
        help: 'Minimum contract value that falls in this category',
      },
      {
        column: 'approval_authority',
        label: 'Approval Authority',
        type: 'select',
        options: [
          'Executive Engineer',
          'Superintending Engineer',
          'Chief Engineer',
          'Managing Director',
          'Cabinet Approval',
        ],
        inList: true,
      },
      STATUS_FIELD,
    ],
  },
  {
    key: 'banks',
    table: 'banks',
    label: 'Banks',
    singular: 'Bank',
    group: 'Finance',
    description: 'Banks used for contractor and staff payments.',
    orderBy: 'name',
    searchColumns: ['code', 'name', 'short_name', 'ifsc_code'],
    fields: [
      CODE('e.g. SBI'),
      NAME,
      { column: 'short_name', label: 'Short Name', type: 'text', inList: true },
      { column: 'ifsc_code', label: 'IFSC Code', type: 'text', inList: true, help: '11 characters, e.g. SBIN0001234' },
      { column: 'micr_code', label: 'MICR Code', type: 'text' },
      { column: 'head_office_address', label: 'Head Office Address', type: 'textarea' },
      { column: 'official_contact', label: 'Official Contact', type: 'text' },
      { ...STATUS_FIELD, options: ['ACTIVE', 'INACTIVE', 'BLACKLISTED'] },
    ],
  },
  {
    key: 'etp-charges',
    table: 'etp_charges',
    label: 'ETP Charges',
    singular: 'ETP Charge',
    group: 'Finance',
    description: 'Establishment, Tools & Plant and contingency charges recovered on works bills.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'account_head'],
    fields: [
      CODE('e.g. ESTABLISHMENT'),
      NAME,
      {
        column: 'charge_type',
        label: 'Charge Type',
        type: 'select',
        options: ['DEDUCTION', 'RECOVERY', 'LEVY'],
        required: true,
        inList: true,
      },
      { column: 'rate_bps', label: 'Applicable Rate', type: 'percent', required: true, inList: true },
      {
        column: 'basis_of_calculation',
        label: 'Basis of Calculation',
        type: 'select',
        options: ['Admissible Amount', 'Gross Bill Value', 'Works Component Only', 'Material Cost'],
        inList: true,
      },
      { column: 'effective_date', label: 'Effective Date', type: 'date' },
      { column: 'govt_reference', label: 'Govt. Reference', type: 'text', help: 'Circular or order authorising the rate' },
      { column: 'account_head', label: 'Account Head / Ledger', type: 'text' },
      STATUS_FIELD,
    ],
  },
  {
    key: 'schedule-of-rates',
    table: 'schedule_of_rates',
    label: 'Schedule of Rates',
    singular: 'Schedule of Rates item',
    group: 'Finance',
    description:
      'The departmental Schedule of Rates — the approved baseline price for every item of work. Estimates are priced from it, a bid may not be quoted above it, and running bills are verified against it. Every change to a rate is kept on record.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'chapter'],
    fields: [
      CODE('The SR item number, e.g. 4.11.2'),
      { column: 'name', label: 'Item of Work', type: 'text', required: true, inList: true, maxLength: 300 },
      { column: 'chapter', label: 'Chapter', type: 'text', inList: true, help: 'e.g. Earthwork, Concrete, Pipeline' },
      { column: 'uom', label: 'Unit', type: 'text', required: true, inList: true, maxLength: 20 },
      { column: 'rate', label: 'Rate', type: 'money', required: true, inList: true },
      { column: 'sr_year', label: 'SR Edition', type: 'text', required: true, inList: true, help: 'e.g. 2024-25' },
      { column: 'effective_date', label: 'Effective Date', type: 'date', help: 'When this rate took effect' },
      {
        column: 'govt_reference',
        label: 'Govt. Reference',
        type: 'text',
        help: 'The circular or order that authorised this rate. Recorded against the change.',
      },
      STATUS_FIELD,
    ],
  },
  {
    key: 'deduction-types',
    table: 'deduction_types',
    label: 'Deduction Types',
    singular: 'Deduction Type',
    group: 'Finance',
    description: 'Statutory and contractual deductions applied to bills.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'account_head'],
    fields: [
      CODE('e.g. IT-TDS'),
      NAME,
      {
        column: 'basis',
        label: 'Basis',
        type: 'select',
        options: ['PERCENT', 'AMOUNT'],
        required: true,
        inList: true,
      },
      { column: 'rate_bps', label: 'Default Rate', type: 'percent', inList: true },
      {
        column: 'applies_to',
        label: 'Applies To',
        type: 'select',
        options: ['RA', 'MISC', 'BOTH'],
        required: true,
        inList: true,
      },
      { column: 'account_head', label: 'Account Head', type: 'text' },
      { column: 'is_statutory', label: 'Statutory', type: 'boolean', inList: true },
      STATUS_FIELD,
    ],
  },
  {
    key: 'expense-categories',
    table: 'expense_categories',
    label: 'Expense Categories',
    singular: 'Expense Category',
    group: 'Finance',
    description: 'Miscellaneous expenditure heads mapped to government object heads.',
    orderBy: 'code',
    searchColumns: ['code', 'name', 'govt_object_head', 'parent_code'],
    fields: [
      CODE('e.g. OE-STATIONERY'),
      NAME,
      { column: 'parent_code', label: 'Parent Group', type: 'text', inList: true },
      {
        column: 'govt_object_head',
        label: 'Govt. Object Head',
        type: 'select',
        options: [
          'Office Expenses (OE)',
          'Domestic Travel Expenses (DTE)',
          'Material & Supply (M&S)',
          'Hospitality / Sumptuary Allowance',
          'Freight / Handling Charges',
          'Professional Services',
          'Works Contingency',
        ],
        inList: true,
      },
      {
        column: 'bill_category',
        label: 'Bill Category',
        type: 'select',
        options: ['PROJECT_EXPENSE', 'REVENUE_EXPENSE', 'REFUND'],
        required: true,
        inList: true,
      },
      STATUS_FIELD,
    ],
  },
];

const BY_KEY = new Map(MASTER_DEFINITIONS.map((d) => [d.key, d]));

export function getMasterDefinition(key: string): MasterDefinition | undefined {
  return BY_KEY.get(key);
}
