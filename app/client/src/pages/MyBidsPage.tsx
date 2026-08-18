import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api/client';
import { dateTime, percent, rupees } from '../lib/format';
import type { Bid } from '../types';
import { Card, PageHeader } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';

export function MyBidsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['my-bids', page],
    queryFn: () => api.get<Page<Bid>>('/tenders/my-bids', { page, pageSize: 20 }),
  });

  return (
    <>
      <PageHeader
        title="My bids"
        subtitle="Every tender your firm has bid for, with the stage each one has reached."
        actions={<Link to="/tenders" className="btn btn--primary">Browse open tenders</Link>}
      />

      <Card flush>
        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/tenders/${row.tenderId}`)}
          caption="Bids submitted by my firm"
          columns={[
            {
              key: 'bid',
              header: 'Bid',
              render: (row) => (
                <>
                  <div className="cell-primary code">{row.bidNo}</div>
                  <div className="cell-muted">{dateTime(row.submittedAt)}</div>
                </>
              ),
            },
            {
              key: 'tender',
              header: 'Tender',
              render: (row) => (
                <>
                  <div>{row.tenderTitle}</div>
                  <div className="cell-muted code">{row.tenderNo}</div>
                </>
              ),
            },
            {
              key: 'technical',
              header: 'Technical',
              render: (row) => (
                <>
                  <StatusBadge status={row.technicalStatus} />
                  {row.technicalScore !== null && (
                    <div className="cell-muted">Score {row.technicalScore}</div>
                  )}
                </>
              ),
            },
            {
              key: 'quoted',
              header: 'Quoted amount',
              numeric: true,
              render: (row) =>
                row.financialsSealed ? (
                  <span className="cell-muted">Sealed until opening</span>
                ) : (
                  <>
                    <div>{rupees(row.quotedAmount)}</div>
                    {row.variation !== null && (
                      <div className="cell-muted">
                        {row.variation > 0 ? 'Above' : 'Below'} estimate by {percent(Math.abs(row.variation))}
                      </div>
                    )}
                  </>
                ),
            },
            {
              key: 'rank',
              header: 'Rank',
              numeric: true,
              render: (row) => (row.rank ? `L${row.rank}` : '—'),
            },
            { key: 'emd', header: 'EMD paid', numeric: true, render: (row) => rupees(row.emdPaid) },
            { key: 'status', header: 'Outcome', render: (row) => <StatusBadge status={row.status} /> },
            { key: 'tenderStatus', header: 'Tender stage', render: (row) => <StatusBadge status={row.tenderStatus} /> },
          ]}
          empty={{
            title: 'You have not bid for anything yet',
            text: 'Open tenders your firm is eligible for are listed under Tenders.',
            action: <Link to="/tenders" className="btn btn--primary">Browse open tenders</Link>,
          }}
        />

        {data && (
          <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPageChange={setPage} />
        )}
      </Card>
    </>
  );
}
