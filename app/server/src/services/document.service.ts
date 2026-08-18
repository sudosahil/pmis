import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { GLOBAL_SCOPE_ROLES, ROLES } from '../config/constants.js';
import { env } from '../config/env.js';
import { transaction } from '../db/index.js';
import * as documentModel from '../models/document.model.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { scopeFilter } from './project.service.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

/**
 * Files are stored on disk under a generated name and served back only through
 * this service. The name the user typed is metadata — it never touches a path.
 */
export const UPLOAD_ROOT = path.resolve(env.serverRoot, 'data', 'uploads');

/** 25 MB. Large enough for a scanned measurement book, small enough to be sane. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * An allow-list, not a deny-list. Anything the department actually files:
 * scans, drawings, spreadsheets and photographs. Nothing executable.
 */
const ALLOWED: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/tiff': ['.tif', '.tiff'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'text/plain': ['.txt'],
  'text/csv': ['.csv'],
  'application/zip': ['.zip'],
  'image/vnd.dwg': ['.dwg'],
  'application/acad': ['.dwg'],
};

export const DOCUMENT_CATEGORIES = [
  'GENERAL',
  'SANCTION',
  'AGREEMENT',
  'TENDER',
  'MEASUREMENT',
  'INVOICE',
  'PHOTOGRAPH',
  'DRAWING',
  'CORRESPONDENCE',
  'REPORT',
] as const;

export const ATTACHABLE_ENTITIES = [
  'PROJECT',
  'PACKAGE',
  'TENDER',
  'RA_BILL',
  'MISC_BILL',
  'CONTRACTOR',
  'LOC',
] as const;

// --- Schemas ---------------------------------------------------------------

export const folderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Name the folder.')
    .max(120)
    // Keeps the name usable as a label and unmistakable for a path.
    .regex(/^[^/\\:*?"<>|]+$/, 'A folder name cannot contain / \\ : * ? " < > or |'),
  parentId: z.coerce.number().int().positive().optional().nullable(),
  description: z.string().trim().max(500).optional(),
  divisionId: z.coerce.number().int().positive().optional().nullable(),
});

export const updateFolderSchema = folderSchema.partial().omit({ divisionId: true });

export const uploadMetadataSchema = z.object({
  folderId: z.coerce.number().int().positive().optional(),
  entityType: z.enum(ATTACHABLE_ENTITIES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  category: z.enum(DOCUMENT_CATEGORIES).default('GENERAL'),
  description: z.string().trim().max(500).optional(),
  name: z.string().trim().max(200).optional(),
});

export const updateDocumentSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  folderId: z.coerce.number().int().positive().optional().nullable(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(30),
  folderId: z.coerce.number().int().positive().optional(),
  root: z.enum(['true', 'false']).optional(),
  entityType: z.enum(ATTACHABLE_ENTITIES).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  search: z.string().trim().max(120).optional(),
});

// --- Upload validation -----------------------------------------------------

/** Called by multer before a byte is written. */
export function isAcceptedUpload(mimeType: string, originalName: string): boolean {
  const extension = path.extname(originalName).toLowerCase();
  const allowedExtensions = ALLOWED[mimeType];
  if (!allowedExtensions) return false;
  return allowedExtensions.includes(extension);
}

export function describeAcceptedTypes(): string {
  return [...new Set(Object.values(ALLOWED).flat())].sort().join(', ');
}

// --- Presentation ----------------------------------------------------------

export function presentFolder(row: documentModel.FolderRow) {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    parentName: row.parent_name,
    description: row.description,
    division: row.division_id ? { id: row.division_id, name: row.division_name } : null,
    createdBy: row.created_by_name,
    documentCount: row.document_count,
    childCount: row.child_count,
    createdAt: row.created_at,
  };
}

export function presentDocument(row: documentModel.DocumentRow) {
  return {
    id: row.id,
    name: row.name,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    checksum: row.checksum,
    folder: row.folder_id ? { id: row.folder_id, name: row.folder_name } : null,
    entityType: row.entity_type,
    entityId: row.entity_id,
    category: row.category,
    description: row.description,
    division: row.division_id ? { id: row.division_id, name: row.division_name } : null,
    uploadedBy: row.uploaded_by_name,
    uploadedById: row.uploaded_by,
    downloadCount: row.download_count,
    createdAt: row.created_at,
  };
}

// --- Access ----------------------------------------------------------------

function isHeadOffice(user: AuthUser): boolean {
  return GLOBAL_SCOPE_ROLES.includes(user.roleCode);
}

/**
 * A contractor sees only what is attached to their own records, which the
 * calling route establishes; staff see departmental files plus their own
 * division's. Head office sees everything.
 */
