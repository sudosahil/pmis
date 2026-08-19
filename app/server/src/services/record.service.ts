import { z } from 'zod';
import { ROLES } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as recordModel from '../models/record.model.js';
import * as projectModel from '../models/project.model.js';
import * as packageModel from '../models/package.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { assertVisible as assertProjectVisible } from './project.service.js';
import { assertVisible as assertPackageVisible } from './package.service.js';
import * as documentService from './document.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';
import { toRupees } from '../utils/money.js';
import { isoDate, rupees } from '../middleware/validate.js';

/**
 * The paperwork a government file carries: the noting sheet officers write on
 * as it moves, the sanction orders that authorise the work, and the Detailed
 * Project Report they are granted against.
 */

export const NOTEABLE_ENTITIES = [
  'PROJECT', 'PACKAGE', 'TENDER', 'RA_BILL', 'MISC_BILL', 'CONTRACTOR', 'LOC',
] as const;

export const SANCTION_KINDS = [
  'ADMINISTRATIVE',
  'REVISED_ADMINISTRATIVE',
  'TECHNICAL',
  'REVISED_TECHNICAL',
  'EXPENDITURE',
] as const;

/** How each kind reads on screen, in the department's own words. */
export const SANCTION_LABELS: Record<string, string> = {
  ADMINISTRATIVE: 'Administrative Approval & Financial Sanction',
  REVISED_ADMINISTRATIVE: 'Revised Administrative Approval',
  TECHNICAL: 'Technical Sanction',
  REVISED_TECHNICAL: 'Revised Technical Sanction',
  EXPENDITURE: 'Expenditure Sanction',
};

// --- Schemas ---------------------------------------------------------------

export const noteSchema = z.object({
  body: z.string().trim().min(2, 'Write the note.').max(4000),
  isInternal: z.coerce.boolean().default(false),
  documentId: z.coerce.number().int().positive().optional(),
});

export const noteQuerySchema = z.object({
  entityType: z.enum(NOTEABLE_ENTITIES),
  entityId: z.coerce.number().int().positive(),
});

export const sanctionSchema = z.object({
  kind: z.enum(SANCTION_KINDS),
  referenceNo: z.string().trim().min(1, 'Enter the order number.').max(100),
  sanctionDate: isoDate,
  amount: rupees,
  authority: z.string().trim().min(2, 'Name the sanctioning authority.').max(160),
  designation: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
  documentId: z.coerce.number().int().positive().optional().nullable(),
});

export const dprSchema = z.object({
  dprNo: z.string().trim().min(1, 'Enter the DPR number.').max(60),
  title: z.string().trim().min(3, 'Give the report a title.').max(250),
  preparedBy: z.string().trim().max(160).optional(),
  consultant: z.string().trim().max(160).optional(),
  estimatedCost: rupees,
  submissionDate: isoDate.optional(),
  scope: z.string().trim().max(4000).optional(),
  justification: z.string().trim().max(4000).optional(),
  remarks: z.string().trim().max(1000).optional(),
  documentId: z.coerce.number().int().positive().optional().nullable(),
});

export const dprDecisionSchema = z.object({
  status: z.enum(['SUBMITTED', 'APPROVED', 'RETURNED']),
  approvedBy: z.string().trim().max(160).optional(),
  approvalDate: isoDate.optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export const progressUpdateSchema = z.object({
  updateDate: isoDate,
  physicalProgressPct: z.coerce.number().int().min(0).max(100).optional(),
  narrative: z.string().trim().min(3, 'Describe the work done since the last update.').max(4000),
});

export const progressReviewSchema = z
  .object({
    status: z.enum(['REVIEWED', 'RETURNED']),
    remarks: z.string().trim().max(1000).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === 'RETURNED' && !value.remarks) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['remarks'],
        message: 'Say what needs correcting before returning it.',
      });
    }
  });

export const progressPhotoMetaSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90, 'That does not look like a valid location.'),
  longitude: z.coerce.number().min(-180).max(180, 'That does not look like a valid location.'),
  capturedAt: z.string().trim().min(1, 'The capture time is required.').max(40),
  description: z.string().trim().max(500).optional(),
});

