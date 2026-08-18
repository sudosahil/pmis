import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { date, dateTime, money, rupees, today } from '../lib/format';
import type { MiscBillDetail } from '../types';
import {
  Alert, Button, Card, DetailItem, EditIcon, Loading, PageHeader, PrinterIcon, SendIcon,
  TextArea, TextInput, TrashIcon,
} from '../components/ui';
import { ConfirmModal, Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { WorkflowPanel } from '../components/WorkflowPanel';

const CATEGORY_LABELS: Record<string, string> = {
  PROJECT_EXPENSE: 'Project expense',
  REVENUE_EXPENSE: 'Revenue expense',
  REFUND: 'Refund',
};

export function MiscBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole, user } = useAuth();

  const [submitting, setSubmitting] = useState(false);
  const [tally, setTally] = useState(false);
  const [paying, setPaying] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data: bill, isLoading, isError } = useQuery({
    queryKey: ['misc-bill', id],
    queryFn: () => api.get<MiscBillDetail>(`/misc-bills/${id}`),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['misc-bill', id] });
    void queryClient.invalidateQueries({ queryKey: ['misc-bills'] });
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  const submit = useMutation({
    mutationFn: (remarks: string) => api.post(`/misc-bills/${id}/submit`, { remarks: remarks || undefined }),
    onSuccess: () => {
      toast.success('Sent for approval', 'The bill has entered the approval chain.');
      setSubmitting(false);
      refresh();
    },
    onError: (error: unknown) =>
      toast.error('Could not submit', error instanceof ApiError ? error.message : undefined),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/misc-bills/${id}`),
    onSuccess: () => {
      toast.success('Draft deleted');
      void queryClient.invalidateQueries({ queryKey: ['misc-bills'] });
      navigate('/misc-bills');
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  if (isLoading) return <Loading label="Loading the bill…" />;
  if (isError || !bill) {
    return (
      <Alert variant="danger" title="Bill not found">
        This bill does not exist, or you do not have access to it.
      </Alert>
    );
  }

  const isDraft = bill.status === 'DRAFT' || bill.status === 'RETURNED';
  const isAuthor = hasRole('ADMIN', 'AC', 'AS', 'EE');
  const canEdit = isDraft && isAuthor;
  const canSendToTally = bill.status === 'APPROVED' && hasRole('ADMIN', 'CAO', 'AAO');
  const canRecordPayment = bill.status === 'SENT_TO_TALLY' && hasRole('ADMIN', 'CAO', 'AAO');

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/misc-bills">Miscellaneous bills</Link>
            <span className="breadcrumb__sep">/</span>
            <span>{bill.billNo}</span>
          </>
        }
        title={bill.billNo}
        subtitle={
          <>
            {CATEGORY_LABELS[bill.billCategory] ?? bill.billCategory} · {bill.division.name} ·{' '}
            {bill.financialYear} · billed {date(bill.billDate)}
          </>
        }
        actions={
          <>
            <Button icon={<PrinterIcon />} onClick={() => window.print()}>Print</Button>
            {canEdit && (
              <>
                <Button icon={<EditIcon />} onClick={() => navigate(`/misc-bills/${bill.id}/edit`)}>
                  Edit
                </Button>
                <Button variant="danger" icon={<TrashIcon />} onClick={() => setDeleting(true)}>
                  Delete draft
                </Button>
                <Button variant="primary" icon={<SendIcon />} onClick={() => setSubmitting(true)}>
                  Send for approval
                </Button>
              </>
            )}
            {canSendToTally && (
              <Button variant="primary" onClick={() => setTally(true)}>Send to Tally</Button>
            )}
            {canRecordPayment && (
              <Button variant="success" onClick={() => setPaying(true)}>Record payment</Button>
            )}
          </>
        }
      />

      {bill.status === 'PAID' && (
        <Alert variant="ok" title="Paid">
          Paid on {date(bill.paymentDate)} against reference {bill.paymentReference ?? '—'}
          {bill.tallyVoucherNo ? `, Tally voucher ${bill.tallyVoucherNo}` : ''}.
        </Alert>
      )}

      <div className="grid grid--3">
        <div className="stat stat--accent">
          <div className="stat__label">Gross claim</div>
          <div className="stat__value stat__value--currency">{rupees(bill.amounts.grossAmount)}</div>
          <div className="stat__meta">{bill.items.length} expense line{bill.items.length === 1 ? '' : 's'}</div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">Deductions</div>
          <div className="stat__value stat__value--currency">−{rupees(bill.amounts.totalDeduction)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Net payable</div>
          <div className="stat__value stat__value--currency">{rupees(bill.amounts.netPayableAmount)}</div>
          <div className="stat__meta"><StatusBadge status={bill.status} /></div>
        </div>
      </div>

      <div className="grid grid--2">
        <div className="stack">
          <Card title="Bill particulars">
            <div className="detail-grid">
              <DetailItem label="Bill number" value={<span className="code">{bill.billNo}</span>} />
              <DetailItem label="Category" value={CATEGORY_LABELS[bill.billCategory] ?? bill.billCategory} />
              <DetailItem label="Project" value={bill.project?.name ?? 'Not tied to a project'} />
              <DetailItem label="Division" value={`${bill.division.name} (${bill.division.code})`} />
              <DetailItem label="Site" value={bill.siteId} />
              <DetailItem label="Bill date" value={date(bill.billDate)} />
              <DetailItem
                label="Expenditure period"
                value={bill.periodFrom || bill.periodTo ? `${date(bill.periodFrom)} – ${date(bill.periodTo)}` : null}
              />
              <DetailItem label="Financial year" value={bill.financialYear} />
            </div>
          </Card>

          <Card title="Payee">
            <div className="detail-grid">
              <DetailItem label="Paid to" value={bill.payeeName} />
              <DetailItem label="Payee type" value={bill.payeeType} />
              <DetailItem label="Contractor" value={bill.contractor?.name} />
              <DetailItem label="Submitted by" value={bill.submittedBy} />
              <DetailItem label="Designation" value={bill.submittedByDesignation} />
              <DetailItem label="Refund reference" value={bill.refundReference} />
              <DetailItem label="Raised by" value={bill.createdBy} />
              <DetailItem label="Raised on" value={dateTime(bill.createdAt)} />
            </div>
          </Card>

          {(bill.eoffice.fileNo || bill.tallyVoucherNo) && (
            <Card title="Treasury and e-Office">
              <div className="detail-grid">
                <DetailItem label="e-Office file" value={bill.eoffice.fileNo} />
                <DetailItem label="e-Office note" value={bill.eoffice.noteNo} />
                <DetailItem label="Tally voucher" value={bill.tallyVoucherNo} />
                <DetailItem label="Payment date" value={date(bill.paymentDate)} />
                <DetailItem label="Payment reference" value={bill.paymentReference} />
                <DetailItem label="Treasury remarks" value={bill.eoffice.remarks} />
              </div>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card title="Payment details" subtitle="Computed from the expense lines below.">
            <div className="totals">
              <div className="totals__row">
                <span className="totals__label">Gross amount claimed</span>
                <span className="totals__value">{money(bill.amounts.grossAmount)}</span>
              </div>
              <div className="totals__row totals__row--sub">
                <span className="totals__label">Less deductions</span>
                <span className="totals__value">−{money(bill.amounts.totalDeduction)}</span>
              </div>
              <div className="totals__row totals__row--grand">
                <span className="totals__label">Net amount payable</span>
                <span className="totals__value">{money(bill.amounts.netPayableAmount)}</span>
              </div>
              <p className="totals__words">{bill.amounts.netPayableInWords}</p>
            </div>
          </Card>

          <WorkflowPanel workflow={bill.workflow} onActed={refresh} />
        </div>
      </div>

      <Card
        title="Expense lines"
        subtitle="Each line is booked to a government object head through its expense category."
        flush
      >
        <div className="table-wrap">
          <table className="table table--compact table--totals">
            <caption className="visually-hidden">Expense lines</caption>
            <thead>
              <tr>
                <th scope="col">Sl</th>
                <th scope="col">Date</th>
                <th scope="col">Particulars</th>
                <th scope="col">Category</th>
                <th scope="col">Object head</th>
                <th scope="col">Invoice</th>
                <th scope="col" className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {bill.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.slNo}</td>
                  <td>{date(item.expenseDate)}</td>
                  <td>
                    <div>{item.description}</div>
                    {item.remarks && <div className="cell-muted">{item.remarks}</div>}
                  </td>
                  <td className="code">{item.categoryCode}</td>
                  <td>{item.govtObjectHead ?? '—'}</td>
                  <td>
                    <div>{item.invoiceNo ?? '—'}</div>
                    {item.gstin && <div className="cell-muted code">{item.gstin}</div>}
                  </td>
                  <td className="num">{money(item.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} style={{ textAlign: 'right' }}>Gross amount</td>
                <td className="num">{money(bill.amounts.grossAmount)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      {bill.remarks && (
        <Card title="Remarks">
          <p style={{ whiteSpace: 'pre-wrap' }}>{bill.remarks}</p>
        </Card>
      )}

      <SubmitDialog
        open={submitting}
        pending={submit.isPending}
        payee={bill.payeeName}
        amount={bill.amounts.netPayableAmount}
        officer={user?.fullName ?? ''}
        onClose={() => setSubmitting(false)}
        onSubmit={(remarks) => submit.mutate(remarks)}
      />

      {tally && (
        <TallyDialog billId={bill.id} onClose={() => setTally(false)} onSaved={refresh} />
      )}
      {paying && (
        <PaymentDialog billId={bill.id} onClose={() => setPaying(false)} onSaved={refresh} />
      )}

      <ConfirmModal
        open={deleting}
        title="Delete this draft bill?"
        message="The bill and all its expense lines are removed. This cannot be undone."
        confirmLabel="Delete draft"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </>
  );
}

function SubmitDialog({
  open, pending, payee, amount, officer, onClose, onSubmit,
}: {
  open: boolean;
  pending: boolean;
  payee: string;
  amount: number;
  officer: string;
  onClose: () => void;
  onSubmit: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState('');
  return (
    <Modal
      open={open}
      title="Send this bill for approval"
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
        <Alert variant="warn" title="You are certifying this claim">
          By sending it onward, {officer || 'you'} certify that {rupees(amount)} is properly due to{' '}
          {payee} and that the supporting invoices are on record.
        </Alert>
        <TextArea
          label="Covering remarks"
          full
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          hint="Optional. Shown to every officer in the approval chain."
        />
      </div>
    </Modal>
  );
}

function TallyDialog({
  billId, onClose, onSaved,
}: {
  billId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [fileNo, setFileNo] = useState('');
  const [noteNo, setNoteNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/misc-bills/${billId}/send-to-tally`, {
        eofficeFileNo: fileNo,
        eofficeNoteNo: noteNo || undefined,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Sent to Tally', 'A voucher number has been allotted against this bill.');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not send the bill to Tally.'),
  });

  return (
    <Modal
      open
      title="Send to Tally"
      subtitle="Records the e-Office file the voucher travels on."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!fileNo.trim()}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Send to Tally
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not send">{message}</Alert>}
        <TextInput
          label="e-Office file number"
          required
          value={fileNo}
          onChange={(event) => setFileNo(event.target.value)}
          placeholder="e.g. PWD/ACCT/2026/1187"
        />
        <TextInput
          label="e-Office note number"
          value={noteNo}
          onChange={(event) => setNoteNo(event.target.value)}
        />
        <TextArea
          label="Remarks"
          full
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />
      </div>
    </Modal>
  );
}

function PaymentDialog({
  billId, onClose, onSaved,
}: {
  billId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [paymentDate, setPaymentDate] = useState(today());
  const [reference, setReference] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/misc-bills/${billId}/payment`, {
        paymentDate,
        paymentReference: reference,
      }),
    onSuccess: () => {
      toast.success('Payment recorded', 'The bill is now closed as paid.');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the payment.'),
  });

  return (
    <Modal
      open
      title="Record payment"
      subtitle="Enter the date and reference of the actual disbursement."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="success"
            loading={mutation.isPending}
            disabled={!reference.trim()}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <TextInput
          label="Payment date"
          type="date"
          required
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
        />
        <TextInput
          label="Payment reference"
          required
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          hint="Cheque, NEFT or treasury bill number."
        />
      </div>
    </Modal>
  );
}