function assertVisible(row: { division_id: number | null }, user: AuthUser): void {
  if (isHeadOffice(user)) return;
  if (row.division_id === null) return;
  if (user.divisionId && row.division_id === user.divisionId) return;
  throw forbidden('This file belongs to another division.');
}

function divisionScope(user: AuthUser): number | undefined {
  if (isHeadOffice(user)) return undefined;
  return scopeFilter(user).divisionId;
}

// --- Folders ---------------------------------------------------------------

export function listFolders(user: AuthUser, parentId: number | null) {
  return documentModel.listFolders(parentId, divisionScope(user)).map(presentFolder);
}

export function listAllFolders(user: AuthUser) {
  return documentModel.listAllFolders(divisionScope(user)).map(presentFolder);
}

export function folderBreadcrumb(id: number) {
  return documentModel.folderPath(id);
}

export function createFolder(input: z.infer<typeof folderSchema>, user: AuthUser) {
  if (user.roleCode === ROLES.CONTRACTOR) {
    throw forbidden('Contractors cannot create folders.');
  }
  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = documentModel.findFolder(parentId);
    if (!parent) throw notFound('Parent folder');
    assertVisible(parent, user);
  }

  // A folder created by division staff belongs to that division unless head
  // office explicitly makes it departmental-wide.
  const divisionId = isHeadOffice(user)
    ? input.divisionId ?? null
    : user.divisionId ?? null;

  try {
    const id = documentModel.insertFolder({
      name: input.name,
      parent_id: parentId,
      description: input.description ?? null,
      division_id: divisionId,
      created_by: user.id,
    });
    insertAuditEntry({
      userId: user.id,
      action: 'FOLDER_CREATED',
      entityType: 'DOCUMENT_FOLDER',
      entityId: id,
      detail: input.name,
    });
    return presentFolder(documentModel.findFolder(id)!);
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) {
      throw conflict(`A folder called "${input.name}" already exists here.`);
    }
    throw error;
  }
}

export function updateFolder(
  id: number,
  input: z.infer<typeof updateFolderSchema>,
  user: AuthUser,
) {
  const folder = documentModel.findFolder(id);
  if (!folder) throw notFound('Folder');
  assertVisible(folder, user);
  if (user.roleCode === ROLES.CONTRACTOR) throw forbidden('Contractors cannot change folders.');

  if (input.parentId !== undefined && input.parentId !== null) {
    if (input.parentId === id) throw badRequest('A folder cannot be moved into itself.');
    if (documentModel.isDescendant(id, input.parentId)) {
      throw badRequest('A folder cannot be moved into one of its own sub-folders.');
    }
    const parent = documentModel.findFolder(input.parentId);
    if (!parent) throw notFound('Parent folder');
    assertVisible(parent, user);
  }

  documentModel.updateFolder(id, {
    name: input.name,
    description: input.description ?? undefined,
    parent_id: input.parentId,
  });
  return presentFolder(documentModel.findFolder(id)!);
}

export function deleteFolder(id: number, user: AuthUser): void {
  const folder = documentModel.findFolder(id);
  if (!folder) throw notFound('Folder');
  assertVisible(folder, user);
  if (user.roleCode === ROLES.CONTRACTOR) throw forbidden('Contractors cannot delete folders.');
  if (folder.document_count > 0 || folder.child_count > 0) {
    throw conflict('Empty the folder before deleting it.');
  }
  documentModel.deleteFolder(id);
  insertAuditEntry({
    userId: user.id,
    action: 'FOLDER_DELETED',
    entityType: 'DOCUMENT_FOLDER',
    entityId: id,
    detail: folder.name,
  });
}

// --- Documents -------------------------------------------------------------

export function list(user: AuthUser, query: z.infer<typeof listQuerySchema>) {
  const folderId =
    query.root === 'true' ? null : query.folderId !== undefined ? query.folderId : undefined;

  const { rows, total } = documentModel.listDocuments({
    folderId,
    entityType: query.entityType,
    entityId: query.entityId,
    category: query.category,
    search: query.search,
    divisionId: divisionScope(user),
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });

  return {
    items: rows.map(presentDocument),
    total,
    page: query.page,
    pageSize: query.pageSize,
  };
}

export function getOne(id: number, user: AuthUser) {
  const row = documentModel.findDocument(id);
  if (!row) throw notFound('File');
  assertVisible(row, user);
  return presentDocument(row);
}

interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Writes the bytes under a generated name, then records the row. Identical
 * bytes already filed in the same folder are rejected rather than duplicated,
 * which is what stops a clerk uploading the same scan four times.
 */
