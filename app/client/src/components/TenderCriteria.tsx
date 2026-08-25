import { useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { dateTime, percent, rupees } from '../lib/format';
import {
  ABOVE_SR_GROUNDS, ABOVE_SR_GROUND_LABELS,
  type AboveSrGround, type TenderCriterion, type TenderDetail,
} from '../types';
import {
  Alert, Button, Card, Checkbox, EmptyState, PlusIcon, Select, TextArea, TextInput, TrashIcon,
} from './ui';
import { Modal, ConfirmModal } from './Modal';

/**
 * Pre-qualification and technical qualification criteria — what a tender
 * document adds to the Detailed Project Report it was raised from.
 *
 * The report says what is to be built and what it should cost. These say who is
 * fit to build it: PQ screens the bidder before anything is opened and is pass
 * or fail; TQ is marked out of a hundred and decides the technical envelope.
 */

export function TenderCriteriaPanel({ tender }: { tender: TenderDetail }) {
  const { can } = useAuth();
  const [editing, setEditing] = useState(false);

  const { pq, tq, tqMaxScore } = tender.criteria;
  const isDraft = tender.status === 'DRAFT' || tender.status === 'REJECTED';
  const canEdit = can('tenders.manage') && isDraft;

  return (
    <div className="stack">
      {!pq.length && !tq.length ? (
        <Card title="Qualification criteria">
          <EmptyState
            title="No qualification criteria set"
            text={
              isDraft
                ? 'A tender document is the estimate plus its criteria. Set the pre-qualification and technical requirements before sending it for approval.'
                : 'This tender was published without structured criteria. Its eligibility is stated in the notice.'
            }
            action={
              canEdit ? (
                <Button variant="primary" icon={<PlusIcon />} onClick={() => setEditing(true)}>
                  Set the criteria
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Card
            title="Pre-qualification criteria"
            subtitle="Pass or fail. A bidder failing any of these is not carried to technical evaluation."
            actions={
              canEdit ? (
                <Button size="sm" onClick={() => setEditing(true)}>Edit criteria</Button>
              ) : undefined
            }
            flush
          >
            <CriteriaTable criteria={pq} scored={false} />
          </Card>

          <Card
            title="Technical qualification criteria"
            subtitle={`Marked out of ${tqMaxScore}. The technical score is the total of these marks.`}
            flush
          >
            <CriteriaTable criteria={tq} scored />
          </Card>
        </>
      )}

      {editing && (
        <CriteriaDialog tender={tender} onClose={() => setEditing(false)} />
      )}
    </div>
  );
}

function CriteriaTable({ criteria, scored }: { criteria: TenderCriterion[]; scored: boolean }) {
  if (!criteria.length) {
    return (
      <EmptyState
        title={scored ? 'No technical criteria' : 'No pre-qualification criteria'}
      />
    );
  }

  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption className="visually-hidden">
          {scored ? 'Technical qualification criteria' : 'Pre-qualification criteria'}
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: 44 }}>Sl</th>
            <th scope="col" style={{ width: 220 }}>Criterion</th>
            <th scope="col">What the bidder must demonstrate</th>
            <th scope="col" style={{ width: 200 }}>Evidence</th>
            {scored && <th scope="col" className="num" style={{ width: 80 }}>Marks</th>}
          </tr>
        </thead>
        <tbody>
          {criteria.map((criterion) => (
            <tr key={criterion.id}>
              <td>{criterion.slNo}</td>
              <td>
                <div className="cell-primary">{criterion.title}</div>
                {criterion.isMandatory && !scored && (
                  <div className="cell-muted">Mandatory</div>
                )}
              </td>
              <td>{criterion.requirement}</td>
              <td className="cell-muted">{criterion.evidence ?? '—'}</td>
              {scored && <td className="num">{criterion.maxScore}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Editing -----------------------------------------------------------------

interface DraftCriterion {
  key: string;
  kind: 'PQ' | 'TQ';
  title: string;
  requirement: string;
  evidence: string;
  isMandatory: boolean;
  maxScore: string;
}

let criterionCounter = 0;
const newCriterion = (kind: 'PQ' | 'TQ'): DraftCriterion => ({
  key: `criterion-${(criterionCounter += 1)}`,
  kind,
  title: '',
  requirement: '',
  evidence: '',
  isMandatory: true,
  maxScore: kind === 'TQ' ? '10' : '0',
});

function CriteriaDialog({ tender, onClose }: { tender: TenderDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);
  const [criteria, setCriteria] = useState<DraftCriterion[]>(() =>
    [...tender.criteria.pq, ...tender.criteria.tq].map((criterion) => ({
      key: `saved-${criterion.id}`,
      kind: criterion.kind,
      title: criterion.title,
      requirement: criterion.requirement,
      evidence: criterion.evidence ?? '',
      isMandatory: criterion.isMandatory,
      maxScore: String(criterion.maxScore),
    })),
  );

  const update = (key: string, patch: Partial<DraftCriterion>) =>
    setCriteria(criteria.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  const tqTotal = criteria
    .filter((row) => row.kind === 'TQ')
    .reduce((sum, row) => sum + (Number(row.maxScore) || 0), 0);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/tenders/${tender.id}/criteria`, {
        criteria: criteria.map((row) => ({
          kind: row.kind,
          title: row.title,
          requirement: row.requirement,
          evidence: row.evidence || undefined,
          isMandatory: row.isMandatory,
          maxScore: row.kind === 'TQ' ? Number(row.maxScore) || 0 : 0,
        })),
      }),
    onSuccess: () => {
      toast.success('Criteria saved');
      void queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the criteria.'),
  });

  return (
    <Modal
      open
      title="Qualification criteria"
      subtitle={`${tender.tenderNo} — the requirements bidders are judged against`}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontSize: 14 }}>
            Technical marks:{' '}
            <strong style={{ color: tqTotal > 100 ? 'var(--danger-fg)' : undefined }}>
              {tqTotal}
            </strong>{' '}
            of 100
          </span>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={tqTotal > 100}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Save criteria
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <Alert variant="info" title="Two different jobs">
          A pre-qualification criterion is pass or fail — a bidder who does not meet a mandatory one
          goes no further, whatever else they score. A technical criterion carries marks, and the
          marks across all of them make up the technical score out of 100.
        </Alert>

        {(['PQ', 'TQ'] as const).map((kind) => (
          <fieldset key={kind} className="fieldset">
            <legend className="fieldset__legend">
              {kind === 'PQ' ? 'Pre-qualification' : 'Technical qualification'}
            </legend>
            <div className="stack">
              {criteria.filter((row) => row.kind === kind).map((row, index) => (
                <div
                  key={row.key}
                  style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '10px 12px' }}
                >
                  <div className="row row--between" style={{ marginBottom: 8 }}>
                    <strong>{kind} {index + 1}</strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<TrashIcon />}
                      aria-label={`Remove ${kind} criterion ${index + 1}`}
                      onClick={() => setCriteria(criteria.filter((other) => other.key !== row.key))}
                    />
                  </div>
                  <div className="form-grid">
                    <TextInput
                      label="Criterion"
                      value={row.title}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        update(row.key, { title: event.target.value })
                      }
                    />
                    {kind === 'TQ' ? (
                      <TextInput
                        label="Marks"
                        numeric
                        value={row.maxScore}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          update(row.key, { maxScore: event.target.value })
                        }
                        hint="Out of the hundred available."
                      />
                    ) : (
                      <div className="field">
                        <span className="field__label">Standing</span>
                        <Checkbox
                          label="Mandatory — failing this disqualifies the bid"
                          checked={row.isMandatory}
                          onChange={(event) => update(row.key, { isMandatory: event.target.checked })}
                        />
                      </div>
                    )}
                    <TextArea
                      label="What the bidder must demonstrate"
                      full
                      rows={2}
                      value={row.requirement}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        update(row.key, { requirement: event.target.value })
                      }
                    />
                    <TextInput
                      label="Evidence required"
                      full
                      value={row.evidence}
                      onChange={(event: ChangeEvent<HTMLInputElement>) =>
                        update(row.key, { evidence: event.target.value })
                      }
                      hint="The document that proves it — a completion certificate, an audited balance sheet."
                    />
                  </div>
                </div>
              ))}

              <Button
                icon={<PlusIcon />}
                onClick={() => setCriteria([...criteria, newCriterion(kind)])}
              >
                Add a {kind === 'PQ' ? 'pre-qualification' : 'technical'} criterion
              </Button>
            </div>
          </fieldset>
        ))}
      </div>
    </Modal>
  );
}

// --- The Schedule of Rates ceiling -------------------------------------------

export function SrCeilingCard({ tender }: { tender: TenderDetail }) {
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [granting, setGranting] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  const { srCeiling } = tender;
  const mayGrant = can('tenders.sr.relief');
  const biddingOpen = ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED'].includes(
    tender.status,
  );

  const withdraw = useMutation({
    mutationFn: () => api.delete(`/tenders/${tender.id}/sr-relief`),
    onSuccess: () => {
      toast.success('Relief withdrawn', 'The Schedule of Rates ceiling applies again in full.');
      void queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
      setWithdrawing(false);
    },
    onError: (error: unknown) => {
      setWithdrawing(false);
      toast.error(
        'Could not withdraw',
        error instanceof ApiError ? error.message : 'Please try again.',
      );
    },
  });

  if (!srCeiling.enforced) {
    return (
      <Card title="Schedule of Rates ceiling">
        <Alert variant="warn" title="This tender is outside the schedule">
          Bids on this tender are not measured against the Schedule of Rates. That is intended for a
          procurement the rate book does not cover — an expression of interest, say — and means the
          usual price control does not apply.
        </Alert>
      </Card>
    );
  }

  return (
    <>
      <Card
        title="Schedule of Rates ceiling"
        subtitle="A bid may be quoted below the approved government rates, but not above them."
        actions={
          mayGrant && biddingOpen ? (
            srCeiling.relief ? (
              <Button size="sm" onClick={() => setWithdrawing(true)}>Withdraw relief</Button>
            ) : (
              <Button size="sm" onClick={() => setGranting(true)}>Permit bidding above the schedule</Button>
            )
          ) : undefined
        }
      >
        <div className="grid grid--2">
          <div className="stat">
            <div className="stat__label">At approved rates</div>
            <div className="stat__value stat__value--currency">
              {rupees(srCeiling.baselineAmount)}
            </div>
            <div className="stat__meta"><span>The Schedule of Rates baseline</span></div>
          </div>
          <div className={`stat${srCeiling.relief ? ' stat--warn' : ' stat--accent'}`}>
            <div className="stat__label">Most a bid may reach</div>
            <div className="stat__value stat__value--currency">
              {rupees(srCeiling.effectiveAmount)}
            </div>
            <div className="stat__meta">
              <span>
                {srCeiling.relief
                  ? `${percent(srCeiling.relief.capPercent)} of relief counted in`
                  : 'No relief granted'}
              </span>
            </div>
          </div>
        </div>

        {srCeiling.relief && (
          <Alert
            variant="warn"
            title={`Bidding above the schedule is permitted, up to ${percent(srCeiling.relief.capPercent)}`}
          >
            <p style={{ margin: 0 }}>
              <strong>Ground. </strong>{srCeiling.relief.groundLabel}
            </p>
            <p style={{ margin: '4px 0 0' }}>
              <strong>Authority. </strong>{srCeiling.relief.authority}
            </p>
            {srCeiling.relief.remarks && (
              <p style={{ margin: '4px 0 0' }}>{srCeiling.relief.remarks}</p>
            )}
            <p style={{ margin: '6px 0 0', fontSize: 13 }}>
              Granted by {srCeiling.relief.grantedBy ?? 'the department'} on{' '}
              {dateTime(srCeiling.relief.grantedAt)}. It applies to every bidder equally, and a bid
              beyond that margin is still refused.
            </p>
          </Alert>
        )}
      </Card>

      {granting && (
        <SrReliefDialog tender={tender} onClose={() => setGranting(false)} />
      )}

      <ConfirmModal
        open={withdrawing}
        title="Withdraw the relief?"
        message={
          <div className="stack">
            <p>
              The Schedule of Rates ceiling will apply again in full, at{' '}
              <strong>{rupees(srCeiling.baselineAmount)}</strong>. Bidders will be refused above it.
            </p>
            <Alert variant="warn">
              This is refused outright if any bid has already been priced against the relief —
              withdrawing it then would invalidate a bid already submitted.
            </Alert>
          </div>
        }
        confirmLabel="Withdraw relief"
        loading={withdraw.isPending}
        onClose={() => setWithdrawing(false)}
        onConfirm={() => withdraw.mutate()}
      />
    </>
  );
}

function SrReliefDialog({ tender, onClose }: { tender: TenderDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [capPercent, setCapPercent] = useState('8');
  const [ground, setGround] = useState<AboveSrGround>('PRICE_ESCALATION');
  const [authority, setAuthority] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const grant = useMutation({
    mutationFn: () =>
      api.post(`/tenders/${tender.id}/sr-relief`, {
        capPercent,
        ground,
        authority,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success(
        'Relief granted',
        'It appears on the published notice, so every bidder prices against the same ceiling.',
      );
      void queryClient.invalidateQueries({ queryKey: ['tender', tender.id] });
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not grant the relief.'),
  });

  const cap = Number(capPercent) || 0;
  const newCeiling = tender.srCeiling.baselineAmount * (1 + cap / 100);

  return (
    <Modal
      open
      title="Permit bidding above the Schedule of Rates"
      subtitle={`${tender.tenderNo} — a decision recorded against your name`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={grant.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={grant.isPending}
            disabled={cap <= 0 || authority.trim().length < 3}
            onClick={() => { setMessage(null); grant.mutate(); }}
          >
            Grant the relief
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not grant">{message}</Alert>}

        <Alert variant="warn" title="Why this exists, and what it is not">
          The schedule is a price list fixed at a point in time. When a war, a pandemic or a price
          shock postdates the edition an estimate was built from, holding bidders to it draws no
          bids at all. This lifts the ceiling by a stated margin, on a stated ground, for every
          bidder equally — and it is granted before bidding, never claimed by one bidder after the
          envelopes are in.
        </Alert>

        <div className="form-grid">
          <TextInput
            label="Permitted above the schedule"
            required
            numeric
            value={capPercent}
            onChange={(event) => setCapPercent(event.target.value)}
            hint="A percentage. Bids beyond it are still refused."
          />
          <Select
            label="Ground"
            required
            options={ABOVE_SR_GROUNDS.map((value) => ({
              value,
              label: ABOVE_SR_GROUND_LABELS[value],
            }))}
            value={ground}
            onChange={(event) => setGround(event.target.value as AboveSrGround)}
          />
          <TextInput
            label="Authority"
            full
            required
            value={authority}
            onChange={(event) => setAuthority(event.target.value)}
            placeholder="e.g. PWD/SR/2026/ESC-03 dated 15 February 2026"
            hint="The circular or order permitting this. It appears on the tender notice."
          />
          <TextArea
            label="Remarks"
            full
            rows={3}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            hint="Why the schedule no longer reflects the market for this work."
          />
        </div>

        <div className="totals">
          <div className="totals__row">
            <span className="totals__label">At approved rates</span>
            <span className="totals__value">{rupees(tender.srCeiling.baselineAmount)}</span>
          </div>
          <div className="totals__row totals__row--grand">
            <span className="totals__label">Ceiling after this relief</span>
            <span className="totals__value">{rupees(newCeiling)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
