import { ROLES, type RoleCode } from './constants.js';

/**
 * What a role is allowed to do.
 *
 * The catalogue is code, not data: a permission only means something because
 * some route checks for it, so inventing one in the database would achieve
 * nothing. What an administrator edits is the *grant* — which roles hold which
 * permission — and that lives in the `role_permissions` table.
 *
 * The defaults below reproduce exactly the access the system had when these
 * checks were hardcoded, so turning this on changes nothing until someone
 * deliberately edits it.
 */

export interface PermissionDefinition {
  key: string;
  /** What an administrator reads on the roles screen. */
  label: string;
  /** Why it exists, in the department's terms. */
  description: string;
  group:
    | 'Works'
    | 'Procurement'
    | 'Bills and payments'
    | 'Funds'
    | 'Documents'
    | 'Communication'
    | 'Administration';
  /**
   * Permissions the system refuses to take away from an administrator, because
   * losing them is how you lock yourself out of the screen that grants them.
   */
  lockedForAdmin?: boolean;
}

export const PERMISSIONS: PermissionDefinition[] = [
  // --- Works ---------------------------------------------------------------
  {
    key: 'projects.view',
    label: 'See projects and packages',
    description: 'Open the projects and packages screens.',
    group: 'Works',
  },
  {
    key: 'projects.manage',
    label: 'Create and edit projects',
    description: 'Raise a project, edit it, send it for sanction and maintain its milestones and packages.',
    group: 'Works',
  },

  // --- Procurement ---------------------------------------------------------
  {
    key: 'tenders.view',
    label: 'See tenders',
    description: 'Open the tender screens and read published notices.',
    group: 'Procurement',
  },
  {
    key: 'tenders.manage',
    label: 'Create and publish tenders',
    description: 'Draft a tender, set its bill of quantities and publish it for bidding.',
    group: 'Procurement',
  },
  {
    key: 'tenders.evaluate',
    label: 'Evaluate bids',
    description: 'Close bidding, score the technical bids and open the financial envelope.',
    group: 'Procurement',
  },
  {
    key: 'tenders.award',
    label: 'Award a tender',
    description: 'Issue the Letter of Acceptance to the successful bidder.',
    group: 'Procurement',
  },
  {
    key: 'tenders.bid',
    label: 'Submit a bid',
    description: 'Bid for a published tender. Held by contractors.',
    group: 'Procurement',
  },
  {
    key: 'contractors.view',
    label: 'See contractors',
    description: 'Open the contractor register.',
    group: 'Procurement',
  },
  {
    key: 'contractors.manage',
    label: 'Edit contractor details',
    description: 'Correct a firm’s particulars, class of registration and banking details.',
    group: 'Procurement',
  },
  {
    key: 'contractors.blacklist',
    label: 'Blacklist a contractor',
    description: 'Bar a firm from bidding, or lift a bar. Recorded permanently against the firm.',
    group: 'Procurement',
  },

  // --- Bills ---------------------------------------------------------------
  {
    key: 'bills.ra.view',
    label: 'See running account bills',
    description: 'Open the RA bill screens.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.ra.raise',
    label: 'Raise a running account bill',
    description: 'Record measurements, create and edit a draft bill, and send it for approval.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.ra.certify',
    label: 'Certify the admissible amount',
    description:
      'Set the admissible amount and the ETP percentages on a bill under approval. The Executive Engineer’s certification.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.ra.deductions',
    label: 'Revise the deduction schedule',
    description: 'Change the statutory deductions applied to a bill under approval.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.misc.view',
    label: 'See miscellaneous bills',
    description: 'Open the miscellaneous bill screens.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.misc.raise',
    label: 'Raise a miscellaneous bill',
    description: 'Create and edit a draft expenditure bill and send it for approval.',
    group: 'Bills and payments',
  },
  {
    key: 'bills.treasury',
    label: 'Send to Tally and record payment',
    description:
      'Stamp the e-Office reference, export the voucher to Tally, and record the actual disbursement.',
    group: 'Bills and payments',
  },

  // --- Funds ---------------------------------------------------------------
  {
    key: 'funds.view',
    label: 'See funds and letters of credit',
    description: 'Open the funds screen.',
    group: 'Funds',
  },
  {
    key: 'funds.release',
    label: 'Record a fund release',
    description: 'Record budget released to a division against a scheme.',
    group: 'Funds',
  },
  {
    key: 'funds.loc.request',
    label: 'Request a letter of credit',
    description: 'Raise a letter of credit for the division and send it for approval.',
    group: 'Funds',
  },
  {
    key: 'funds.loc.approve',
    label: 'Set the amount approved on a letter of credit',
    description: 'Decide how much of a requested letter of credit is granted.',
    group: 'Funds',
  },

  // --- Documents -----------------------------------------------------------
  {
    key: 'files.view',
    label: 'See files',
    description: 'Open the file store and download what is filed there.',
    group: 'Documents',
  },
  {
    key: 'files.manage',
    label: 'Upload and organise files',
    description: 'Upload documents, create folders, and rename or remove what is filed.',
    group: 'Documents',
  },

  // --- Communication -------------------------------------------------------
  {
    key: 'chat.use',
    label: 'Use messages',
    description: 'Hold direct conversations with colleagues.',
    group: 'Communication',
  },
  {
    key: 'chat.groups',
    label: 'Create group chats',
    description: 'Set up a group conversation and manage its members.',
    group: 'Communication',
  },

  // --- Administration ------------------------------------------------------
  {
    key: 'approvals.act',
    label: 'Act on approvals',
    description: 'Hold an approval inbox and approve, return or reject the files in it.',
    group: 'Administration',
  },
  {
    key: 'masters.view',
    label: 'See master data',
    description: 'Read the reference lists every form draws on.',
    group: 'Administration',
  },
  {
    key: 'masters.manage',
    label: 'Maintain master data',
    description: 'Add, edit and remove entries in the reference lists.',
    group: 'Administration',
  },
  {
    key: 'workflows.view',
    label: 'See approval chains',
    description: 'Read how each kind of file moves and who acts at each stage.',
    group: 'Administration',
  },
  {
    key: 'workflows.manage',
    label: 'Design approval chains',
    description: 'Create chains and change their steps. A structural change publishes a new version.',
    group: 'Administration',
  },
  {
    key: 'users.manage',
    label: 'Manage user accounts',
    description: 'Create accounts, change postings and reset passwords.',
    group: 'Administration',
    lockedForAdmin: true,
  },
  {
    key: 'roles.manage',
    label: 'Change what each role may do',
    description: 'Edit this screen. Held by the administrator alone.',
    group: 'Administration',
    lockedForAdmin: true,
  },
  {
    key: 'audit.view',
    label: 'Read the audit trail',
    description: 'Read the permanent record of business events.',
    group: 'Administration',
  },
  {
    key: 'activity.view',
    label: 'Watch live activity',
    description: 'See who is signed in and what every officer is doing, as it happens.',
    group: 'Administration',
  },
];

