import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { money, percent, quantity, rupees, rupeesShort } from '../lib/format';
import type { PackageBoq } from '../types';
import { Alert, Card, EmptyState, Loading, Progress } from './ui';

/**
 * The agreement bill of quantities, with what has been billed against each line
 * and how the agreed rate compares with the Schedule of Rates.
 *
 * The SR comparison is the point: it is what tells an officer whether the
 * department is paying above the sanctioned rate, and by how much.
 */
export function BoqPanel({ packageId }: { packageId: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['package-boq', packageId],
    queryFn: () => api.get<PackageBoq>(`/packages/${packageId}/boq`),
  });

  if (isLoading) return <Loading label="Loading the agreement BOQ…" />;

  if (!data?.items.length) {
    return (
      <Card title="Agreement BOQ">
        <EmptyState
          title="No agreement BOQ on this package"
          text="A BOQ is carried over automatically when a tender is awarded. Until then, bill items are entered by hand."
        />
      </Card>
    );
  }

  const { totals } = data;
  const above = (totals.variancePercent ?? 0) > 0;

  return (
    <div className="stack">
      <div className="grid grid--4">
        <div className="stat stat--accent">
          <div className="stat__label">Agreement value</div>
          <div className="stat__value stat__value--currency">{rupeesShort(totals.boqValue)}</div>
          <div className="stat__meta">{totals.itemCount} items</div>
        </div>
        <div className="stat">
          <div className="stat__label">At Schedule of Rates</div>
          <div className="stat__value stat__value--currency">{rupeesShort(totals.srValue)}</div>
          <div className="stat__meta">Same quantities, sanctioned rates</div>
        </div>
        <div className={`stat${above ? ' stat--warn' : ''}`}>
          <div className="stat__label">Against SR</div>
          <div className="stat__value">
            {totals.variancePercent === null ? '—' : `${above ? '+' : ''}${totals.variancePercent}%`}
          </div>
          <div className="stat__meta">
            {totals.variancePercent === null
              ? 'No SR linked'
              : above
                ? 'Agreement is above the schedule'
                : 'Agreement is at or below the schedule'}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Billed to date</div>
          <div className="stat__value stat__value--currency">{rupeesShort(totals.billedValue)}</div>
          <div className="stat__meta">{rupeesShort(totals.balanceValue)} remaining</div>
        </div>
      </div>

      {above && (
        <Alert variant="warn" title="The agreement is priced above the Schedule of Rates">
          Overall the agreed rates come to {percent(totals.variancePercent ?? 0)} above the SR for the
          same quantities. Individual items are shown below.
        </Alert>
      )}

      <Card
        title="Agreement BOQ"
        subtitle="Every running account bill is measured against these lines, at these rates."
        flush
      >
        <div className="table-wrap">
          <table className="table table--compact table--totals">
            <caption className="visually-hidden">Agreement bill of quantities</caption>
            <thead>
              <tr>
                <th scope="col" style={{ width: 44 }}>Sl</th>
                <th scope="col" style={{ width: 90 }}>SR code</th>
                <th scope="col">Item of work</th>
                <th scope="col" style={{ width: 60 }}>Unit</th>
                <th scope="col" className="num" style={{ width: 100 }}>Quantity</th>
                <th scope="col" className="num" style={{ width: 100 }}>Agreed rate</th>
                <th scope="col" className="num" style={{ width: 100 }}>SR rate</th>
                <th scope="col" className="num" style={{ width: 80 }}>Variance</th>
                <th scope="col" className="num" style={{ width: 120 }}>Amount</th>
                <th scope="col" style={{ width: 150 }}>Billed</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.slNo}</td>
                  <td className="code">{item.itemCode ?? '—'}</td>
                  <td>
                    <div>{item.description}</div>
                    {item.remarks && <div className="cell-muted">{item.remarks}</div>}
                  </td>
                  <td>{item.uom}</td>
                  <td className="num">{quantity(item.quantity)}</td>
                  <td className="num">{money(item.agreedRate)}</td>
                  <td className="num">{item.sr ? money(item.sr.rate) : '—'}</td>
                  <td
                    className="num"
                    style={
                      item.sr && item.sr.variancePercent > 0
                        ? { color: 'var(--warn-fg)', fontWeight: 700 }
                        : item.sr
                          ? { color: 'var(--ok-fg)' }
                          : undefined
                    }
                  >
                    {item.sr ? `${item.sr.variancePercent > 0 ? '+' : ''}${item.sr.variancePercent}%` : '—'}
                  </td>
                  <td className="num">{money(item.amount)}</td>
                  <td>
                    <Progress value={item.billedPercent} label={`${item.description} billed`} />
                    <div className="cell-muted">
                      {quantity(item.billedQuantity)} of {quantity(item.quantity)} {item.uom}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={8} style={{ textAlign: 'right' }}>Agreement value</td>
                <td className="num">{money(totals.boqValue)}</td>
                <td>{rupees(totals.billedValue)} billed</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>
    </div>
  );
}
