/** Role codes. Kept in sync with the `roles` table seeded in src/db/seed.ts. */
export const ROLES = {
  ADMIN: 'ADMIN',
  MD: 'MD',
  CE: 'CE',
  SE: 'SE',
  EE: 'EE',
  AEE: 'AEE',
  AE: 'AE',
  AC: 'AC',
  AS: 'AS',
  AAO: 'AAO',
  CAO: 'CAO',
  AUDITOR: 'AUDITOR',
  CONTRACTOR: 'CONTRACTOR',
} as const;

export type RoleCode = (typeof ROLES)[keyof typeof ROLES];

export const STAFF_ROLES: RoleCode[] = [
  ROLES.ADMIN, ROLES.MD, ROLES.CE, ROLES.SE, ROLES.EE, ROLES.AEE,
  ROLES.AE, ROLES.AC, ROLES.AS, ROLES.AAO, ROLES.CAO, ROLES.AUDITOR,
];

/** Roles permitted to maintain master data. */
export const MASTER_MAINTAINER_ROLES: RoleCode[] = [ROLES.ADMIN, ROLES.CE, ROLES.SE];

/** Roles that can see every division rather than only their own. */
export const GLOBAL_SCOPE_ROLES: RoleCode[] = [
  ROLES.ADMIN, ROLES.MD, ROLES.CE, ROLES.CAO, ROLES.AAO, ROLES.AUDITOR,
];

export const WORKFLOWS = {
  PROJECT_SANCTION: 'PROJECT_SANCTION',
  TENDER_APPROVAL: 'TENDER_APPROVAL',
  TENDER_AWARD: 'TENDER_AWARD',
  RA_BILL: 'RA_BILL',
  MISC_BILL: 'MISC_BILL',
  CONTRACTOR_REGISTRATION: 'CONTRACTOR_REGISTRATION',
  LOC_APPROVAL: 'LOC_APPROVAL',
} as const;

export type WorkflowCode = (typeof WORKFLOWS)[keyof typeof WORKFLOWS];

export const ENTITY_TYPES = {
  PROJECT: 'PROJECT',
  TENDER: 'TENDER',
  RA_BILL: 'RA_BILL',
  MISC_BILL: 'MISC_BILL',
  CONTRACTOR: 'CONTRACTOR',
  LOC: 'LOC',
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

export const WORKFLOW_ACTIONS = {
  SUBMIT: 'SUBMIT',
  APPROVE: 'APPROVE',
  REJECT: 'REJECT',
  RETURN: 'RETURN',
  ASSIGN: 'ASSIGN',
  CANCEL: 'CANCEL',
} as const;

export type WorkflowAction = (typeof WORKFLOW_ACTIONS)[keyof typeof WORKFLOW_ACTIONS];

export const INSTANCE_STATUS = {
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;

/** Bill lifecycle shared by RA and miscellaneous bills. */
export const BILL_STATUS = {
  DRAFT: 'DRAFT',
  IN_APPROVAL: 'IN_APPROVAL',
  APPROVED: 'APPROVED',
  SENT_TO_TALLY: 'SENT_TO_TALLY',
  PAID: 'PAID',
  REJECTED: 'REJECTED',
  RETURNED: 'RETURNED',
} as const;

export const PROJECT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_SANCTION: 'PENDING_SANCTION',
  SANCTIONED: 'SANCTIONED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CLOSED: 'CLOSED',
  REJECTED: 'REJECTED',
} as const;

export const TENDER_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PUBLISHED: 'PUBLISHED',
  BIDDING_CLOSED: 'BIDDING_CLOSED',
  TECHNICAL_EVALUATION: 'TECHNICAL_EVALUATION',
  FINANCIAL_EVALUATION: 'FINANCIAL_EVALUATION',
  AWARDED: 'AWARDED',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
} as const;

export const PACKAGE_STATUS = {
  DRAFT: 'DRAFT',
  TENDERING: 'TENDERING',
  AWARDED: 'AWARDED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CLOSED: 'CLOSED',
} as const;

export const MISC_BILL_CATEGORIES = ['PROJECT_EXPENSE', 'REVENUE_EXPENSE', 'REFUND'] as const;