export const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

export type PermissionKey = string;

export function isPermissionKey(value: string): boolean {
  return PERMISSION_KEYS.includes(value);
}

export function findPermission(key: string): PermissionDefinition | undefined {
  return PERMISSIONS.find((permission) => permission.key === key);
}

/**
 * The grants the system starts with. These mirror, one for one, the role lists
 * that used to be written into the routes, so switching to permissions changed
 * nobody's access on the day it landed.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  // The administrator holds everything.
  [ROLES.ADMIN]: PERMISSION_KEYS,

  [ROLES.MD]: [
    'projects.view', 'tenders.view', 'contractors.view',
    'bills.ra.view', 'bills.misc.view',
    'funds.view', 'funds.release', 'funds.loc.approve',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view', 'audit.view',
  ],

  [ROLES.CE]: [
    'projects.view', 'projects.manage',
    'tenders.view', 'tenders.manage', 'tenders.evaluate', 'tenders.award',
    'contractors.view', 'contractors.manage', 'contractors.blacklist',
    'bills.ra.view', 'bills.misc.view',
    'funds.view', 'funds.release',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'masters.manage', 'workflows.view',
  ],

  [ROLES.SE]: [
    'projects.view', 'projects.manage',
    'tenders.view', 'tenders.manage', 'tenders.evaluate', 'tenders.award',
    'contractors.view', 'contractors.manage', 'contractors.blacklist',
    'bills.ra.view', 'bills.misc.view',
    'funds.view',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'masters.manage', 'workflows.view',
  ],

  [ROLES.EE]: [
    'projects.view', 'projects.manage',
    'tenders.view', 'tenders.manage', 'tenders.evaluate',
    'contractors.view', 'contractors.manage',
    'bills.ra.view', 'bills.ra.raise', 'bills.ra.certify',
    'bills.misc.view', 'bills.misc.raise',
    'funds.view', 'funds.loc.request',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.AEE]: [
    'projects.view', 'projects.manage',
    'tenders.view', 'contractors.view', 'contractors.manage',
    'bills.ra.view', 'bills.ra.raise', 'bills.misc.view',
    'funds.view',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.AE]: [
    'projects.view', 'projects.manage',
    'tenders.view', 'contractors.view',
    'bills.ra.view', 'bills.ra.raise', 'bills.misc.view',
    'funds.view',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.AC]: [
    'projects.view', 'tenders.view', 'contractors.view', 'contractors.manage',
    'bills.ra.view', 'bills.ra.raise', 'bills.ra.deductions',
    'bills.misc.view', 'bills.misc.raise',
    'funds.view', 'funds.loc.request',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.AS]: [
    'projects.view', 'tenders.view', 'contractors.view', 'contractors.manage',
    'bills.ra.view', 'bills.ra.deductions',
    'bills.misc.view', 'bills.misc.raise',
    'funds.view', 'funds.loc.request',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.AAO]: [
    'projects.view', 'tenders.view', 'contractors.view', 'contractors.manage',
    'bills.ra.view', 'bills.ra.deductions', 'bills.misc.view', 'bills.treasury',
    'funds.view', 'funds.loc.approve',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view',
  ],

  [ROLES.CAO]: [
    'projects.view', 'tenders.view', 'tenders.evaluate',
    'contractors.view', 'contractors.manage', 'contractors.blacklist',
    'bills.ra.view', 'bills.ra.deductions', 'bills.misc.view', 'bills.treasury',
    'funds.view', 'funds.release', 'funds.loc.approve',
    'files.view', 'files.manage', 'chat.use', 'chat.groups',
    'approvals.act', 'masters.view', 'workflows.view', 'audit.view',
  ],

  // Read-only by design.
  [ROLES.AUDITOR]: [
    'projects.view', 'tenders.view', 'contractors.view',
    'bills.ra.view', 'bills.misc.view', 'funds.view',
    'files.view', 'chat.use',
    'approvals.act', 'masters.view', 'workflows.view',
    'audit.view', 'activity.view',
  ],

  // A contractor sees only their own work, which the scoping rules enforce
  // separately; these are the surfaces they may reach at all.
  [ROLES.CONTRACTOR]: [
    'tenders.view', 'tenders.bid',
    'bills.ra.view', 'bills.ra.raise',
    'files.view', 'chat.use',
  ],
};
