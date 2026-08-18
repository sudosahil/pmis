import { z } from 'zod';
import {
  BILL_STATUS,
  ENTITY_TYPES,
  MISC_BILL_CATEGORIES,
  ROLES,
  WORKFLOWS,
} from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as miscBillModel from '../models/misc-bill.model.js';
import * as projectModel from '../models/project.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import { registerOutcomeHandler, startWorkflow } from './workflow.service.js';
import type { AuthUser } from '../types/auth.js';
import { financialYear, generateMiscBillNo, generateTallyVoucherNo } from '../utils/codes.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { amountInWords, applyBps, fromBps, toRupees } from '../utils/money.js';
import { GSTIN_REGEX, isoDate, percent, rupees } from '../middleware/validate.js';

/** A GST invoice is mandatory above this value, per the submission guidelines. */
const GST_INVOICE_THRESHOLD_PAISE = 50_000;

export const miscBillItemSchema = z.object({
  slNo: z.coerce.number().int().min(1).optional(),
  expenseDate: isoDate,
  description: z
    .string()
    .trim()
    .min(5, 'Be specific — "Misc Expenses" is not accepted.')
    .max(300)
    .refine(
      (value) => !/^(misc|sundry|others?|general)\b/i.test(value.trim()),
      'Be specific: describe what was purchased, not "Misc" or "Sundry".',
    ),
  categoryCode: z.string().trim().min(1, 'Select an expense category.').max(40),
  invoiceNo: z.string().trim().max(60).optional(),
  gstin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN.')
    .optional()
    .or(z.literal('')),
  amount: rupees,
  remarks: z.string().trim().max(300).optional(),
});

export const createMiscBillSchema = z.object({
  billCategory: z.enum(MISC_BILL_CATEGORIES),
  projectId: z.coerce.number().int().positive().optional(),
  divisionId: z.coerce.number().int().positive().optional(),
  billDate: isoDate,
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  siteId: z.string().trim().max(40).optional(),
  payeeName: z.string().trim().min(2, 'Enter the payee name.').max(160),
  payeeType: z.enum(['STAFF', 'VENDOR', 'CONTRACTOR', 'OTHER']).default('STAFF'),
  contractorId: z.coerce.number().int().positive().optional(),
  submittedByDesignation: z.string().trim().max(120).optional(),
  refundReference: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
  items: z.array(miscBillItemSchema).min(1, 'Add at least one expense line.').max(100),
  deductionPercent: percent.optional(),
});

export const updateMiscBillSchema = createMiscBillSchema.partial().omit({ billCategory: true });

