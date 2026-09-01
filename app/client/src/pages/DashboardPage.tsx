import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import {
  date, dateTime, humanise, relativeTime, rupees, rupeesShort,
} from '../lib/format';
import {
  isContractorDashboard, type ContractorDashboard, type Dashboard, type StaffDashboard,
} from '../types';
import { Alert, Card, DetailItem, EmptyState, Loading, PageHeader, Progress, Button, PlusIcon } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';
import { DataTable, type Column } from '../components/DataTable';
import { TrendChart } from '../components/charts/TrendChart';
import { ColumnChart } from '../components/charts/ColumnChart';
import { BarRows } from '../components/charts/BarRows';
import { StackedBar } from '../components/charts/StackedBar';
import {
  AGE_RAMP, PROJECT_STATUS_COLOUR, SERIES, TENDER_STAGE_COLOUR,
} from '../components/charts/chart-kit';

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<Dashboard>('/dashboard'),
  });

  if (isLoading) return <Loading label="Loading your dashboard…" />;
  if (error || !data) {
    return <Alert variant="danger" title="Could not load the dashboard">Please refresh the page.</Alert>;
  }

  const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader
        title={`${greeting}, ${user?.fullName?.split(' ').slice(-1)[0] ?? ''}`}
        subtitle={
          <>
            {user?.designation ?? user?.roleName}
            {user?.divisionName ? ` · ${user.divisionName}` : ''}
            {' · Financial year '}
            <strong>{data.financialYear}</strong>
          </>
        }
      />
      {isContractorDashboard(data) ? <ContractorView data={data} /> : <StaffView data={data} />}
    </>
  );
}

/* ==========================================================================
   Departmental staff
   ========================================================================== */

