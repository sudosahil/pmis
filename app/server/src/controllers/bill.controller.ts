import type { Request, Response } from 'express';
import { z } from 'zod';
import * as raBillService from '../services/ra-bill.service.js';
import * as miscBillService from '../services/misc-bill.service.js';
import * as workflowService from '../services/workflow.service.js';
import { ENTITY_TYPES, MISC_BILL_CATEGORIES } from '../config/constants.js';
import { created, noContent, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

export const raListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  packageId: z.coerce.number().int().positive().optional(),
  contractorId: z.coerce.number().int().positive().optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export const miscListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
  search: z.string().trim().max(120).optional(),
  status: z.string().trim().max(30).optional(),
  billCategory: z.enum(MISC_BILL_CATEGORIES).optional(),
  projectId: z.coerce.number().int().positive().optional(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  mineOnly: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const remarksSchema = z.object({
  remarks: z.string().trim().max(1000).optional(),
});

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

// --- RA bills --------------------------------------------------------------

export function listRa(req: Request, res: Response): void {
  ok(res, raBillService.list(requireUser(req), req.query as unknown as z.infer<typeof raListQuerySchema>));
}

export function getRa(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...raBillService.getOne(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.RA_BILL, id, user),
  });
}

export function createRa(req: Request, res: Response): void {
  created(
    res,
    raBillService.create(req.body as z.infer<typeof raBillService.createRaBillSchema>, requireUser(req)),
  );
}

export function updateRa(req: Request, res: Response): void {
  ok(
    res,
    raBillService.update(
      Number(req.params.id),
      req.body as z.infer<typeof raBillService.updateRaBillSchema>,
      requireUser(req),
    ),
  );
}

export function removeRa(req: Request, res: Response): void {
  raBillService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}

export function submitRa(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, raBillService.submit(Number(req.params.id), requireUser(req), body?.remarks));
}

export function certifyRa(req: Request, res: Response): void {
  ok(
    res,
    raBillService.certify(
      Number(req.params.id),
      req.body as z.infer<typeof raBillService.certifySchema>,
      requireUser(req),
    ),
  );
}

export function setRaDeductions(req: Request, res: Response): void {
  ok(
    res,
    raBillService.setDeductions(
      Number(req.params.id),
      req.body as z.infer<typeof raBillService.deductionsSchema>,
      requireUser(req),
    ),
  );
}

export function sendRaToTally(req: Request, res: Response): void {
  ok(
    res,
    raBillService.sendToTally(
      Number(req.params.id),
      req.body as z.infer<typeof raBillService.tallySchema>,
      requireUser(req),
    ),
  );
}

export function payRa(req: Request, res: Response): void {
  ok(
    res,
    raBillService.recordPayment(
      Number(req.params.id),
      req.body as z.infer<typeof raBillService.paymentSchema>,
      requireUser(req),
    ),
  );
}

// --- Miscellaneous bills ---------------------------------------------------

export function listMisc(req: Request, res: Response): void {
  ok(
    res,
    miscBillService.list(requireUser(req), req.query as unknown as z.infer<typeof miscListQuerySchema>),
  );
}

export function getMisc(req: Request, res: Response): void {
  const user = requireUser(req);
  const id = Number(req.params.id);
  ok(res, {
    ...miscBillService.getOne(id, user),
    workflow: workflowService.getWorkflowViewForEntity(ENTITY_TYPES.MISC_BILL, id, user),
  });
}

export function createMisc(req: Request, res: Response): void {
  created(
    res,
    miscBillService.create(
      req.body as z.infer<typeof miscBillService.createMiscBillSchema>,
      requireUser(req),
    ),
  );
}

export function updateMisc(req: Request, res: Response): void {
  ok(
    res,
    miscBillService.update(
      Number(req.params.id),
      req.body as z.infer<typeof miscBillService.updateMiscBillSchema>,
      requireUser(req),
    ),
  );
}

export function removeMisc(req: Request, res: Response): void {
  miscBillService.remove(Number(req.params.id), requireUser(req));
  noContent(res);
}

export function submitMisc(req: Request, res: Response): void {
  const body = req.body as z.infer<typeof remarksSchema>;
  ok(res, miscBillService.submit(Number(req.params.id), requireUser(req), body?.remarks));
}

export function sendMiscToTally(req: Request, res: Response): void {
  ok(
    res,
    miscBillService.sendToTally(
      Number(req.params.id),
      req.body as z.infer<typeof miscBillService.tallySchema>,
      requireUser(req),
    ),
  );
}

export function payMisc(req: Request, res: Response): void {
  ok(
    res,
    miscBillService.recordPayment(
      Number(req.params.id),
      req.body as z.infer<typeof miscBillService.paymentSchema>,
      requireUser(req),
    ),
  );
}

export function objectHeadSummary(req: Request, res: Response): void {
  const fy = (req.query as { financialYear?: string }).financialYear;
  ok(res, miscBillService.objectHeadSummary(requireUser(req), fy));
}
