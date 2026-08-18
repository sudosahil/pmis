import type { Request, Response } from 'express';
import type { z } from 'zod';
import * as recordService from '../services/record.service.js';
import * as boqService from '../services/boq.service.js';
import { created, noContent, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

// --- Agreement BOQ ---------------------------------------------------------

export function listBoq(req: Request, res: Response): void {
  ok(res, boqService.listForPackage(Number(req.params.id), requireUser(req)));
}

export function replaceBoq(req: Request, res: Response): void {
  ok(
    res,
    boqService.replaceForPackage(
      Number(req.params.id),
      req.body as z.infer<typeof boqService.replaceBoqSchema>,
      requireUser(req),
    ),
  );
}

export function removeBoqItem(req: Request, res: Response): void {
  boqService.removeItem(Number(req.params.itemId), requireUser(req));
  noContent(res);
}

// --- Noting sheet ----------------------------------------------------------

export function listNotes(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof recordService.noteQuerySchema>;
  ok(res, recordService.listNotes(query.entityType, query.entityId, requireUser(req)));
}

export function addNote(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof recordService.noteQuerySchema>;
  created(
    res,
    recordService.addNote(
      query.entityType,
      query.entityId,
      req.body as z.infer<typeof recordService.noteSchema>,
      requireUser(req),
    ),
  );
}

export function removeNote(req: Request, res: Response): void {
  recordService.removeNote(Number(req.params.id), requireUser(req));
  noContent(res);
}

// --- Sanctions -------------------------------------------------------------

export function listSanctions(req: Request, res: Response): void {
  ok(res, recordService.listSanctions(Number(req.params.id), requireUser(req)));
}

export function addSanction(req: Request, res: Response): void {
  created(
    res,
    recordService.addSanction(
      Number(req.params.id),
      req.body as z.infer<typeof recordService.sanctionSchema>,
      requireUser(req),
    ),
  );
}

export function updateSanction(req: Request, res: Response): void {
  ok(
    res,
    recordService.updateSanction(
      Number(req.params.sanctionId),
      req.body as z.infer<typeof recordService.sanctionSchema>,
      requireUser(req),
    ),
  );
}

export function removeSanction(req: Request, res: Response): void {
  recordService.removeSanction(Number(req.params.sanctionId), requireUser(req));
  noContent(res);
}

// --- DPR -------------------------------------------------------------------

export function listDprs(req: Request, res: Response): void {
  ok(res, recordService.listDprs(Number(req.params.id), requireUser(req)));
}

export function addDpr(req: Request, res: Response): void {
  created(
    res,
    recordService.addDpr(
      Number(req.params.id),
      req.body as z.infer<typeof recordService.dprSchema>,
      requireUser(req),
    ),
  );
}

export function updateDpr(req: Request, res: Response): void {
  ok(
    res,
    recordService.updateDpr(
      Number(req.params.dprId),
      req.body as z.infer<typeof recordService.dprSchema>,
      requireUser(req),
    ),
  );
}

export function decideDpr(req: Request, res: Response): void {
  ok(
    res,
    recordService.decideDpr(
      Number(req.params.dprId),
      req.body as z.infer<typeof recordService.dprDecisionSchema>,
      requireUser(req),
    ),
  );
}

export function removeDpr(req: Request, res: Response): void {
  recordService.removeDpr(Number(req.params.dprId), requireUser(req));
  noContent(res);
}