// --- Noting sheet ----------------------------------------------------------

function presentNote(row: recordModel.NoteRow) {
  return {
    id: row.id,
    noteNo: row.note_no,
    entityType: row.entity_type,
    entityId: row.entity_id,
    authorId: row.author_id,
    authorName: row.author_name,
    authorRole: row.author_role,
    body: row.body,
    isInternal: Boolean(row.is_internal),
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    createdAt: row.created_at,
  };
}

export function listNotes(entityType: string, entityId: number, user: AuthUser) {
  // A contractor reads the file's public notes only; internal noting stays inside.
  const includeInternal = user.roleCode !== ROLES.CONTRACTOR;
  return recordModel.listNotes(entityType, entityId, includeInternal).map(presentNote);
}

export function addNote(
  entityType: string,
  entityId: number,
  input: z.infer<typeof noteSchema>,
  user: AuthUser,
) {
  if (user.roleCode === ROLES.CONTRACTOR && input.isInternal) {
    throw forbidden('Contractors cannot write internal notes.');
  }

  return transaction(() => {
    const id = recordModel.insertNote({
      entity_type: entityType,
      entity_id: entityId,
      note_no: recordModel.nextNoteNo(entityType, entityId),
      author_id: user.id,
      author_name: user.fullName,
      author_role: user.designation ?? user.roleCode,
      body: input.body,
      is_internal: input.isInternal ? 1 : 0,
      document_id: input.documentId ?? null,
    });

    insertAuditEntry({
      userId: user.id,
      action: 'NOTE_ADDED',
      entityType,
      entityId,
      detail: input.body.length > 120 ? `${input.body.slice(0, 120)}…` : input.body,
    });

    return presentNote(recordModel.findNote(id)!);
  });
}

/**
 * A note is a record of what an officer said, so it is not editable. Only its
 * author may withdraw it, and only before anyone has written beneath it.
 */
export function removeNote(id: number, user: AuthUser): void {
  const note = recordModel.findNote(id);
  if (!note) throw notFound('Note');
  if (note.author_id !== user.id && user.roleCode !== ROLES.ADMIN) {
    throw forbidden('A note can only be withdrawn by the officer who wrote it.');
  }

  const latest = recordModel.nextNoteNo(note.entity_type, note.entity_id) - 1;
  if (note.note_no !== latest) {
    throw conflict(
      'Another officer has written below this note, so it can no longer be withdrawn. ' +
        'Add a further note correcting it instead.',
    );
  }

  recordModel.deleteNote(id);
  insertAuditEntry({
    userId: user.id,
    action: 'NOTE_WITHDRAWN',
    entityType: note.entity_type,
    entityId: note.entity_id,
    detail: `Note ${note.note_no} withdrawn`,
  });
}

// --- Sanctions -------------------------------------------------------------

function presentSanction(row: recordModel.SanctionRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    kind: row.kind,
    kindLabel: SANCTION_LABELS[row.kind] ?? row.kind,
    referenceNo: row.reference_no,
    sanctionDate: row.sanction_date,
    amount: toRupees(row.amount),
    authority: row.authority,
    designation: row.designation,
    remarks: row.remarks,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    recordedBy: row.recorded_by_name,
    createdAt: row.created_at,
  };
}

export function listSanctions(projectId: number, user: AuthUser) {
  const project = projectModel.findById(projectId);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  const rows = recordModel.listSanctions(projectId);
  const administrative = recordModel.latestSanction(projectId, 'ADMINISTRATIVE');
  const technical = recordModel.latestSanction(projectId, 'TECHNICAL');

  return {
    items: rows.map(presentSanction),
    /** What the project header shows: is this work actually authorised? */
    summary: {
      administrative: administrative ? presentSanction(administrative) : null,
      technical: technical ? presentSanction(technical) : null,
      hasAdministrative: Boolean(administrative),
      hasTechnical: Boolean(technical),
    },
  };
}

