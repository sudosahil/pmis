import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { currentFinancialYear, date, rupees, rupeesShort } from '../lib/format';
import type { RaBill } from '../types';
import { Card, PageHeader, PlusIcon, Select } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

const BILL_STATUSES = [
  'DRAFT', 'IN_APPROVAL', 'APPROVED', 'SENT_TO_TALLY', 'PAID', 'REJECTED', 'RETURNED',
];

export function RaBillsPage() {
  const navigate = useNavigate();
  const { hasRole, isContractor } = useAuth();
  const [params, setParams] = useSearchParams();

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const financialYear = params.get('financialYear') ?? '';
  const page = Number(params.get('page') ?? 1);

  const canRaise = isContractor || hasRole('ADMIN', 'EE', 'AEE', 'AE', 'AC');

  const { data, isLoading } = useQuery({
    queryKey: ['ra-bills', search, status, financialYear, page],
    queryFn: () =>
      api.get<Page<RaBill>>('/ra-bills', {
        search: search || undefined,
        status: status || undefined,
        financialYear: financialYear || undefined,
        page,
        pageSize: 20,
      }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  // Financial year options: the current year and the four before it.
  const currentFy = currentFinancialYear();
  const startYear = Number(currentFy.slice(0, 4));
  const fyOptions = Array.from({ length: 5 }, (_, i) => {
    const y = startYear - i;
    return `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  });

  return (
    <>
      <PageHeader
        title="Running account bills"
        subtitle="Progress payments against awarded work packages, with ETP charges and statutory deductions."
        actions={
          canRaise ? (
            <Link to="/ra-bills/new" className="btn btn--primary">
              <PlusIcon /> Raise a bill
            </Link>
          ) : undefined
        }
      />

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="bill-search">Search</label>
            <input
              id="bill-search"
              type="search"
              className="input"
              placeholder="Bill number, DBR number, project or contractor"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={BILL_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
          <Select
            label="Financial year"
            value={financialYear}
            onChange={(event) => setParam('financialYear', event.target.value)}
            placeholder="All years"
            options={fyOptions.map((value) => ({ value, label: value }))}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/ra-bills/${row.id}`)}
          caption="Running account bills"
          columns={[
            {
              key: 'bill',
              header: 'Bill',
              render: (row) => (
                <>
                  <div className="cell-primary code">{row.billNo}</div>
                  <div className="cell-muted">
                    RA {row.raSequence}
                    {row.dbrNo ? ` · DBR ${row.dbrNo}` : ''}
                    {row.billType === 'FINAL' ? ' · Final bill' : ''}
                  </div>
                </>
              ),
            },
            {
              key: 'work',
              header: 'Work',
              render: (row) => (
                <>
                  <div>{row.package.name}</div>
                  <div className="cell-muted">{row.project.name}</div>
                </>
              ),
            },
            {
              key: 'contractor',
              header: 'Contractor',
              render: (row) => (
                <>
                  <div>{row.contractor.name}</div>
                  <div className="cell-muted">
                    {date(row.periodFrom)} – {date(row.periodTo)}
                  </div>
                </>
              ),
            },
            {
              key: 'gross',
              header: 'Gross',
              numeric: true,
              render: (row) => rupees(row.amounts.presentBillAmount),
            },
            {
              key: 'deduction',
              header: 'Deductions',
              numeric: true,
              render: (row) => (
                <span style={{ color: 'var(--danger-fg)' }}>
                  −{rupees(row.amounts.totalDeduction)}
                </span>
              ),
            },
            {
              key: 'net',
              header: 'Net payable',
              numeric: true,
              render: (row) => <strong>{rupees(row.amounts.netPayableAmount)}</strong>,
            },
            {
              key: 'etp',
              header: 'ETP',
              numeric: true,
              render: (row) => (
                <>
                  <div>{rupeesShort(row.etp.totalAmount)}</div>
                  <div className="cell-muted">{row.etp.totalPercent.toFixed(2)}%</div>
                </>
              ),
            },
            {
              key: 'pending',
              header: 'Pending with',
              render: (row) =>
                row.pendingWith ? (
                  <>
                    <div className="cell-primary">
                      {row.pendingWith.officer ?? row.pendingWith.role ?? 'Unassigned'}
                    </div>
                    <div className="cell-muted">{row.pendingWith.step}</div>
                  </>
                ) : (
                  <span className="cell-muted">Not in approval</span>
                ),
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: 'No bills found',
            text: canRaise
              ? 'Raise a running account bill against an awarded package.'
              : 'Bills raised in your jurisdiction will appear here.',
            action: canRaise
              ? <Link to="/ra-bills/new" className="btn btn--primary">Raise a bill</Link>
              : undefined,
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