export const tallySchema = z.object({
  eofficeFileNo: z.string().trim().min(1, 'Enter the e-Office file number.').max(80),
  eofficeNoteNo: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export const paymentSchema = z.object({
  paymentDate: isoDate,
  paymentReference: z.string().trim().min(1, 'Enter the payment reference.').max(80),
});

export function present(row: miscBillModel.MiscBillDetailRow) {
  const items = miscBillModel.listItems(row.id);
  return {
    id: row.id,
    billNo: row.bill_no,
    billCategory: row.bill_category,
    financialYear: row.financial_year,
    project: row.project_id
      ? { id: row.project_id, code: row.project_code, name: row.project_name }
      : null,
    division: { id: row.division_id, code: row.division_code, name: row.division_name },
    billDate: row.bill_date,
    periodFrom: row.period_from,
    periodTo: row.period_to,
    siteId: row.site_id,
    payeeName: row.payee_name,
    payeeType: row.payee_type,
    contractor: row.contractor_id ? { id: row.contractor_id, name: row.contractor_name } : null,
    submittedBy: row.submitted_by_name,
    submittedByDesignation: row.submitted_by_designation,
    amounts: {
      grossAmount: toRupees(row.gross_amount),
      totalDeduction: toRupees(row.total_deduction),
      netPayableAmount: toRupees(row.net_payable_amount),
      netPayableInWords: row.amount_in_words ?? amountInWords(row.net_payable_amount),
    },
    refundReference: row.refund_reference,
    items: items.map((item) => ({
      id: item.id,
      slNo: item.sl_no,
      expenseDate: item.expense_date,
      description: item.description,
      categoryCode: item.category_code,
      govtObjectHead: item.govt_object_head,
      invoiceNo: item.invoice_no,
      gstin: item.gstin,
      amount: toRupees(item.amount),
      remarks: item.remarks,
    })),
    status: row.status,
    workflowInstanceId: row.workflow_instance_id,
    tallyVoucherNo: row.tally_voucher_no,
    eoffice: {
      fileNo: row.eoffice_file_no,
      noteNo: row.eoffice_note_no,
      remarks: row.eoffice_remarks,
    },
    paymentDate: row.payment_date,
    paymentReference: row.payment_reference,
    remarks: row.remarks,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

export function list(
  user: AuthUser,
  options: {
    search?: string;
    status?: string;
    billCategory?: string;
    projectId?: number;
    financialYear?: string;
    mineOnly?: boolean;
    page: number;
    pageSize: number;
  },
) {
  if (user.roleCode === ROLES.CONTRACTOR) {
    throw forbidden('Miscellaneous bills are an internal departmental record.');
  }
  const scope = scopeFilter(user);
  const { rows, total } = miscBillModel.listMiscBills({
    search: options.search,
    status: options.status,
    billCategory: options.billCategory,
    projectId: options.projectId,
    divisionId: scope.divisionId,
    circleId: scope.circleId,
    zoneId: scope.zoneId,
    financialYear: options.financialYear,
    submittedByUserId: options.mineOnly ? user.id : undefined,
    limit: options.pageSize,
    offset: (options.page - 1) * options.pageSize,
  });
  return { items: rows.map(present), total, page: options.page, pageSize: options.pageSize };
}

function assertVisible(row: miscBillModel.MiscBillDetailRow, user: AuthUser): void {
  if (user.roleCode === ROLES.CONTRACTOR) {
    throw forbidden('Miscellaneous bills are an internal departmental record.');
  }
  const scope = scopeFilter(user);
  if (scope.divisionId && row.division_id !== scope.divisionId) {
    throw forbidden('This bill belongs to another division.');
  }
}

export function getOne(id: number, user: AuthUser) {
  const row = miscBillModel.findById(id);
  if (!row) throw notFound('Miscellaneous bill');
  assertVisible(row, user);
  return present(row);
}

/**
 * Validates each expense line and resolves its government object head from the
 * expense category master, so the accounting classification is never typed in.
 */
function prepareItems(
  items: z.infer<typeof miscBillItemSchema>[],
  billCategory: string,
): { prepared: ReturnType<typeof buildItem>[]; gross: number } {
  let gross = 0;
  const prepared = items.map((item, index) => {
    const category = miscBillModel.findExpenseCategory(item.categoryCode);
    if (!category) {
      throw badRequest(`Line ${index + 1}: "${item.categoryCode}" is not a valid expense category.`);
    }
    if (category.bill_category !== billCategory) {
      throw badRequest(
        `Line ${index + 1}: "${category.name}" cannot be claimed under a ${billCategory.replace('_', ' ').toLowerCase()} bill.`,
      );
    }
    if (item.amount <= 0) throw badRequest(`Line ${index + 1}: enter an amount greater than zero.`);
    if (item.amount > GST_INVOICE_THRESHOLD_PAISE && !item.gstin) {
      throw badRequest(
        `Line ${index + 1}: a GST invoice is mandatory above ₹${toRupees(GST_INVOICE_THRESHOLD_PAISE)}. Enter the supplier GSTIN.`,
      );
    }
    gross += item.amount;
    return buildItem(item, category, index);
  });
  return { prepared, gross };
}

function buildItem(
  item: z.infer<typeof miscBillItemSchema>,
  category: { govt_object_head: string | null },
  index: number,
) {
  return {
    sl_no: item.slNo ?? index + 1,
    expense_date: item.expenseDate,
    description: item.description,
    category_code: item.categoryCode,
    govt_object_head: category.govt_object_head,
    invoice_no: item.invoiceNo ?? null,
    gstin: item.gstin || null,
    amount: item.amount,
    remarks: item.remarks ?? null,
  };
}

export function create(input: z.infer<typeof createMiscBillSchema>, user: AuthUser) {
  return transaction(() => {
    if (user.roleCode === ROLES.CONTRACTOR) {
      throw forbidden('Miscellaneous bills are raised by departmental staff.');
    }

    const divisionId = input.divisionId ?? user.divisionId;
    if (!divisionId) {
      throw badRequest('Select the division this expenditure belongs to.');
    }
    if (input.billCategory === 'PROJECT_EXPENSE' && !input.projectId) {
      throw badRequest('A project expense bill must be linked to a project.');
    }
    if (input.projectId && !projectModel.findById(input.projectId)) {
      throw badRequest('Select a valid project.');
    }
    if (input.billCategory === 'REFUND' && !input.refundReference) {
      throw badRequest('Enter the reference of the receipt being refunded.');
    }

    const { prepared, gross } = prepareItems(input.items, input.billCategory);
    const deduction = input.deductionPercent ? applyBps(gross, input.deductionPercent) : 0;
    const net = gross - deduction;

    const fy = financialYear(new Date(input.billDate));
    const divisionCode = getDivisionCode(divisionId);
    const billNo = generateMiscBillNo(divisionCode, input.billCategory, fy);

    const billId = miscBillModel.insertMiscBill({
      bill_no: billNo,
      bill_category: input.billCategory,
      financial_year: fy,
      project_id: input.projectId ?? null,
      division_id: divisionId,
      bill_date: input.billDate,
      period_from: input.periodFrom ?? null,
      period_to: input.periodTo ?? null,
      site_id: input.siteId ?? null,
      payee_name: input.payeeName,
      payee_type: input.payeeType,
      contractor_id: input.contractorId ?? null,
      submitted_by_user_id: user.id,
      submitted_by_designation: input.submittedByDesignation ?? user.designation,
      gross_amount: gross,
      total_deduction: deduction,
      net_payable_amount: net,
      amount_in_words: amountInWords(net),
      refund_reference: input.refundReference ?? null,
      remarks: input.remarks ?? null,
      status: BILL_STATUS.DRAFT,
      created_by: user.id,
    });

    miscBillModel.replaceItems(billId, prepared);

    insertAuditEntry({
      userId: user.id,
      action: 'MISC_BILL_CREATED',
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: billId,
      detail: `${billNo} for ₹${toRupees(net)}`,
    });

    return present(miscBillModel.findById(billId)!);
  });
}

function getDivisionCode(divisionId: number): string {
  const code = miscBillModel.findDivisionCode(divisionId);
  if (!code) throw badRequest('Select a valid division.');
  return code;
}

function assertEditable(bill: miscBillModel.MiscBillDetailRow): void {
  const editable: string[] = [BILL_STATUS.DRAFT, BILL_STATUS.RETURNED];
  if (!editable.includes(bill.status)) {
    throw conflict('This bill is in approval and can no longer be edited.');
  }
}

export function update(id: number, input: z.infer<typeof updateMiscBillSchema>, user: AuthUser) {
  return transaction(() => {
    const bill = miscBillModel.findById(id);
    if (!bill) throw notFound('Miscellaneous bill');
    assertVisible(bill, user);
    assertEditable(bill);

    let gross = bill.gross_amount;
    if (input.items) {
      const prepared = prepareItems(input.items, bill.bill_category);
      miscBillModel.replaceItems(id, prepared.prepared);
      gross = prepared.gross;
    }

    const deductionBps = input.deductionPercent;
    const deduction =
      deductionBps !== undefined
        ? applyBps(gross, deductionBps)
        : bill.gross_amount > 0
          ? Math.round((bill.total_deduction / bill.gross_amount) * gross)
          : 0;
    const net = gross - deduction;

    miscBillModel.updateMiscBill(id, {
      project_id: input.projectId,
      bill_date: input.billDate,
      period_from: input.periodFrom,
      period_to: input.periodTo,
      site_id: input.siteId,
      payee_name: input.payeeName,
      payee_type: input.payeeType,
      contractor_id: input.contractorId,
      submitted_by_designation: input.submittedByDesignation,
      refund_reference: input.refundReference,
      remarks: input.remarks,
      gross_amount: gross,
      total_deduction: deduction,
      net_payable_amount: net,
      amount_in_words: amountInWords(net),
    });

    insertAuditEntry({
      userId: user.id,
      action: 'MISC_BILL_UPDATED',
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: id,
      detail: bill.bill_no,
    });

    return present(miscBillModel.findById(id)!);
  });
}

export function remove(id: number, user: AuthUser): void {
  const bill = miscBillModel.findById(id);
  if (!bill) throw notFound('Miscellaneous bill');
  assertVisible(bill, user);
  if (bill.status !== BILL_STATUS.DRAFT) throw conflict('Only a draft bill can be deleted.');
  miscBillModel.deleteMiscBill(id);
  insertAuditEntry({
    userId: user.id,
    action: 'MISC_BILL_DELETED',
    entityType: ENTITY_TYPES.MISC_BILL,
    entityId: id,
    detail: bill.bill_no,
  });
}

export function submit(id: number, user: AuthUser, remarks?: string) {
  return transaction(() => {
    const bill = miscBillModel.findById(id);
    if (!bill) throw notFound('Miscellaneous bill');
    assertVisible(bill, user);
    assertEditable(bill);
    if (bill.net_payable_amount <= 0) throw badRequest('The bill amount must be greater than zero.');

    const instance = startWorkflow({
      definitionCode: WORKFLOWS.MISC_BILL,
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: id,
      entityRef: bill.bill_no,
      title: `${bill.bill_category.replace('_', ' ')} — ${bill.payee_name}`,
      amount: bill.net_payable_amount,
      divisionId: bill.division_id,
      circleId: bill.circle_id,
      zoneId: bill.zone_id,
      initiator: user,
      remarks: remarks ?? null,
    });

    miscBillModel.updateMiscBill(id, {
      status: BILL_STATUS.IN_APPROVAL,
      workflow_instance_id: instance.id,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'MISC_BILL_SUBMITTED',
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: id,
      detail: bill.bill_no,
    });

    return present(miscBillModel.findById(id)!);
  });
}

export function sendToTally(id: number, input: z.infer<typeof tallySchema>, user: AuthUser) {
  return transaction(() => {
    const bill = miscBillModel.findById(id);
    if (!bill) throw notFound('Miscellaneous bill');
    assertVisible(bill, user);
    if (bill.status !== BILL_STATUS.APPROVED) {
      throw conflict('Only a fully approved bill can be sent to Tally.');
    }
    if (bill.tally_voucher_no) throw conflict('This bill has already been sent to Tally.');

    const voucherNo = generateTallyVoucherNo(bill.division_code, bill.financial_year);
    miscBillModel.updateMiscBill(id, {
      status: BILL_STATUS.SENT_TO_TALLY,
      tally_voucher_no: voucherNo,
      eoffice_file_no: input.eofficeFileNo,
      eoffice_note_no: input.eofficeNoteNo ?? null,
      eoffice_remarks: input.remarks ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'MISC_BILL_SENT_TO_TALLY',
      entityType: ENTITY_TYPES.MISC_BILL,
      entityId: id,
      detail: `${bill.bill_no}, voucher ${voucherNo}`,
    });

    return present(miscBillModel.findById(id)!);
  });
}

export function recordPayment(id: number, input: z.infer<typeof paymentSchema>, user: AuthUser) {
  const bill = miscBillModel.findById(id);
  if (!bill) throw notFound('Miscellaneous bill');
  assertVisible(bill, user);
  if (bill.status !== BILL_STATUS.SENT_TO_TALLY) {
    throw conflict('Send the bill to Tally before recording payment.');
  }

  miscBillModel.updateMiscBill(id, {
    status: BILL_STATUS.PAID,
    payment_date: input.paymentDate,
    payment_reference: input.paymentReference,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'MISC_BILL_PAID',
    entityType: ENTITY_TYPES.MISC_BILL,
    entityId: id,
    detail: `${bill.bill_no} paid, reference ${input.paymentReference}`,
  });

  return present(miscBillModel.findById(id)!);
}

export function objectHeadSummary(user: AuthUser, fy?: string) {
  const scope = scopeFilter(user);
  const rows = miscBillModel.summariseByObjectHead(fy ?? financialYear(), scope.divisionId);
  return rows.map((row) => ({
    objectHead: row.objectHead,
    total: toRupees(row.total),
    billCount: row.billCount,
  }));
}

registerOutcomeHandler(ENTITY_TYPES.MISC_BILL, ({ instance, status, action }) => {
  const billId = instance.entity_id;
  if (status === 'APPROVED') {
    miscBillModel.updateMiscBill(billId, { status: BILL_STATUS.APPROVED });
  } else if (status === 'REJECTED') {
    miscBillModel.updateMiscBill(billId, { status: BILL_STATUS.REJECTED });
  } else if (status === 'CANCELLED') {
    miscBillModel.updateMiscBill(billId, { status: BILL_STATUS.DRAFT, workflow_instance_id: null });
  } else if (action === 'RETURN' && instance.current_step_id === null) {
    miscBillModel.updateMiscBill(billId, { status: BILL_STATUS.RETURNED });
  }
});

export { fromBps };