export function addSanction(
  projectId: number,
  input: z.infer<typeof sanctionSchema>,
  user: AuthUser,
) {
  const project = projectModel.findById(projectId);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  const id = recordModel.insertSanction({
    project_id: projectId,
    kind: input.kind,
    reference_no: input.referenceNo,
    sanction_date: input.sanctionDate,
    amount: input.amount,
    authority: input.authority,
    designation: input.designation ?? null,
    remarks: input.remarks ?? null,
    document_id: input.documentId ?? null,
    recorded_by: user.id,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'SANCTION_RECORDED',
    entityType: 'PROJECT',
    entityId: projectId,
    detail: `${SANCTION_LABELS[input.kind] ?? input.kind} ${input.referenceNo} for ₹${toRupees(input.amount)}`,
  });

  return presentSanction(recordModel.findSanction(id)!);
}

export function updateSanction(
  id: number,
  input: z.infer<typeof sanctionSchema>,
  user: AuthUser,
) {
  const existing = recordModel.findSanction(id);
  if (!existing) throw notFound('Sanction');
  const project = projectModel.findById(existing.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  recordModel.updateSanction(id, {
    kind: input.kind,
    reference_no: input.referenceNo,
    sanction_date: input.sanctionDate,
    amount: input.amount,
    authority: input.authority,
    designation: input.designation ?? null,
    remarks: input.remarks ?? null,
    document_id: input.documentId ?? null,
  });

  return presentSanction(recordModel.findSanction(id)!);
}

export function removeSanction(id: number, user: AuthUser): void {
  const existing = recordModel.findSanction(id);
  if (!existing) throw notFound('Sanction');
  const project = projectModel.findById(existing.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  recordModel.deleteSanction(id);
  insertAuditEntry({
    userId: user.id,
    action: 'SANCTION_DELETED',
    entityType: 'PROJECT',
    entityId: existing.project_id,
    detail: `${existing.kind} ${existing.reference_no}`,
  });
}

// --- DPR -------------------------------------------------------------------

function presentDpr(row: recordModel.DprRow) {
  return {
    id: row.id,
    projectId: row.project_id,
    dprNo: row.dpr_no,
    version: row.version,
    title: row.title,
    preparedBy: row.prepared_by,
    consultant: row.consultant,
    estimatedCost: toRupees(row.estimated_cost),
    submissionDate: row.submission_date,
    scope: row.scope,
    justification: row.justification,
    status: row.status,
    approvedBy: row.approved_by,
    approvalDate: row.approval_date,
    remarks: row.remarks,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
  };
}

export function listDprs(projectId: number, user: AuthUser) {
  const project = projectModel.findById(projectId);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);
  return recordModel.listDprs(projectId).map(presentDpr);
}

export function addDpr(projectId: number, input: z.infer<typeof dprSchema>, user: AuthUser) {
  const project = projectModel.findById(projectId);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  // A DPR number reappearing means a revision, not a duplicate.
  const version = recordModel.nextDprVersion(projectId, input.dprNo);

  const id = recordModel.insertDpr({
    project_id: projectId,
    dpr_no: input.dprNo,
    version,
    title: input.title,
    prepared_by: input.preparedBy ?? null,
    consultant: input.consultant ?? null,
    estimated_cost: input.estimatedCost,
    submission_date: input.submissionDate ?? null,
    scope: input.scope ?? null,
    justification: input.justification ?? null,
    status: 'DRAFT',
    remarks: input.remarks ?? null,
    document_id: input.documentId ?? null,
    created_by: user.id,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'DPR_CREATED',
    entityType: 'PROJECT',
    entityId: projectId,
    detail: `${input.dprNo} v${version} — ${input.title}`,
  });

  return presentDpr(recordModel.findDpr(id)!);
}

export function updateDpr(id: number, input: z.infer<typeof dprSchema>, user: AuthUser) {
  const existing = recordModel.findDpr(id);
  if (!existing) throw notFound('DPR');
  const project = projectModel.findById(existing.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  if (existing.status === 'APPROVED') {
    throw conflict(
      'An approved DPR is a record and cannot be edited. Add a revision instead — ' +
        'reusing the same DPR number creates the next version.',
    );
  }

  recordModel.updateDpr(id, {
    title: input.title,
    prepared_by: input.preparedBy ?? null,
    consultant: input.consultant ?? null,
    estimated_cost: input.estimatedCost,
    submission_date: input.submissionDate ?? null,
    scope: input.scope ?? null,
    justification: input.justification ?? null,
    remarks: input.remarks ?? null,
    document_id: input.documentId ?? null,
  });

  return presentDpr(recordModel.findDpr(id)!);
}

export function decideDpr(
  id: number,
  input: z.infer<typeof dprDecisionSchema>,
  user: AuthUser,
) {
  const existing = recordModel.findDpr(id);
  if (!existing) throw notFound('DPR');
  const project = projectModel.findById(existing.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  recordModel.updateDpr(id, {
    status: input.status,
    approved_by: input.approvedBy ?? user.fullName,
    approval_date: input.approvalDate ?? new Date().toISOString().slice(0, 10),
    remarks: input.remarks ?? existing.remarks,
  });

  insertAuditEntry({
    userId: user.id,
    action: `DPR_${input.status}`,
    entityType: 'PROJECT',
    entityId: existing.project_id,
    detail: `${existing.dpr_no} v${existing.version}`,
  });

  return presentDpr(recordModel.findDpr(id)!);
}

export function removeDpr(id: number, user: AuthUser): void {
  const existing = recordModel.findDpr(id);
  if (!existing) throw notFound('DPR');
  const project = projectModel.findById(existing.project_id);
  if (!project) throw notFound('Project');
  assertProjectVisible(project, user);

  if (existing.status === 'APPROVED') {
    throw conflict('An approved DPR cannot be deleted.');
  }
  recordModel.deleteDpr(id);
}

// --- Package progress updates ------------------------------------------------

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function presentProgressUpdate(row: recordModel.ProgressUpdateRow) {
  return {
    id: row.id,
    packageId: row.package_id,
    contractor: row.contractor_id ? { id: row.contractor_id, name: row.contractor_name } : null,
    updateDate: row.update_date,
    physicalProgress: row.physical_progress_pct,
    narrative: row.narrative,
    status: row.status,
    reviewRemarks: row.review_remarks,
    reviewedBy: row.reviewed_by_name,
    reviewedAt: row.reviewed_at,
    submittedBy: row.submitted_by_name,
    photoCount: row.photo_count,
    createdAt: row.created_at,
  };
}

function findPackageOrThrow(packageId: number, user: AuthUser): packageModel.PackageDetailRow {
  const pkg = packageModel.findById(packageId);
  if (!pkg) throw notFound('Package');
  assertPackageVisible(pkg, user);
  return pkg;
}

/** A contractor may only touch an update raised against their own package. */
function assertOwnUpdate(update: recordModel.ProgressUpdateRow, user: AuthUser): void {
  if (user.roleCode === ROLES.CONTRACTOR && update.submitted_by !== user.id) {
    throw forbidden('This progress update was not submitted by you.');
  }
}

export function listProgressUpdates(packageId: number, user: AuthUser) {
  findPackageOrThrow(packageId, user);
  return recordModel.listProgressUpdates(packageId).map(presentProgressUpdate);
}

export function addProgressUpdate(
  packageId: number,
  input: z.infer<typeof progressUpdateSchema>,
  user: AuthUser,
) {
  const pkg = findPackageOrThrow(packageId, user);

  if (user.roleCode === ROLES.CONTRACTOR && pkg.contractor_id !== user.contractorId) {
    throw forbidden('This package is not awarded to you.');
  }
  if (!['AWARDED', 'IN_PROGRESS', 'COMPLETED'].includes(pkg.status)) {
    throw conflict('Progress can only be logged once the package is awarded.');
  }

  const id = recordModel.insertProgressUpdate({
    package_id: packageId,
    contractor_id: pkg.contractor_id,
    update_date: input.updateDate,
    physical_progress_pct: input.physicalProgressPct ?? null,
    narrative: input.narrative,
    status: 'SUBMITTED',
    submitted_by: user.id,
  });

  insertAuditEntry({
    userId: user.id,
    action: 'PROGRESS_UPDATE_SUBMITTED',
    entityType: 'PACKAGE',
    entityId: packageId,
    detail: `Progress update for ${input.updateDate}${
      input.physicalProgressPct !== undefined ? ` — ${input.physicalProgressPct}% complete` : ''
    }`,
  });

  return presentProgressUpdate(recordModel.findProgressUpdate(id)!);
}

export function updateProgressUpdate(
  id: number,
  input: z.infer<typeof progressUpdateSchema>,
  user: AuthUser,
) {
  const existing = recordModel.findProgressUpdate(id);
  if (!existing) throw notFound('Progress update');
  findPackageOrThrow(existing.package_id, user);
  assertOwnUpdate(existing, user);

  if (existing.status === 'REVIEWED') {
    throw conflict('A reviewed update is a record and cannot be edited.');
  }

  // Correcting a returned update puts it back in front of the reviewer.
  recordModel.updateProgressUpdate(id, {
    update_date: input.updateDate,
    physical_progress_pct: input.physicalProgressPct ?? null,
    narrative: input.narrative,
    status: 'SUBMITTED',
    review_remarks: null,
    reviewed_by: null,
    reviewed_at: null,
  });

  return presentProgressUpdate(recordModel.findProgressUpdate(id)!);
}

export function reviewProgressUpdate(
  id: number,
  input: z.infer<typeof progressReviewSchema>,
  user: AuthUser,
) {
  const existing = recordModel.findProgressUpdate(id);
  if (!existing) throw notFound('Progress update');
  findPackageOrThrow(existing.package_id, user);

  if (existing.status !== 'SUBMITTED') {
    throw conflict('This update has already been decided.');
  }

  recordModel.updateProgressUpdate(id, {
    status: input.status,
    review_remarks: input.remarks ?? null,
    reviewed_by: user.id,
    reviewed_at: new Date().toISOString(),
  });

  insertAuditEntry({
    userId: user.id,
    action: `PROGRESS_UPDATE_${input.status}`,
    entityType: 'PACKAGE',
    entityId: existing.package_id,
    detail: `Progress update of ${existing.update_date} ${input.status.toLowerCase()}`,
  });

  return presentProgressUpdate(recordModel.findProgressUpdate(id)!);
}

export function removeProgressUpdate(id: number, user: AuthUser): void {
  const existing = recordModel.findProgressUpdate(id);
  if (!existing) throw notFound('Progress update');
  findPackageOrThrow(existing.package_id, user);
  assertOwnUpdate(existing, user);

  if (existing.status === 'REVIEWED') {
    throw conflict('A reviewed update cannot be deleted.');
  }
  recordModel.deleteProgressUpdate(id);
}

/**
 * Attaches a geotagged site photograph to a progress update. The file itself
 * goes through the same store as every other document; what is specific here
 * is that a photo is required to carry the location and time it was taken,
 * and that it may only be added while the update is still open for review.
 */
export function addProgressPhoto(
  updateId: number,
  file: UploadedFile,
  meta: z.infer<typeof progressPhotoMetaSchema>,
  user: AuthUser,
) {
  const existing = recordModel.findProgressUpdate(updateId);
  if (!existing) throw notFound('Progress update');
  const pkg = findPackageOrThrow(existing.package_id, user);
  assertOwnUpdate(existing, user);

  if (existing.status === 'REVIEWED') {
    throw conflict('This update has already been reviewed; photographs can no longer be attached.');
  }
  if (!file.mimetype.startsWith('image/')) {
    throw badRequest('Only photographs may be attached to a progress update.');
  }

  return documentService.upload(
    file,
    {
      entityType: 'PACKAGE_PROGRESS_UPDATE',
      entityId: updateId,
      category: 'PHOTOGRAPH',
      description: meta.description,
      latitude: meta.latitude,
      longitude: meta.longitude,
      capturedAt: meta.capturedAt,
    },
    user,
    pkg.division_id,
  );
}
