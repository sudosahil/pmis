import { useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import {
  currentFinancialYear, date, humanise, money, percent, rupees, rupeesShort,
} from '../lib/format';
import type { ReportCatalogue, ReportColumn, ReportResult, ReportRow } from '../types';
import {
  Alert, Button, Card, ChartIcon, EmptyState, Loading, PageHeader, PrinterIcon, Select,
  TextInput,
} from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';

/**
 * Reports and MIS.
 *
 * Six reports, each answering a question the department already asks on paper.
 * The server decides what each one contains and how each column should be read
 * — as money, a percentage, a date — so this screen renders any of them from
 * the same description rather than carrying six bespoke tables.
 */

const REPORT_ROUTE = '/reports';

export function ReportsPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();

  const catalogue = useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: () => api.get<ReportCatalogue>('/reports'),
  });

  const [filters, setFilters] = useState({
    financialYear: '',
    divisionId: '',
    from: '',
    to: '',
    chapter: '',
    changeKind: '',
    search: '',
    packageId: '',
  });

  const active = key ?? catalogue.data?.reports[0]?.key;

  const report = useQuery({
    queryKey: ['reports', active, filters],
    queryFn: () =>
      api.get<ReportResult>(`/reports/${active}`, {
        financialYear: filters.financialYear || undefined,
        divisionId: filters.divisionId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        chapter: filters.chapter || undefined,
        changeKind: filters.changeKind || undefined,
        search: filters.search || undefined,
        packageId: filters.packageId || undefined,
      }),
    enabled: Boolean(active),
  });

  if (catalogue.isLoading) return <Loading label="Loading reports…" />;
  if (catalogue.error || !catalogue.data) {
    return (
      <Alert variant="danger" title="Reports are not available">
        This screen is restricted to departmental staff holding the reports permission.
      </Alert>
    );
  }

  const definition = catalogue.data.reports.find((row) => row.key === active);
  const set = (field: keyof typeof filters, value: string) =>
    setFilters((current) => ({ ...current, [field]: value }));

  return (
    <>
      <PageHeader
        title="Reports &amp; MIS"
        subtitle={
          <>
            Departmental analysis across works, procurement, billing and approvals. Financial year{' '}
            <strong>{catalogue.data.financialYear}</strong>.
          </>
        }
        actions={
          report.data ? (
            <>
              <Button icon={<PrinterIcon />} onClick={() => window.print()}>Print</Button>
              <Button
                variant="primary"
                onClick={() => downloadCsv(report.data!)}
              >
                Download CSV
              </Button>
            </>
          ) : undefined
        }
      />

      <div className="tabs" role="tablist">
        {catalogue.data.reports.map((row) => (
          <button
            key={row.key}
            type="button"
            role="tab"
            aria-selected={row.key === active}
            className={`tab${row.key === active ? ' is-active' : ''}`}
            onClick={() => navigate(`${REPORT_ROUTE}/${row.key}`)}
          >
            {row.label}
          </button>
        ))}
      </div>

      {definition && (
        <p className="page-subtitle" style={{ marginBottom: 14 }}>{definition.description}</p>
      )}

      <Card title="Filters">
        <div className="form-grid">
          <TextInput
            label="Financial year"
            value={filters.financialYear}
            onChange={(event) => set('financialYear', event.target.value)}
            placeholder={currentFinancialYear()}
            hint="Leave blank for every year on record."
          />
          <Select
            label="Division"
            placeholder="Every division in my jurisdiction"
            options={catalogue.data.divisions.map((division) => ({
              value: String(division.id),
              label: `${division.code} — ${division.name}`,
            }))}
            value={filters.divisionId}
            onChange={(event) => set('divisionId', event.target.value)}
          />
          <TextInput
            label="From"
            type="date"
            value={filters.from}
            onChange={(event) => set('from', event.target.value)}
          />
          <TextInput
            label="To"
            type="date"
            value={filters.to}
            onChange={(event) => set('to', event.target.value)}
          />
          {(active === 'sr-rates' || active === 'sr-rate-history') && (
            <TextInput
              label="Chapter"
              value={filters.chapter}
              onChange={(event) => set('chapter', event.target.value)}
              placeholder="e.g. Roadwork"
            />
          )}
          {active === 'sr-rate-history' && (
            <Select
              label="Kind of change"
              placeholder="Every change"
              options={catalogue.data.changeKinds.map((kind) => ({
                value: kind,
                label: humanise(kind),
              }))}
              value={filters.changeKind}
              onChange={(event) => set('changeKind', event.target.value)}
            />
          )}
          {(active === 'sr-rates' || active === 'sr-rate-history') && (
            <TextInput
              label="Search"
              value={filters.search}
              onChange={(event) => set('search', event.target.value)}
              placeholder="Item number or description"
            />
          )}
        </div>
      </Card>

      <div style={{ height: 16 }} />

      {report.isLoading ? (
        <Loading label="Running the report…" />
      ) : report.error || !report.data ? (
        <Alert variant="danger" title="Could not run the report">Please adjust the filters and try again.</Alert>
      ) : (
        <ReportBody
          report={report.data}
          buckets={catalogue.data.ageingBuckets}
          onDrill={(packageId) => set('packageId', String(packageId))}
        />
      )}
    </>
  );
}

