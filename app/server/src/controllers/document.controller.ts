import type { Request, Response } from 'express';
import { z } from 'zod';
import * as documentService from '../services/document.service.js';
import { created, noContent, ok } from '../utils/respond.js';
import { badRequest, unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const folderQuerySchema = z.object({
  parentId: z.coerce.number().int().positive().optional(),
  all: z.enum(['true', 'false']).optional(),
});

export function listFolders(req: Request, res: Response): void {
  const user = requireUser(req);
  const query = req.query as unknown as z.infer<typeof folderQuerySchema>;
  if (query.all === 'true') {
    ok(res, documentService.listAllFolders(user));
    return;
  }
  ok(res, documentService.listFolders(user, query.parentId ?? null));
}

export function folderBreadcrumb(req: Request, res: Response): void {
  requireUser(req);
  ok(res, documentService.folderBreadcrumb(Number(req.params.id)));
}

export function createFolder(req: Request, res: Response): void {
  created(
    res,
    documentService.createFolder(
      req.body as z.infer<typeof documentService.folderSchema>,
      requireUser(req),
    ),
  );
}

export function updateFolder(req: Request, res: Response): void {
  ok(
    res,
    documentService.updateFolder(
      Number(req.params.id),
      req.body as z.infer<typeof documentService.updateFolderSchema>,
      requireUser(req),
    ),
  );
}

export function removeFolder(req: Request, res: Response): void {
  documentService.deleteFolder(Number(req.params.id), requireUser(req));
  noContent(res);
}

export function list(req: Request, res: Response): void {
  ok(
    res,
    documentService.list(
      requireUser(req),
      req.query as unknown as z.infer<typeof documentService.listQuerySchema>,
    ),
  );
}

export function getOne(req: Request, res: Response): void {
  ok(res, documentService.getOne(Number(req.params.id), requireUser(req)));
}

export function upload(req: Request, res: Response): void {
  const user = requireUser(req);
  if (!req.file) throw badRequest('Choose a file to upload.');

  // The metadata rides alongside the file as form fields, so it is parsed here
  // rather than by the shared validate() middleware.
  const parsed = documentService.uploadMetadataSchema.safeParse(req.body);
  if (!parsed.success) {
    const details: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      details[issue.path.join('.') || '_'] = issue.message;
    }
    throw badRequest('Some fields need attention.', details);
  }

  created(res, documentService.upload(req.file, parsed.data, user));
}

/** Streams the bytes back as an attachment, never inline. */
export function download(req: Request, res: Response): void {
  const file = documentService.openForDownload(Number(req.params.id), requireUser(req));

  // Content-Disposition attachment plus nosniff means a browser will save the
  // file rather than render it, so an uploaded HTML-ish file cannot execute.
  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${encodeURIComponent(file.name)}"`,
  );
  res.sendFile(file.path);
}

export function update(req: Request, res: Response): void {
  ok(
    res,
    documentService.update(
      Number(req.params.id),
      req.body as z.infer<typeof documentService.updateDocumentSchema>,
      requireUser(req),
    ),
  );
}

export function remove(req: Request, res: Response): void {
  documentService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}

export function summary(_req: Request, res: Response): void {
  ok(res, {
    ...documentService.summary(),
    maxUploadBytes: documentService.MAX_UPLOAD_BYTES,
    acceptedTypes: documentService.describeAcceptedTypes(),
    categories: documentService.DOCUMENT_CATEGORIES,
  });
}
