import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { dateTime, humanise } from '../lib/format';
import type { AuditEntry } from '../types';
import { Card, PageHeader, Select, TextInput } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';

/** The entity types the audit log records against, for the filter dropdown. */
const ENTITY_TYPES = [
  'PROJECT', 'PACKAGE', 'TENDER', 'BID', 'RA_BILL', 'MISC_BILL',
  'CONTRACTOR', 'USER', 'FUND_RELEASE', 'LOC_REQUEST', 'MASTER', 'WORKFLOW',
];

export function AuditPage() {
  const [params, setParams] = useSearchParams();

  const entityType = params.get('entityType') ?? '';
  const action = params.get('action') ?? '';
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? 1);

  const { data, isLoading } = useQuery({
    queryKey: ['audit', entityType, action, from, to, page],
    queryFn: () =>
      api.get<Page<AuditEntry>>('/audit', {
        entityType: entityType || undefined,
        action: action || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
        pageSize: 50,
      }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Audit trail"
        subtitle="Every change to a record, with who made it and when. Entries are written by the system and cannot be edited or deleted."
      />

      <Card flush>
        <div className="filter-bar">
          <Select
            label="Record type"
            value={entityType}
            onChange={(event) => setParam('entityType', event.target.value)}
            placeholder="All record types"
            options={ENTITY_TYPES.map((value) => ({ value, label: humanise(value) }))}
          />
          <div className="field field--search">
            <label className="field__label" htmlFor="audit-action">Action</label>
            <input
              id="audit-action"
              type="search"
              className="input"
              placeholder="e.g. RA_BILL_CREATED"
              defaultValue={action}
              onChange={(event) => setParam('action', event.target.value)}
            />
          </div>
          <TextInput
            label="From date"
            type="date"
            value={from}
            onChange={(event) => setParam('from', event.target.value)}
          />
          <TextInput
            label="To date"
            type="date"
            value={to}
            onChange={(event) => setParam('to', event.target.value)}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          compact
          caption="Audit trail"
          columns={[
            {
              key: 'when',
              header: 'When',
              width: '190px',
              render: (row) => dateTime(row.createdAt),
            },
            {
              key: 'who',
              header: 'Who',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.userName ?? 'System'}</div>
                  {row.ipAddress && <div className="cell-muted code">{row.ipAddress}</div>}
                </>
              ),
            },
            {
              key: 'action',
              header: 'Action',
              render: (row) => <span className="code">{row.action}</span>,
            },
            {
              key: 'entity',
              header: 'Record',
              render: (row) =>
                row.entityType ? (
                  <>
                    <div>{humanise(row.entityType)}</div>
                    {row.entityId !== null && <div className="cell-muted">#{row.entityId}</div>}
                  </>
                ) : (
                  '—'
                ),
            },
            { key: 'detail', header: 'Detail', render: (row) => row.detail ?? '—' },
          ]}
          empty={{
            title: 'No audit entries match',
            text: 'Widen the date range or clear the filters.',
          }}
        />

        {data && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(next) => setParam('page', String(next))}
          />
        )}
      </Card>
    </>
  );
}