// --- Rendering a report ------------------------------------------------------

function ReportBody({
  report, onDrill,
}: {
  report: ReportResult;
  buckets: { key: string; label: string }[];
  onDrill: (packageId: number) => void;
}) {
  return (
    <div className="stack">
      <TotalsStrip report={report} />

      {report.buckets && <AgeingBuckets report={report} />}

      <Card
        title={report.label}
        subtitle={`${report.items.length} row(s) · run ${date(report.generatedAt)}`}
        flush
      >
        <ReportTable
          columns={report.columns}
          rows={report.items}
          onRowClick={
            report.key === 'boq-analysis'
              ? (row) => onDrill(Number(row.packageId))
              : undefined
          }
        />
      </Card>

      {report.lines && report.lines.length > 0 && (
        <Card title="Agreement lines" subtitle="Every item of the selected agreement, read against the schedule." flush>
          <ReportTable
            columns={[
              { key: 'slNo', label: 'Sl', numeric: true },
              { key: 'srCode', label: 'SR item' },
              { key: 'description', label: 'Item of work' },
              { key: 'uom', label: 'Unit' },
              { key: 'quantity', label: 'Quantity', numeric: true },
              { key: 'agreedRate', label: 'Agreed rate', numeric: true, money: true },
              { key: 'srRate', label: 'SR rate', numeric: true, money: true },
              { key: 'variancePercent', label: 'Variance', numeric: true, percent: true },
              { key: 'amount', label: 'Amount', numeric: true, money: true },
            ]}
            rows={report.lines}
          />
        </Card>
      )}

      {report.chapters && report.chapters.length > 0 && (
        <Card title="The rate book by chapter" flush>
          <ReportTable
            columns={[
              { key: 'chapter', label: 'Chapter' },
              { key: 'itemCount', label: 'Items', numeric: true },
              { key: 'activeCount', label: 'Active', numeric: true },
              { key: 'minRate', label: 'Lowest rate', numeric: true, money: true },
              { key: 'maxRate', label: 'Highest rate', numeric: true, money: true },
              { key: 'avgRate', label: 'Average rate', numeric: true, money: true },
              { key: 'usageCount', label: 'Used in agreements', numeric: true },
              { key: 'revisionCount', label: 'Revisions', numeric: true },
              { key: 'lastRevisedOn', label: 'Last revised', date: true },
            ]}
            rows={report.chapters}
          />
        </Card>
      )}

      {report.turnaround && report.turnaround.length > 0 && (
        <Card
          title="How long finished files actually took"
          subtitle="End to end, from raising to the final decision."
          flush
        >
          <ReportTable
            columns={[
              { key: 'entityType', label: 'Record type' },
              { key: 'completedCount', label: 'Completed', numeric: true },
              { key: 'approvedCount', label: 'Approved', numeric: true },
              { key: 'rejectedCount', label: 'Rejected', numeric: true },
              { key: 'approvalRate', label: 'Approval rate', numeric: true, percent: true },
              { key: 'avgDays', label: 'Average days', numeric: true },
              { key: 'fastestDays', label: 'Fastest', numeric: true },
              { key: 'slowestDays', label: 'Slowest', numeric: true },
            ]}
            rows={report.turnaround}
          />
        </Card>
      )}

      {report.officers && report.officers.length > 0 && (
        <Card
          title="What each officer has done"
          subtitle="Actions taken in the period, and what is still on their desk."
          flush
        >
          <ReportTable
            columns={[
              { key: 'name', label: 'Officer' },
              { key: 'role', label: 'Role' },
              { key: 'approved', label: 'Approved', numeric: true },
              { key: 'returned', label: 'Returned', numeric: true },
              { key: 'rejected', label: 'Rejected', numeric: true },
              { key: 'returnRate', label: 'Sent back', numeric: true, percent: true },
              { key: 'pendingNow', label: 'Pending now', numeric: true },
            ]}
            rows={report.officers}
          />
        </Card>
      )}
    </div>
  );
}

