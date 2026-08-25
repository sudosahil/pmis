import { useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { date, dateTime, humanise, today } from '../lib/format';
import {
  COMMITTEE_KINDS, MEMBER_ROLES,
  type Committee, type CommitteeAction, type CommitteeDetail, type Meeting,
  type MeetingDetail, type MemberRole, type User,
} from '../types';
import {
  Alert, Button, Card, Checkbox, ClockIcon, DetailItem, EmptyState, Loading, PageHeader,
  PlusIcon, Select, TextArea, TextInput, TrashIcon, UsersIcon,
} from '../components/ui';
import { DataTable, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal, ConfirmModal } from '../components/Modal';

/**
 * Committees, their sittings, and what those sittings left behind.
 *
 * Two rules carry the module and the screen says both out loud. A sitting short
 * of its quorum can be minuted but cannot decide, and every decision names the
 * officer who has to act on it — minutes nobody is named against are minutes
 * nobody acts on.
 */

export function CommitteesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [committeeId, setCommitteeId] = useState<number | null>(null);
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const view = (params.get('view') ?? 'committees') as 'committees' | 'meetings' | 'actions';

  const setView = (next: string) => {
    const params2 = new URLSearchParams(params);
    if (next === 'committees') params2.delete('view');
    else params2.set('view', next);
    setParams(params2);
  };

  const committees = useQuery({
    queryKey: ['committees'],
    queryFn: () => api.get<Page<Committee>>('/committees', { pageSize: 100 }),
    enabled: view === 'committees',
  });

  const meetings = useQuery({
    queryKey: ['meetings'],
    queryFn: () => api.get<Page<Meeting>>('/committees/meetings', { pageSize: 100 }),
    enabled: view === 'meetings',
  });

  const actions = useQuery({
    queryKey: ['committee-actions'],
    queryFn: () => api.get<CommitteeAction[]>('/committees/my-actions'),
  });

  const openActions = actions.data ?? [];

  return (
    <>
      <PageHeader
        title="Committees &amp; meetings"
        subtitle="Standing committees, the sittings they hold, and the action items those sittings leave behind."
        actions={
          can('committees.manage') ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Constitute a committee
            </Button>
          ) : undefined
        }
      />

      {openActions.some((action) => action.isOverdue) && (
        <div style={{ marginBottom: 14 }}>
          <Alert
            variant="warn"
            title={`${openActions.filter((a) => a.isOverdue).length} action item(s) with you are past their date`}
          >
            A committee decided these and named you to act on them.
          </Alert>
        </div>
      )}

      <div className="tabs" role="tablist">
        {(['committees', 'meetings', 'actions'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={`tab${view === key ? ' is-active' : ''}`}
            onClick={() => setView(key)}
          >
            {key === 'committees' ? 'Committees' : key === 'meetings' ? 'Sittings' : 'My action items'}
            {key === 'actions' && openActions.length > 0 ? (
              <span className="tab__count">({openActions.length})</span>
            ) : null}
          </button>
        ))}
      </div>

      {view === 'committees' && (
        <Card flush>
          <DataTable
            rows={committees.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={committees.isLoading}
            onRowClick={(row) => setCommitteeId(row.id)}
            caption="Committees"
            columns={[
              {
                key: 'committee',
                header: 'Committee',
                render: (row) => (
                  <>
                    <div className="cell-primary">{row.name}</div>
                    <div className="cell-muted code">{row.code}</div>
                  </>
                ),
              },
              { key: 'kind', header: 'Kind', render: (row) => humanise(row.kind) },
              {
                key: 'jurisdiction',
                header: 'Jurisdiction',
                render: (row) => row.division?.name ?? 'Departmental',
              },
              {
                key: 'members',
                header: 'Members',
                numeric: true,
                render: (row) => (
                  <>
                    <div>{row.memberCount}</div>
                    <div className="cell-muted">quorum {row.quorum}</div>
                  </>
                ),
              },
              {
                key: 'sittings',
                header: 'Sittings',
                numeric: true,
                render: (row) => (
                  <>
                    <div>{row.meetingCount}</div>
                    {row.lastMeetingAt && (
                      <div className="cell-muted">last {date(row.lastMeetingAt)}</div>
                    )}
                  </>
                ),
              },
              {
                key: 'actions',
                header: 'Open actions',
                numeric: true,
                render: (row) =>
                  row.openActions > 0 ? (
                    <strong style={{ color: 'var(--warn-fg)' }}>{row.openActions}</strong>
                  ) : (
                    '—'
                  ),
              },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            ]}
            empty={{
              title: 'No committees constituted',
              text: 'A tender committee, a technical committee and a grievance committee are where most departments start.',
            }}
          />
        </Card>
      )}

      {view === 'meetings' && (
        <Card flush>
          <DataTable
            rows={meetings.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={meetings.isLoading}
            onRowClick={(row) => setMeetingId(row.id)}
            caption="Sittings"
            columns={
              [
                {
                  key: 'meeting',
                  header: 'Sitting',
                  render: (row) => (
                    <>
                      <div className="cell-primary">{row.title}</div>
                      <div className="cell-muted code">{row.meetingNo}</div>
                    </>
                  ),
                },
                { key: 'committee', header: 'Committee', render: (row) => row.committee.name },
                {
                  key: 'when',
                  header: 'When',
                  render: (row) => (
                    <>
                      <div>{dateTime(row.scheduledAt)}</div>
                      <div className="cell-muted">{row.venue ?? humanise(row.mode)}</div>
                    </>
                  ),
                },
                {
                  key: 'attendance',
                  header: 'Attendance',
                  numeric: true,
                  render: (row) =>
                    row.status === 'SCHEDULED' ? (
                      '—'
                    ) : (
                      <>
                        <div>{row.presentCount} of {row.invitedCount}</div>
                        <div
                          className="cell-muted"
                          style={row.hasQuorum ? undefined : { color: 'var(--danger-fg)' }}
                        >
                          {row.hasQuorum ? 'quorate' : 'short of quorum'}
                        </div>
                      </>
                    ),
                },
                {
                  key: 'decisions',
                  header: 'Decisions',
                  numeric: true,
                  render: (row) =>
                    row.decisionCount === 0 ? '—' : (
                      <>
                        <div>{row.decisionCount}</div>
                        {row.openActions > 0 && (
                          <div className="cell-muted">{row.openActions} open</div>
                        )}
                      </>
                    ),
                },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              ] as Column<Meeting>[]
            }
            empty={{ title: 'No sittings on record' }}
          />
        </Card>
      )}

      {view === 'actions' && (
        <Card
          title="Action items with you"
          subtitle="What committees have decided and named you to carry out."
          flush
        >
          {actions.isLoading ? (
            <Loading />
          ) : openActions.length === 0 ? (
            <EmptyState
              icon={<ClockIcon size={40} />}
              title="Nothing outstanding"
              text="Action items a committee names you against will appear here until you close them."
            />
          ) : (
            <div className="stack" style={{ padding: 18 }}>
              {openActions.map((action) => (
                <div
                  key={action.id}
                  style={{
                    border: '1px solid var(--line)',
                    borderLeft: `3px solid ${action.isOverdue ? 'var(--danger-fg)' : 'var(--line-strong)'}`,
                    borderRadius: 8,
                    padding: '12px 14px',
                  }}
                >
                  <div className="row row--between">
                    <div>
                      <strong>{action.subject}</strong>
                      <div className="cell-muted">
                        {action.committeeName} · <span className="code">{action.meetingNo}</span>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {action.dueDate && (
                        <div style={action.isOverdue ? { color: 'var(--danger-fg)', fontWeight: 700 } : undefined}>
                          Due {date(action.dueDate)}
                        </div>
                      )}
                      <Button size="sm" onClick={() => setMeetingId(action.meetingId)}>
                        Open the sitting
                      </Button>
                    </div>
                  </div>
                  <p style={{ marginTop: 8, lineHeight: 1.6 }}>{action.decision}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {committeeId !== null && (
        <CommitteeDialog
          committeeId={committeeId}
          onClose={() => setCommitteeId(null)}
          onOpenMeeting={(id) => { setCommitteeId(null); setMeetingId(id); }}
        />
      )}
      {meetingId !== null && (
        <MeetingDialog meetingId={meetingId} onClose={() => setMeetingId(null)} />
      )}
      {creating && <CommitteeFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// --- One committee ------------------------------------------------------------

function CommitteeDialog({
  committeeId, onClose, onOpenMeeting,
}: {
  committeeId: number;
  onClose: () => void;
  onOpenMeeting: (id: number) => void;
}) {
  const { can } = useAuth();
  const [editingMembers, setEditingMembers] = useState(false);
  const [convening, setConvening] = useState(false);

  const committee = useQuery({
    queryKey: ['committee', committeeId],
    queryFn: () => api.get<CommitteeDetail>(`/committees/${committeeId}`),
  });

  const c = committee.data;

  return (
    <Modal
      open
      title={c ? c.name : 'Committee'}
      subtitle={c ? `${c.code} · quorum ${c.quorum}` : undefined}
      size="wide"
      onClose={onClose}
      footer={
        <>
          {c && can('committees.manage') && (
            <>
              <Button icon={<UsersIcon size={16} />} onClick={() => setEditingMembers(true)}>
                Membership
              </Button>
              <Button variant="primary" onClick={() => setConvening(true)}>Convene a sitting</Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {committee.isLoading || !c ? (
        <Loading />
      ) : (
        <div className="stack">
          {!c.isQuorate && (
            <Alert variant="danger" title="This committee cannot sit">
              It has {c.memberCount} member(s) against a quorum of {c.quorum}. Complete the
              membership before convening a sitting.
            </Alert>
          )}

          <Card title="Constitution">
            <div className="detail-grid">
              <DetailItem label="Code" value={<span className="code">{c.code}</span>} />
              <DetailItem label="Kind" value={humanise(c.kind)} />
              <DetailItem label="Jurisdiction" value={c.division?.name ?? 'Departmental'} />
              <DetailItem label="Quorum" value={`${c.quorum} members`} />
              <DetailItem label="Sittings held" value={c.meetingCount} />
              <DetailItem label="Open action items" value={c.openActions} />
            </div>
            {c.purpose && (
              <div style={{ marginTop: 14 }}>
                <div className="detail-item__label">Purpose</div>
                <p style={{ marginTop: 4, lineHeight: 1.6 }}>{c.purpose}</p>
              </div>
            )}
          </Card>

          <Card title="Members" flush>
            <DataTable
              rows={c.members}
              rowKey={(row) => row.userId}
              compact
              caption="Committee members"
              columns={[
                { key: 'name', header: 'Member', render: (row) => row.name },
                { key: 'designation', header: 'Post', render: (row) => row.designation ?? '—' },
                {
                  key: 'role',
                  header: 'On the committee',
                  render: (row) => (
                    <>
                      {humanise(row.memberRole)}
                      {row.memberRole === 'SPECIAL_INVITEE' && (
                        <div className="cell-muted">Does not count towards quorum</div>
                      )}
                    </>
                  ),
                },
              ]}
              empty={{ title: 'No members named yet' }}
            />
          </Card>

          <Card title="Recent sittings" flush>
            <DataTable
              rows={c.meetings}
              rowKey={(row) => row.id}
              compact
              onRowClick={(row) => onOpenMeeting(row.id)}
              caption="Sittings"
              columns={[
                {
                  key: 'meeting',
                  header: 'Sitting',
                  render: (row) => (
                    <>
                      <div className="cell-primary">{row.title}</div>
                      <div className="cell-muted code">{row.meetingNo}</div>
                    </>
                  ),
                },
                { key: 'when', header: 'When', render: (row) => dateTime(row.scheduledAt) },
                {
                  key: 'quorum',
                  header: 'Attendance',
                  numeric: true,
                  render: (row) =>
                    row.status === 'SCHEDULED' ? '—' : `${row.presentCount} of ${row.invitedCount}`,
                },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              ]}
              empty={{ title: 'No sittings yet' }}
            />
          </Card>
        </div>
      )}

      {editingMembers && c && (
        <MembersDialog committee={c} onClose={() => setEditingMembers(false)} />
      )}
      {convening && c && <ConveneDialog committee={c} onClose={() => setConvening(false)} />}
    </Modal>
  );
}

function MembersDialog({ committee, onClose }: { committee: CommitteeDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState(
    committee.members.map((member) => ({
      userId: String(member.userId),
      memberRole: member.memberRole,
      designation: member.designation ?? '',
    })),
  );
  const [message, setMessage] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ['users', 'for-committee'],
    queryFn: () => api.get<Page<User>>('/users', { pageSize: 200 }),
  });

  const save = useMutation({
    mutationFn: () =>
      api.put(`/committees/${committee.id}/members`, {
        members: rows.map((row) => ({
          userId: Number(row.userId),
          memberRole: row.memberRole,
          designation: row.designation || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success('Membership saved');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the membership.'),
  });

  const chairs = rows.filter((row) => row.memberRole === 'CHAIRPERSON').length;

  return (
    <Modal
      open
      title="Membership"
      subtitle={`${committee.name} · quorum ${committee.quorum}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontSize: 14 }}>
            {rows.length} member(s){chairs !== 1 && rows.length > 0 && (
              <span style={{ color: 'var(--danger-fg)' }}>
                {' '}· {chairs === 0 ? 'no chairperson named' : 'more than one chairperson'}
              </span>
            )}
          </span>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={rows.length > 0 && chairs !== 1}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Save membership
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <Alert variant="info" title="One chairperson, and enough members for the quorum">
          A special invitee is heard but not counted — a sitting of two members and three invitees
          is still a sitting of two.
        </Alert>

        {rows.map((row, index) => (
          <div key={index} className="form-grid" style={{ alignItems: 'end' }}>
            <Select
              label={`Member ${index + 1}`}
              placeholder="Choose an officer"
              options={(staff.data?.items ?? []).map((user) => ({
                value: String(user.id),
                label: `${user.fullName} — ${user.roleName}`,
              }))}
              value={row.userId}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, userId: event.target.value } : r)))
              }
            />
            <Select
              label="On the committee"
              options={MEMBER_ROLES.map((value) => ({ value, label: humanise(value) }))}
              value={row.memberRole}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setRows(
                  rows.map((r, i) =>
                    i === index ? { ...r, memberRole: event.target.value as MemberRole } : r,
                  ),
                )
              }
            />
            <TextInput
              label="Post"
              value={row.designation}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setRows(rows.map((r, i) => (i === index ? { ...r, designation: event.target.value } : r)))
              }
            />
            <Button
              variant="ghost"
              icon={<TrashIcon />}
              aria-label={`Remove member ${index + 1}`}
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            />
          </div>
        ))}

        <Button
          icon={<PlusIcon />}
          onClick={() =>
            setRows([...rows, { userId: '', memberRole: 'MEMBER' as MemberRole, designation: '' }])
          }
        >
          Add a member
        </Button>
      </div>
    </Modal>
  );
}

function ConveneDialog({ committee, onClose }: { committee: CommitteeDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '',
    scheduledAt: `${today()} 11:00`,
    venue: '',
    mode: 'IN_PERSON',
    agenda: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () => api.post(`/committees/${committee.id}/meetings`, form),
    onSuccess: () => {
      toast.success('Sitting convened', 'Every member has been told.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not convene the sitting.'),
  });

  return (
    <Modal
      open
      title="Convene a sitting"
      subtitle={committee.name}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Convene
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not convene">{message}</Alert>}
        <Alert variant="info" title="Everyone on the roll is invited">
          All {committee.memberCount} members are notified. Attendance is marked afterwards, and
          the quorum of {committee.quorum} is checked when the minutes are recorded.
        </Alert>
        <div className="form-grid">
          <TextInput label="Subject" full required value={form.title} onChange={set('title')} />
          <TextInput
            label="When"
            required
            value={form.scheduledAt}
            onChange={set('scheduledAt')}
            hint="YYYY-MM-DD HH:MM"
          />
          <TextInput label="Venue" value={form.venue} onChange={set('venue')} />
          <Select
            label="Mode"
            options={[
              { value: 'IN_PERSON', label: 'In person' },
              { value: 'VIDEO', label: 'Video conference' },
              { value: 'HYBRID', label: 'Hybrid' },
            ]}
            value={form.mode}
            onChange={set('mode')}
          />
          <TextArea
            label="Agenda"
            full
            rows={5}
            value={form.agenda}
            onChange={set('agenda')}
            hint="One item per line, numbered as it will read on the notice."
          />
        </div>
      </div>
    </Modal>
  );
}

// --- One sitting ---------------------------------------------------------------

function MeetingDialog({ meetingId, onClose }: { meetingId: number; onClose: () => void }) {
  const { can, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [minuting, setMinuting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [closing, setClosing] = useState<number | null>(null);

  const meeting = useQuery({
    queryKey: ['meeting', meetingId],
    queryFn: () => api.get<MeetingDetail>(`/committees/meetings/${meetingId}`),
  });

  const attendance = useMutation({
    mutationFn: (rows: { userId: number; isPresent: boolean }[]) =>
      api.put(`/committees/meetings/${meetingId}/attendance`, { attendance: rows }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['meeting', meetingId] }),
    onError: (error: unknown) =>
      toast.error('Could not save', error instanceof ApiError ? error.message : undefined),
  });

  const m = meeting.data;
  const editable = m?.status === 'SCHEDULED';

  return (
    <Modal
      open
      title={m ? m.title : 'Sitting'}
      subtitle={m ? `${m.meetingNo} · ${m.committee.name}` : undefined}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          {m && can('committees.manage') && m.status === 'SCHEDULED' && (
            <>
              <Button onClick={() => setCancelling(true)}>Call it off</Button>
              <Button variant="primary" onClick={() => setMinuting(true)}>Record the minutes</Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {meeting.isLoading || !m ? (
        <Loading />
      ) : (
        <div className="stack">
          {m.status === 'HELD' && !m.hasQuorum && (
            <Alert variant="warn" title="Held short of its quorum">
              {m.presentCount} member(s) attended against a quorum of {m.committee.quorum}. The
              sitting could be minuted but could not decide anything.
            </Alert>
          )}

          <Card title="Particulars">
            <div className="detail-grid">
              <DetailItem label="Sitting" value={<span className="code">{m.meetingNo}</span>} />
              <DetailItem label="Committee" value={m.committee.name} />
              <DetailItem label="When" value={dateTime(m.scheduledAt)} />
              <DetailItem label="Venue" value={m.venue ?? humanise(m.mode)} />
              <DetailItem label="Status" value={<StatusBadge status={m.status} />} />
              <DetailItem
                label="Attendance"
                value={
                  m.status === 'SCHEDULED'
                    ? 'Not yet marked'
                    : `${m.presentCount} of ${m.invitedCount} · ${m.hasQuorum ? 'quorate' : 'short of quorum'}`
                }
              />
            </div>
            {m.agenda && (
              <div style={{ marginTop: 14 }}>
                <div className="detail-item__label">Agenda</div>
                <p style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{m.agenda}</p>
              </div>
            )}
          </Card>

          <Card
            title="Attendance"
            subtitle={
              editable
                ? 'Mark who is present. The quorum is checked when the minutes are recorded.'
                : undefined
            }
            flush
          >
            <div style={{ padding: 18 }} className="stack">
              {m.attendance.map((entry) => (
                <div key={entry.userId} className="row row--between">
                  <div>
                    <strong>{entry.name}</strong>
                    <div className="cell-muted">
                      {entry.memberRole ? humanise(entry.memberRole) : 'Not on the roll'}
                      {entry.memberRole === 'SPECIAL_INVITEE' && ' · not counted for quorum'}
                    </div>
                  </div>
                  {editable && can('committees.manage') ? (
                    <Checkbox
                      label={entry.isPresent ? 'Present' : 'Absent'}
                      checked={entry.isPresent}
                      onChange={(event) =>
                        attendance.mutate(
                          m.attendance.map((row) => ({
                            userId: row.userId,
                            isPresent: row.userId === entry.userId ? event.target.checked : row.isPresent,
                          })),
                        )
                      }
                    />
                  ) : (
                    <StatusBadge status={entry.isPresent ? 'PRESENT' : 'ABSENT'} />
                  )}
                </div>
              ))}
            </div>
          </Card>

          {m.minutes && (
            <Card title="Minutes" subtitle={m.minutesBy ? `Recorded by ${m.minutesBy}` : undefined}>
              <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{m.minutes}</p>
            </Card>
          )}

          {m.decisions.length > 0 && (
            <Card
              title="Decisions and action items"
              subtitle="Every decision names the officer who has to act on it."
              flush
            >
              <div className="stack" style={{ padding: 18 }}>
                {m.decisions.map((decision) => (
                  <div
                    key={decision.id}
                    style={{
                      border: '1px solid var(--line)',
                      borderLeft: `3px solid ${
                        decision.status !== 'OPEN'
                          ? 'var(--ok-fg)'
                          : decision.isOverdue
                            ? 'var(--danger-fg)'
                            : 'var(--line-strong)'
                      }`,
                      borderRadius: 8,
                      padding: '12px 14px',
                    }}
                  >
                    <div className="row row--between">
                      <div>
                        <strong>{decision.seq}. {decision.subject}</strong>
                        <div className="cell-muted">
                          {decision.actionBy?.name ?? 'Nobody named'}
                          {decision.dueDate && ` · due ${date(decision.dueDate)}`}
                        </div>
                      </div>
                      <div className="row">
                        <StatusBadge status={decision.status} />
                        {decision.status === 'OPEN'
                          && decision.actionBy?.id === user?.id && (
                          <Button size="sm" onClick={() => setClosing(decision.id)}>Close</Button>
                        )}
                      </div>
                    </div>
                    <p style={{ marginTop: 8, lineHeight: 1.6 }}>{decision.decision}</p>
                    {decision.closingNote && (
                      <p className="cell-muted" style={{ marginTop: 6 }}>
                        Closed {date(decision.closedOn)}: {decision.closingNote}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {minuting && m && <MinutesDialog meeting={m} onClose={() => setMinuting(false)} />}
      {closing !== null && (
        <CloseActionDialog decisionId={closing} onClose={() => setClosing(null)} />
      )}

      <ConfirmModal
        open={cancelling}
        title="Call off this sitting?"
        message="Members will keep the notice they were sent. Record why it was called off."
        confirmLabel="Call it off"
        danger
        onClose={() => setCancelling(false)}
        onConfirm={() => {
          void api
            .post(`/committees/meetings/${meetingId}/cancel`, {
              reason: 'Called off by the convener.',
            })
            .then(() => {
              toast.success('Sitting called off');
              void queryClient.invalidateQueries();
              setCancelling(false);
            });
        }}
      />
    </Modal>
  );
}

function MinutesDialog({ meeting, onClose }: { meeting: MeetingDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [minutes, setMinutes] = useState('');
  const [decisions, setDecisions] = useState<
    { subject: string; decision: string; actionById: string; dueDate: string }[]
  >([]);
  const [message, setMessage] = useState<string | null>(null);

  const quorate = meeting.presentCount >= meeting.committee.quorum;

  const save = useMutation({
    mutationFn: () =>
      api.post(`/committees/meetings/${meeting.id}/minutes`, {
        minutes,
        decisions: decisions.map((row) => ({
          subject: row.subject,
          decision: row.decision,
          actionById: row.actionById ? Number(row.actionById) : undefined,
          dueDate: row.dueDate || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success('Minutes recorded', 'Everyone named against an action item has been told.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the minutes.'),
  });

  return (
    <Modal
      open
      title="Record the minutes"
      subtitle={`${meeting.meetingNo} · ${meeting.presentCount} of ${meeting.invitedCount} present`}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Record minutes
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}

        {!quorate && (
          <Alert variant="warn" title="This sitting is short of its quorum">
            {meeting.presentCount} member(s) attended against a quorum of{' '}
            {meeting.committee.quorum}. The proceedings can be minuted, but no decision can be
            recorded until the sitting is quorate.
          </Alert>
        )}

        <TextArea
          label="Minutes"
          full
          required
          rows={7}
          value={minutes}
          onChange={(event) => setMinutes(event.target.value)}
          hint="What the sitting considered and resolved, in the committee's own words."
        />

        {quorate && (
          <>
            {decisions.map((row, index) => (
              <fieldset key={index} className="fieldset">
                <legend className="fieldset__legend">Decision {index + 1}</legend>
                <div className="form-grid">
                  <TextInput
                    label="Item"
                    value={row.subject}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setDecisions(
                        decisions.map((d, i) => (i === index ? { ...d, subject: event.target.value } : d)),
                      )
                    }
                  />
                  <Select
                    label="To be acted on by"
                    placeholder="Name an officer"
                    options={meeting.attendance.map((entry) => ({
                      value: String(entry.userId),
                      label: entry.name,
                    }))}
                    value={row.actionById}
                    onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                      setDecisions(
                        decisions.map((d, i) => (i === index ? { ...d, actionById: event.target.value } : d)),
                      )
                    }
                  />
                  <TextInput
                    label="By when"
                    type="date"
                    value={row.dueDate}
                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                      setDecisions(
                        decisions.map((d, i) => (i === index ? { ...d, dueDate: event.target.value } : d)),
                      )
                    }
                  />
                  <TextArea
                    label="Decision"
                    full
                    rows={3}
                    value={row.decision}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setDecisions(
                        decisions.map((d, i) => (i === index ? { ...d, decision: event.target.value } : d)),
                      )
                    }
                  />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<TrashIcon />}
                    onClick={() => setDecisions(decisions.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              </fieldset>
            ))}

            <Button
              icon={<PlusIcon />}
              onClick={() =>
                setDecisions([...decisions, { subject: '', decision: '', actionById: '', dueDate: '' }])
              }
            >
              Add a decision
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function CloseActionDialog({ decisionId, onClose }: { decisionId: number; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'DONE' | 'DROPPED'>('DONE');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/committees/decisions/${decisionId}/close`, {
        status,
        closingNote: note || undefined,
      }),
    onSuccess: () => {
      toast.success('Action item closed');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not close it.'),
  });

  return (
    <Modal
      open
      title="Close the action item"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Close it
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not close">{message}</Alert>}
        <Select
          label="Outcome"
          options={[
            { value: 'DONE', label: 'Complied with' },
            { value: 'DROPPED', label: 'Dropped' },
          ]}
          value={status}
          onChange={(event) => setStatus(event.target.value as 'DONE' | 'DROPPED')}
        />
        <TextArea
          label="What was done"
          full
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          hint="What the committee will be told at its next sitting."
        />
      </div>
    </Modal>
  );
}

// --- Constituting a committee --------------------------------------------------

function CommitteeFormDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    code: '',
    name: '',
    kind: 'TENDER',
    purpose: '',
    quorum: '3',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post('/committees', {
        code: form.code,
        name: form.name,
        kind: form.kind,
        purpose: form.purpose || undefined,
        quorum: form.quorum,
      }),
    onSuccess: () => {
      toast.success('Committee constituted', 'Name its members before convening a sitting.');
      void queryClient.invalidateQueries({ queryKey: ['committees'] });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not constitute the committee.');
      }
    },
  });

  return (
    <Modal
      open
      title="Constitute a committee"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setErrors({}); setMessage(null); save.mutate(); }}
          >
            Constitute
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Code"
            required
            value={form.code}
            onChange={set('code')}
            error={errors.code}
            placeholder="e.g. DTC-NGR"
          />
          <TextInput label="Name" required value={form.name} onChange={set('name')} error={errors.name} />
          <Select
            label="Kind"
            options={COMMITTEE_KINDS.map((value) => ({ value, label: humanise(value) }))}
            value={form.kind}
            onChange={set('kind')}
          />
          <TextInput
            label="Quorum"
            required
            numeric
            value={form.quorum}
            onChange={set('quorum')}
            error={errors.quorum}
            hint="Members who must attend for the sitting to decide anything."
          />
          <TextArea label="Purpose" full rows={3} value={form.purpose} onChange={set('purpose')} />
        </div>
      </div>
    </Modal>
  );
}
