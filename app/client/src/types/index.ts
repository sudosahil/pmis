export type RoleCode =
  | 'ADMIN' | 'MD' | 'CE' | 'SE' | 'EE' | 'AEE' | 'AE'
  | 'AC' | 'AS' | 'AAO' | 'CAO' | 'AUDITOR' | 'CONTRACTOR';

export interface User {
  id: number;
  username: string;
  email: string;
  fullName: string;
  employeeCode: string | null;
  designation: string | null;
  roleCode: RoleCode;
  roleName: string;
  phone: string | null;
  zoneId: number | null;
  zoneName: string | null;
  circleId: number | null;
  circleName: string | null;
  divisionId: number | null;
  divisionName: string | null;
  subDivisionId: number | null;
  subDivisionName: string | null;
  contractorId: number | null;
  contractorName: string | null;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  /** What this user's role may do. Present on the session; absent elsewhere. */
  permissions?: string[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  mustChangePassword: boolean;
}

// --- Role access -----------------------------------------------------------

export interface PermissionDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
  /** The administrator may not give this one up. */
  lockedForAdmin: boolean;
}

export interface RoleAccess {
  code: RoleCode;
  name: string;
  description: string | null;
  scope: string;
  userCount: number;
  permissions: string[];
  defaultPermissions: string[];
  isDefault: boolean;
}

export interface RoleAccessCatalogue {
  permissions: PermissionDefinition[];
  groups: string[];
  roles: RoleAccess[];
}

// --- Masters ---------------------------------------------------------------

export type MasterFieldType =
  | 'text' | 'textarea' | 'number' | 'money' | 'percent'
  | 'date' | 'select' | 'lookup' | 'boolean';

export interface MasterField {
  column: string;
  label: string;
  type: MasterFieldType;
  required?: boolean;
  inList?: boolean;
  options?: string[];
  refKey?: string;
  help?: string;
  maxLength?: number;
}

export interface MasterDefinition {
  key: string;
  label: string;
  singular: string;
  group: 'Organisation' | 'Geography' | 'Classification' | 'Finance';
  description: string;
  fields: MasterField[];
}

export interface LookupOption {
  id: number;
  code: string;
  name: string;
  parentId: number | null;
}

export type MasterRecord = Record<string, unknown> & { id: number };

// --- Workflow --------------------------------------------------------------

export type WorkflowActionType = 'SUBMIT' | 'APPROVE' | 'REJECT' | 'RETURN' | 'ASSIGN' | 'CANCEL';

export interface TimelineStep {
  stepId: number;
  seq: number;
  name: string;
  roleCode: string;
  state: 'DONE' | 'CURRENT' | 'PENDING' | 'SKIPPED';
}

export interface WorkflowHistoryEntry {
  id: number;
  stepName: string;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  remarks: string | null;
  createdAt: string;
}

export interface WorkflowView {
  instance: {
    id: number;
    definitionCode: string;
    definitionName: string;
    entityType: string;
    entityId: number;
    entityRef: string | null;
    title: string | null;
    amount: number;
    status: string;
    currentStepId: number | null;
    currentStepName: string | null;
    assignedRole: string | null;
    assignedUserId: number | null;
    assignedUserName: string | null;
    dueAt: string | null;
    initiatedBy: number | null;
    createdAt: string;
    completedAt: string | null;
  };
  steps: TimelineStep[];
  history: WorkflowHistoryEntry[];
  availableActions: WorkflowActionType[];
  returnTargets: { stepId: number; name: string; roleCode: string }[];
}

export interface InboxItem {
  instanceId: number;
  entityType: string;
  entityId: number;
  entityRef: string | null;
  title: string | null;
  amount: number;
  workflowName: string;
  stepName: string | null;
  stepSeq: number | null;
  status: string;
  divisionName: string | null;
  initiatedBy: string | null;
  dueAt: string | null;
  isOverdue: boolean;
  createdAt: string;
}

export interface WorkflowStepView {
  id: number;
  seq: number;
  code: string;
  name: string;
  roleCode: string;
  scope: string;
  slaDays: number;
  allowReturn: boolean;
  allowReject: boolean;
}

export interface WorkflowDefinitionView {
  id: number;
  code: string;
  version: number;
  isCurrent: boolean;
  name: string;
  entityType: string;
  description: string | null;
  status: string;
  supersededAt: string | null;
  createdAt: string;
  inFlightCount: number;
  totalInstances: number;
  /** False when a structural edit would supersede the version instead. */
  editsInPlace: boolean;
  steps: {
    id: number;
    seq: number;
    code: string;
    name: string;
    roleCode: string;
    scope: string;
    slaDays: number;
    allowReturn: boolean;
    allowReject: boolean;
  }[];
}

// --- Projects --------------------------------------------------------------