/** The headline figures, read straight from whatever totals the report carries. */
function TotalsStrip({ report }: { report: ReportResult }) {
  const entries = Object.entries(report.totals).filter(([, value]) => value !== null);
  if (!entries.length) return null;

  return (
    <div className="grid grid--4">
      {entries.slice(0, 8).map(([name, value]) => (
        <div key={name} className={`stat${isAlarming(name, value) ? ' stat--warn' : ''}`}>
          <div className="stat__label">{labelForTotal(name)}</div>
          <div className={`stat__value${isMoneyTotal(name) ? ' stat__value--currency' : ''}`}>
            {isMoneyTotal(name) ? rupeesShort(value ?? 0) : formatTotal(name, value)}
          </div>
        </div>
      ))}
    </div>
  );
}

const MONEY_TOTALS = new Set([
  'billed', 'paid', 'pending', 'amount', 'valueHeld', 'agreementValue', 'srValue',
  'varianceAmount', 'billedValue',
]);

const TOTAL_LABELS: Record<string, string> = {
  contractors: 'Contractors',
  bills: 'Bills',
  billed: 'Value billed',
  paid: 'Paid',
  pending: 'Pending',
  amount: 'Amount waiting',
  overdue: 'Past their service level',
  beyond90: 'Waiting over 90 days',
  oldestDays: 'Oldest, in days',
  packages: 'Agreements',
  items: 'Items',
  linesAboveSr: 'Lines above the schedule',
  agreementValue: 'At agreed rates',
  srValue: 'At schedule rates',
  varianceAmount: 'Difference',
  variancePercent: 'Variance',
  billedValue: 'Billed to date',
  chapters: 'Chapters',
  active: 'Active rates',
  inUse: 'Used in agreements',
  revised: 'Revised at least once',
  entries: 'Entries',
  revisions: 'Rate revisions',
  increases: 'Increases',
  decreases: 'Decreases',
  averageMovement: 'Average movement',
  filesPending: 'Files pending',
  valueHeld: 'Value held up',
  completed: 'Files completed',
};

function labelForTotal(name: string): string {
  return TOTAL_LABELS[name] ?? humanise(name.replace(/([A-Z])/g, ' $1'));
}

function isMoneyTotal(name: string): boolean {
  return MONEY_TOTALS.has(name);
}

/** The figures an officer is asked about: what is late, and what is stuck. */
function isAlarming(name: string, value: number | null): boolean {
  return ['overdue', 'beyond90'].includes(name) && (value ?? 0) > 0;
}

function formatTotal(name: string, value: number | null): string {
  if (value === null) return '—';
  if (name.endsWith('Percent') || name === 'averageMovement') return percent(value);
  return String(Math.round(value * 100) / 100);
}

