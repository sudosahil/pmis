import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { dateTime, initials, relativeTime } from '../lib/format';
import type { ChatContact, ChatMessage, Conversation } from '../types';
import {
  Alert, Button, Checkbox, EmptyState, InboxIcon, Loading, PageHeader, PlusIcon, SendIcon,
  TextInput, UsersIcon,
} from '../components/ui';
import { Modal } from '../components/Modal';

/** How often an open conversation checks for new messages. */
const POLL_MS = 5000;

export function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, isContractor } = useAuth();

  const [search, setSearch] = useState('');
  const [newDirect, setNewDirect] = useState(false);
  const [newGroup, setNewGroup] = useState(false);
  const [managing, setManaging] = useState(false);

  const activeId = id ? Number(id) : null;

  const conversations = useQuery({
    queryKey: ['chat', 'conversations', search],
    queryFn: () => api.get<Conversation[]>('/chat', { search: search || undefined }),
    refetchInterval: POLL_MS,
  });

  const conversation = useQuery({
    queryKey: ['chat', 'conversation', activeId],
    queryFn: () => api.get<Conversation>(`/chat/${activeId}`),
    enabled: activeId !== null,
  });

  const messages = useQuery({
    queryKey: ['chat', 'messages', activeId],
    queryFn: () => api.get<ChatMessage[]>(`/chat/${activeId}/messages`, { limit: 100 }),
    enabled: activeId !== null,
    refetchInterval: POLL_MS,
  });

  const send = useMutation({
    mutationFn: (body: string) => api.post<ChatMessage>(`/chat/${activeId}/messages`, { body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', activeId] });
      void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
      void queryClient.invalidateQueries({ queryKey: ['chat', 'unread'] });
    },
    onError: (error: unknown) =>
      toast.error('Message not sent', error instanceof ApiError ? error.message : undefined),
  });

  const deleteMessage = useMutation({
    mutationFn: (messageId: number) => api.delete(`/chat/${activeId}/messages/${messageId}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['chat', 'messages', activeId] }),
  });

  const leave = useMutation({
    mutationFn: () => api.delete(`/chat/${activeId}/members/${user!.id}`),
    onSuccess: () => {
      toast.success('You have left the conversation');
      void queryClient.invalidateQueries({ queryKey: ['chat'] });
      navigate('/chat');
    },
    onError: (error: unknown) =>
      toast.error('Could not leave', error instanceof ApiError ? error.message : undefined),
  });

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle="Talk to a colleague directly, or set up a group for a work, a division or a desk."
        actions={
          <>
            <Button icon={<PlusIcon />} onClick={() => setNewDirect(true)}>New chat</Button>
            {!isContractor && (
              <Button variant="primary" icon={<UsersIcon size={16} />} onClick={() => setNewGroup(true)}>
                New group
              </Button>
            )}
          </>
        }
      />

      {/* Sized to the viewport so the message box is always reachable without
          scrolling the page — the thread scrolls inside its own pane. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(260px, 330px) minmax(0, 1fr)',
          gap: 16,
          height: 'calc(100vh - 230px)',
          minHeight: 420,
        }}
      >
        <section className="card" style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div className="card__body" style={{ paddingBottom: 8 }}>
            <div className="field">
              <label className="field__label" htmlFor="chat-search">Search</label>
              <input
                id="chat-search"
                type="search"
                className="input"
                placeholder="Name or group"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          {conversations.isLoading ? (
            <Loading />
          ) : !conversations.data?.length ? (
            <div style={{ padding: 12 }}>
              <EmptyState
                icon={<InboxIcon size={34} />}
                title="No conversations yet"
                text="Start one with a colleague from the button above."
              />
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, flex: 1, minHeight: 0, overflowY: 'auto' }}>
              {conversations.data.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/chat/${row.id}`)}
                    style={{
                      display: 'flex', gap: 10, width: '100%', padding: '12px 16px',
                      border: 'none', borderBottom: '1px solid var(--line-soft)',
                      borderLeft: row.id === activeId ? '3px solid var(--brand-700)' : '3px solid transparent',
                      background: row.id === activeId ? 'var(--brand-050)' : 'transparent',
                      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
                    }}
                  >
                    <span className="header-user__avatar" style={{ flex: 'none', background: 'var(--brand-100)', color: 'var(--brand-900)' }}>
                      {row.kind === 'GROUP' ? <UsersIcon size={15} /> : initials(row.name)}
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.name}
                        </strong>
                        {row.unreadCount > 0 && <span className="nav-link__count">{row.unreadCount}</span>}
                      </span>
                      <span
                        style={{
                          display: 'block', color: 'var(--ink-600)', fontSize: 12.5,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {row.lastMessage
                          ? `${row.lastMessageSender ? `${row.lastMessageSender.split(' ').pop()}: ` : ''}${row.lastMessage}`
                          : row.subtitle}
                      </span>
                      <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 11.5, marginTop: 2 }}>
                        {row.kind === 'DIRECT' && (row.isOnline ? 'Online now · ' : '')}
                        {row.lastMessageAt ? relativeTime(row.lastMessageAt) : 'No messages yet'}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {activeId === null ? (
          <section className="card">
            <div className="card__body">
              <EmptyState
                icon={<InboxIcon size={40} />}
                title="Choose a conversation"
                text="Pick one on the left, or start a new chat. Messages are kept on the department's own server."
              />
            </div>
          </section>
        ) : (
          <ConversationPane
            conversation={conversation.data}
            messages={messages.data ?? []}
            loading={messages.isLoading}
            currentUserId={user?.id ?? 0}
            sending={send.isPending}
            onSend={(body) => send.mutate(body)}
            onDeleteMessage={(messageId) => deleteMessage.mutate(messageId)}
            onManage={() => setManaging(true)}
            onLeave={() => leave.mutate()}
          />
        )}
      </div>

      {newDirect && (
        <NewDirectDialog
          onClose={() => setNewDirect(false)}
          onOpened={(conversationId) => {
            setNewDirect(false);
            void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
            navigate(`/chat/${conversationId}`);
          }}
        />
      )}
      {newGroup && (
        <NewGroupDialog
          onClose={() => setNewGroup(false)}
          onCreated={(conversationId) => {
            setNewGroup(false);
            void queryClient.invalidateQueries({ queryKey: ['chat', 'conversations'] });
            navigate(`/chat/${conversationId}`);
          }}
        />
      )}
      {managing && conversation.data && (
        <ManageGroupDialog
          conversation={conversation.data}
          onClose={() => setManaging(false)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['chat'] });
          }}
        />
      )}
    </>
  );
}

