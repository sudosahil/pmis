import { z } from 'zod';
import { ROLES } from '../config/constants.js';
import { transaction } from '../db/index.js';
import * as chatModel from '../models/chat.model.js';
import * as userModel from '../models/user.model.js';
import { insertNotification } from '../models/notification.model.js';
import type { AuthUser } from '../types/auth.js';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors.js';

/** A member counts as online if the API has seen them in the last two minutes. */
const ONLINE_WINDOW_SECONDS = 120;

// --- Schemas ---------------------------------------------------------------

export const directChatSchema = z.object({
  userId: z.coerce.number().int().positive(),
});

export const groupChatSchema = z.object({
  name: z.string().trim().min(2, 'Name the group.').max(120),
  topic: z.string().trim().max(300).optional(),
  memberIds: z
    .array(z.coerce.number().int().positive())
    .min(1, 'Add at least one other member.')
    .max(100),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  topic: z.string().trim().max(300).optional().nullable(),
});

export const membersSchema = z.object({
  memberIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

export const messageSchema = z.object({
  body: z.string().trim().min(1, 'Write a message.').max(4000),
  entityType: z.string().trim().max(40).optional(),
  entityId: z.coerce.number().int().positive().optional(),
  documentId: z.coerce.number().int().positive().optional(),
});

export const messageQuerySchema = z.object({
  before: z.coerce.number().int().positive().optional(),
  after: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const contactQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
});

// --- Presentation ----------------------------------------------------------

function isOnline(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(`${lastSeenAt.replace(' ', 'T')}Z`).getTime();
  return Number.isFinite(seen) && Date.now() - seen < ONLINE_WINDOW_SECONDS * 1000;
}

function presentMember(row: chatModel.MemberRow) {
  return {
    id: row.user_id,
    fullName: row.full_name,
    username: row.username,
    roleCode: row.role_code,
    designation: row.designation,
    divisionName: row.division_name,
    isAdmin: Boolean(row.is_admin),
    isOnline: isOnline(row.last_seen_at),
    lastSeenAt: row.last_seen_at,
  };
}

function presentMessage(row: chatModel.MessageRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    senderName: row.sender_name,
    senderRole: row.sender_role,
    // A deleted message keeps its place in the thread but loses its content.
    body: row.deleted_at ? 'This message was deleted.' : row.body,
    isDeleted: Boolean(row.deleted_at),
    entityType: row.entity_type,
    entityId: row.entity_id,
    document: row.document_id ? { id: row.document_id, name: row.document_name } : null,
    createdAt: row.created_at,
  };
}

function present(row: chatModel.ConversationRow, viewerId: number) {
  const members = chatModel.listMembers(row.id).map(presentMember);
  // A direct chat is titled by the other person, not by a stored name.
  const other = row.kind === 'DIRECT' ? members.find((m) => m.id !== viewerId) : undefined;

  return {
    id: row.id,
    kind: row.kind as 'DIRECT' | 'GROUP',
    name: row.kind === 'DIRECT' ? other?.fullName ?? 'Direct message' : row.name ?? 'Group',
    subtitle:
      row.kind === 'DIRECT'
        ? [other?.designation ?? other?.roleCode, other?.divisionName].filter(Boolean).join(' · ')
        : row.topic ?? `${row.member_count} members`,
    topic: row.topic,
    createdBy: row.created_by_name,
    createdById: row.created_by,
    memberCount: row.member_count,
    unreadCount: row.unread_count,
    lastMessage: row.last_message_body,
    lastMessageSender: row.last_message_sender,
    lastMessageAt: row.last_message_at,
    isOnline: row.kind === 'DIRECT' ? Boolean(other?.isOnline) : false,
    members,
    createdAt: row.created_at,
  };
}

// --- Access ----------------------------------------------------------------

function assertMember(conversationId: number, user: AuthUser): void {
  if (!chatModel.isMember(conversationId, user.id)) {
    throw forbidden('You are not a member of this conversation.');
  }
}

/**
 * Contractors talk to the department, not to each other, so a contractor may
 * only be in a conversation that includes at least one member of staff.
 */
function assertContactAllowed(actor: AuthUser, targetId: number): void {
  const target = userModel.findSummaryById(targetId);
  if (!target) throw notFound('User');
  if (target.status !== 'ACTIVE') throw badRequest('That account is not active.');
  if (actor.roleCode === ROLES.CONTRACTOR && target.roleCode === ROLES.CONTRACTOR) {
    throw forbidden('Contractors can only message departmental staff.');
  }
}

// --- Conversations ---------------------------------------------------------

export function listConversations(user: AuthUser, search?: string) {
  return chatModel.listConversations(user.id, search).map((row) => present(row, user.id));
}

export function getConversation(id: number, user: AuthUser) {
  assertMember(id, user);
  const row = chatModel.findConversation(id, user.id);
  if (!row) throw notFound('Conversation');
  return present(row, user.id);
}

/** Opens the chat with one person, reusing it if it already exists. */
export function openDirect(input: z.infer<typeof directChatSchema>, user: AuthUser) {
  if (input.userId === user.id) throw badRequest('You cannot start a chat with yourself.');
  assertContactAllowed(user, input.userId);

  const key = chatModel.directKey(user.id, input.userId);
  const existing = chatModel.findByDirectKey(key);
  if (existing) {
    return present(chatModel.findConversation(existing.id, user.id)!, user.id);
  }

  return transaction(() => {
    const id = chatModel.insertConversation({
      kind: 'DIRECT',
      name: null,
      topic: null,
      direct_key: key,
      created_by: user.id,
    });
    chatModel.addMember(id, user.id, true);
    chatModel.addMember(id, input.userId, true);
    return present(chatModel.findConversation(id, user.id)!, user.id);
  });
}

export function createGroup(input: z.infer<typeof groupChatSchema>, user: AuthUser) {
  if (user.roleCode === ROLES.CONTRACTOR) {
    throw forbidden('Contractors cannot create group chats.');
  }
  const members = [...new Set(input.memberIds.filter((id) => id !== user.id))];
  if (!members.length) throw badRequest('Add at least one other member.');
  for (const id of members) assertContactAllowed(user, id);

  return transaction(() => {
    const id = chatModel.insertConversation({
      kind: 'GROUP',
      name: input.name,
      topic: input.topic ?? null,
      direct_key: null,
      created_by: user.id,
    });
    chatModel.addMember(id, user.id, true);
    for (const memberId of members) {
      chatModel.addMember(id, memberId, false);
      insertNotification({
        userId: memberId,
        title: `Added to “${input.name}”`,
        message: `${user.fullName} added you to the group chat “${input.name}”.`,
        severity: 'INFO',
        entityType: 'CONVERSATION',
        entityId: id,
        link: `/chat/${id}`,
      });
    }
    return present(chatModel.findConversation(id, user.id)!, user.id);
  });
}

export function updateGroup(id: number, input: z.infer<typeof updateGroupSchema>, user: AuthUser) {
  assertMember(id, user);
  const conversation = chatModel.findConversation(id, user.id);
  if (!conversation) throw notFound('Conversation');
  if (conversation.kind !== 'GROUP') throw badRequest('A direct chat cannot be renamed.');
  assertGroupAdmin(id, user);

  chatModel.renameConversation(id, { name: input.name, topic: input.topic ?? undefined });
  return present(chatModel.findConversation(id, user.id)!, user.id);
}

export function addMembers(id: number, input: z.infer<typeof membersSchema>, user: AuthUser) {
  assertMember(id, user);
  const conversation = chatModel.findConversation(id, user.id);
  if (!conversation) throw notFound('Conversation');
  if (conversation.kind !== 'GROUP') throw badRequest('A direct chat has exactly two members.');
  assertGroupAdmin(id, user);

  for (const memberId of input.memberIds) {
    assertContactAllowed(user, memberId);
    if (chatModel.isMember(id, memberId)) continue;
    chatModel.addMember(id, memberId, false);
    insertNotification({
      userId: memberId,
      title: `Added to “${conversation.name ?? 'a group'}”`,
      message: `${user.fullName} added you to a group chat.`,
      severity: 'INFO',
      entityType: 'CONVERSATION',
      entityId: id,
      link: `/chat/${id}`,
    });
  }
  return present(chatModel.findConversation(id, user.id)!, user.id);
}

export function removeMember(id: number, memberId: number, user: AuthUser) {
  assertMember(id, user);
  const conversation = chatModel.findConversation(id, user.id);
  if (!conversation) throw notFound('Conversation');
  if (conversation.kind !== 'GROUP') throw badRequest('A direct chat has exactly two members.');

  // Anyone may leave; only a group admin may remove someone else.
  if (memberId !== user.id) assertGroupAdmin(id, user);

  const members = chatModel.listMembers(id);
  if (members.length <= 1) {
    // The last member out closes the group rather than leaving it orphaned.
    chatModel.deleteConversation(id);
    return null;
  }
  const admins = members.filter((m) => m.is_admin);
  if (admins.length === 1 && admins[0]!.user_id === memberId) {
    throw conflict('Make someone else a group admin before leaving.');
  }

  chatModel.removeMember(id, memberId);
  if (memberId === user.id) return null;
  return present(chatModel.findConversation(id, user.id)!, user.id);
}

function assertGroupAdmin(conversationId: number, user: AuthUser): void {
  if (user.roleCode === ROLES.ADMIN) return;
  if (!chatModel.isConversationAdmin(conversationId, user.id)) {
    throw forbidden('Only a group admin can do that.');
  }
}

// --- Messages --------------------------------------------------------------

export function listMessages(
  conversationId: number,
  query: z.infer<typeof messageQuerySchema>,
  user: AuthUser,
) {
  assertMember(conversationId, user);
  const rows = chatModel.listMessages(conversationId, {
    before: query.before,
    after: query.after,
    limit: query.limit,
  });
  // Reading the thread is what marks it read; polling for new messages is not.
  if (!query.after) chatModel.markRead(conversationId, user.id);
  return rows.map(presentMessage);
}

export function sendMessage(
  conversationId: number,
  input: z.infer<typeof messageSchema>,
  user: AuthUser,
) {
  assertMember(conversationId, user);
  const conversation = chatModel.findConversation(conversationId, user.id);
  if (!conversation) throw notFound('Conversation');

  return transaction(() => {
    const id = chatModel.insertMessage({
      conversation_id: conversationId,
      sender_id: user.id,
      body: input.body,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      document_id: input.documentId ?? null,
    });
    chatModel.markRead(conversationId, user.id);

    // Notify the others, but keep the noise down: only when they are not looking.
    const title =
      conversation.kind === 'DIRECT'
        ? `Message from ${user.fullName}`
        : `${user.fullName} in “${conversation.name ?? 'group'}”`;
    for (const member of chatModel.listMembers(conversationId)) {
      if (member.user_id === user.id) continue;
      if (isOnline(member.last_seen_at)) continue;
      insertNotification({
        userId: member.user_id,
        title,
        message: input.body.length > 140 ? `${input.body.slice(0, 140)}…` : input.body,
        severity: 'INFO',
        entityType: 'CONVERSATION',
        entityId: conversationId,
        link: `/chat/${conversationId}`,
      });
    }

    return presentMessage(chatModel.findMessage(id)!);
  });
}

export function deleteMessage(messageId: number, user: AuthUser) {
  const message = chatModel.findMessage(messageId);
  if (!message) throw notFound('Message');
  assertMember(message.conversation_id, user);
  if (message.sender_id !== user.id && user.roleCode !== ROLES.ADMIN) {
    throw forbidden('You can only delete your own messages.');
  }
  chatModel.softDeleteMessage(messageId);
  return presentMessage(chatModel.findMessage(messageId)!);
}

export function markRead(conversationId: number, user: AuthUser): void {
  assertMember(conversationId, user);
  chatModel.markRead(conversationId, user.id);
}

export function unreadCount(user: AuthUser): number {
  return chatModel.totalUnread(user.id);
}

export function listContacts(user: AuthUser, search?: string) {
  // A contractor may only reach departmental staff; staff may reach anyone.
  const staffOnly = user.roleCode === ROLES.CONTRACTOR;
  return chatModel.listContactableUsers(user.id, search, staffOnly).map((row) => ({
    id: row.id,
    fullName: row.full_name,
    username: row.username,
    roleCode: row.role_code,
    designation: row.designation,
    divisionName: row.division_name,
    isOnline: isOnline(row.last_seen_at),
  }));
}