/**
 * The ageing register, drawn as a bar per bucket. A treasury reads this shape
 * before it reads any number: the tail on the right is the problem.
 */
function AgeingBuckets({ report }: { report: ReportResult }) {
  const buckets = report.buckets ?? [];
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.amount));

  return (
    <Card
      title="How long bills have been waiting"
      subtitle="Measured from the day the bill was raised, not from the desk it is on now."
      flush
    >
      <div style={{ padding: '16px 18px', display: 'grid', gap: 12 }}>
        {buckets.map((bucket, index) => {
          const share = (bucket.amount / peak) * 100;
          // The last bucket is open-ended, and is the one that gets asked about.
          const critical = index >= buckets.length - 2 && bucket.count > 0;
          return (
            <div key={bucket.key} style={{ display: 'grid', gap: 4 }}>
              <div className="row row--between" style={{ fontSize: 13.5 }}>
                <span>{bucket.label}</span>
                <span>
                  <strong>{bucket.count}</strong> bill{bucket.count === 1 ? '' : 's'} ·{' '}
                  {rupees(bucket.amount)}
                </span>
              </div>
              <div className="progress" role="img" aria-label={`${bucket.label}: ${bucket.count} bills`}>
                <div
                  className={`progress__fill${critical ? ' progress__fill--warn' : ''}`}
                  style={{ width: `${Math.max(bucket.amount > 0 ? 2 : 0, share)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Renders any report table from the column description the server sends. */
function ReportTable({
  columns, rows, onRowClick,
}: {
  columns: ReportColumn[];
  rows: ReportRow[];
  onRowClick?: (row: ReportRow) => void;
}) {
  if (!rows.length) {
    return (
      <EmptyState
        icon={<ChartIcon size={40} />}
        title="Nothing to report for this period"
        text="Widen the dates, or clear the division filter."
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption className="visually-hidden">Report</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.numeric ? 'num' : undefined}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row.id ?? row.contractorId ?? row.packageId ?? index)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              style={onRowClick ? { cursor: 'pointer' } : undefined}
            >
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : undefined}>
                  <Cell column={column} row={row} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ column, row }: { column: ReportColumn; row: ReportRow }) {
  const value = row[column.key];

  if (value === null || value === undefined || value === '') return <>—</>;
  if (column.money) return <>{money(Number(value))}</>;
  if (column.date) return <>{date(String(value))}</>;
  if (column.percent) {
    const numeric = Number(value);
    return (
      <span
        style={
          numeric > 0
            ? { color: 'var(--warn-fg)', fontWeight: 700 }
            : numeric < 0
              ? { color: 'var(--ok-fg)' }
              : undefined
        }
      >
        {numeric > 0 ? '+' : ''}{percent(numeric)}
      </span>
    );
  }

  // A status reads as a badge wherever one turns up, and a bill links to itself.
  if (column.key === 'status') return <StatusBadge status={String(value)} />;
  if (column.key === 'changeKind') return <StatusBadge status={String(value)} />;
  if (column.key === 'billNo' && typeof row.link === 'string') {
    return <Link to={row.link} className="code">{String(value)}</Link>;
  }
  if (column.key === 'packageCode' && typeof row.link === 'string') {
    return <Link to={row.link} className="code">{String(value)}</Link>;
  }
  if (column.key === 'code' || column.key === 'srCode') {
    return <span className="code">{String(value)}</span>;
  }
  if (column.key === 'entityType') return <>{humanise(String(value))}</>;

  return <>{String(value)}</>;
}

// --- Taking it away ----------------------------------------------------------

/**
 * The department files reports; a screen it cannot take away is half a report.
 * The CSV is built from the same column description the table renders, so the
 * two can never drift apart.
 */
function downloadCsv(report: ReportResult): void {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [
    report.columns.map((column) => escape(column.label)).join(','),
    ...report.items.map((row) =>
      report.columns.map((column) => escape(row[column.key])).join(','),
    ),
  ];

  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${report.key}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