function StaffView({ data }: { data: StaffDashboard }) {
  const { can } = useAuth();
  const { cards, myApprovals } = data;

  return (
    <div className="stack">
      {myApprovals.total > 0 && (
        <Alert variant="warn" title={`${myApprovals.total} item${myApprovals.total === 1 ? '' : 's'} awaiting your action`}>
          These files cannot move until you act on them.{' '}
          <Link to="/approvals">Open my approvals</Link>
        </Alert>
      )}

      <div className="grid grid--4">
        <Link to="/projects" className="stat stat--accent">
          <div className="stat__label">Projects</div>
          <div className="stat__value">{cards.projects.total}</div>
          <div className="stat__meta">
            <span>{cards.projects.inProgress} in progress</span>
            {cards.projects.pendingSanction > 0 && <span>{cards.projects.pendingSanction} awaiting sanction</span>}
          </div>
        </Link>

        <Link to="/projects" className="stat">
          <div className="stat__label">Sanctioned value</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.projects.sanctionedValue)}</div>
          <div className="stat__meta"><span>{cards.projects.completed} completed works</span></div>
        </Link>

        <Link to="/ra-bills" className="stat">
          <div className="stat__label">RA bills paid</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.raBills.paidValue)}</div>
          <div className="stat__meta"><span>{cards.raBills.paid} of {cards.raBills.total} bills</span></div>
        </Link>

        <Link to="/ra-bills?status=IN_APPROVAL" className="stat stat--warn">
          <div className="stat__label">Bills in approval</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.raBills.pendingValue)}</div>
          <div className="stat__meta"><span>{cards.raBills.inApproval} bills pending</span></div>
        </Link>
      </div>

      <div className="grid grid--4">
        <Link to="/tenders" className="stat">
          <div className="stat__label">Live tenders</div>
          <div className="stat__value">{cards.tenders.published}</div>
          <div className="stat__meta">
            <span>{cards.tenders.underEvaluation} under evaluation</span>
            <span>{cards.tenders.awarded} awarded</span>
          </div>
        </Link>

        <Link to="/misc-bills" className="stat">
          <div className="stat__label">Miscellaneous bills</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.miscBills.paidValue)}</div>
          <div className="stat__meta"><span>{cards.miscBills.inApproval} in approval</span></div>
        </Link>

        <Link to="/funds" className="stat">
          <div className="stat__label">Funds released</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.funds.released)}</div>
          <div className="stat__meta"><span>LOC {rupeesShort(cards.funds.locApproved)}</span></div>
        </Link>

        {cards.contractors ? (
          <Link to="/contractors" className="stat">
            <div className="stat__label">Contractors</div>
            <div className="stat__value">{cards.contractors.approved}</div>
            <div className="stat__meta">
              {cards.contractors.pending > 0 && <span>{cards.contractors.pending} pending</span>}
              {cards.contractors.blacklisted > 0 && <span>{cards.contractors.blacklisted} blacklisted</span>}
            </div>
          </Link>
        ) : (
          <Link to="/approvals" className="stat">
            <div className="stat__label">My approvals</div>
            <div className="stat__value">{myApprovals.total}</div>
            <div className="stat__meta"><span>Files awaiting your action</span></div>
          </Link>
        )}
      </div>

      <div className="grid grid--2">
        <Card
          title="Awaiting your action"
          subtitle={myApprovals.total ? `${myApprovals.total} file(s) pending with you` : undefined}
          actions={myApprovals.total > 0 ? <Link to="/approvals" className="btn btn--sm">View all</Link> : undefined}
          flush
        >
          {myApprovals.items.length ? (
            <DataTable
              rows={myApprovals.items}
              rowKey={(row) => row.instanceId}
              compact
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
                  key: 'step',
                  header: 'Stage',
                  render: (row) => (
                    <>
                      <div>{row.stepName}</div>
                      <div className="cell-muted">
                        {row.isOverdue ? (
                          <span style={{ color: 'var(--danger-fg)', fontWeight: 600 }}>
                            Overdue {relativeTime(row.dueAt)}
                          </span>
                        ) : (
                          `Due ${relativeTime(row.dueAt)}`
                        )}
                      </div>
                    </>
                  ),
                },
                { key: 'amount', header: 'Amount', numeric: true, render: (row) => rupees(row.amount) },
              ]}
              empty={{ title: 'Nothing pending with you' }}
            />
          ) : (
            <EmptyState title="Your desk is clear" text="No files are waiting for your action right now." />
          )}
        </Card>

        <Card
          title="Scheme-wise utilisation"
          subtitle="Sanctioned against paid, current position"
          actions={
            can('reports.view') ? (
              <Link to="/reports/contractor-bills" className="btn btn--sm">Reports</Link>
            ) : undefined
          }
          flush
        >
          {data.spendByScheme.length ? (
            <>
              <div className="card__chart">
                <BarRows
                  rows={data.spendByScheme.map((row) => ({
                    key: row.schemeCode,
                    label: row.schemeCode,
                    sublabel: `${row.projectCount} project(s)`,
                    value: row.paid,
                    of: row.sanctioned,
                    note: `${rupeesShort(row.paid)} of ${rupeesShort(row.sanctioned)}`,
                  }))}
                  format={rupeesShort}
                />
              </div>
              <details className="chart-figures">
                <summary>Show the figures</summary>
                <DataTable
                  rows={data.spendByScheme}
                  rowKey={(row) => row.schemeCode}
                  compact
                  columns={[
                    {
                      key: 'scheme',
                      header: 'Scheme',
                      render: (row) => (
                        <>
                          <div className="cell-primary">{row.schemeCode}</div>
                          <div className="cell-muted">{row.schemeName}</div>
                        </>
                      ),
                    },
                    { key: 'sanctioned', header: 'Sanctioned', numeric: true, render: (row) => rupeesShort(row.sanctioned) },
                    { key: 'paid', header: 'Paid', numeric: true, render: (row) => rupeesShort(row.paid) },
                    {
                      key: 'util',
                      header: 'Utilisation',
                      width: '150px',
                      render: (row) => <Progress value={row.utilisation} label={`${row.schemeName} utilisation`} />,
                    },
                  ]}
                />
              </details>
            </>
          ) : (
            <EmptyState title="No scheme spend recorded yet" />
          )}
        </Card>
      </div>

      {data.overdueApprovals.length > 0 && (
        <Card
          title="Files past their service level"
          subtitle="Grouped by the role that owes an action"
          actions={
            can('reports.view') ? (
              <Link to="/reports/approval-analysis" className="btn btn--sm">
                Full approval analysis
              </Link>
            ) : undefined
          }
          flush
        >
          <>
            <div className="card__chart">
              <BarRows
                rows={data.overdueApprovals.map((row) => ({
                  key: `${row.role}-${row.entityType}`,
                  label: row.roleName ?? row.role,
                  sublabel: humanise(row.entityType),
                  value: row.amount,
                  note: `${rupeesShort(row.amount)} · ${row.count} file(s)`,
                }))}
                format={rupeesShort}
                color="var(--age-4)"
              />
            </div>
            <details className="chart-figures">
              <summary>Show the figures</summary>
              <DataTable
                rows={data.overdueApprovals}
                rowKey={(row) => `${row.role}-${row.entityType}`}
                compact
                columns={[
                  { key: 'role', header: 'Pending with', render: (row) => row.roleName ?? row.role },
                  { key: 'type', header: 'Record type', render: (row) => humanise(row.entityType) },
                  { key: 'count', header: 'Files', numeric: true, render: (row) => row.count },
                  { key: 'amount', header: 'Value held up', numeric: true, render: (row) => rupees(row.amount) },
                ]}
              />
            </details>
          </>
        </Card>
      )}

      {data.divisionPerformance.length > 0 && (
        <Card title="Division performance" subtitle="Sanctioned value against payments made" flush>
          <>
            <div className="card__chart">
              <BarRows
                rows={data.divisionPerformance.map((row) => ({
                  key: String(row.divisionId),
                  label: row.divisionName,
                  sublabel: `${row.projectCount} project(s)`,
                  value: row.paid,
                  of: row.sanctioned,
                  note: `${rupeesShort(row.paid)} of ${rupeesShort(row.sanctioned)}`,
                }))}
                format={rupeesShort}
              />
            </div>
            <details className="chart-figures">
              <summary>Show the figures</summary>
              <DataTable
                rows={data.divisionPerformance}
                rowKey={(row) => row.divisionId}
                columns={[
              {
                key: 'division',
                header: 'Division',
                render: (row) => (
                  <>
                    <div className="cell-primary">{row.divisionName}</div>
                    <div className="cell-muted code">{row.divisionCode}</div>
                  </>
                ),
              },
              { key: 'projects', header: 'Projects', numeric: true, render: (row) => row.projectCount },
              { key: 'sanctioned', header: 'Sanctioned', numeric: true, render: (row) => rupeesShort(row.sanctioned) },
              { key: 'paid', header: 'Paid', numeric: true, render: (row) => rupeesShort(row.paid) },
              {
                key: 'pending',
                header: 'Bills in approval',
                numeric: true,
                render: (row) => row.billsInApproval,
              },
                  {
                    key: 'util',
                    header: 'Utilisation',
                    width: '160px',
                    render: (row) => <Progress value={row.utilisation} label={`${row.divisionName} utilisation`} />,
                  },
                ]}
              />
            </details>
          </>
        </Card>
      )}

      {data.billTrend.length > 0 && (
        <Card
          title="Claims raised against payments made"
          subtitle="The last eighteen complete months. The distance between the lines is the payment lag."
          actions={
            can('reports.view') ? (
              <Link to="/reports/bill-ageing" className="btn btn--sm">Ageing analysis</Link>
            ) : undefined
          }
          flush
        >
          <div className="card__chart">
            <TrendChart
              months={data.billTrend.map((row) => row.month)}
              series={[
                {
                  key: 'raised',
                  label: 'Claims raised',
                  color: SERIES[0],
                  values: data.billTrend.map((row) => row.amount),
                },
                {
                  key: 'paid',
                  label: 'Payments made',
                  color: SERIES[2],
                  values: data.billTrend.map((row) => row.paidAmount),
                },
              ]}
              format={rupees}
              caption="Running account bills raised each month against the payments actually made in that month, over the last eighteen months."
            />
          </div>
          <details className="chart-figures">
            <summary>Show the monthly figures</summary>
            <DataTable
              rows={data.billTrend}
              rowKey={(row) => row.month}
              compact
              columns={[
                { key: 'month', header: 'Month', render: (row) => row.month },
                { key: 'count', header: 'Bills raised', numeric: true, render: (row) => row.billCount },
                { key: 'amount', header: 'Value raised', numeric: true, render: (row) => rupees(row.amount) },
                { key: 'paid', header: 'Value paid', numeric: true, render: (row) => rupees(row.paidAmount) },
              ]}
            />
          </details>
        </Card>
      )}

      <div className="grid grid--2">
        <Card
          title="How long unpaid bills have been waiting"
          subtitle="Bills still moving through approval, by the time since they were raised"
          actions={
            can('reports.view') ? (
              <Link to="/reports/bill-ageing" className="btn btn--sm">Full register</Link>
            ) : undefined
          }
          flush
        >
          <div className="card__chart">
            <ColumnChart
              columns={data.billAgeing.map((bucket, index) => ({
                key: bucket.key,
                label: bucket.label,
                value: bucket.count,
                color: AGE_RAMP[index] ?? AGE_RAMP[AGE_RAMP.length - 1]!,
                note: rupeesShort(bucket.amount),
              }))}
              format={(value) => String(value)}
              caption="Count of unpaid running account bills in each ageing bucket, with the value held up in each."
            />
          </div>
          <details className="chart-figures">
            <summary>Show the figures</summary>
            <DataTable
              rows={data.billAgeing}
              rowKey={(row) => row.key}
              compact
              columns={[
                { key: 'bucket', header: 'Waiting', render: (row) => row.label },
                { key: 'count', header: 'Bills', numeric: true, render: (row) => row.count },
                { key: 'amount', header: 'Value held up', numeric: true, render: (row) => rupees(row.amount) },
              ]}
            />
          </details>
        </Card>

        <Card title="Where the work stands" subtitle="Works by sanction stage, and tenders by stage of procurement">
          <div className="stack">
            <div>
              <h3 className="chart-heading">Works</h3>
              <StackedBar
                unit="work(s)"
                segments={data.projectMix.map((slice) => ({
                  key: slice.status,
                  label: slice.label,
                  value: slice.count,
                  color: PROJECT_STATUS_COLOUR[slice.status] ?? SERIES[5],
                }))}
              />
            </div>
            <div>
              <h3 className="chart-heading">Tenders</h3>
              <StackedBar
                unit="tender(s)"
                segments={data.tenderPipeline.map((stage) => ({
                  key: stage.stage,
                  label: stage.label,
                  value: stage.count,
                  color: TENDER_STAGE_COLOUR[stage.stage] ?? SERIES[5],
                }))}
              />
              {data.tenderPipeline.every((stage) => stage.count === 0) && (
                <EmptyState title="No tenders in the pipeline" />
              )}
            </div>
          </div>
        </Card>
      </div>

      {data.recentActivity.length > 0 && (
        <Card title="Recent activity across the department">
          <div className="history">
            {data.recentActivity.map((entry) => (
              <div key={entry.id} className="history__item">
                <span className="history__avatar">{(entry.userName ?? 'SY').slice(0, 2).toUpperCase()}</span>
                <div style={{ minWidth: 0 }}>
                  <div className="history__head">
                    <span className="history__actor">{entry.userName ?? 'System'}</span>
                    <span className="history__time">{dateTime(entry.createdAt)}</span>
                  </div>
                  <div className="timeline__meta">
                    {humanise(entry.action)}
                    {entry.detail ? ` — ${entry.detail}` : ''}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ==========================================================================
   Contractor
   ========================================================================== */

function ContractorView({ data }: { data: ContractorDashboard }) {
  const { cards } = data;

  const tenderColumns: Column<ContractorDashboard['openTenders'][number]>[] = [
    {
      key: 'tender',
      header: 'Tender',
      render: (row) => (
        <>
          <Link to={`/tenders/${row.id}`} className="cell-primary">{row.title}</Link>
          <div className="cell-muted code">{row.tenderNo}</div>
        </>
      ),
    },
    { key: 'value', header: 'Estimate', numeric: true, render: (row) => rupees(row.estimatedValue) },
    { key: 'emd', header: 'EMD', numeric: true, render: (row) => rupees(row.emdAmount) },
    {
      key: 'closes',
      header: 'Bids close',
      render: (row) => (
        <>
          <div>{date(row.bidEndAt)}</div>
          <div className="cell-muted">{relativeTime(row.bidEndAt)}</div>
        </>
      ),
    },
    {
      key: 'action',
      header: '',
      actions: true,
      render: (row) => (
        <Link to={`/tenders/${row.id}`} className="btn btn--sm btn--primary">Bid</Link>
      ),
    },
  ];

  return (
    <div className="stack">
      {data.registrationStatus !== 'APPROVED' && (
        <Alert variant="warn" title="Registration under verification">
          Your registration is <strong>{humanise(data.registrationStatus)}</strong>. You can browse tenders,
          but you cannot submit a bid until the division office approves your registration.
        </Alert>
      )}

      <div className="grid grid--4">
        <Link to="/packages" className="stat stat--accent">
          <div className="stat__label">Active works</div>
          <div className="stat__value">{cards.packages.active}</div>
          <div className="stat__meta"><span>{cards.packages.completed} completed</span></div>
        </Link>
        <Link to="/packages" className="stat">
          <div className="stat__label">Awarded value</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.packages.awardedValue)}</div>
        </Link>
        <Link to="/ra-bills" className="stat">
          <div className="stat__label">Payments received</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.bills.amountPaid)}</div>
          <div className="stat__meta"><span>{cards.bills.paid} of {cards.bills.submitted} bills</span></div>
        </Link>
        <Link to="/ra-bills" className="stat stat--warn">
          <div className="stat__label">Payment pending</div>
          <div className="stat__value stat__value--currency">{rupeesShort(cards.bills.amountPending)}</div>
          <div className="stat__meta"><span>With the department</span></div>
        </Link>
      </div>

      <Card
        title="Tenders open for bidding"
        actions={<Link to="/tenders" className="btn btn--sm">All tenders</Link>}
        flush
      >
        <DataTable
          rows={data.openTenders}
          rowKey={(row) => row.id}
          columns={tenderColumns}
          empty={{
            title: 'No tenders are open right now',
            text: 'Published tenders you are eligible for will appear here.',
          }}
        />
      </Card>

      <div className="grid grid--2">
        <Card title="My work packages" flush>
          <DataTable
            rows={data.myPackages}
            rowKey={(row) => row.id}
            compact
            columns={[
              {
                key: 'pkg',
                header: 'Package',
                render: (row) => (
                  <>
                    <Link to={`/packages/${row.id}`} className="cell-primary">{row.name}</Link>
                    <div className="cell-muted">{row.projectName}</div>
                  </>
                ),
              },
              { key: 'value', header: 'Value', numeric: true, render: (row) => rupeesShort(row.awardedValue) },
              {
                key: 'progress',
                header: 'Progress',
                width: '130px',
                render: (row) => <Progress value={row.physicalProgress} label={`${row.name} progress`} />,
              },
            ]}
            empty={{ title: 'No packages awarded yet' }}
          />
        </Card>

        <Card
          title="My bills"
          actions={
            cards.packages.active > 0 ? (
              <Link to="/ra-bills/new" className="btn btn--sm btn--primary">
                <PlusIcon /> Raise a bill
              </Link>
            ) : undefined
          }
          flush
        >
          <DataTable
            rows={data.myBills}
            rowKey={(row) => row.id}
            compact
            columns={[
              {
                key: 'bill',
                header: 'Bill',
                render: (row) => (
                  <>
                    <Link to={`/ra-bills/${row.id}`} className="cell-primary code">{row.billNo}</Link>
                    <div className="cell-muted">RA {row.raSequence} · {row.packageName}</div>
                  </>
                ),
              },
              { key: 'amount', header: 'Net payable', numeric: true, render: (row) => rupees(row.netPayableAmount) },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            ]}
            empty={{
              title: 'No bills raised yet',
              text: 'Raise a running account bill against an awarded package.',
            }}
          />
        </Card>
      </div>

      <Card title="My bids" flush>
        <DataTable
          rows={data.myBids}
          rowKey={(row) => row.id}
          compact
          columns={[
            {
              key: 'bid',
              header: 'Tender',
              render: (row) => (
                <>
                  <Link to={`/tenders/${row.tenderId}`} className="cell-primary">{row.tenderTitle}</Link>
                  <div className="cell-muted code">{row.bidNo}</div>
                </>
              ),
            },
            { key: 'quoted', header: 'Quoted', numeric: true, render: (row) => rupees(row.quotedAmount) },
            {
              key: 'rank',
              header: 'Rank',
              numeric: true,
              render: (row) => (row.rank ? `L${row.rank}` : '—'),
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: 'No bids submitted yet',
            text: 'Open a published tender to submit your first bid.',
            action: <Link to="/tenders" className="btn btn--primary">Browse tenders</Link>,
          }}
        />
      </Card>

      <Card title="Registration">
        <div className="detail-grid">
          <DetailItem label="Status" value={<StatusBadge status={data.registrationStatus} />} />
          <DetailItem label="Bids submitted" value={cards.bids.total} />
          <DetailItem label="Tenders won" value={cards.bids.awarded} />
        </div>
        <div style={{ marginTop: 14 }}>
          <Button onClick={() => window.location.assign('/profile')}>View my firm profile</Button>
        </div>
      </Card>
    </div>
  );
}