export interface Project {
  id: number;
  projectCode: string;
  name: string;
  description: string | null;
  scheme: { id: number; code: string; name: string };
  workType: { id: number; name: string };
  category: { id: number; name: string };
  location: {
    zoneId: number; zoneName: string;
    circleId: number; circleName: string;
    divisionId: number; divisionName: string; divisionCode: string;
    subDivisionId: number | null; subDivisionName: string | null;
    districtId: number | null; districtName: string | null;
    townId: number | null; townName: string | null;
    latitude: string | null; longitude: string | null;
  };
  estimatedCost: number;
  sanctionedCost: number;
  sanctionNo: string | null;
  sanctionDate: string | null;
  startDate: string | null;
  targetCompletionDate: string | null;
  actualCompletionDate: string | null;
  physicalProgress: number;
  status: string;
  workflowInstanceId: number | null;
  packageCount: number;
  awardedValue: number;
  paidAmount: number;
  pendingAmount: number;
  miscExpenditure: number;
  financialProgress: number;
  createdBy: string | null;
  createdAt: string;
}

export interface Milestone {
  id: number;
  seq: number;
  name: string;
  plannedDate: string | null;
  actualDate: string | null;
  weightage: number;
  status: string;
  remarks: string | null;
}

export interface ProjectDetail extends Project {
  milestones: Milestone[];
  expenditure: {
    financialYear: string;
    uptoPreviousYear: number;
    duringYear: number;
    total: number;
  };
  workflow: WorkflowView | null;
}

// --- Packages --------------------------------------------------------------

export interface Package {
  id: number;
  packageCode: string;
  name: string;
  description: string | null;
  project: {
    id: number; code: string; name: string;
    divisionId: number; divisionCode: string; divisionName: string;
  };
  workType: { id: number; name: string | null } | null;
  contractor: { id: number; code: string | null; name: string | null } | null;
  inCharge: { id: number; name: string | null } | null;
  estimatedValue: number;
  awardedValue: number;
  billedToDate: number;
  balanceValue: number;
  agreementNo: string | null;
  agreementDate: string | null;
  workOrderNo: string | null;
  workOrderDate: string | null;
  commencementDate: string | null;
  completionDate: string | null;
  defectLiabilityMonths: number;
  securityDeposit: number;
  retention: number;
  physicalProgress: number;
  status: string;
  billCount: number;
  paidAmount: number;
  pendingAmount: number;
  createdAt: string;
}

export interface PackageProgressUpdate {
  id: number;
  packageId: number;
  contractor: { id: number; name: string | null } | null;
  updateDate: string;
  physicalProgress: number | null;
  narrative: string;
  status: 'SUBMITTED' | 'REVIEWED' | 'RETURNED';
  reviewRemarks: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  submittedBy: string | null;
  photoCount: number;
  createdAt: string;
}

// --- Contractors -----------------------------------------------------------

export interface Contractor {
  id: number;
  code: string;
  name: string;
  contractorType: string | null;
  registrationClass: string | null;
  registrationNo: string | null;
  eprocNo: string | null;
  pan: string;
  gstin: string | null;
  contactPerson: string | null;
  email: string;
  phone: string | null;
  address: {
    building: string | null; street: string | null; area: string | null;
    city: string | null; state: string | null; country: string | null; zipCode: string | null;
  };
  bank: {
    bankId: number | null; bankName: string | null; branch: string | null;
    accountNo: string | null; accountType: string | null; ifscCode: string | null;
  };
  tdsRate: number;
  isBlacklisted: boolean;
  validityDate: string | null;
  registrationStatus: string;
  status: string;
  remarks: string | null;
  activePackages: number;
  createdAt: string;
}

export interface ContractorStats {
  activePackages: number;
  completedPackages: number;
  awardedValue: number;
  billsSubmitted: number;
  billsPaid: number;
  amountPaid: number;
  amountPending: number;
}

export interface ContractorDetail extends Contractor {
  stats: ContractorStats;
  workflow: WorkflowView | null;
}

// --- Tenders ---------------------------------------------------------------

export interface BoqItem {
  id: number;
  slNo: number;
  itemCode: string | null;
  description: string;
  uom: string;
  quantity: number;
  estimatedRate: number;
  estimatedAmount: number;
  /** The Schedule of Rates line this item was priced from, where there is one. */
  sr: { id: number | null; code: string | null; name: string | null; rate: number } | null;
  /** The most a bid may quote against this line. Null when no ceiling applies. */
  ceilingRate: number | null;
}

/** How a bid answered one published qualification criterion. */
export interface BidCriterionResponse {
  criterionId: number;
  kind: 'PQ' | 'TQ';
  slNo: number;
  title: string;
  requirement: string;
  isMandatory: boolean;
  maxScore: number;
  isMet: boolean;
  score: number;
  remarks: string | null;
}

