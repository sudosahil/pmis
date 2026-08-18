import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { date, percent } from '../lib/format';
import type { Contractor } from '../types';
import { Card, PageHeader, Select } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

const REGISTRATION_STATUSES = ['PENDING', 'VERIFIED', 'APPROVED', 'REJECTED'];
const CLASSES = ['Class A', 'Class B', 'Class C', 'Class D'];

export function ContractorsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const search = params.get('search') ?? '';
  const registrationStatus = params.get('registrationStatus') ?? '';
  const registrationClass = params.get('registrationClass') ?? '';
  const blacklisted = params.get('blacklisted') ?? '';
  const page = Number(params.get('page') ?? 1);

  const { data, isLoading } = useQuery({
    queryKey: ['contractors', search, registrationStatus, registrationClass, blacklisted, page],
    queryFn: () =>
      api.get<Page<Contractor>>('/contractors', {
        search: search || undefined,
        registrationStatus: registrationStatus || undefined,
        registrationClass: registrationClass || undefined,
        blacklisted: blacklisted || undefined,
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

  return (
    <>
      <PageHeader
        title="Contractors"
        subtitle="Firms registered with the department, their class of registration and their standing."
        actions={
          <Link to="/register" className="btn" target="_blank" rel="noreferrer">
            Open the public registration form
          </Link>
        }
      />

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="contractor-search">Search</label>
            <input
              id="contractor-search"
              type="search"
              className="input"
              placeholder="Name, code, PAN, GSTIN or registration number"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Registration"
            value={registrationStatus}
            onChange={(event) => setParam('registrationStatus', event.target.value)}
            placeholder="Any registration state"
            options={REGISTRATION_STATUSES.map((value) => ({
              value,
              label: value.charAt(0) + value.slice(1).toLowerCase(),
            }))}
          />
          <Select
            label="Class"
            value={registrationClass}
            onChange={(event) => setParam('registrationClass', event.target.value)}
            placeholder="Any class"
            options={CLASSES.map((value) => ({ value, label: value }))}
          />
          <Select
            label="Standing"
            value={blacklisted}
            onChange={(event) => setParam('blacklisted', event.target.value)}
            placeholder="All firms"
            options={[
              { value: 'false', label: 'In good standing' },
              { value: 'true', label: 'Blacklisted' },
            ]}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/contractors/${row.id}`)}
          caption="Registered contractors"
          columns={[
            {
              key: 'firm',
              header: 'Firm',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.name}</div>
                  <div className="cell-muted code">{row.code}</div>
                </>
              ),
            },
            {
              key: 'class',
              header: 'Class',
              render: (row) => (
                <>
                  <div>{row.registrationClass ?? '—'}</div>
                  <div className="cell-muted">{row.contractorType ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'contact',
              header: 'Contact',
              render: (row) => (
                <>
                  <div>{row.contactPerson ?? row.name}</div>
                  <div className="cell-muted">{row.phone ?? row.email}</div>
                </>
              ),
            },
            {
              key: 'place',
              header: 'Place',
              render: (row) => [row.address.city, row.address.state].filter(Boolean).join(', ') || '—',
            },
            {
              key: 'tax',
              header: 'PAN / TDS',
              render: (row) => (
                <>
                  <div className="code">{row.pan}</div>
                  <div className="cell-muted">TDS {percent(row.tdsRate)}</div>
                </>
              ),
            },
            {
              key: 'works',
              header: 'Live works',
              numeric: true,
              render: (row) => row.activePackages,
            },
            {
              key: 'validity',
              header: 'Valid till',
              render: (row) => date(row.validityDate),
            },
            {
              key: 'status',
              header: 'Standing',
              render: (row) =>
                row.isBlacklisted ? (
                  <StatusBadge status="BLACKLISTED" tone="danger" />
                ) : (
                  <StatusBadge status={row.registrationStatus} />
                ),
            },
          ]}
          empty={{
            title: 'No contractors match',
            text: 'Clear the filters, or ask the firm to register through the public form.',
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
