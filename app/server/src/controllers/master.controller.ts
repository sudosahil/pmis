import type { Request, Response } from 'express';
import { z } from 'zod';
import * as masterService from '../services/master.service.js';
import { insertAuditEntry } from '../models/audit.model.js';
import { created, noContent, ok } from '../utils/respond.js';

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
});

export const optionsQuerySchema = z.object({
  parentId: z.coerce.number().int().positive().optional(),
});

export function definitions(_req: Request, res: Response): void {
  ok(res, masterService.listDefinitions());
}

export function list(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;
  ok(res, masterService.list(req.params.key!, query));
}

export function options(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof optionsQuerySchema>;
  ok(res, masterService.options(req.params.key!, query.parentId));
}

export function getOne(req: Request, res: Response): void {
  ok(res, masterService.getOne(req.params.key!, Number(req.params.id)));
}

export function create(req: Request, res: Response): void {
  const key = req.params.key!;
  const record = masterService.create(key, req.body);
  insertAuditEntry({
    userId: req.user?.id,
    action: 'MASTER_CREATED',
    entityType: key.toUpperCase(),
    entityId: (record as { id: number }).id,
    detail: `${key}: ${(record as { code?: string }).code ?? ''}`,
    requestId: req.requestId,
  });
  created(res, record);
}

export function update(req: Request, res: Response): void {
  const key = req.params.key!;
  const id = Number(req.params.id);
  const record = masterService.update(key, id, req.body);
  insertAuditEntry({
    userId: req.user?.id,
    action: 'MASTER_UPDATED',
    entityType: key.toUpperCase(),
    entityId: id,
    detail: key,
    requestId: req.requestId,
  });
  ok(res, record);
}

export function remove(req: Request, res: Response): void {
  const key = req.params.key!;
  const id = Number(req.params.id);
  masterService.remove(key, id);
  insertAuditEntry({
    userId: req.user?.id,
    action: 'MASTER_DELETED',
    entityType: key.toUpperCase(),
    entityId: id,
    detail: key,
    requestId: req.requestId,
  });
  noContent(res);
}
