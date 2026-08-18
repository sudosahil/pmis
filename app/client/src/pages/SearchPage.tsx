import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { rupeesShort } from '../lib/format';
import type { Contractor, MiscBill, Package, Project, RaBill, Tender } from '../types';
import { Card, EmptyState, Loading, PageHeader, SearchIcon } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';

interface Hit {
  to: string;
  code: string;
  title: string;
  meta: string;
  status: string;
  amount?: number;
}

const PAGE_SIZE = 5;

export function SearchPage() {
  const [params] = useSearchParams();
  const term = params.get('q')?.trim() ?? '';
  const { isContractor } = useAuth();

  const enabled = term.length >= 2;
  const query = { search: term, pageSize: PAGE_SIZE };

  const projects = useQuery({
    queryKey: ['search', 'projects', term],
    queryFn: () => api.get<Page<Project>>('/projects', query),
    enabled,
  });
  const packages = useQuery({
    queryKey: ['search', 'packages', term],
    queryFn: () => api.get<Page<Package>>('/packages', query),
    enabled,
  });
  const tenders = useQuery({
    queryKey: ['search', 'tenders', term],
    queryFn: () => api.get<Page<Tender>>('/tenders', query),
    enabled,
  });
  const raBills = useQuery({
    queryKey: ['search', 'ra-bills', term],
    queryFn: () => api.get<Page<RaBill>>('/ra-bills', query),
    enabled,
  });
  const miscBills = useQuery({
    queryKey: ['search', 'misc-bills', term],
    queryFn: () => api.get<Page<MiscBill>>('/misc-bills', query),
    enabled: enabled && !isContractor,
  });
  const contractors = useQuery({
    queryKey: ['search', 'contractors', term],
    queryFn: () => api.get<Page<Contractor>>('/contractors', query),
    enabled: enabled && !isContractor,
  });

  const groups: { title: string; total: number; loading: boolean; hits: Hit[] }[] = [
    {
      title: 'Projects',
      total: projects.data?.total ?? 0,
      loading: projects.isLoading,
      hits: (projects.data?.items ?? []).map((row) => ({
        to: `/projects/${row.id}`,
        code: row.projectCode,
        title: row.name,
        meta: `${row.scheme.name} · ${row.location.divisionName}`,
        status: row.status,
        amount: row.estimatedCost,
      })),
    },
    {
      title: 'Packages',
      total: packages.data?.total ?? 0,
      loading: packages.isLoading,
      hits: (packages.data?.items ?? []).map((row) => ({
        to: `/packages/${row.id}`,
        code: row.packageCode,
        title: row.name,
        meta: `${row.project.name} · ${row.contractor?.name ?? 'Not awarded'}`,
        status: row.status,
        amount: row.awardedValue || row.estimatedValue,
      })),
    },
    {
      title: 'Tenders',
      total: tenders.data?.total ?? 0,
      loading: tenders.isLoading,
      hits: (tenders.data?.items ?? []).map((row) => ({
        to: `/tenders/${row.id}`,
        code: row.tenderNo,
        title: row.title,
        meta: `${row.project.name} · ${row.division.name}`,
        status: row.status,
        amount: row.estimatedValue,
      })),
    },
    {
      title: 'RA bills',
      total: raBills.data?.total ?? 0,
      loading: raBills.isLoading,
      hits: (raBills.data?.items ?? []).map((row) => ({
        to: `/ra-bills/${row.id}`,
        code: row.billNo,
        title: row.package.name,
        meta: `${row.contractor.name} · RA ${row.raSequence}${row.dbrNo ? ` · DBR ${row.dbrNo}` : ''}`,
        status: row.status,
        amount: row.amounts.netPayableAmount,
      })),
    },
    {
      title: 'Miscellaneous bills',
      total: miscBills.data?.total ?? 0,
      loading: miscBills.isLoading,
      hits: (miscBills.data?.items ?? []).map((row) => ({
        to: `/misc-bills/${row.id}`,
        code: row.billNo,
        title: row.payeeName,
        meta: `${row.division.name} · ${row.financialYear}`,
        status: row.status,
        amount: row.amounts.netPayableAmount,
      })),
    },
    {
      title: 'Contractors',
      total: contractors.data?.total ?? 0,
      loading: contractors.isLoading,
      hits: (contractors.data?.items ?? []).map((row) => ({
        to: `/contractors/${row.id}`,
        code: row.code,
        title: row.name,
        meta: [row.registrationClass, row.address.city].filter(Boolean).join(' · ') || 'No class recorded',
        status: row.registrationStatus,
      })),
    },
  ].filter((group) => group.loading || group.hits.length > 0);

  const anyLoading = groups.some((group) => group.loading);
  const totalHits = groups.reduce((sum, group) => sum + group.hits.length, 0);

  return (
    <>
      <PageHeader
        title={term ? `Search results for “${term}”` : 'Search'}
        subtitle="Projects, packages, tenders, bills and contractors you are permitted to see."
      />

      {!enabled ? (
        <Card>
          <EmptyState
            icon={<SearchIcon size={40} />}
            title="Type at least two characters"
            text="Search by project code, tender number, bill number, DBR number, contractor name or package code."
          />
        </Card>
      ) : anyLoading && totalHits === 0 ? (
        <Loading label="Searching…" />
      ) : totalHits === 0 ? (
        <Card>
          <EmptyState
            icon={<SearchIcon size={40} />}
            title="Nothing matched"
            text={`No record in your jurisdiction matches “${term}”. Check the spelling, or try part of a code.`}
          />
        </Card>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <Card
              key={group.title}
              title={group.title}
              subtitle={
                group.total > group.hits.length
                  ? `Showing the first ${group.hits.length} of ${group.total} matches`
                  : `${group.total} match${group.total === 1 ? '' : 'es'}`
              }
              flush
            >
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {group.hits.map((hit) => (
                  <li key={hit.to}>
                    <Link
                      to={hit.to}
                      style={{
                        display: 'flex',
                        gap: 14,
                        alignItems: 'center',
                        padding: '12px 18px',
                        borderBottom: '1px solid var(--line-soft)',
                        color: 'inherit',
                      }}
                    >
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span className="code" style={{ display: 'block', fontWeight: 600 }}>{hit.code}</span>
                        <span style={{ display: 'block' }}>{hit.title}</span>
                        <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 13 }}>{hit.meta}</span>
                      </span>
                      {hit.amount !== undefined && (
                        <span style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
                          {rupeesShort(hit.amount)}
                        </span>
                      )}
                      <span style={{ flex: 'none' }}><StatusBadge status={hit.status} /></span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
