import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { date, dateTime, rupees } from '../lib/format';
import type { LocRequestDetail } from '../types';
import {
  Alert, Button, Card, DetailItem, Loading, PageHeader, SendIcon, TextArea, TextInput,
} from '../components/ui';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { WorkflowPanel } from '../components/WorkflowPanel';

export function LocRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [approving, setApproving] = useState(false);

  const { data: loc, isLoading, isError } = useQuery({
    queryKey: ['loc', id],
    queryFn: () => api.get<LocRequestDetail>(`/funds/loc/${id}`),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['loc', id] });
    void queryClient.invalidateQueries({ queryKey: ['loc-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  const submit = useMutation({
    mutationFn: (remarks: string) => api.post(`/funds/loc/${id}/submit`, { remarks: remarks || undefined }),
    onSuccess: () => {
      toast.success('Sent for approval', 'The request has entered the accounts approval chain.');
      setSubmitting(false);
      refresh();
    },
    onError: (error: unknown) =>
      toast.error('Could not submit', error instanceof ApiError ? error.message : undefined),
  });

  if (isLoading) return <Loading label="Loading the request…" />;
  if (isError || !loc) {
    return (
      <Alert variant="danger" title="Request not found">
        This letter of credit does not exist, or you do not have access to it.
      </Alert>
    );
  }

  const isDraft = loc.status === 'DRAFT' || loc.status === 'RETURNED';
  const canSubmit = isDraft && hasRole('ADMIN', 'EE', 'AC', 'AS');
  const canSetAmount = loc.status === 'IN_APPROVAL' && hasRole('ADMIN', 'CAO', 'AAO', 'MD');

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/funds?tab=loc">Funds and letters of credit</Link>
            <span className="breadcrumb__sep">/</span>
            <span>{loc.locNo}</span>
          </>
        }
        title={loc.locNo}
        subtitle={`${loc.division.name} · ${loc.financialYear} · requested ${date(loc.requestDate)}`}
        actions={
          <>
            {canSubmit && (
              <Button variant="primary" icon={<SendIcon />} onClick={() => setSubmitting(true)}>
                Send for approval
              </Button>
            )}
            {canSetAmount && (
              <Button variant="primary" onClick={() => setApproving(true)}>
                Set the amount approved
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid--3">
        <div className="stat stat--accent">
          <div className="stat__label">Amount requested</div>
          <div className="stat__value stat__value--currency">{rupees(loc.requestedAmount)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Amount approved</div>
          <div className="stat__value stat__value--currency">
            {loc.approvedAmount ? rupees(loc.approvedAmount) : 'Not yet set'}
          </div>
          <div className="stat__meta">{loc.approvalDate ? `Approved ${date(loc.approvalDate)}` : 'Pending decision'}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Status</div>
          <div className="stat__value"><StatusBadge status={loc.status} /></div>
        </div>
      </div>

      <div className="grid grid--2">
        <div className="stack">
          <Card title="Request">
            <div className="detail-grid">
              <DetailItem label="Letter of credit number" value={<span className="code">{loc.locNo}</span>} />
              <DetailItem label="Division" value={`${loc.division.name} (${loc.division.code})`} />
              <DetailItem label="Scheme" value={loc.scheme?.name ?? 'All schemes'} />
              <DetailItem label="Financial year" value={loc.financialYear} />
              <DetailItem label="Request date" value={date(loc.requestDate)} />
              <DetailItem label="Raised by" value={loc.createdBy} />
              <DetailItem label="Raised on" value={dateTime(loc.createdAt)} />
            </div>
          </Card>

          <Card title="Purpose">
            <p style={{ whiteSpace: 'pre-wrap' }}>{loc.purpose ?? 'No purpose recorded.'}</p>
            {loc.remarks && (
              <>
                <h3 style={{ marginTop: 16, fontSize: 14 }}>Remarks</h3>
                <p style={{ whiteSpace: 'pre-wrap' }}>{loc.remarks}</p>
              </>
            )}
          </Card>
        </div>

        <WorkflowPanel workflow={loc.workflow} onActed={refresh} />
      </div>

      <SubmitDialog
        open={submitting}
        pending={submit.isPending}
        onClose={() => setSubmitting(false)}
        onSubmit={(remarks) => submit.mutate(remarks)}
      />
      {approving && (
        <ApprovedAmountDialog
          loc={loc}
          onClose={() => setApproving(false)}
          onSaved={refresh}
        />
      )}
    </>
  );
}

function SubmitDialog({
  open, pending, onClose, onSubmit,
}: {
  open: boolean;
  pending: boolean;
  onClose: () => void;
  onSubmit: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState('');
  return (
    <Modal
      open={open}
      title="Send this request for approval"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => onSubmit(remarks)}>
            Send for approval
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert variant="info" title="Once sent, the request cannot be edited">
          It moves to the accounts officer for scrutiny. If anything needs changing they will return it to you.
        </Alert>
        <TextArea
          label="Covering remarks"
          full
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          hint="Optional. Shown to every officer in the chain."
        />
      </div>
    </Modal>
  );
}

function ApprovedAmountDialog({
  loc, onClose, onSaved,
}: {
  loc: LocRequestDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [approvedAmount, setApprovedAmount] = useState(String(loc.requestedAmount));
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/funds/loc/${loc.id}/approved-amount`, {
        approvedAmount,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Amount recorded', 'The approved amount has been saved against this request.');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the amount.'),
  });

  const shortfall = loc.requestedAmount - Number(approvedAmount || 0);

  return (
    <Modal
      open
      title="Set the amount approved"
      subtitle={loc.locNo}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => { setMessage(null); mutation.mutate(); }}>
            Save amount
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <DetailItem label="Amount requested" value={rupees(loc.requestedAmount)} />
          <TextInput
            label="Amount approved"
            required
            numeric
            prefix="₹"
            value={approvedAmount}
            onChange={(event) => setApprovedAmount(event.target.value)}
            hint="May be less than the amount requested."
          />
          <TextArea
            label="Remarks"
            full
            rows={3}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            hint="Record why the amount was reduced, if it was."
          />
        </div>
        {shortfall > 0 && (
          <Alert variant="warn" title="Approved for less than requested">
            The division will be short by {rupees(shortfall)} against what it asked for. Record the reason above.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
