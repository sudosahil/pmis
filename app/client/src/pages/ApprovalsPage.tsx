import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { dateTime, humanise, relativeTime, rupees } from '../lib/format';
import type { InboxItem } from '../types';
import { Card, PageHeader, Select } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

/** Where each record type lives, so a row can link through to it. */
const ENTITY_ROUTES: Record<string, string> = {
  PROJECT: '/projects',
  TENDER: '/tenders',
  RA_BILL: '/ra-bills',
  MISC_BILL: '/misc-bills',
  CONTRACTOR: '/contractors',
  LOC: '/funds',
};

const ENTITY_LABELS: Record<string, string> = {
  PROJECT: 'Project sanction',
  TENDER: 'Tender approval',
  RA_BILL: 'RA bill',
  MISC_BILL: 'Miscellaneous bill',
  CONTRACTOR: 'Contractor registration',
  LOC: 'Letter of credit',
};

type TabKey = 'inbox' | 'submitted';

export function ApprovalsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<TabKey>('inbox');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const inbox = useQuery({
    queryKey: ['approvals', 'inbox', entityType, page],
    queryFn: () =>
      api.get<Page<InboxItem>>('/approvals/inbox', {
        entityType: entityType || undefined,
        page,
        pageSize,
      }),
    enabled: tab === 'inbox',
  });

  const submitted = useQuery({
    queryKey: ['approvals', 'my-submissions', page],
    queryFn: () => api.get<Page<InboxItem>>('/approvals/my-submissions', { page, pageSize }),
    enabled: tab === 'submitted',
  });

  const active = tab === 'inbox' ? inbox : submitted;

  function openRecord(row: InboxItem) {
    const base = ENTITY_ROUTES[row.entityType];
    // LOC records live under the funds screen, addressed by their own id.
    if (row.entityType === 'LOC') navigate(`/funds/loc/${row.entityId}`);
    else if (base) navigate(`${base}/${row.entityId}`);
  }

  return (
    <>
      <PageHeader
        title="My approvals"
        subtitle="Files waiting for your decision, and the ones you have sent onward."
      />

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={`tab${tab === 'inbox' ? ' is-active' : ''}`}
          onClick={() => { setTab('inbox'); setPage(1); }}
        >
          Awaiting my action
          {inbox.data ? <span className="tab__count">({inbox.data.total})</span> : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'submitted'}
          className={`tab${tab === 'submitted' ? ' is-active' : ''}`}
          onClick={() => { setTab('submitted'); setPage(1); }}
        >
          Raised by me
          {submitted.data ? <span className="tab__count">({submitted.data.total})</span> : null}
        </button>
      </div>

      <Card flush>
        {tab === 'inbox' && (
          <div className="filter-bar">
            <Select
              label="Record type"
              value={entityType}
              onChange={(event) => { setEntityType(event.target.value); setPage(1); }}
              placeholder="All record types"
              options={Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </div>
        )}

        <DataTable
          rows={active.data?.items ?? []}
          rowKey={(row) => row.instanceId}
          loading={active.isLoading}
          onRowClick={openRecord}
          caption="Approval items"
          columns={[
            {
              key: 'ref',
              header: 'Reference',
              render: (row) => (
                <>
                  <div className="cell-primary code">{row.entityRef}</div>
                  <div className="cell-muted">{row.title}</div>
                </>
              ),
            },
            {
              key: 'type',
              header: 'Type',
              render: (row) => (
                <>
                  <div>{ENTITY_LABELS[row.entityType] ?? humanise(row.entityType)}</div>
                  {row.divisionName && <div className="cell-muted">{row.divisionName}</div>}
                </>
              ),
            },
            {
              key: 'stage',
              header: 'Stage',
              render: (row) =>
                tab === 'inbox' ? (
                  <>
                    <div>{row.stepName}</div>
                    <div className="cell-muted">Raised by {row.initiatedBy ?? '—'}</div>
                  </>
                ) : (
                  <>
                    <StatusBadge status={row.status} />
                    <div className="cell-muted" style={{ marginTop: 3 }}>
                      {row.status === 'IN_PROGRESS' ? `With ${row.stepName}` : dateTime(row.createdAt)}
                    </div>
                  </>
                ),
            },
            {
              key: 'due',
              header: 'Due',
              render: (row) =>
                row.dueAt ? (
                  <span style={row.isOverdue ? { color: 'var(--danger-fg)', fontWeight: 600 } : undefined}>
                    {row.isOverdue ? 'Overdue ' : ''}
                    {relativeTime(row.dueAt)}
                  </span>
                ) : (
                  <span className="cell-muted">—</span>
                ),
            },
            {
              key: 'amount',
              header: 'Amount',
              numeric: true,
              render: (row) => (row.amount > 0 ? rupees(row.amount) : <span className="cell-muted">—</span>),
            },
            {
              key: 'open',
              header: '',
              actions: true,
              render: (row) => {
                const to = row.entityType === 'LOC'
                  ? `/funds/loc/${row.entityId}`
                  : `${ENTITY_ROUTES[row.entityType] ?? '/dashboard'}/${row.entityId}`;
                return <Link to={to} className="btn btn--sm btn--primary">Open</Link>;
              },
            },
          ]}
          empty={
            tab === 'inbox'
              ? {
                  title: 'Your desk is clear',
                  text: 'No files are waiting for your action. New items appear here as soon as a colleague forwards them.',
                }
              : {
                  title: 'You have not raised anything yet',
                  text: 'Projects, tenders and bills you submit will be tracked here until they are decided.',
                }
          }
        />

        {active.data && (
          <Pagination
            page={active.data.page}
            pageSize={active.data.pageSize}
            total={active.data.total}
            onPageChange={setPage}
          />
        )}
      </Card>
    </>
  );
}
