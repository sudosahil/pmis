import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, dateTime, percent, quantity, relativeTime, rupees, rupeesShort } from '../lib/format';
import type { BoqItem, TenderDetail } from '../types';
import {
  Alert, Button, Card, Checkbox, ChevronRightIcon, DetailItem, GavelIcon, Loading,
  PageHeader, SendIcon, Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal, ConfirmModal } from '../components/Modal';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { useToast } from '../components/Toast';
import { BiddingCountdown } from './TendersPage';
import { SrCeilingCard, TenderCriteriaPanel } from '../components/TenderCriteria';

export function TenderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const tenderId = Number(id);
  const { hasRole, isContractor, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'notice' | 'boq' | 'criteria' | 'bids' | 'approval'>('notice');
  const [dialog, setDialog] = useState<
    null | 'submit' | 'publish' | 'close' | 'cancel' | 'startTech' | 'openFinancial' | 'bid' | 'evaluate' | 'award'
  >(null);

  const tender = useQuery({
    queryKey: ['tender', tenderId],
    queryFn: () => api.get<TenderDetail>(`/tenders/${tenderId}`),
  });

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) =>
      api.post(`/tenders/${tenderId}/${path}`, body),
    onSuccess: (_result, variables) => {
      const labels: Record<string, string> = {
        submit: 'Sent for approval',
        publish: 'Tender published',
        'close-bidding': 'Bidding closed',
        cancel: 'Tender cancelled',
        'technical-evaluation/start': 'Technical evaluation started',
        'open-financial': 'Financial bids opened',
      };
      toast.success(labels[variables.path] ?? 'Done');
      void queryClient.invalidateQueries();
      setDialog(null);
    },
    onError: (error: unknown) => {
      toast.error('Could not complete', error instanceof ApiError ? error.message : undefined);
    },
  });

  if (tender.isLoading) return <Loading label="Loading tender…" />;
  if (tender.error || !tender.data) {
    return <Alert variant="danger" title="Tender not found">It may have been withdrawn, or it is not yet published.</Alert>;
  }

  const t = tender.data;
  const isProcurement = hasRole('ADMIN', 'CE', 'SE', 'EE');
  const isEvaluator = hasRole('ADMIN', 'CE', 'SE', 'EE', 'CAO');
  const canAward = hasRole('ADMIN', 'CE', 'SE');

  const myBid = isContractor
    ? t.bids.find((b) => b.contractor.id === user?.contractorId)
    : undefined;
  const financialsRevealed = t.status === 'FINANCIAL_EVALUATION' || t.status === 'AWARDED';

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/tenders">Tenders</Link>
            <span className="breadcrumb__sep"><ChevronRightIcon size={14} /></span>
            <span>{t.tenderNo}</span>
          </>
        }
        title={t.title}
        subtitle={
          <>
            <span className="code">{t.tenderNo}</span> · {t.project.name} · {t.division.name}
          </>
        }
        actions={
          <>
            <StatusBadge status={t.status} />
            {isProcurement && t.status === 'DRAFT' && (
              <Button variant="primary" icon={<SendIcon />} onClick={() => setDialog('submit')}>
                Send for approval
              </Button>
            )}
            {isProcurement && t.status === 'APPROVED' && (
              <Button variant="primary" onClick={() => setDialog('publish')}>Publish tender</Button>
            )}
            {isProcurement && t.status === 'PUBLISHED' && (
              <Button onClick={() => setDialog('close')}>Close bidding</Button>
            )}
            {isEvaluator && t.status === 'BIDDING_CLOSED' && (
              <Button variant="primary" onClick={() => setDialog('startTech')}>
                Open technical bids
              </Button>
            )}
            {isEvaluator && t.status === 'TECHNICAL_EVALUATION' && (
              <>
                <Button onClick={() => setDialog('evaluate')}>Record evaluation</Button>
                <Button variant="primary" onClick={() => setDialog('openFinancial')}>
                  Open financial bids
                </Button>
              </>
            )}
            {canAward && t.status === 'FINANCIAL_EVALUATION' && (
              <Button variant="success" icon={<GavelIcon size={16} />} onClick={() => setDialog('award')}>
                Award tender
              </Button>
            )}
            {isContractor && t.isBiddingOpen && !myBid && (
              <Button variant="primary" onClick={() => setDialog('bid')}>Submit bid</Button>
            )}
          </>
        }
      />

      {t.status === 'PUBLISHED' && <div style={{ marginBottom: 18 }}><BiddingCountdown tender={t} /></div>}

      {t.award && (
        <div style={{ marginBottom: 18 }}>
          <Alert variant="ok" title={`Awarded to ${t.award.contractor.name}`}>
            Letter of acceptance <span className="code">{t.award.loaNo}</span> dated {date(t.award.loaDate)} for{' '}
            <strong>{rupees(t.award.awardedValue)}</strong>
            {t.award.negotiatedValue ? ' (negotiated)' : ''}.
            {t.packageCode && (
              <> Work package <span className="code">{t.packageCode}</span> has been created.</>
            )}
          </Alert>
        </div>
      )}

      {isContractor && myBid && (
        <div style={{ marginBottom: 18 }}>
          <Alert
            variant={myBid.status === 'AWARDED' ? 'ok' : myBid.status === 'DISQUALIFIED' ? 'danger' : 'info'}
            title={`Your bid ${myBid.bidNo}`}
          >
            Submitted {dateTime(myBid.submittedAt)} · Status <strong>{myBid.status.replace(/_/g, ' ').toLowerCase()}</strong>
            {myBid.quotedAmount !== null && <> · Quoted <strong>{rupees(myBid.quotedAmount)}</strong></>}
            {myBid.rank && <> · Ranked <strong>L{myBid.rank}</strong></>}
            {myBid.technicalRemarks && <div style={{ marginTop: 6 }}>{myBid.technicalRemarks}</div>}
          </Alert>
        </div>
      )}

      <div className="grid grid--5" style={{ marginBottom: 18 }}>
        <div className="stat stat--accent">
          <div className="stat__label">Estimated value</div>
          <div className="stat__value stat__value--currency">{rupeesShort(t.estimatedValue)}</div>
        </div>
        <div className={`stat${t.srCeiling.relief ? ' stat--warn' : ''}`}>
          <div className="stat__label">Bidding ceiling</div>
          <div className="stat__value stat__value--currency">
            {t.srCeiling.enforced ? rupeesShort(t.srCeiling.effectiveAmount) : '—'}
          </div>
          <div className="stat__meta">
            <span>
              {!t.srCeiling.enforced
                ? 'Outside the Schedule of Rates'
                : t.srCeiling.relief
                  ? `SR + ${percent(t.srCeiling.relief.capPercent)} relief`
                  : 'At the Schedule of Rates'}
            </span>
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">Earnest money</div>
          <div className="stat__value stat__value--currency">{rupeesShort(t.emdAmount)}</div>
          <div className="stat__meta"><span>Fee {rupeesShort(t.tenderFee)}</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Bids received</div>
          <div className="stat__value">{isContractor ? (myBid ? 1 : 0) : t.submittedBidCount}</div>
          <div className="stat__meta"><span>{t.tenderType.toLowerCase()} tender</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Completion period</div>
          <div className="stat__value">{t.completionPeriodDays}</div>
          <div className="stat__meta"><span>days from work order</span></div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['notice', 'boq', 'criteria', 'bids', 'approval'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'notice' ? 'Tender notice'
              : key === 'boq' ? 'Bill of quantities'
              : key === 'criteria' ? 'Qualification criteria'
              : key === 'bids' ? (isContractor ? 'My bid' : 'Bids & evaluation')
              : 'Approval'}
            {key === 'boq' ? <span className="tab__count">({t.boqItems.length})</span> : null}
            {key === 'criteria' ? (
              <span className="tab__count">
                ({t.criteria.pq.length + t.criteria.tq.length})
              </span>
            ) : null}
            {key === 'bids' && !isContractor ? <span className="tab__count">({t.bids.length})</span> : null}
          </button>
        ))}
      </div>

      {tab === 'notice' && (
        <div className="stack">
          <Card title="Tender particulars">
            <div className="detail-grid">
              <DetailItem label="Tender number" value={<span className="code">{t.tenderNo}</span>} />
              <DetailItem label="Tender type" value={t.tenderType.replace(/_/g, ' ')} />
              <DetailItem label="Bid type" value={t.bidType.replace(/_/g, ' ')} />
              <DetailItem label="Project" value={<Link to={`/projects/${t.project.id}`}>{t.project.name}</Link>} />
              <DetailItem label="Division" value={t.division.name} />
              <DetailItem label="Minimum class" value={t.minRegistrationClass ?? 'Open to all classes'} />
              <DetailItem label="Published on" value={date(t.publishDate)} />
              <DetailItem label="Bidding opens" value={dateTime(t.bidStartAt)} />
              <DetailItem label="Bidding closes" value={dateTime(t.bidEndAt)} />
              <DetailItem label="Technical opening" value={dateTime(t.technicalOpenAt)} />
              <DetailItem label="Financial opening" value={dateTime(t.financialOpenAt)} />
              <DetailItem label="Raised by" value={t.createdBy} />
              <DetailItem
                label="Raised from"
                value={
                  t.dpr ? (
                    <Link to={`/projects/${t.project.id}`} className="code">
                      DPR {t.dpr.dprNo} v{t.dpr.version}
                    </Link>
                  ) : null
                }
              />
            </div>
            {t.description && (
              <div style={{ marginTop: 18 }}>
                <div className="detail-item__label">Description of work</div>
                <p style={{ marginTop: 4, fontSize: 14.5, lineHeight: 1.6 }}>{t.description}</p>
              </div>
            )}
          </Card>

          <SrCeilingCard tender={t} />

          {t.eligibilityCriteria && (
            <Card title="Eligibility criteria">
              <p style={{ fontSize: 14.5, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{t.eligibilityCriteria}</p>
            </Card>
          )}
        </div>
      )}

      {tab === 'criteria' && <TenderCriteriaPanel tender={t} />}

      {tab === 'boq' && (
        <Card
          title="Bill of quantities"
          subtitle={
            t.bidType === 'ITEM_RATE'
              ? 'Bidders quote a rate against each line.'
              : 'This tender is not priced line by line.'
          }
          flush
        >
          <BoqTable items={t.boqItems} />
        </Card>
      )}

      {tab === 'bids' && (
        <div className="stack">
          {!financialsRevealed && !isContractor && t.bids.length > 0 && (
            <Alert variant="warn" title="Financial bids are sealed">
              Quoted amounts stay hidden until every bid has been technically evaluated and the
              financial envelopes are formally opened.
            </Alert>
          )}

          <Card
            title={isContractor ? 'My bid' : 'Bids received'}
            subtitle={
              !isContractor && t.status === 'PUBLISHED'
                ? 'Bids remain sealed until bidding closes.'
                : undefined
            }
            flush
          >
            <DataTable
              rows={t.bids}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'bidder',
                  header: 'Bidder',
                  render: (row) => (
                    <>
                      <div className="cell-primary">{row.contractor.name}</div>
                      <div className="cell-muted code">
                        {row.bidNo} · {row.contractor.registrationClass ?? '—'}
                      </div>
                    </>
                  ),
                },
                {
                  key: 'submitted',
                  header: 'Submitted',
                  render: (row) => (
                    <>
                      <div>{date(row.submittedAt)}</div>
                      <div className="cell-muted">EMD {row.emdReference ?? '—'}</div>
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
                        <div className="cell-muted" style={{ marginTop: 3 }}>Score {row.technicalScore}/100</div>
                      )}
                    </>
                  ),
                },
                {
                  key: 'quoted',
                  header: 'Quoted amount',
                  numeric: true,
                  render: (row) =>
                    row.quotedAmount === null ? (
                      <span className="cell-muted">Sealed</span>
                    ) : (
                      <>
                        <strong>{rupees(row.quotedAmount)}</strong>
                        {row.variation !== null && (
                          <div
                            className="cell-muted"
                            style={{ color: row.variation > 0 ? 'var(--danger-fg)' : 'var(--ok-fg)' }}
                          >
                            {row.variation > 0 ? '+' : ''}{percent(row.variation)} vs estimate
                          </div>
                        )}
                      </>
                    ),
                },
                {
                  key: 'rank',
                  header: 'Rank',
                  numeric: true,
                  render: (row) =>
                    row.rank ? (
                      <span className={row.rank === 1 ? 'badge badge--ok' : 'badge badge--neutral'}>
                        L{row.rank}
                      </span>
                    ) : (
                      <span className="cell-muted">—</span>
                    ),
                },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              ]}
              empty={{
                title: isContractor ? 'You have not bid on this tender' : 'No bids received yet',
                text: isContractor && t.isBiddingOpen
                  ? 'Submit your rates before the closing time.'
                  : undefined,
                action: isContractor && t.isBiddingOpen
                  ? <Button variant="primary" onClick={() => setDialog('bid')}>Submit bid</Button>
                  : undefined,
              }}
            />
          </Card>

          {t.bids.some((b) => b.technicalRemarks) && !isContractor && (
            <Card title="Technical evaluation notes">
              <div className="history">
                {t.bids.filter((b) => b.technicalRemarks).map((b) => (
                  <div key={b.id} className="history__item">
                    <span className="history__avatar">{b.contractor.name.slice(0, 2).toUpperCase()}</span>
                    <div>
                      <div className="history__head">
                        <span className="history__actor">{b.contractor.name}</span>
                        <StatusBadge status={b.technicalStatus} />
                      </div>
                      <p className="history__remarks">{b.technicalRemarks}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {tab === 'approval' && (
        <WorkflowPanel
          workflow={t.workflow}
          onActed={() => void queryClient.invalidateQueries({ queryKey: ['tender', tenderId] })}
        />
      )}

      {/* --- Dialogs --- */}

      <RemarksDialog
        open={dialog === 'submit'}
        title="Send tender for approval"
        info="The notice moves through Divisional Check, Circle Review and finally approval to invite tenders. It cannot be edited while in the chain."
        confirmLabel="Send for approval"
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={(remarks) => action.mutate({ path: 'submit', body: { remarks } })}
      />

      <ConfirmModal
        open={dialog === 'publish'}
        title="Publish this tender"
        message={
          <div className="stack">
            <Alert variant="info">
              Publishing makes the tender visible to every eligible contractor and notifies them by
              email. The bidding window opens at {dateTime(t.bidStartAt)}.
            </Alert>
            <p>Confirm that the estimate, dates and eligibility criteria are final.</p>
          </div>
        }
        confirmLabel="Publish tender"
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => action.mutate({ path: 'publish' })}
      />

      <ConfirmModal
        open={dialog === 'close'}
        title="Close bidding"
        message={`No further bids can be submitted after this. ${t.submittedBidCount} bid(s) have been received.`}
        confirmLabel="Close bidding"
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => action.mutate({ path: 'close-bidding' })}
      />

      <ConfirmModal
        open={dialog === 'startTech'}
        title="Open technical bids"
        message="Technical envelopes will be opened for evaluation. Financial bids stay sealed until every bid has a technical decision."
        confirmLabel="Open technical bids"
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => action.mutate({ path: 'technical-evaluation/start' })}
      />

      <ConfirmModal
        open={dialog === 'openFinancial'}
        title="Open financial bids"
        message={
          <div className="stack">
            <Alert variant="warn" title="This cannot be undone">
              Quoted amounts become visible and qualified bids are ranked lowest first (L1).
            </Alert>
            <p>Every bid must already carry a technical decision.</p>
          </div>
        }
        confirmLabel="Open financial bids"
        loading={action.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => action.mutate({ path: 'open-financial' })}
      />

      {dialog === 'bid' && (
        <BidDialog tender={t} onClose={() => setDialog(null)} />
      )}

      {dialog === 'evaluate' && (
        <EvaluationDialog tender={t} onClose={() => setDialog(null)} />
      )}

      {dialog === 'award' && (
        <AwardDialog tender={t} onClose={() => setDialog(null)} />
      )}
    </>
  );
}

