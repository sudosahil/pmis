import { Router } from 'express';
import * as controller from '../controllers/chat.controller.js';
import * as chatService from '../services/chat.service.js';
import { authenticate } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate } from '../middleware/validate.js';

export const chatRouter = Router();
chatRouter.use(authenticate);

// Polled by the header for the unread pip, so it stays cheap and unlogged.
chatRouter.get('/unread', asyncHandler(controller.unread));

chatRouter.get(
  '/contacts',
  validate(controller.searchQuerySchema, 'query'),
  asyncHandler(controller.contacts),
);

chatRouter.get(
  '/',
  validate(controller.searchQuerySchema, 'query'),
  asyncHandler(controller.listConversations),
);
chatRouter.post(
  '/direct',
  validate(chatService.directChatSchema),
  asyncHandler(controller.openDirect),
);
chatRouter.post(
  '/groups',
  validate(chatService.groupChatSchema),
  asyncHandler(controller.createGroup),
);

chatRouter.get('/:id', asyncHandler(controller.getConversation));
chatRouter.patch(
  '/:id',
  validate(chatService.updateGroupSchema),
  asyncHandler(controller.updateGroup),
);
chatRouter.post(
  '/:id/members',
  validate(chatService.membersSchema),
  asyncHandler(controller.addMembers),
);
chatRouter.delete('/:id/members/:userId', asyncHandler(controller.removeMember));

chatRouter.get(
  '/:id/messages',
  validate(chatService.messageQuerySchema, 'query'),
  asyncHandler(controller.listMessages),
);
chatRouter.post(
  '/:id/messages',
  validate(chatService.messageSchema),
  asyncHandler(controller.sendMessage),
);
chatRouter.delete('/:id/messages/:messageId', asyncHandler(controller.deleteMessage));
chatRouter.post('/:id/read', asyncHandler(controller.markRead));
