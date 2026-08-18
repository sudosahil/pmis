import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/Toast';
import { dateTime, initials, relativeTime } from '../lib/format';
import type { ActivityEntry, ActivityOverview, ActivityPage, OnlineUser } from '../types';
import {
  Alert, Button, Card, EmptyState, Loading, PageHeader, Select, ShieldIcon, TextInput,
} from '../components/ui';
import { ConfirmModal } from '../components/Modal';

/** How often the tail asks for anything new. */
const POLL_MS = 4000;
/** How many lines the live tail keeps on screen before dropping the oldest. */
const MAX_TAIL = 300;

function statusTone(status: number): string {
  if (status >= 500) return 'danger';
  if (status >= 400) return 'warn';
  return 'ok';
}

export function LiveActivityPage() {
  const toast = useToast();
  const queryClient = useQueryClient();

  const [live, setLive] = useState(true);
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState('');
  const [method, setMethod] = useState('');
  const [pruning, setPruning] = useState(false);

  // The id the next poll asks from. Null until the first page has landed.
  const cursor = useRef<number | null>(null);

  const filters = { search: search || undefined, only: only || undefined, method: method || undefined };

  // Changing a filter restarts the tail rather than mixing two result sets.
  useEffect(() => {
    cursor.current = null;
    setEntries([]);
  }, [search, only, method]);

  const overview = useQuery({
    queryKey: ['activity', 'overview'],
    queryFn: () => api.get<ActivityOverview>('/activity/overview'),
    refetchInterval: live ? POLL_MS * 2 : false,
  });

  const onlineUsers = useQuery({
    queryKey: ['activity', 'online'],
    queryFn: () => api.get<OnlineUser[]>('/activity/online'),
    refetchInterval: live ? POLL_MS * 2 : false,
  });

  const tail = useQuery({
    queryKey: ['activity', 'tail', search, only, method],
    queryFn: async () => {
      const page = await api.get<ActivityPage>('/activity', {
        ...filters,
        // The first call reads recent history; later calls ask only for new lines.
        ...(cursor.current === null ? { pageSize: 60 } : { sinceId: cursor.current, pageSize: 100 }),
      });

      if (page.items.length) {
        // The API returns newest first; the tail reads oldest to newest.
        const incoming = [...page.items].reverse();
        setEntries((current) => {
          const merged = cursor.current === null ? incoming : [...current, ...incoming];
          return merged.slice(-MAX_TAIL);
        });
      }
      cursor.current = page.latestId;
      return page;
    },
    refetchInterval: live ? POLL_MS : false,
  });

  const prune = useMutation({
    mutationFn: (days: number) => api.post<{ removed: number }>('/activity/prune', { days }),
    onSuccess: (result) => {
      toast.success('Old entries removed', `${result.removed} line(s) cleared from the log.`);
      setPruning(false);
      cursor.current = null;
      setEntries([]);
      void queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not prune', error instanceof ApiError ? error.message : undefined),
  });

  const visible = [...entries].reverse();

  return (
    <>
      <PageHeader
        title="Live activity"
        subtitle="Every action taken in PMIS, as it happens — who did it, what they did, and how the system answered."
        actions={
          <>
            <Button variant={live ? 'success' : 'default'} onClick={() => setLive((value) => !value)}>
              {live ? 'Live — pause' : 'Paused — resume'}
            </Button>
            <Button variant="ghost" onClick={() => setPruning(true)}>Clear old entries</Button>
          </>
        }
      />

      <Alert variant="info" title="This is the technical log">
        It records every screen opened and every action attempted, including ones that failed. The{' '}
        <strong>audit trail</strong> is the separate, permanent record of business events — sanctions,
        certifications, payments — in the department's own language.
      </Alert>

      {overview.data && (
        <div className="grid grid--4">
          <div className="stat stat--accent">
            <div className="stat__label">Online now</div>
            <div className="stat__value">{overview.data.onlineNow}</div>
            <div className="stat__meta">{overview.data.activeUsersLastHour} active in the last hour</div>
          </div>
          <div className="stat">
            <div className="stat__label">Requests, last hour</div>
            <div className="stat__value">{overview.data.requestsLastHour}</div>
            <div className="stat__meta">{overview.data.writesLastHour} changed something</div>
          </div>
          <div className={`stat${overview.data.errorsLastHour > 0 ? ' stat--warn' : ''}`}>
            <div className="stat__label">Refused or failed</div>
            <div className="stat__value">{overview.data.errorsLastHour}</div>
            <div className="stat__meta">In the last hour</div>
          </div>
          <div className="stat">
            <div className="stat__label">Slowest response</div>
            <div className="stat__value">{overview.data.slowestMs} ms</div>
            <div className="stat__meta">In the last hour</div>
          </div>
        </div>
      )}

      <div className="grid grid--2">
        <Card
          title="Who is online"
          subtitle="Anyone the system has served in the last two minutes."
          flush
        >
          {onlineUsers.isLoading ? (
            <Loading />
          ) : !onlineUsers.data?.length ? (
            <div style={{ padding: 16 }}>
              <EmptyState title="Nobody is signed in" text="Sessions appear here as officers start work." />
            </div>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {onlineUsers.data.map((row) => (
                <li
                  key={row.id}
                  style={{
                    display: 'flex', gap: 10, alignItems: 'center',
                    padding: '10px 18px', borderBottom: '1px solid var(--line-soft)',
                  }}
                >
                  <span className="header-user__avatar" style={{ background: 'var(--brand-100)', color: 'var(--brand-900)' }}>
                    {initials(row.fullName)}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 600 }}>{row.fullName}</span>
                    <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5 }}>
                      {[row.designation ?? row.roleCode, row.divisionName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span style={{ textAlign: 'right', flex: 'none' }}>
                    <span className="badge badge--ok">Online</span>
                    <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 11.5, marginTop: 3 }}>
                      {row.requestsToday} action{row.requestsToday === 1 ? '' : 's'} today
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Busiest today" subtitle="By number of actions in the last 24 hours." flush>
          {!overview.data?.topUsers.length ? (
            <div style={{ padding: 16 }}>
              <EmptyState title="No activity recorded yet" />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">Busiest users today</caption>
                <thead>
                  <tr>
                    <th scope="col">Officer</th>
                    <th scope="col">Role</th>
                    <th scope="col" className="num">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.topUsers.map((row) => (
                    <tr key={`${row.fullName}-${row.roleCode}`}>
                      <td>{row.fullName}</td>
                      <td>{row.roleCode}</td>
                      <td className="num">{row.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Live feed"
        subtitle={
          live
            ? 'Updating every few seconds. Newest first.'
            : 'Paused. Resume to keep following along.'
        }
        actions={
          <span className={`badge badge--${live ? 'ok' : 'neutral'}`}>
            {live ? 'Live' : 'Paused'}
          </span>
        }
        flush
      >
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="activity-search">Search</label>
            <input
              id="activity-search"
              type="search"
              className="input"
              placeholder="Officer, action or path"
              defaultValue={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <Select
            label="Show"
            value={only}
            onChange={(event) => setOnly(event.target.value)}
            placeholder="Everything"
            options={[
              { value: 'writes', label: 'Only changes' },
              { value: 'errors', label: 'Only refused or failed' },
            ]}
          />
          <Select
            label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            placeholder="Any method"
            options={['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((value) => ({ value, label: value }))}
          />
        </div>

        {tail.isLoading && !visible.length ? (
          <Loading label="Reading the log…" />
        ) : !visible.length ? (
          <EmptyState
            icon={<ShieldIcon size={40} />}
            title="Nothing recorded yet"
            text="Actions appear here the moment someone uses the system."
          />
        ) : (
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto' }}>
            <table className="table table--compact">
              <caption className="visually-hidden">Live activity feed</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 150 }}>When</th>
                  <th scope="col" style={{ width: 190 }}>Who</th>
                  <th scope="col">What they did</th>
                  <th scope="col" style={{ width: 90 }}>Method</th>
                  <th scope="col" style={{ width: 90 }}>Result</th>
                  <th scope="col" style={{ width: 80 }} className="num">Took</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => (
                  <tr key={entry.id}>
                    <td title={dateTime(entry.createdAt)}>{relativeTime(entry.createdAt)}</td>
                    <td>
                      <div className="cell-primary">{entry.fullName ?? 'Unknown'}</div>
                      <div className="cell-muted">{entry.roleCode}</div>
                    </td>
                    <td>
                      <div>{entry.action}</div>
                      <div className="cell-muted code">{entry.path}</div>
                    </td>
                    <td className="code">{entry.method}</td>
                    <td>
                      <span className={`badge badge--${statusTone(entry.statusCode)}`}>
                        {entry.statusCode}
                      </span>
                    </td>
                    <td className="num">{entry.durationMs} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <PruneDialog
        open={pruning}
        loading={prune.isPending}
        onConfirm={(days) => prune.mutate(days)}
        onClose={() => setPruning(false)}
      />
    </>
  );
}

function PruneDialog({
  open, loading, onConfirm, onClose,
}: {
  open: boolean;
  loading: boolean;
  onConfirm: (days: number) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState('30');

  return (
    <ConfirmModal
      open={open}
      title="Clear old activity entries"
      message={
        <div className="stack">
          <p>
            Entries older than the number of days below are deleted from the technical log. The
            audit trail is not touched.
          </p>
          <TextInput
            label="Keep the last"
            type="number"
            min="1"
            max="365"
            numeric
            value={days}
            onChange={(event) => setDays(event.target.value)}
            hint="Days of activity to keep."
          />
        </div>
      }
      confirmLabel="Clear entries"
      danger
      loading={loading}
      onConfirm={() => onConfirm(Number(days) || 30)}
      onClose={onClose}
    />
  );
}
