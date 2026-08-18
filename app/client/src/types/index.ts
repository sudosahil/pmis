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
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
  mustChangePassword: boolean;
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
  financialsSealed: boolean;
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

// --- Bills -----------------------------------------------------------------

export interface RaBillItem {
  id: number;
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