export interface TenderCriterion {
  id: number;
  kind: 'PQ' | 'TQ';
  slNo: number;
  title: string;
  requirement: string;
  evidence: string | null;
  isMandatory: boolean;
  maxScore: number;
}

export const ABOVE_SR_GROUNDS = [
  'WAR',
  'PANDEMIC',
  'PRICE_ESCALATION',
  'NATURAL_CALAMITY',
  'OTHER',
] as const;

export type AboveSrGround = (typeof ABOVE_SR_GROUNDS)[number];

export const ABOVE_SR_GROUND_LABELS: Record<AboveSrGround, string> = {
  WAR: 'War or armed conflict',
  PANDEMIC: 'Pandemic',
  PRICE_ESCALATION: 'Market price escalation since the SR edition',
  NATURAL_CALAMITY: 'Natural calamity',
  OTHER: 'Other special consideration',
};

/**
 * The bidding ceiling. A contractor may quote below the approved government
 * rates but not above them, unless the department has granted relief — and then
 * only as far as that relief allows.
 */
export interface SrCeiling {
  enforced: boolean;
  baselineAmount: number;
  effectiveAmount: number;
  relief: {
    capPercent: number;
    ground: AboveSrGround | null;
    groundLabel: string | null;
    authority: string | null;
    remarks: string | null;
    grantedBy: string | null;
    grantedAt: string | null;
  } | null;
}

export interface Bid {
  id: number;
  bidNo: string;
  tenderId: number;
  tenderNo: string;
  tenderTitle: string;
  tenderStatus: string;
  contractor: { id: number; code: string; name: string; registrationClass: string | null };
  emdReference: string | null;
  emdPaid: number;
  technicalScore: number | null;
  technicalStatus: string;
  technicalRemarks: string | null;
  financialStatus: string;
  rank: number | null;
  status: string;
  submittedAt: string | null;
  quotedAmount: number | null;
  variation: number | null;
  /** How the bid sat against the approved rates, rather than against the estimate. */
  srVariation: number | null;
  srCeilingAmount: number | null;
  isAboveSr: boolean;
  financialsSealed: boolean;
  criteria: BidCriterionResponse[];
}

export interface Tender {
  id: number;
  tenderNo: string;
  title: string;
  description: string | null;
  project: { id: number; code: string; name: string };
  packageId: number | null;
  packageCode: string | null;
  division: { id: number; code: string; name: string };
  tenderType: string;
  bidType: string;
  estimatedValue: number;
  emdAmount: number;
  tenderFee: number;
  completionPeriodDays: number;
  minRegistrationClass: string | null;
  eligibilityCriteria: string | null;
  srCeiling: SrCeiling;
  /** Set when the tender was raised from a Detailed Project Report. */
  dpr: { id: number; dprNo: string | null; version: number | null } | null;
  publishDate: string | null;
  bidStartAt: string | null;
  bidEndAt: string | null;
  technicalOpenAt: string | null;
  financialOpenAt: string | null;
  status: string;
  workflowInstanceId: number | null;
  bidCount: number;
  submittedBidCount: number;
  isBiddingOpen: boolean;
  createdBy: string | null;
  createdAt: string;
}

export interface TenderDetail extends Tender {
  boqItems: BoqItem[];
  criteria: { pq: TenderCriterion[]; tq: TenderCriterion[]; tqMaxScore: number };
  bids: Bid[];
  award: {
    id: number;
    loaNo: string;
    loaDate: string;
    awardedValue: number;
    negotiatedValue: number | null;
    contractor: { id: number; code: string; name: string };
    awardedBy: string | null;
    remarks: string | null;
  } | null;
  workflow: WorkflowView | null;
}

// --- Agreement BOQ ---------------------------------------------------------

export interface BoqSrLink {
  id: number | null;
  code: string | null;
  name: string | null;
  rate: number;
  /** How far the agreed rate sits above or below the Schedule of Rates. */
  variancePercent: number;
  varianceAmount: number;
}

export interface PackageBoqItem {
  id: number;
  slNo: number;
  itemCode: string | null;
  description: string;
  uom: string;
  quantity: number;
  agreedRate: number;
  amount: number;
  sr: BoqSrLink | null;
  billedQuantity: number;
  billedAmount: number;
  balanceQuantity: number;
  billedPercent: number;
  isFullyBilled: boolean;
  remarks: string | null;
}

export interface PackageBoq {
  packageId: number;
  items: PackageBoqItem[];
  totals: {
    itemCount: number;
    boqValue: number;
    srValue: number;
    billedValue: number;
    balanceValue: number;
    variancePercent: number | null;
  };
}

// --- Noting sheet, sanctions and DPR ---------------------------------------

export interface FileNote {
  id: number;
  noteNo: number;
  entityType: string;
  entityId: number;
  authorId: number | null;
  authorName: string | null;
  authorRole: string | null;
  body: string;
  isInternal: boolean;
  document: { id: number; name: string | null } | null;
  createdAt: string;
}

