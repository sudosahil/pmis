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
  LAND_ACQUISITION: 'LAND_ACQUISITION',
} as const;

export type WorkflowCode = (typeof WORKFLOWS)[keyof typeof WORKFLOWS];

export const ENTITY_TYPES = {
  PROJECT: 'PROJECT',
  TENDER: 'TENDER',
  RA_BILL: 'RA_BILL',
  MISC_BILL: 'MISC_BILL',
  CONTRACTOR: 'CONTRACTOR',
  LOC: 'LOC',
  LAND_PARCEL: 'LAND_PARCEL',
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

/**
 * A land parcel moves through the stages the 2013 Act lays down, and it cannot
 * skip one: an award before a declaration, or a declaration before the
 * preliminary notification, is not an acquisition a court would recognise.
 */
export const LAND_PARCEL_STATUS = {
  IDENTIFIED: 'IDENTIFIED',
  NOTIFIED: 'NOTIFIED',
  DECLARED: 'DECLARED',
  AWARDED: 'AWARDED',
  COMPENSATED: 'COMPENSATED',
  POSSESSED: 'POSSESSED',
  DISPUTED: 'DISPUTED',
  WITHDRAWN: 'WITHDRAWN',
} as const;

/** The order the stages run in, used to refuse a step taken out of turn. */
export const LAND_PARCEL_SEQUENCE: string[] = [
  LAND_PARCEL_STATUS.IDENTIFIED,
  LAND_PARCEL_STATUS.NOTIFIED,
  LAND_PARCEL_STATUS.DECLARED,
  LAND_PARCEL_STATUS.AWARDED,
  LAND_PARCEL_STATUS.COMPENSATED,
  LAND_PARCEL_STATUS.POSSESSED,
];

/**
 * The Right to Information Act's clocks, in days. Missing the first one costs
 * the Public Information Officer ₹250 a day out of their own pocket, so the
 * figures are constants rather than something a form can be talked into.
 */
export const RTI_DAYS = {
  /** Section 7(1): thirty days to reply. */
  REPLY: 30,
  /** Section 7(1) proviso: forty-eight hours where life or liberty is at stake. */
  LIFE_OR_LIBERTY_HOURS: 48,
  /** Section 19(1): thirty days to prefer a first appeal, and to decide it. */
  APPEAL: 30,
  /** Section 19(6): the appellate authority may take forty-five for reasons recorded. */
  APPEAL_EXTENDED: 45,
} as const;