function ConversationPane({
  conversation, messages, loading, currentUserId, sending, onSend, onDeleteMessage, onManage, onLeave,
}: {
  conversation: Conversation | undefined;
  messages: ChatMessage[];
  loading: boolean;
  currentUserId: number;
  sending: boolean;
  onSend: (body: string) => void;
  onDeleteMessage: (id: number) => void;
  onManage: () => void;
  onLeave: () => void;
}) {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, conversation?.id]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft('');
  }

  // Group consecutive messages from one person on one day under a single header.
  const grouped = useMemo(() => {
    const output: { key: string; day: string; items: ChatMessage[]; senderId: number | null }[] = [];
    for (const message of messages) {
      const day = message.createdAt.slice(0, 10);
      const last = output[output.length - 1];
      if (last && last.senderId === message.senderId && last.day === day) {
        last.items.push(message);
      } else {
        output.push({ key: `${message.id}`, day, items: [message], senderId: message.senderId });
      }
    }
    return output;
  }, [messages]);

  const online = conversation?.members.filter((m) => m.isOnline && m.id !== currentUserId) ?? [];

  return (
    <section
      className="card"
      style={{ display: 'flex', flexDirection: 'column', minWidth: 0, height: '100%' }}
    >
      <header className="card__header">
        <div>
          <h2 className="card__title">{conversation?.name ?? 'Loading…'}</h2>
          <p className="card__subtitle">
            {conversation?.subtitle}
            {conversation?.kind === 'GROUP' && online.length > 0 && ` · ${online.length} online now`}
            {conversation?.kind === 'DIRECT' && conversation.isOnline && ' · online now'}
          </p>
        </div>
        {conversation?.kind === 'GROUP' && (
          <div className="card__actions">
            <Button size="sm" onClick={onManage}>Members</Button>
            <Button size="sm" variant="ghost" onClick={onLeave}>Leave</Button>
          </div>
        )}
      </header>

      <div
        className="card__body"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {loading ? (
          <Loading />
        ) : !messages.length ? (
          <EmptyState title="No messages yet" text="Say something to start the conversation." />
        ) : (
          grouped.map((group) => {
            const first = group.items[0]!;
            const mine = first.senderId === currentUserId;
            return (
              <div
                key={group.key}
                style={{
                  display: 'flex',
                  gap: 10,
                  flexDirection: mine ? 'row-reverse' : 'row',
                  alignItems: 'flex-start',
                }}
              >
                <span
                  className="header-user__avatar"
                  style={{ flex: 'none', background: mine ? 'var(--brand-700)' : 'var(--surface-sunken)', color: mine ? '#fff' : 'var(--ink-900)' }}
                  title={first.senderName ?? undefined}
                >
                  {initials(first.senderName)}
                </span>
                <div style={{ maxWidth: '72%', minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: 'var(--ink-600)',
                      marginBottom: 4,
                      textAlign: mine ? 'right' : 'left',
                    }}
                  >
                    {mine ? 'You' : first.senderName}
                    {first.senderRole && !mine ? ` · ${first.senderRole}` : ''}
                    {' · '}
                    <span title={dateTime(first.createdAt)}>{relativeTime(first.createdAt)}</span>
                  </div>
                  {group.items.map((message) => (
                    <div
                      key={message.id}
                      style={{
                        background: mine ? 'var(--brand-700)' : 'var(--surface-sunken)',
                        color: mine ? '#fff' : 'var(--ink-900)',
                        border: mine ? 'none' : '1px solid var(--line)',
                        borderRadius: 10,
                        padding: '9px 12px',
                        marginBottom: 6,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontStyle: message.isDeleted ? 'italic' : undefined,
                        opacity: message.isDeleted ? 0.7 : 1,
                      }}
                    >
                      {message.body}
                      {mine && !message.isDeleted && (
                        <button
                          type="button"
                          onClick={() => onDeleteMessage(message.id)}
                          title="Delete this message"
                          style={{
                            display: 'block', marginTop: 4, background: 'none', border: 'none',
                            color: 'rgba(255,255,255,0.75)', fontSize: 11.5, cursor: 'pointer',
                            padding: 0, textDecoration: 'underline',
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <footer className="card__footer">
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, width: '100%' }}>
          <label className="visually-hidden" htmlFor="chat-draft">Message</label>
          <input
            id="chat-draft"
            className="input"
            style={{ flex: 1 }}
            placeholder="Write a message…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={4000}
          />
          <Button type="submit" variant="primary" icon={<SendIcon />} loading={sending} disabled={!draft.trim()}>
            Send
          </Button>
        </form>
      </footer>
    </section>
  );
}

function useContacts(search: string) {
  return useQuery({
    queryKey: ['chat', 'contacts', search],
    queryFn: () => api.get<ChatContact[]>('/chat/contacts', { search: search || undefined }),
  });
}

function NewDirectDialog({
  onClose, onOpened,
}: {
  onClose: () => void;
  onOpened: (conversationId: number) => void;
}) {
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const contacts = useContacts(search);

  const mutation = useMutation({
    mutationFn: (userId: number) => api.post<Conversation>('/chat/direct', { userId }),
    onSuccess: (conversation) => onOpened(conversation.id),
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not open that chat.'),
  });

  return (
    <Modal open title="Start a chat" subtitle="Choose the colleague you want to message." onClose={onClose}>
      <div className="stack">
        {message && <Alert variant="danger" title="Could not open">{message}</Alert>}
        <TextInput
          label="Search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, username or designation"
        />
        {contacts.isLoading ? (
          <Loading />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, maxHeight: 320, overflowY: 'auto' }}>
            {(contacts.data ?? []).map((contact) => (
              <li key={contact.id}>
                <button
                  type="button"
                  onClick={() => mutation.mutate(contact.id)}
                  disabled={mutation.isPending}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center', width: '100%',
                    padding: '10px 12px', border: 'none', borderBottom: '1px solid var(--line-soft)',
                    background: 'transparent', textAlign: 'left', cursor: 'pointer', font: 'inherit',
                  }}
                >
                  <span className="header-user__avatar" style={{ background: 'var(--brand-100)', color: 'var(--brand-900)' }}>
                    {initials(contact.fullName)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{contact.fullName}</span>
                    <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5 }}>
                      {[contact.designation ?? contact.roleCode, contact.divisionName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {contact.isOnline && <span className="badge badge--ok">Online</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function NewGroupDialog({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (conversationId: number) => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const contacts = useContacts(search);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Conversation>('/chat/groups', {
        name,
        topic: topic || undefined,
        memberIds: selected,
      }),
    onSuccess: (conversation) => onCreated(conversation.id),
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not create the group.'),
  });

  function toggle(id: number) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  return (
    <Modal
      open
      title="New group"
      subtitle="Everyone you add can see the whole conversation, including messages sent before they joined."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={name.trim().length < 2 || selected.length === 0}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Create group ({selected.length})
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not create">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Group name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Ring road package — site coordination"
          />
          <TextInput
            label="What it is for"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            hint="Optional. Shown under the group name."
          />
        </div>

        <TextInput
          label="Find members"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Name, username or designation"
          full
        />

        {contacts.isLoading ? (
          <Loading />
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
            {(contacts.data ?? []).map((contact) => (
              <div
                key={contact.id}
                style={{ padding: '8px 12px', borderBottom: '1px solid var(--line-soft)' }}
              >
                <Checkbox
                  label={`${contact.fullName} — ${[contact.designation ?? contact.roleCode, contact.divisionName].filter(Boolean).join(' · ')}`}
                  checked={selected.includes(contact.id)}
                  onChange={() => toggle(contact.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ManageGroupDialog({
  conversation, onClose, onSaved,
}: {
  conversation: Conversation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(conversation.name);
  const [topic, setTopic] = useState(conversation.topic ?? '');
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const contacts = useContacts(search);

  const memberIds = new Set(conversation.members.map((member) => member.id));

  const rename = useMutation({
    mutationFn: () => api.patch<Conversation>(`/chat/${conversation.id}`, { name, topic: topic || null }),
    onSuccess: () => { toast.success('Group updated'); onSaved(); },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not rename the group.'),
  });

  const addMember = useMutation({
    mutationFn: (userId: number) =>
      api.post<Conversation>(`/chat/${conversation.id}/members`, { memberIds: [userId] }),
    onSuccess: () => { toast.success('Member added'); onSaved(); },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not add that member.'),
  });

  const removeMember = useMutation({
    mutationFn: (userId: number) => api.delete(`/chat/${conversation.id}/members/${userId}`),
    onSuccess: () => { toast.success('Member removed'); onSaved(); },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not remove that member.'),
  });

  return (
    <Modal
      open
      title="Group members"
      subtitle={conversation.name}
      size="wide"
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Done</Button>}
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Group details</legend>
          <div className="form-grid">
            <TextInput label="Group name" value={name} onChange={(event) => setName(event.target.value)} />
            <TextInput label="What it is for" value={topic} onChange={(event) => setTopic(event.target.value)} />
          </div>
          <div style={{ marginTop: 10 }}>
            <Button size="sm" loading={rename.isPending} onClick={() => { setMessage(null); rename.mutate(); }}>
              Save details
            </Button>
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Members ({conversation.members.length})</legend>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {conversation.members.map((member) => (
              <li
                key={member.id}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center',
                  padding: '8px 0', borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span className="header-user__avatar" style={{ background: 'var(--brand-100)', color: 'var(--brand-900)' }}>
                  {initials(member.fullName)}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>
                    {member.fullName}
                    {member.isAdmin && <span className="badge badge--info" style={{ marginLeft: 8 }}>Group admin</span>}
                  </span>
                  <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5 }}>
                    {[member.designation ?? member.roleCode, member.divisionName].filter(Boolean).join(' · ')}
                    {member.isOnline ? ' · online now' : member.lastSeenAt ? ` · last seen ${relativeTime(member.lastSeenAt)}` : ''}
                  </span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={removeMember.isPending}
                  onClick={() => { setMessage(null); removeMember.mutate(member.id); }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Add someone</legend>
          <TextInput
            label="Search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, username or designation"
            full
          />
          <div style={{ maxHeight: 220, overflowY: 'auto', marginTop: 10 }}>
            {(contacts.data ?? [])
              .filter((contact) => !memberIds.has(contact.id))
              .map((contact) => (
                <div
                  key={contact.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '8px 0', borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{contact.fullName}</span>
                    <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5 }}>
                      {[contact.designation ?? contact.roleCode, contact.divisionName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    loading={addMember.isPending}
                    onClick={() => { setMessage(null); addMember.mutate(contact.id); }}
                  >
                    Add
                  </Button>
                </div>
              ))}
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
