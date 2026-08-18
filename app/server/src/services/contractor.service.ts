import crypto from 'node:crypto';
import { z } from 'zod';
import { ENTITY_TYPES, ROLES, WORKFLOWS } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as contractorModel from '../models/contractor.model.js';
import * as userModel from '../models/user.model.js';
import { insertNotification } from '../models/notification.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { hashPassword } from './auth.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import { generateContractorCode } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { fromBps, toBps } from '../utils/money.js';
import { GSTIN_REGEX, IFSC_REGEX, PAN_REGEX } from '../middleware/validate.js';

// --- Schemas ---------------------------------------------------------------

/** Mirrors the Contractor Registration Form supplied with the requirements. */
export const registrationSchema = z.object({
  name: z.string().trim().min(3, 'Enter the contractor or company name.').max(200),
  contractorType: z
    .enum(['Proprietorship', 'Partnership', 'Private Limited', 'Public Limited', 'LLP', 'Cooperative Society'])
    .optional(),
  registrationClass: z.enum(['Class A', 'Class B', 'Class C', 'Class D']).optional(),
  registrationNo: z.string().trim().max(60).optional(),
  eprocNo: z.string().trim().max(60).optional(),
  pan: z.string().trim().toUpperCase().regex(PAN_REGEX, 'Enter a valid 10-character PAN.'),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN.')
    .optional()
    .or(z.literal('')),
  contactPerson: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.'),
  phone: z.string().trim().regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a valid mobile number.'),
  building: z.string().trim().max(120).optional(),
  street: z.string().trim().max(120).optional(),
  area: z.string().trim().max(120).optional(),
  city: z.string().trim().min(1, 'Enter the city.').max(80),
  state: z.string().trim().min(1, 'Enter the state.').max(80),
  country: z.string().trim().max(80).default('India'),
  zipCode: z.string().trim().regex(/^\d{6}$/, 'Enter a valid 6-digit PIN code.'),
  bankId: z.coerce.number().int().positive().optional(),
  bankBranch: z.string().trim().max(120).optional(),
  bankAccountNo: z.string().trim().regex(/^\d{6,20}$/, 'Enter a valid bank account number.').optional(),
  bankAccountType: z.enum(['Savings', 'Current', 'Cash Credit', 'Overdraft']).optional(),
  ifscCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(IFSC_REGEX, 'Enter a valid 11-character IFSC code.')
    .optional()
    .or(z.literal('')),
  validityDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const updateContractorSchema = registrationSchema.partial().extend({
  tdsRate: z.coerce.number().min(0).max(30).optional(),
  isBlacklisted: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  remarks: z.string().trim().max(500).optional(),
});

export type RegistrationInput = z.infer<typeof registrationSchema>;

// --- Presentation ----------------------------------------------------------

export function present(row: contractorModel.ContractorListRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    contractorType: row.contractor_type,
    registrationClass: row.registration_class,
    registrationNo: row.registration_no,
    eprocNo: row.eproc_no,
    pan: row.pan,
    gstin: row.gstin,
    contactPerson: row.contact_person,
    email: row.email,
    phone: row.phone,
    address: {
      building: row.building,
      street: row.street,
      area: row.area,
      city: row.city,
      state: row.state,
      country: row.country,
      zipCode: row.zip_code,
    },
    bank: {
      bankId: row.bank_id,
      bankName: row.bank_name,
      branch: row.bank_branch,
      accountNo: row.bank_account_no ? maskAccount(row.bank_account_no) : null,
      accountType: row.bank_account_type,
      ifscCode: row.ifsc_code,
    },
    tdsRate: fromBps(row.tds_rate_bps),
    isBlacklisted: Boolean(row.is_blacklisted),
    validityDate: row.validity_date,
    registrationStatus: row.registration_status,
    status: row.status,
    remarks: row.remarks,
    activePackages: row.active_packages,
    createdAt: row.created_at,
  };
}

/** Bank account numbers are shown masked outside the accounts cadre. */
function maskAccount(account: string): string {
  return account.length <= 4 ? account : `${'X'.repeat(account.length - 4)}${account.slice(-4)}`;
}

// --- Operations ------------------------------------------------------------

/**
 * Self-service registration from the contractor portal. Creates the vendor
 * record plus a login, and routes it for departmental verification. The account
 * stays inactive until the registration is approved.
 */
export function register(
  input: RegistrationInput,
  ip?: string,
): { contractorId: number; code: string; username: string; activationToken: string } {
  return transaction(() => {
    if (contractorModel.findByPan(input.pan)) {
      throw conflict('A contractor is already registered with this PAN.');
    }
    if (contractorModel.findByEmail(input.email)) {
      throw conflict('A contractor is already registered with this email address.');
    }
    if (userModel.findByLogin(input.email)) {
      throw conflict('An account already exists for this email address.');
    }

    const code = generateContractorCode();
    const contractorId = contractorModel.insertContractor({
      code,
      name: input.name,
      contractor_type: input.contractorType ?? null,
      registration_class: input.registrationClass ?? null,
      registration_no: input.registrationNo ?? null,
      eproc_no: input.eprocNo ?? null,
      pan: input.pan,
      gstin: input.gstin || null,
      contact_person: input.contactPerson ?? null,
      email: input.email,
      phone: input.phone,
      building: input.building ?? null,
      street: input.street ?? null,
      area: input.area ?? null,
      city: input.city,
      state: input.state,
      country: input.country,
      zip_code: input.zipCode,
      bank_id: input.bankId ?? null,
      bank_branch: input.bankBranch ?? null,
      bank_account_no: input.bankAccountNo ?? null,
      bank_account_type: input.bankAccountType ?? null,
      ifsc_code: input.ifscCode || null,
      validity_date: input.validityDate ?? null,
      registration_status: 'PENDING',
      status: 'ACTIVE',
    });

    // A one-time token stands in for the activation link the production system
    // would email; it is returned to the caller rather than logged.
    const activationToken = crypto.randomBytes(24).toString('hex');
    const userId = userModel.insertUser({
      username: input.email,
      email: input.email,
      passwordHash: hashPassword(activationToken),
      fullName: input.contactPerson || input.name,
      designation: 'Authorised Signatory',
      roleCode: ROLES.CONTRACTOR,
      phone: input.phone,
      contractorId,
      mustChangePassword: true,
    });
    userModel.updateUserFields(userId, { status: 'INACTIVE' });

    insertAuditEntry({
      userId: null,
      action: 'CONTRACTOR_REGISTERED',
      entityType: ENTITY_TYPES.CONTRACTOR,
      entityId: contractorId,
      detail: `${input.name} (${code}) submitted a registration`,
      ipAddress: ip,
    });

    // Verification runs through the standard workflow engine.
    const systemUser: AuthUser = {
      id: userId,
      username: input.email,
      fullName: input.name,
      email: input.email,
      roleCode: ROLES.CONTRACTOR,
      designation: null,
      zoneId: null,
      circleId: null,
      divisionId: null,
      subDivisionId: null,
      contractorId,
    };

    startWorkflow({
      definitionCode: WORKFLOWS.CONTRACTOR_REGISTRATION,
      entityType: ENTITY_TYPES.CONTRACTOR,
      entityId: contractorId,
      entityRef: code,
      title: `Contractor registration — ${input.name}`,
      amount: 0,
      divisionId: null,
      circleId: null,
      zoneId: null,
      initiator: systemUser,
      remarks: 'Submitted through the contractor portal.',
    });

    return { contractorId, code, username: input.email, activationToken };
  });
}

export function list(options: {
  search?: string;
  registrationStatus?: string;
  registrationClass?: string;
  blacklisted?: boolean;
  page: number;
  pageSize: number;
}) {
  const { rows, total } = contractorModel.listContractors({
    search: options.search,
    registrationStatus: options.registrationStatus,
    registrationClass: options.registrationClass,
    blacklisted: options.blacklisted,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

export function getOne(id: number, user: AuthUser) {
  const row = contractorModel.findById(id);
  if (!row) throw notFound('Contractor');
  if (user.roleCode === ROLES.CONTRACTOR && user.contractorId !== id) {
    throw forbidden('You can only view your own registration.');
  }
  return present(row);
}

export function update(id: number, payload: z.infer<typeof updateContractorSchema>, user: AuthUser) {
  const existing = contractorModel.findById(id);
  if (!existing) throw notFound('Contractor');

  if (user.roleCode === ROLES.CONTRACTOR) {
    if (user.contractorId !== id) throw forbidden('You can only update your own profile.');
    // A contractor may correct contact and bank details, never their standing.
    const restricted = ['isBlacklisted', 'status', 'tdsRate', 'registrationClass'] as const;
    for (const key of restricted) {
      if (payload[key] !== undefined) {
        throw forbidden(`"${key}" can only be changed by the department.`);
      }
    }
  }

  const values: Record<string, unknown> = {
    name: payload.name,
    contractor_type: payload.contractorType,
    registration_class: payload.registrationClass,
    registration_no: payload.registrationNo,
    eproc_no: payload.eprocNo,
    gstin: payload.gstin === '' ? null : payload.gstin,
    contact_person: payload.contactPerson,
    phone: payload.phone,
    building: payload.building,
    street: payload.street,
    area: payload.area,
    city: payload.city,
    state: payload.state,
    country: payload.country,
    zip_code: payload.zipCode,
    bank_id: payload.bankId,
    bank_branch: payload.bankBranch,
    bank_account_no: payload.bankAccountNo,
    bank_account_type: payload.bankAccountType,
    ifsc_code: payload.ifscCode === '' ? null : payload.ifscCode,
    validity_date: payload.validityDate,
    tds_rate_bps: payload.tdsRate === undefined ? undefined : toBps(payload.tdsRate),
    is_blacklisted: payload.isBlacklisted === undefined ? undefined : payload.isBlacklisted ? 1 : 0,
    status: payload.status,
    remarks: payload.remarks,
  };

  if (payload.pan && payload.pan !== existing.pan) {
    if (contractorModel.findByPan(payload.pan)) {
      throw conflict('Another contractor is already registered with this PAN.');
    }
    values.pan = payload.pan;
  }

  contractorModel.updateContractor(id, values);
  insertAuditEntry({
    userId: user.id,
    action: 'CONTRACTOR_UPDATED',
    entityType: ENTITY_TYPES.CONTRACTOR,
    entityId: id,
    detail: Object.keys(values)
      .filter((k) => values[k] !== undefined)
      .join(', '),
  });
  return present(contractorModel.findById(id)!);
}

export function setBlacklist(id: number, blacklisted: boolean, reason: string, user: AuthUser) {
  const existing = contractorModel.findById(id);
  if (!existing) throw notFound('Contractor');
  if (!reason.trim()) throw badRequest('A reason is required.');

  contractorModel.updateContractor(id, {
    is_blacklisted: blacklisted ? 1 : 0,
    remarks: reason,
  });

  const account = userModel.findSummaryByContractorId(id);
  if (account) {
    userModel.updateUserFields(account.id, { status: blacklisted ? 'INACTIVE' : 'ACTIVE' });
    insertNotification({
      userId: account.id,
      title: blacklisted ? 'Registration suspended' : 'Registration restored',
      message: reason,
      severity: blacklisted ? 'WARNING' : 'SUCCESS',
      entityType: ENTITY_TYPES.CONTRACTOR,
      entityId: id,
    });
  }

  insertAuditEntry({
    userId: user.id,
    action: blacklisted ? 'CONTRACTOR_BLACKLISTED' : 'CONTRACTOR_UNBLACKLISTED',
    entityType: ENTITY_TYPES.CONTRACTOR,
    entityId: id,
    detail: reason,
  });
  return present(contractorModel.findById(id)!);
}

export function stats(contractorId: number) {
  return contractorModel.getContractorStats(contractorId);
}

export function listEligible(minClass?: string | null) {
  return contractorModel.listEligible(minClass).map(present);
}

// --- Workflow completion ---------------------------------------------------

/**
 * When the verification workflow finishes, the vendor record and its login are
 * switched on (or the registration is closed as rejected).
 */
registerOutcomeHandler(ENTITY_TYPES.CONTRACTOR, ({ instance, status }) => {
  if (status === 'IN_PROGRESS') return;

  const contractorId = instance.entity_id;
  const account = userModel.findSummaryByContractorId(contractorId);

  if (status === 'APPROVED') {
    contractorModel.updateContractor(contractorId, { registration_status: 'APPROVED' });
    if (account) {
      userModel.updateUserFields(account.id, { status: 'ACTIVE' });
      insertNotification({
        userId: account.id,
        title: 'Registration approved',
        message:
          'Your registration has been approved. You can now sign in, view published tenders and submit bids.',
        severity: 'SUCCESS',
        entityType: ENTITY_TYPES.CONTRACTOR,
        entityId: contractorId,
        link: '/dashboard',
      });
    }
  } else {
    contractorModel.updateContractor(contractorId, { registration_status: 'REJECTED' });
    if (account) {
      userModel.updateUserFields(account.id, { status: 'INACTIVE' });
      insertNotification({
        userId: account.id,
        title: 'Registration not approved',
        message: 'Your registration was not approved. Contact the division office for details.',
        severity: 'WARNING',
        entityType: ENTITY_TYPES.CONTRACTOR,
        entityId: contractorId,
      });
    }
  }
});