function BoqTable({ items }: { items: BoqItem[] }) {
  const total = items.reduce((sum, item) => sum + item.estimatedAmount, 0);
  // The ceiling is per line, so a bidder reading the BOQ has to see it here
  // rather than work it out from a figure at the top of the page.
  const hasCeiling = items.some((item) => item.ceilingRate !== null);

  return (
    <DataTable
      rows={items}
      rowKey={(row) => row.id}
      compact
      columns={[
        { key: 'sl', header: '#', width: '48px', render: (row) => row.slNo },
        {
          key: 'code',
          header: 'SR item',
          render: (row) => <span className="code">{row.sr?.code ?? row.itemCode ?? '—'}</span>,
        },
        { key: 'desc', header: 'Description', render: (row) => row.description },
        { key: 'uom', header: 'Unit', render: (row) => row.uom },
        { key: 'qty', header: 'Quantity', numeric: true, render: (row) => quantity(row.quantity) },
        { key: 'rate', header: 'Estimated rate (₹)', numeric: true, render: (row) => rupees(row.estimatedRate) },
        ...(hasCeiling
          ? [
              {
                key: 'ceiling',
                header: 'Ceiling rate (₹)',
                numeric: true,
                render: (row: BoqItem) =>
                  row.ceilingRate === null ? (
                    '—'
                  ) : (
                    <strong>{rupees(row.ceilingRate)}</strong>
                  ),
              },
            ]
          : []),
        { key: 'amount', header: 'Amount (₹)', numeric: true, render: (row) => rupees(row.estimatedAmount) },
      ]}
      footer={
        <tr>
          <td colSpan={hasCeiling ? 7 : 6}>Total estimated value</td>
          <td className="num">{rupees(total)}</td>
        </tr>
      }
      empty={{ title: 'No bill of quantities recorded', text: 'This tender is priced as a lump sum or percentage.' }}
    />
  );
}

