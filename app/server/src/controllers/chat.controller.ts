import type { Request, Response } from 'express';
import { z } from 'zod';
import * as chatService from '../services/chat.service.js';
import { created, noContent, ok } from '../utils/respond.js';
import { unauthorized } from '../utils/errors.js';

function requireUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

export const searchQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});

export function listConversations(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof searchQuerySchema>;
  ok(res, chatService.listConversations(requireUser(req), query.search));
}

export function getConversation(req: Request, res: Response): void {
  ok(res, chatService.getConversation(Number(req.params.id), requireUser(req)));
}

export function openDirect(req: Request, res: Response): void {
  created(
    res,
    chatService.openDirect(
      req.body as z.infer<typeof chatService.directChatSchema>,
      requireUser(req),
    ),
  );
}

export function createGroup(req: Request, res: Response): void {
  created(
    res,
    chatService.createGroup(
      req.body as z.infer<typeof chatService.groupChatSchema>,
      requireUser(req),
    ),
  );
}

export function updateGroup(req: Request, res: Response): void {
  ok(
    res,
    chatService.updateGroup(
      Number(req.params.id),
      req.body as z.infer<typeof chatService.updateGroupSchema>,
      requireUser(req),
    ),
  );
}

export function addMembers(req: Request, res: Response): void {
  ok(
    res,
    chatService.addMembers(
      Number(req.params.id),
      req.body as z.infer<typeof chatService.membersSchema>,
      requireUser(req),
    ),
  );
}

export function removeMember(req: Request, res: Response): void {
  const result = chatService.removeMember(
    Number(req.params.id),
    Number(req.params.userId),
    requireUser(req),
  );
  if (!result) {
    noContent(res);
    return;
  }
  ok(res, result);
}

export function listMessages(req: Request, res: Response): void {
  ok(
    res,
    chatService.listMessages(
      Number(req.params.id),
      req.query as unknown as z.infer<typeof chatService.messageQuerySchema>,
      requireUser(req),
    ),
  );
}

export function sendMessage(req: Request, res: Response): void {
  created(
    res,
    chatService.sendMessage(
      Number(req.params.id),
      req.body as z.infer<typeof chatService.messageSchema>,
      requireUser(req),
    ),
  );
}

export function deleteMessage(req: Request, res: Response): void {
  ok(res, chatService.deleteMessage(Number(req.params.messageId), requireUser(req)));
}

export function markRead(req: Request, res: Response): void {
  chatService.markRead(Number(req.params.id), requireUser(req));
  ok(res, { message: 'Marked as read.' });
}

export function unread(req: Request, res: Response): void {
  ok(res, { unread: chatService.unreadCount(requireUser(req)) });
}

export function contacts(req: Request, res: Response): void {
  const query = req.query as unknown as z.infer<typeof searchQuerySchema>;
  ok(res, chatService.listContacts(requireUser(req), query.search));
}