export type SanctionKind =
  | 'ADMINISTRATIVE' | 'REVISED_ADMINISTRATIVE'
  | 'TECHNICAL' | 'REVISED_TECHNICAL' | 'EXPENDITURE';

export interface ProjectSanction {
  id: number;
  projectId: number;
  kind: SanctionKind;
  kindLabel: string;
  referenceNo: string;
  sanctionDate: string;
  amount: number;
  authority: string;
  designation: string | null;
  remarks: string | null;
  document: { id: number; name: string | null } | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface ProjectSanctions {
  items: ProjectSanction[];
  summary: {
    administrative: ProjectSanction | null;
    technical: ProjectSanction | null;
    hasAdministrative: boolean;
    hasTechnical: boolean;
  };
}

export interface ProjectDpr {
  id: number;
  projectId: number;
  dprNo: string;
  version: number;
  title: string;
  preparedBy: string | null;
  consultant: string | null;
  estimatedCost: number;
  submissionDate: string | null;
  scope: string | null;
  justification: string | null;
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'RETURNED';
  approvedBy: string | null;
  approvalDate: string | null;
  remarks: string | null;
  document: { id: number; name: string | null } | null;
  /** The abstract of cost, as it appears at the foot of the estimate. */
  abstract: DprAbstract;
  /** Set once the report has been converted into a tender document. */
  tender: { id: number; tenderNo: string | null; status: string | null } | null;
  createdBy: string | null;
  createdAt: string;
}

export interface DprAbstract {
  srEdition: string | null;
  itemCount: number;
  itemsTotal: number;
  contingencyPercent: number;
  contingencyAmount: number;
  establishmentPercent: number;
  establishmentAmount: number;
  total: number;
  /** True once the report is a priced estimate rather than a single figure. */
  isPriced: boolean;
}

/**
 * One line of the item-wise estimate a report is prepared from. A line priced
 * from the Schedule of Rates carries the rate it was frozen at, and whether the
 * rate book has moved since.
 */
export interface DprItem {
  id: number;
  slNo: number;
  itemCode: string | null;
  description: string;
  uom: string;
  quantity: number;
  rate: number;
  amount: number;
  remarks: string | null;
  sr: {
    id: number | null;
    code: string | null;
    name: string | null;
    rate: number;
    currentRate: number | null;
    hasMoved: boolean;
    variancePercent: number;
  } | null;
}

export interface DprEstimate {
  dprId: number;
  items: DprItem[];
  abstract: DprAbstract;
  /** Lines whose Schedule of Rates entry has been revised since pricing. */
  staleLineCount: number;
}

// --- Reports and MIS -------------------------------------------------------

export interface ReportDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
}

export interface ReportCatalogue {
  reports: ReportDefinition[];
  financialYear: string;
  divisions: { id: number; code: string; name: string }[];
  changeKinds: readonly string[];
  ageingBuckets: { key: string; label: string }[];
}

/** How one column of a report should be read: as money, a percentage, a date. */
export interface ReportColumn {
  key: string;
  label: string;
  numeric?: boolean;
  money?: boolean;
  percent?: boolean;
  date?: boolean;
}

export type ReportRow = Record<string, unknown>;

export interface ReportResult {
  key: string;
  label: string;
  description: string;
  generatedAt: string;
  filters: Record<string, string | number | null>;
  columns: ReportColumn[];
  items: ReportRow[];
  totals: Record<string, number | null>;
  /** Present only on the reports that carry a secondary table. */
  buckets?: { key: string; label: string; count: number; amount: number }[];
  lines?: ReportRow[];
  chapters?: ReportRow[];
  turnaround?: ReportRow[];
  officers?: ReportRow[];
}

/** One movement of a Schedule of Rates line. */
export interface SrHistoryEntry {
  id: number;
  srItemId: number | null;
  code: string;
  name: string;
  chapter: string | null;
  uom: string | null;
  changeKind: string;
  oldRate: number | null;
  newRate: number | null;
  changeAmount: number | null;
  changePercent: number | null;
  oldSrYear: string | null;
  newSrYear: string | null;
  oldStatus: string | null;
  newStatus: string | null;
  effectiveDate: string | null;
  govtReference: string | null;
  remarks: string | null;
  changedBy: string | null;
  changedAt: string;
}

// --- Casework: land acquisition ---------------------------------------------

export const LAND_TYPES = [
  'AGRICULTURAL', 'RESIDENTIAL', 'COMMERCIAL', 'INDUSTRIAL', 'GOVERNMENT', 'FOREST',
] as const;

export type LandType = (typeof LAND_TYPES)[number];