function RemarksDialog({
  open, title, info, confirmLabel, loading, onClose, onConfirm,
}: {
  open: boolean;
  title: string;
  info: string;
  confirmLabel: string;
  loading: boolean;
  onClose: () => void;
  onConfirm: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState('');
  if (!open) return null;
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => onConfirm(remarks)}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert variant="info">{info}</Alert>
        <TextArea
          label="Covering remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={4}
          hint="Optional."
        />
      </div>
    </Modal>
  );
}

/* ==========================================================================
   Contractor bid submission
   ========================================================================== */

function BidDialog({ tender, onClose }: { tender: TenderDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [emdReference, setEmdReference] = useState('');
  const [rates, setRates] = useState<Record<number, string>>({});
  const [quotedAmount, setQuotedAmount] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const isItemRate = tender.bidType === 'ITEM_RATE';
  const { srCeiling } = tender;

  const total = isItemRate
    ? tender.boqItems.reduce((sum, item) => sum + item.quantity * (Number(rates[item.id]) || 0), 0)
    : Number(quotedAmount) || 0;

  const variation = tender.estimatedValue > 0
    ? ((total - tender.estimatedValue) / tender.estimatedValue) * 100
    : 0;

  const allPriced = isItemRate
    ? tender.boqItems.every((item) => Number(rates[item.id]) > 0)
    : total > 0;

  /**
   * A bidder turned away by a rule they could not see will simply try again, so
   * the lines that breach the ceiling are called out while the form is being
   * filled in rather than only when the server refuses the bid.
   */
  const overCeiling = isItemRate
    ? tender.boqItems.filter(
        (item) => item.ceilingRate !== null && (Number(rates[item.id]) || 0) > item.ceilingRate,
      )
    : [];

  const breachesCeiling =
    srCeiling.enforced &&
    (isItemRate ? overCeiling.length > 0 : total > srCeiling.effectiveAmount);

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/tenders/${tender.id}/bids`, {
        emdReference,
        items: isItemRate
          ? tender.boqItems.map((item) => ({ boqItemId: item.id, quotedRate: rates[item.id] ?? '0' }))
          : undefined,
        quotedAmount: isItemRate ? undefined : quotedAmount,
      }),
    onSuccess: () => {
      toast.success('Bid submitted', 'Your bid is sealed until the opening date.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) => {
      setConfirming(false);
      setMessage(error instanceof ApiError ? error.message : 'Could not submit the bid.');
    },
  });

  return (
    <>
      <Modal
        open
        title="Submit your bid"
        subtitle={`${tender.tenderNo} — ${tender.title}`}
        size="xwide"
        onClose={onClose}
        footer={
          <>
            <span style={{ marginRight: 'auto', fontSize: 14 }}>
              Your total:{' '}
              <strong style={{ fontSize: 16 }}>{rupees(total)}</strong>
              {total > 0 && (
                <span style={{ color: variation > 0 ? 'var(--danger-fg)' : 'var(--ok-fg)', marginLeft: 8 }}>
                  ({variation > 0 ? '+' : ''}{variation.toFixed(2)}% vs estimate)
                </span>
              )}
            </span>
            <Button onClick={onClose} disabled={submit.isPending}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!allPriced || breachesCeiling || emdReference.trim().length < 3}
              onClick={() => setConfirming(true)}
            >
              Review and submit
            </Button>
          </>
        }
      >
        <div className="stack">
          {message && <Alert variant="danger" title="Could not submit">{message}</Alert>}

          <Alert variant="warn" title="A bid cannot be changed once submitted">
            Check every rate carefully. Bidding closes {relativeTime(tender.bidEndAt)} — {dateTime(tender.bidEndAt)}.
          </Alert>

          {srCeiling.enforced && (
            <Alert
              variant={breachesCeiling ? 'danger' : 'info'}
              title={
                srCeiling.relief
                  ? `You may quote up to ${percent(srCeiling.relief.capPercent)} above the Schedule of Rates`
                  : 'You may not quote above the Schedule of Rates'
              }
            >
              {srCeiling.relief ? (
                <p style={{ margin: 0 }}>
                  The rates this work was estimated at predate{' '}
                  {srCeiling.relief.groundLabel?.toLowerCase()}, so the department has lifted the
                  ceiling to <strong>{rupees(srCeiling.effectiveAmount)}</strong> for every bidder
                  under {srCeiling.relief.authority}. A quote beyond that is still refused.
                </p>
              ) : (
                <p style={{ margin: 0 }}>
                  The approved government rates put this work at{' '}
                  <strong>{rupees(srCeiling.baselineAmount)}</strong>. Quote at or below the ceiling
                  shown against each line — there is no limit on how far below you go.
                </p>
              )}
              {breachesCeiling && (
                <p style={{ margin: '6px 0 0' }}>
                  <strong>
                    {isItemRate
                      ? `${overCeiling.length} line(s) are above the ceiling and must be brought down before you can submit.`
                      : 'Your quoted amount is above the ceiling and will be refused.'}
                  </strong>
                </p>
              )}
            </Alert>
          )}

          <div className="form-grid">
            <TextInput
              label="EMD payment reference"
              required
              value={emdReference}
              onChange={(event) => setEmdReference(event.target.value)}
              placeholder="e.g. RTGS/SBIN/2026/778341"
              hint={`Earnest money of ${rupees(tender.emdAmount)} must already be paid.`}
              full
            />
          </div>

          {isItemRate ? (
            <fieldset className="fieldset">
              <legend className="fieldset__legend">Your rates</legend>
              <div className="table-wrap">
                <table className="table table--compact table--totals">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>#</th>
                      <th>Description</th>
                      <th style={{ width: 80 }}>Unit</th>
                      <th className="num" style={{ width: 110 }}>Quantity</th>
                      <th className="num" style={{ width: 130 }}>Estimated rate</th>
                      <th className="num" style={{ width: 130 }}>Ceiling rate</th>
                      <th className="num" style={{ width: 150 }}>Your rate (₹)</th>
                      <th className="num" style={{ width: 140 }}>Amount (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tender.boqItems.map((item) => {
                      const rate = Number(rates[item.id]) || 0;
                      const over = item.ceilingRate !== null && rate > item.ceilingRate;
                      return (
                        <tr key={item.id}>
                          <td>{item.slNo}</td>
                          <td>{item.description}</td>
                          <td>{item.uom}</td>
                          <td className="num">{quantity(item.quantity)}</td>
                          <td className="num cell-muted">{rupees(item.estimatedRate)}</td>
                          <td className="num">
                            {item.ceilingRate === null
                              ? '—'
                              : <strong>{rupees(item.ceilingRate)}</strong>}
                          </td>
                          <td>
                            <input
                              className={`input input--number${over ? ' has-error' : ''}`}
                              inputMode="decimal"
                              value={rates[item.id] ?? ''}
                              onChange={(event) =>
                                setRates((prev) => ({ ...prev, [item.id]: event.target.value }))
                              }
                              placeholder="0.00"
                              aria-label={`Your rate for item ${item.slNo}`}
                              aria-invalid={over || undefined}
                            />
                            {over && (
                              <span className="field__error" role="alert">
                                Above the ceiling of {rupees(item.ceilingRate!)}
                              </span>
                            )}
                          </td>
                          <td className="num">{rupees(item.quantity * rate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={7}>Total quoted amount</td>
                      <td className="num">{rupees(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {!allPriced && (
                <p className="field__error" style={{ marginTop: 10 }}>
                  Quote a rate greater than zero against every line before submitting.
                </p>
              )}
            </fieldset>
          ) : (
            <div className="form-grid">
              <TextInput
                label="Your quoted amount"
                required
                prefix="₹"
                numeric
                inputMode="decimal"
                value={quotedAmount}
                onChange={(event) => setQuotedAmount(event.target.value)}
                hint={
                  srCeiling.enforced
                    ? `Department estimate ${rupees(tender.estimatedValue)}; ceiling ${rupees(srCeiling.effectiveAmount)}`
                    : `Department estimate: ${rupees(tender.estimatedValue)}`
                }
                error={breachesCeiling ? 'Above the Schedule of Rates ceiling.' : undefined}
                full
              />
            </div>
          )}
        </div>
      </Modal>

      <ConfirmModal
        open={confirming}
        title="Confirm your bid"
        message={
          <div className="stack">
            <Alert variant="warn" title="This is final">
              Once submitted, your bid is sealed and cannot be withdrawn or amended.
            </Alert>
            <div className="totals">
              <div className="totals__row">
                <span className="totals__label">Department estimate</span>
                <span className="totals__value">{rupees(tender.estimatedValue)}</span>
              </div>
              {srCeiling.enforced && (
                <div className="totals__row">
                  <span className="totals__label">Bidding ceiling</span>
                  <span className="totals__value">{rupees(srCeiling.effectiveAmount)}</span>
                </div>
              )}
              <div className="totals__row totals__row--grand">
                <span className="totals__label">Your quoted amount</span>
                <span className="totals__value">{rupees(total)}</span>
              </div>
            </div>
            <p>
              That is <strong>{variation > 0 ? 'above' : 'below'}</strong> the estimate by{' '}
              <strong>{Math.abs(variation).toFixed(2)}%</strong>.
            </p>
          </div>
        }
        confirmLabel="Submit my bid"
        loading={submit.isPending}
        onClose={() => setConfirming(false)}
        onConfirm={() => submit.mutate()}
      />
    </>
  );
}

/* ==========================================================================
   Technical evaluation
   ========================================================================== */

/** One bid's answer to one published criterion, while it is being marked. */
interface CriterionMark {
  isMet: boolean;
  score: string;
}

function EvaluationDialog({ tender, onClose }: { tender: TenderDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const published = [...tender.criteria.pq, ...tender.criteria.tq];
  const hasCriteria = published.length > 0;

  const [rows, setRows] = useState<Record<number, { status: string; score: string; remarks: string }>>(
    Object.fromEntries(
      tender.bids.map((bid) => [
        bid.id,
        {
          status: bid.technicalStatus === 'PENDING' ? 'QUALIFIED' : bid.technicalStatus,
          score: bid.technicalScore !== null ? String(bid.technicalScore) : '',
          remarks: bid.technicalRemarks ?? '',
        },
      ]),
    ),
  );

  // Marks against the published criteria, where the tender has any. Whatever
  // the committee marked last time is the starting point.
  const [marks, setMarks] = useState<Record<number, Record<number, CriterionMark>>>(
    Object.fromEntries(
      tender.bids.map((bid) => [
        bid.id,
        Object.fromEntries(
          published.map((criterion) => {
            const previous = bid.criteria.find((row) => row.criterionId === criterion.id);
            return [
              criterion.id,
              {
                isMet: previous ? previous.isMet : true,
                score: String(previous ? previous.score : criterion.maxScore),
              },
            ];
          }),
        ),
      ]),
    ),
  );
  const [message, setMessage] = useState<string | null>(null);

  const markOf = (bidId: number, criterionId: number): CriterionMark =>
    marks[bidId]?.[criterionId] ?? { isMet: true, score: '0' };

  const setMark = (bidId: number, criterionId: number, patch: Partial<CriterionMark>) =>
    setMarks((prev) => ({
      ...prev,
      [bidId]: { ...prev[bidId], [criterionId]: { ...markOf(bidId, criterionId), ...patch } },
    }));

  /** The technical score is the total of the technical marks, not a typed figure. */
  const derivedScore = (bidId: number) =>
    tender.criteria.tq.reduce((sum, criterion) => {
      const mark = markOf(bidId, criterion.id);
      return sum + (mark.isMet ? Number(mark.score) || 0 : 0);
    }, 0);

  /** A mandatory pre-qualification criterion missed ends the matter. */
  const failsMandatory = (bidId: number) =>
    published.some(
      (criterion) => criterion.isMandatory && !markOf(bidId, criterion.id).isMet,
    );

  const save = useMutation({
    mutationFn: () =>
      api.post(`/tenders/${tender.id}/technical-evaluation`, {
        evaluations: tender.bids.map((bid) => ({
          bidId: bid.id,
          technicalStatus: hasCriteria && failsMandatory(bid.id)
            ? 'DISQUALIFIED'
            : rows[bid.id]!.status,
          technicalScore: hasCriteria
            ? derivedScore(bid.id)
            : rows[bid.id]!.score
              ? Number(rows[bid.id]!.score)
              : undefined,
          remarks: rows[bid.id]!.remarks || undefined,
          criteria: hasCriteria
            ? published.map((criterion) => ({
                criterionId: criterion.id,
                isMet: markOf(bid.id, criterion.id).isMet,
                score: criterion.kind === 'TQ' ? Number(markOf(bid.id, criterion.id).score) || 0 : 0,
              }))
            : undefined,
        })),
      }),
    onSuccess: () => {
      toast.success('Evaluation recorded');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) => {
      setMessage(error instanceof ApiError ? error.message : 'Could not record the evaluation.');
    },
  });

  const update = (bidId: number, key: 'status' | 'score' | 'remarks', value: string) =>
    setRows((prev) => ({ ...prev, [bidId]: { ...prev[bidId]!, [key]: value } }));

  return (
    <Modal
      open
      title="Technical evaluation"
      subtitle="Record a decision against every bid. Financial bids stay sealed."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => { setMessage(null); save.mutate(); }}>
            Record evaluation
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        {hasCriteria && (
          <Alert variant="info" title="Marked against the published criteria">
            The technical score is totalled from the marks below rather than typed, and a bid that
            misses a mandatory criterion is disqualified whatever it scored elsewhere.
          </Alert>
        )}

        {tender.bids.map((bid) => {
          const disqualified = hasCriteria && failsMandatory(bid.id);
          return (
            <fieldset className="fieldset" key={bid.id}>
              <legend className="fieldset__legend">{bid.contractor.name}</legend>
              <p className="field__hint" style={{ marginBottom: 12 }}>
                <span className="code">{bid.bidNo}</span> · {bid.contractor.registrationClass ?? 'Unclassified'}
                {' · '}Submitted {dateTime(bid.submittedAt)} · EMD {bid.emdReference ?? '—'}
              </p>

              {hasCriteria ? (
                <div className="stack">
                  <div className="table-wrap">
                    <table className="table table--compact">
                      <caption className="visually-hidden">
                        Criteria for {bid.contractor.name}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col" style={{ width: 60 }}>Type</th>
                          <th scope="col">Criterion</th>
                          <th scope="col" style={{ width: 130 }}>Met</th>
                          <th scope="col" className="num" style={{ width: 130 }}>Marks</th>
                        </tr>
                      </thead>
                      <tbody>
                        {published.map((criterion) => {
                          const mark = markOf(bid.id, criterion.id);
                          return (
                            <tr key={criterion.id}>
                              <td>
                                <span className="code">{criterion.kind}{criterion.slNo}</span>
                              </td>
                              <td>
                                <div className="cell-primary">{criterion.title}</div>
                                <div className="cell-muted">{criterion.requirement}</div>
                              </td>
                              <td>
                                <Checkbox
                                  label={mark.isMet ? 'Met' : 'Not met'}
                                  checked={mark.isMet}
                                  onChange={(event) =>
                                    setMark(bid.id, criterion.id, { isMet: event.target.checked })
                                  }
                                />
                                {criterion.isMandatory && !mark.isMet && (
                                  <div className="cell-muted" style={{ color: 'var(--danger-fg)' }}>
                                    Mandatory — disqualifies
                                  </div>
                                )}
                              </td>
                              <td>
                                {criterion.kind === 'TQ' ? (
                                  <input
                                    className="input input--number"
                                    inputMode="numeric"
                                    aria-label={`Marks for ${criterion.title}`}
                                    value={mark.score}
                                    disabled={!mark.isMet}
                                    onChange={(event) =>
                                      setMark(bid.id, criterion.id, { score: event.target.value })
                                    }
                                  />
                                ) : (
                                  <span className="cell-muted">Pass or fail</span>
                                )}
                                {criterion.kind === 'TQ' && (
                                  <div className="cell-muted">of {criterion.maxScore}</div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr>
                          <td colSpan={3} style={{ textAlign: 'right' }}>Technical score</td>
                          <td className="num">
                            <strong>{derivedScore(bid.id)}</strong> of {tender.criteria.tqMaxScore}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  {disqualified && (
                    <Alert variant="danger" title="This bid fails a mandatory criterion">
                      It will be recorded as disqualified and will not reach the financial stage.
                    </Alert>
                  )}

                  <TextArea
                    label="Evaluation note"
                    full
                    rows={2}
                    value={rows[bid.id]!.remarks}
                    onChange={(event) => update(bid.id, 'remarks', event.target.value)}
                    hint="The committee’s reasoning, in its own words. This is auditable."
                  />
                </div>
              ) : (
                <div className="form-grid">
                  <Select
                    label="Decision"
                    required
                    value={rows[bid.id]!.status}
                    onChange={(event) => update(bid.id, 'status', event.target.value)}
                    options={[
                      { value: 'QUALIFIED', label: 'Technically qualified' },
                      { value: 'DISQUALIFIED', label: 'Disqualified' },
                    ]}
                  />
                  <TextInput
                    label="Technical score (out of 100)"
                    numeric
                    inputMode="numeric"
                    value={rows[bid.id]!.score}
                    onChange={(event) => update(bid.id, 'score', event.target.value)}
                  />
                  <TextArea
                    label="Evaluation note"
                    full
                    rows={2}
                    value={rows[bid.id]!.remarks}
                    onChange={(event) => update(bid.id, 'remarks', event.target.value)}
                    hint="Record which criteria were met or missed. This is auditable."
                  />
                </div>
              )}
            </fieldset>
          );
        })}
      </div>
    </Modal>
  );
}

/* ==========================================================================
   Award
   ========================================================================== */

function AwardDialog({ tender, onClose }: { tender: TenderDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const qualified = tender.bids
    .filter((b) => b.technicalStatus === 'QUALIFIED')
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99));

  const l1 = qualified.find((b) => b.rank === 1);
  const [bidId, setBidId] = useState(l1 ? String(l1.id) : '');
  const [negotiatedValue, setNegotiatedValue] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const selected = qualified.find((b) => String(b.id) === bidId);
  const notL1 = Boolean(selected && selected.rank !== 1);

  const award = useMutation({
    mutationFn: () =>
      api.post(`/tenders/${tender.id}/award`, {
        bidId: Number(bidId),
        negotiatedValue: negotiatedValue || undefined,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Tender awarded', 'A letter of acceptance has been issued and the package created.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) => {
      setMessage(error instanceof ApiError ? error.message : 'Could not award the tender.');
    },
  });

  return (
    <Modal
      open
      title="Award tender"
      subtitle={`${tender.tenderNo} — ${tender.title}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={award.isPending}>Cancel</Button>
          <Button
            variant="success"
            loading={award.isPending}
            disabled={!bidId || (notL1 && remarks.trim().length < 5)}
            onClick={() => { setMessage(null); award.mutate(); }}
          >
            Issue letter of acceptance
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not award">{message}</Alert>}

        <Card title="Ranked bids" flush>
          <DataTable
            rows={qualified}
            rowKey={(row) => row.id}
            compact
            columns={[
              {
                key: 'rank',
                header: 'Rank',
                render: (row) => (
                  <span className={row.rank === 1 ? 'badge badge--ok' : 'badge badge--neutral'}>
                    L{row.rank}
                  </span>
                ),
              },
              { key: 'name', header: 'Contractor', render: (row) => row.contractor.name },
              { key: 'score', header: 'Technical', numeric: true, render: (row) => row.technicalScore ?? '—' },
              { key: 'quoted', header: 'Quoted', numeric: true, render: (row) => rupees(row.quotedAmount) },
              {
                key: 'variation',
                header: 'vs estimate',
                numeric: true,
                render: (row) =>
                  row.variation === null ? '—' : (
                    <span style={{ color: row.variation > 0 ? 'var(--danger-fg)' : 'var(--ok-fg)' }}>
                      {row.variation > 0 ? '+' : ''}{percent(row.variation)}
                    </span>
                  ),
              },
            ]}
          />
        </Card>

        <Select
          label="Award to"
          required
          value={bidId}
          onChange={(event) => setBidId(event.target.value)}
          placeholder="Select the successful bidder"
          options={qualified.map((b) => ({
            value: b.id,
            label: `L${b.rank} — ${b.contractor.name} — ${rupees(b.quotedAmount)}`,
          }))}
        />

        {notL1 && (
          <Alert variant="warn" title="Not the lowest bidder">
            You are awarding above L1. Record the justification below — it becomes part of the
            permanent audit record.
          </Alert>
        )}

        <TextInput
          label="Negotiated value"
          prefix="₹"
          numeric
          inputMode="decimal"
          value={negotiatedValue}
          onChange={(event) => setNegotiatedValue(event.target.value)}
          hint={
            selected
              ? `Leave blank to award at the quoted amount of ${rupees(selected.quotedAmount)}. A negotiated value cannot be higher.`
              : 'Leave blank to award at the quoted amount.'
          }
        />

        <TextArea
          label="Award remarks"
          required={notL1}
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          hint={notL1 ? 'Required — explain why L1 was not selected.' : 'Optional.'}
        />

        <Alert variant="info" title="What happens on award">
          A letter of acceptance is generated, the work package is created (or updated) with the
          awarded value, and the contractor is notified. Running account bills can then be raised
          against that package.
        </Alert>
      </div>
    </Modal>
  );
}