export function upload(
  file: UploadedFile,
  input: z.infer<typeof uploadMetadataSchema>,
  user: AuthUser,
) {
  if (!file) throw badRequest('Choose a file to upload.');
  if (file.size <= 0) throw badRequest('That file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw badRequest(`Files must be ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB or smaller.`);
  }
  if (!isAcceptedUpload(file.mimetype, file.originalname)) {
    throw badRequest(
      `That file type is not accepted. Allowed types: ${describeAcceptedTypes()}.`,
    );
  }

  const folderId = input.folderId ?? null;
  if (folderId) {
    const folder = documentModel.findFolder(folderId);
    if (!folder) throw notFound('Folder');
    assertVisible(folder, user);
  }

  const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex');
  const duplicate = documentModel.findByChecksum(checksum, folderId);
  if (duplicate) {
    throw conflict(`This file is already filed here as "${duplicate.name}".`);
  }

  const extension = path.extname(file.originalname).toLowerCase();
  // The stored name is ours: random, lower-case, and with a vetted extension.
  const storedName = `${crypto.randomUUID()}${extension}`;

  fs.mkdirSync(UPLOAD_ROOT, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_ROOT, storedName), file.buffer, { flag: 'wx' });

  try {
    return transaction(() => {
      const id = documentModel.insertDocument({
        name: input.name?.trim() || path.basename(file.originalname),
        stored_name: storedName,
        mime_type: file.mimetype,
        extension,
        size_bytes: file.size,
        checksum,
        folder_id: folderId,
        entity_type: input.entityType ?? null,
        entity_id: input.entityId ?? null,
        category: input.category,
        description: input.description ?? null,
        division_id: isHeadOffice(user) ? null : user.divisionId ?? null,
        uploaded_by: user.id,
      });

      insertAuditEntry({
        userId: user.id,
        action: 'DOCUMENT_UPLOADED',
        entityType: 'DOCUMENT',
        entityId: id,
        detail: `${input.name?.trim() || file.originalname} (${formatBytes(file.size)})`,
      });

      return presentDocument(documentModel.findDocument(id)!);
    });
  } catch (error) {
    // The row failed, so the orphaned bytes must not stay on disk.
    fs.rmSync(path.join(UPLOAD_ROOT, storedName), { force: true });
    throw error;
  }
}

/** Resolves the bytes for a download, after checking the caller may have them. */
export function openForDownload(id: number, user: AuthUser) {
  const row = documentModel.findDocument(id);
  if (!row) throw notFound('File');
  assertVisible(row, user);

  // Defence in depth: the stored name comes from our own generator, but the
  // resolved path is still checked to be inside the upload root.
  const absolute = path.resolve(UPLOAD_ROOT, row.stored_name);
  if (!absolute.startsWith(UPLOAD_ROOT + path.sep)) {
    throw forbidden('That file path is not valid.');
  }
  if (!fs.existsSync(absolute)) throw notFound('The stored file');

  documentModel.recordDownload(id);
  return { path: absolute, row: presentDocument(row), mimeType: row.mime_type, name: row.name };
}

export function update(id: number, input: z.infer<typeof updateDocumentSchema>, user: AuthUser) {
  const row = documentModel.findDocument(id);
  if (!row) throw notFound('File');
  assertVisible(row, user);
  assertMayModify(row, user);

  if (input.folderId) {
    const folder = documentModel.findFolder(input.folderId);
    if (!folder) throw notFound('Folder');
    assertVisible(folder, user);
  }

  documentModel.updateDocument(id, {
    name: input.name,
    description: input.description ?? undefined,
    folder_id: input.folderId,
    category: input.category,
  });
  return presentDocument(documentModel.findDocument(id)!);
}

export function remove(id: number, user: AuthUser): void {
  const row = documentModel.findDocument(id);
  if (!row) throw notFound('File');
  assertVisible(row, user);
  assertMayModify(row, user);

  documentModel.deleteDocument(id);
  // Only unlink the bytes once nothing else points at them.
  if (!documentModel.isStoredFileShared(row.stored_name, id)) {
    fs.rmSync(path.resolve(UPLOAD_ROOT, row.stored_name), { force: true });
  }

  insertAuditEntry({
    userId: user.id,
    action: 'DOCUMENT_DELETED',
    entityType: 'DOCUMENT',
    entityId: id,
    detail: row.name,
  });
}

/** The uploader, the administrative cadre and head office may change a file. */
function assertMayModify(row: documentModel.DocumentRow, user: AuthUser): void {
  if (row.uploaded_by === user.id) return;
  const managers: string[] = [ROLES.ADMIN, ROLES.CE, ROLES.SE, ROLES.EE, ROLES.CAO];
  if (managers.includes(user.roleCode)) return;
  throw forbidden('Only the person who uploaded this file, or a senior officer, may change it.');
}

export function summary() {
  return documentModel.storageSummary();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