/** The stages of the 2013 Act, in the order a parcel must pass through them. */
export const LAND_STAGES = [
  { key: 'NOTIFIED', label: 'Preliminary notification', section: 'Section 11' },
  { key: 'DECLARED', label: 'Declaration', section: 'Section 19' },
  { key: 'AWARDED', label: 'Award', section: 'Section 23' },
  { key: 'POSSESSED', label: 'Possession taken', section: '' },
] as const;

export interface LandParcel {
  id: number;
  parcelNo: string;
  project: { id: number; code: string; name: string };
  packageId: number | null;
  packageCode: string | null;
  division: { id: number; code: string; name: string };
  district: string | null;
  village: string;
  surveyNo: string;
  khataNo: string | null;
  landType: LandType;
  areaSqm: number;
  areaAcres: number;
  owner: { name: string; address: string | null; contact: string | null };
  stages: {
    notification: { no: string | null; date: string | null };
    declaration: { no: string | null; date: string | null };
    award: { no: string | null; date: string | null };
    possessionDate: string | null;
  };
  compensation: {
    marketValue: number;
    solatium: number;
    interest: number;
    other: number;
    total: number;
    paid: number;
    balance: number;
    isFullyPaid: boolean;
    paymentCount: number;
  };
  status: string;
  openCaseCount: number;
  remarks: string | null;
  document: { id: number; name: string | null } | null;
  workflowInstanceId: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LandPayment {
  id: number;
  paymentDate: string;
  amount: number;
  mode: string;
  referenceNo: string | null;
  payeeName: string;
  remarks: string | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface LandParcelDetail extends LandParcel {
  payments: LandPayment[];
  workflow: WorkflowView | null;
}

// --- Casework: court cases ---------------------------------------------------

export const COURT_TYPES = [
  'SUPREME_COURT', 'HIGH_COURT', 'DISTRICT_COURT', 'TRIBUNAL', 'LOK_ADALAT', 'ARBITRATION',
] as const;

export const CASE_TYPES = [
  'WRIT', 'CIVIL', 'ARBITRATION', 'CONTEMPT', 'LAND_ACQUISITION', 'SERVICE', 'OTHER',
] as const;

export const CASE_OUTCOMES = [
  'IN_FAVOUR', 'AGAINST', 'PARTLY_IN_FAVOUR', 'SETTLED', 'WITHDRAWN',
] as const;

export interface CourtCase {
  id: number;
  caseNo: string;
  internalRef: string | null;
  court: { name: string; type: string };
  caseType: string;
  filedBy: 'BY_DEPARTMENT' | 'AGAINST_DEPARTMENT';
  isRespondent: boolean;
  petitioner: string;
  respondent: string;
  subject: string;
  filingDate: string;
  division: { id: number; code: string | null; name: string | null } | null;
  project: { id: number; code: string | null; name: string | null } | null;
  packageCode: string | null;
  parcel: { id: number; parcelNo: string | null } | null;
  contractor: { id: number; name: string | null } | null;
  claimAmount: number;
  decreeAmount: number;
  advocate: { name: string | null; fee: number };
  dealingOfficer: { id: number; name: string | null } | null;
  nextHearingDate: string | null;
  isListedToday: boolean;
  isHearingMissed: boolean;
  status: string;
  outcome: string | null;
  disposalDate: string | null;
  isClosed: boolean;
  hearingCount: number;
  lastHearingDate: string | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CourtHearing {
  id: number;
  hearingDate: string;
  purpose: string | null;
  appearedBy: string | null;
  proceedings: string | null;
  orderSummary: string | null;
  nextDate: string | null;
  document: { id: number; name: string | null } | null;
  recordedBy: string | null;
  createdAt: string;
}

export interface CourtCaseDetail extends CourtCase {
  hearings: CourtHearing[];
}

// --- Casework: committees and meetings ---------------------------------------

export const COMMITTEE_KINDS = [
  'TENDER', 'TECHNICAL', 'PURCHASE', 'GRIEVANCE', 'BOARD', 'REVIEW', 'OTHER',
] as const;

export const MEMBER_ROLES = [
  'CHAIRPERSON', 'MEMBER_SECRETARY', 'MEMBER', 'SPECIAL_INVITEE',
] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

export interface Committee {
  id: number;
  code: string;
  name: string;
  kind: string;
  purpose: string | null;
  division: { id: number; code: string | null; name: string | null } | null;
  quorum: number;
  status: string;
  memberCount: number;
  meetingCount: number;
  lastMeetingAt: string | null;
  openActions: number;
  isQuorate: boolean;
  createdAt: string;
}

export interface CommitteeMember {
  userId: number;
  name: string;
  email: string;
  roleCode: string;
  memberRole: MemberRole;
  designation: string | null;
}

export interface Meeting {
  id: number;
  committee: { id: number; code: string; name: string; quorum: number };
  meetingNo: string;
  title: string;
  scheduledAt: string;
  venue: string | null;
  mode: string;
  agenda: string | null;
  status: string;
  heldAt: string | null;
  minutes: string | null;
  minutesBy: string | null;
  invitedCount: number;
  presentCount: number;
  hasQuorum: boolean;
  decisionCount: number;
  openActions: number;
  createdBy: string | null;
  createdAt: string;
}

export interface MeetingDecision {
  id: number;
  seq: number;
  subject: string;
  decision: string;
  actionBy: { id: number; name: string | null } | null;
  dueDate: string | null;
  status: 'OPEN' | 'DONE' | 'DROPPED';
  isOverdue: boolean;
  closedOn: string | null;
  closingNote: string | null;
}

export interface MeetingDetail extends Meeting {
  attendance: {
    userId: number;
    name: string;
    roleCode: string;
    memberRole: MemberRole | null;
    isPresent: boolean;
    remarks: string | null;
  }[];
  decisions: MeetingDecision[];
}

export interface CommitteeDetail extends Committee {
  members: CommitteeMember[];
  meetings: Meeting[];
}

export interface CommitteeAction {
  id: number;
  meetingId: number;
  meetingNo: string;
  meetingTitle: string;
  committeeName: string;
  subject: string;
  decision: string;
  dueDate: string | null;
  isOverdue: boolean;
}

// --- Casework: Right to Information ------------------------------------------

export const RTI_RECEIVED_VIA = [
  'ONLINE', 'RTI_PORTAL', 'POST', 'COUNTER', 'TRANSFERRED_IN',
] as const;

export interface RtiExemption {
  code: string;
  label: string;
}

export interface RtiRequest {
  id: number;
  requestNo: string;
  applicant: {
    name: string;
    address: string | null;
    email: string | null;
    phone: string | null;
    isBpl: boolean;
  };
  feePaid: number;
  receivedOn: string;
  receivedVia: string;
  subject: string;
  informationSought: string;
  isLifeOrLiberty: boolean;
  division: { id: number; code: string | null; name: string | null } | null;
  pio: { id: number; name: string | null } | null;
  dueDate: string;
  daysRemaining: number;
  isOpen: boolean;
  isOverdue: boolean;
  /** Section 20: ₹250 a day, to a ceiling of ₹25,000, on the officer personally. */
  penaltyExposure: number;
  status: string;
  replyDate: string | null;
  replySummary: string | null;
  daysTaken: number | null;
  wasLate: boolean;
  rejection: { section: string; label: string | null; ground: string | null } | null;
  transferredTo: string | null;
  appealCount: number;
  document: { id: number; name: string | null } | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RtiAppeal {
  id: number;
  appealNo: string;
  level: 'FIRST' | 'SECOND';
  filedOn: string;
  grounds: string;
  appellateAuthority: string | null;
  authority: { id: number; name: string | null } | null;
  dueDate: string;
  daysRemaining: number;
  isOverdue: boolean;
  status: string;
  decidedOn: string | null;
  decision: string | null;
  penaltyImposed: number;
  remarks: string | null;
}

export interface RtiRequestDetail extends RtiRequest {
  appeals: RtiAppeal[];
}

/** What an Information Commission asks a public authority for. */
export interface RtiCompliance {
  total: number;
  open: number;
  overdue: number;
  replied: number;
  rejected: number;
  onTime: number;
  late: number;
  appeals: number;
}

// --- Bills -----------------------------------------------------------------

export interface RaBillItem {
  id: number;
  /** The agreement BOQ line this measurement is against. */
  boqItemId: number | null;
  slNo: number;
  description: string;
  uom: string;
  quantityUptoDate: number;
  quantityPrevious: number;
  quantityPresent: number;
  rate: number;
  amount: number;
}

export interface RaBillDeduction {
  id: number;
  code: string;
  description: string;
  basis: string;
  rate: number;
  amount: number;
}

export interface RaBill {
  id: number;
  billNo: string;
  dbrNo: string | null;
  financialYear: string;
  raSequence: number;
  billType: string;
  project: { id: number; code: string; name: string };
  package: { id: number; code: string; name: string; awardedValue: number };
  contractor: { id: number; code: string; name: string };
  division: { id: number; code: string; name: string };
  periodFrom: string | null;
  periodTo: string | null;
  measurementBookNo: string | null;
  amounts: {
    contractorClaimAmount: number;
    previousPaidAmount: number;
    presentBillAmount: number;
    admissibleAmount: number;
    grossAmount: number;
    totalDeduction: number;
    netPayableAmount: number;
    netPayableInWords: string;
  };
  etp: {
    establishment: number; establishmentAmount: number;
    toolsPlant: number; toolsPlantAmount: number;
    contingency: number; contingencyAmount: number;
    totalPercent: number; totalAmount: number;
    basis: string;
  };
  projectExpenditure: {
    financialYear: string;
    uptoPreviousYear: number;
    duringYear: number;
    etpPercent: number;
    etpOnExpenditure: number;
    totalWithEtp: number;
  };
  items: RaBillItem[];
  deductions: RaBillDeduction[];
  /** Where the file is sitting, so a list can say so without being opened. */
  pendingWith: {
    step: string;
    role: string | null;
    officer: string | null;
    since: string | null;
    dueAt: string | null;
  } | null;
  noteCount: number;
  status: string;
  workflowInstanceId: number | null;
  tallyVoucherNo: string | null;
  eoffice: { fileNo: string | null; noteNo: string | null; remarks: string | null };
  paymentDate: string | null;
  paymentReference: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface RaBillDetail extends RaBill {
  workflow: WorkflowView | null;
}

export interface MiscBillItem {
  id: number;
  slNo: number;
  expenseDate: string;
  description: string;
  categoryCode: string;
  govtObjectHead: string | null;
  invoiceNo: string | null;
  gstin: string | null;
  amount: number;
  remarks: string | null;
}

export interface MiscBill {
  id: number;
  billNo: string;
  billCategory: 'PROJECT_EXPENSE' | 'REVENUE_EXPENSE' | 'REFUND';
  financialYear: string;
  project: { id: number; code: string | null; name: string | null } | null;
  division: { id: number; code: string; name: string };
  billDate: string;
  periodFrom: string | null;
  periodTo: string | null;
  siteId: string | null;
  payeeName: string;
  payeeType: string;
  contractor: { id: number; name: string | null } | null;
  submittedBy: string | null;
  submittedByDesignation: string | null;
  amounts: {
    grossAmount: number;
    totalDeduction: number;
    netPayableAmount: number;
    netPayableInWords: string;
  };
  refundReference: string | null;
  items: MiscBillItem[];
  status: string;
  workflowInstanceId: number | null;
  tallyVoucherNo: string | null;
  eoffice: { fileNo: string | null; noteNo: string | null; remarks: string | null };
  paymentDate: string | null;
  paymentReference: string | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MiscBillDetail extends MiscBill {
  workflow: WorkflowView | null;
}

// --- Funds -----------------------------------------------------------------

export interface FundRelease {
  id: number;
  releaseNo: string;
  scheme: { id: number; code: string; name: string };
  project: { id: number; code: string | null; name: string | null } | null;
  division: { id: number; code: string; name: string };
  financialYear: string;
  sanctionedAmount: number;
  releasedAmount: number;
  balanceAmount: number;
  releaseDate: string;
  referenceNo: string | null;
  remarks: string | null;
  status: string;
  createdBy: string | null;
  createdAt: string;
}

export interface LocRequest {
  id: number;
  locNo: string;
  division: { id: number; code: string; name: string };
  scheme: { id: number; name: string | null } | null;
  financialYear: string;
  requestDate: string;
  requestedAmount: number;
  approvedAmount: number;
  purpose: string | null;
  status: string;
  workflowInstanceId: number | null;
  approvalDate: string | null;
  remarks: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface LocRequestDetail extends LocRequest {
  workflow: WorkflowView | null;
}

// --- Dashboard -------------------------------------------------------------

export interface StaffDashboard {
  role: RoleCode;
  financialYear: string;
  cards: {
    projects: {
      total: number; inProgress: number; pendingSanction: number;
      completed: number; sanctionedValue: number;
    };
    raBills: {
      total: number; inApproval: number; paid: number;
      paidValue: number; pendingValue: number;
    };
    miscBills: { total: number; inApproval: number; paidValue: number; pendingValue: number };
    tenders: { total: number; published: number; underEvaluation: number; awarded: number };
    contractors: { total: number; pending: number; approved: number; blacklisted: number } | null;
    funds: { released: number; locApproved: number };
  };
  myApprovals: { total: number; byType: Record<string, number>; items: InboxItem[] };
  spendByScheme: {
    schemeCode: string; schemeName: string; projectCount: number;
    sanctioned: number; paid: number; utilisation: number;
  }[];
  billTrend: { month: string; billCount: number; amount: number; paidAmount: number }[];
  divisionPerformance: {
    divisionId: number; divisionCode: string; divisionName: string;
    projectCount: number; sanctioned: number; paid: number;
    billsInApproval: number; utilisation: number;
  }[];
  overdueApprovals: {
    role: string; roleName: string; entityType: string; count: number; amount: number;
  }[];
  recentActivity: {
    id: number; action: string; entityType: string | null; entityId: number | null;
    detail: string | null; createdAt: string; userName: string | null;
  }[];
}

export interface ContractorDashboard {
  role: 'CONTRACTOR';
  financialYear: string;
  registrationStatus: string;
  cards: {
    packages: { active: number; completed: number; awardedValue: number };
    bills: { submitted: number; paid: number; amountPaid: number; amountPending: number };
    bids: { total: number; awarded: number };
  };
  openTenders: {
    id: number; tenderNo: string; title: string;
    estimatedValue: number; emdAmount: number; bidEndAt: string | null;
  }[];
  myBids: {
    id: number; bidNo: string; tenderId: number; tenderNo: string; tenderTitle: string;
    quotedAmount: number; status: string; rank: number | null; submittedAt: string | null;
  }[];
  myPackages: {
    id: number; packageCode: string; name: string; projectName: string;
    awardedValue: number; physicalProgress: number; status: string;
  }[];
  myBills: {
    id: number; billNo: string; raSequence: number; packageName: string;
    netPayableAmount: number; status: string; createdAt: string;
  }[];
}

export type Dashboard = StaffDashboard | ContractorDashboard;

export function isContractorDashboard(d: Dashboard): d is ContractorDashboard {
  return d.role === 'CONTRACTOR';
}

// --- Files -----------------------------------------------------------------

export interface DocumentFolder {
  id: number;
  name: string;
  parentId: number | null;
  parentName: string | null;
  description: string | null;
  division: { id: number; name: string | null } | null;
  createdBy: string | null;
  documentCount: number;
  childCount: number;
  createdAt: string;
}

export type DocumentCategory =
  | 'GENERAL' | 'SANCTION' | 'AGREEMENT' | 'TENDER' | 'MEASUREMENT'
  | 'INVOICE' | 'PHOTOGRAPH' | 'DRAWING' | 'CORRESPONDENCE' | 'REPORT';

export interface StoredDocument {
  id: number;
  name: string;
  mimeType: string;
  extension: string;
  sizeBytes: number;
  checksum: string;
  folder: { id: number; name: string | null } | null;
  entityType: string | null;
  entityId: number | null;
  category: DocumentCategory;
  description: string | null;
  division: { id: number; name: string | null } | null;
  uploadedBy: string | null;
  uploadedById: number | null;
  downloadCount: number;
  /** Set only for a geotagged photograph, e.g. a site progress photo. */
  latitude: string | null;
  longitude: string | null;
  capturedAt: string | null;
  createdAt: string;
}

export interface DocumentStoreSummary {
  totalFiles: number;
  totalBytes: number;
  maxUploadBytes: number;
  acceptedTypes: string;
  categories: DocumentCategory[];
}

// --- Chat ------------------------------------------------------------------

export interface ChatMember {
  id: number;
  fullName: string;
  username: string;
  roleCode: RoleCode;
  designation: string | null;
  divisionName: string | null;
  isAdmin: boolean;
  isOnline: boolean;
  lastSeenAt: string | null;
}

export interface Conversation {
  id: number;
  kind: 'DIRECT' | 'GROUP';
  name: string;
  subtitle: string;
  topic: string | null;
  createdBy: string | null;
  createdById: number | null;
  memberCount: number;
  unreadCount: number;
  lastMessage: string | null;
  lastMessageSender: string | null;
  lastMessageAt: string | null;
  isOnline: boolean;
  members: ChatMember[];
  createdAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderId: number | null;
  senderName: string | null;
  senderRole: string | null;
  body: string;
  isDeleted: boolean;
  entityType: string | null;
  entityId: number | null;
  document: { id: number; name: string | null } | null;
  createdAt: string;
}

export interface ChatContact {
  id: number;
  fullName: string;
  username: string;
  roleCode: RoleCode;
  designation: string | null;
  divisionName: string | null;
  isOnline: boolean;
}

// --- Live activity ---------------------------------------------------------

export interface ActivityEntry {
  id: number;
  userId: number | null;
  username: string | null;
  fullName: string | null;
  roleCode: string | null;
  method: string;
  path: string;
  action: string | null;
  statusCode: number;
  durationMs: number;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
  latestId: number;
}

export interface OnlineUser {
  id: number;
  fullName: string;
  username: string;
  roleCode: RoleCode;
  designation: string | null;
  divisionName: string | null;
  lastSeenAt: string | null;
  requestsToday: number;
}

export interface ActivityOverview {
  requestsLastHour: number;
  errorsLastHour: number;
  writesLastHour: number;
  activeUsersLastHour: number;
  slowestMs: number;
  onlineNow: number;
  topUsers: { fullName: string; roleCode: string; requests: number }[];
}

// --- Notifications and audit ----------------------------------------------

export interface Notification {
  id: number;
  title: string;
  message: string;
  severity: 'INFO' | 'ACTION' | 'WARNING' | 'SUCCESS';
  entityType: string | null;
  entityId: number | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  userId: number | null;
  userName: string | null;
  action: string;
  entityType: string | null;
  entityId: number | null;
  detail: string | null;
  ipAddress: string | null;
  createdAt: string;
}
