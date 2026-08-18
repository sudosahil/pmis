import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { currentFinancialYear, date, rupees, rupeesShort } from '../lib/format';
import type { MiscBill } from '../types';
import { Card, PageHeader, PlusIcon, Select } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

const STATUSES = ['DRAFT', 'IN_APPROVAL', 'APPROVED', 'SENT_TO_TALLY', 'PAID', 'REJECTED', 'RETURNED'];

const CATEGORY_LABELS: Record<string, string> = {
  PROJECT_EXPENSE: 'Project expense',
  REVENUE_EXPENSE: 'Revenue expense',
  REFUND: 'Refund',
};

interface ObjectHeadRow {
  objectHead: string;
  total: number;
  billCount: number;
}

export function MiscBillsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const billCategory = params.get('billCategory') ?? '';
  const financialYear = params.get('financialYear') ?? '';
  const page = Number(params.get('page') ?? 1);

  const canRaise = hasRole('ADMIN', 'AC', 'AS', 'EE');

  const { data, isLoading } = useQuery({
    queryKey: ['misc-bills', search, status, billCategory, financialYear, page],
    queryFn: () =>
      api.get<Page<MiscBill>>('/misc-bills', {
        search: search || undefined,
        status: status || undefined,
        billCategory: billCategory || undefined,
        financialYear: financialYear || undefined,
        page,
        pageSize: 20,
      }),
  });

  const objectHeads = useQuery({
    queryKey: ['misc-bills', 'object-heads', financialYear || currentFinancialYear()],
    queryFn: () =>
      api.get<ObjectHeadRow[]>('/misc-bills/object-head-summary', {
        financialYear: financialYear || undefined,
      }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const currentFy = currentFinancialYear();
  const startYear = Number(currentFy.slice(0, 4));
  const fyOptions = Array.from({ length: 5 }, (_, index) => {
    const year = startYear - index;
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  });

  return (
    <>
      <PageHeader
        title="Miscellaneous bills"
        subtitle="Office, travel, material and contingency expenditure, booked against government object heads."
        actions={
          canRaise ? (
            <Link to="/misc-bills/new" className="btn btn--primary">
              <PlusIcon /> Raise a bill
            </Link>
          ) : undefined
        }
      />

      {(objectHeads.data?.length ?? 0) > 0 && (
        <Card
          title={`Expenditure by object head — ${financialYear || currentFy}`}
          subtitle="Only bills within your jurisdiction are counted."
        >
          <div className="grid grid--4">
            {objectHeads.data!.map((row) => (
              <div key={row.objectHead} className="stat">
                <div className="stat__label">{row.objectHead}</div>
                <div className="stat__value stat__value--currency">{rupeesShort(row.total)}</div>
                <div className="stat__meta">{row.billCount} bill{row.billCount === 1 ? '' : 's'}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="misc-search">Search</label>
            <input
              id="misc-search"
              type="search"
              className="input"
              placeholder="Bill number, payee or project"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Category"
            value={billCategory}
            onChange={(event) => setParam('billCategory', event.target.value)}
            placeholder="All categories"
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={STATUSES.map((value) => ({
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
          onRowClick={(row) => navigate(`/misc-bills/${row.id}`)}
          caption="Miscellaneous bills"
          columns={[
            {
              key: 'bill',
              header: 'Bill',
              render: (row) => (
                <>
                  <div className="cell-primary code">{row.billNo}</div>
                  <div className="cell-muted">{date(row.billDate)}</div>
                </>
              ),
            },
            {
              key: 'category',
              header: 'Category',
              render: (row) => (
                <>
                  <div>{CATEGORY_LABELS[row.billCategory] ?? row.billCategory}</div>
                  <div className="cell-muted">{row.project?.name ?? 'Not tied to a project'}</div>
                </>
              ),
            },
            {
              key: 'payee',
              header: 'Payee',
              render: (row) => (
                <>
                  <div>{row.payeeName}</div>
                  <div className="cell-muted">{row.payeeType.toLowerCase()}</div>
                </>
              ),
            },
            { key: 'division', header: 'Division', render: (row) => row.division.name },
            {
              key: 'gross',
              header: 'Gross',
              numeric: true,
              render: (row) => rupees(row.amounts.grossAmount),
            },
            {
              key: 'deduction',
              header: 'Deductions',
              numeric: true,
              render: (row) =>
                row.amounts.totalDeduction > 0 ? (
                  <span style={{ color: 'var(--danger-fg)' }}>−{rupees(row.amounts.totalDeduction)}</span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'net',
              header: 'Net payable',
              numeric: true,
              render: (row) => <strong>{rupees(row.amounts.netPayableAmount)}</strong>,
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: 'No bills found',
            text: canRaise
              ? 'Raise a bill to claim office, travel or material expenditure.'
              : 'Bills raised in your jurisdiction will appear here.',
            action: canRaise
              ? <Link to="/misc-bills/new" className="btn btn--primary">Raise a bill</Link>
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
