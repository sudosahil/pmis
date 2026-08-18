import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, dateTime, percent, quantity, rupees, today } from '../lib/format';
import type { RaBillDetail } from '../types';
import {
  Alert, Button, Card, CheckIcon, ChevronRightIcon, DetailItem, EditIcon, Loading,
  PageHeader, PrinterIcon, SendIcon, TextArea, TextInput, TrashIcon,
} from '../components/ui';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal, ConfirmModal } from '../components/Modal';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { useToast } from '../components/Toast';

export function RaBillDetailPage() {
  const { id } = useParams<{ id: string }>();
  const billId = Number(id);
  const navigate = useNavigate();
  const { hasRole, isContractor, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<'bill' | 'items' | 'approval'>('bill');
  const [dialog, setDialog] = useState<
    null | 'submit' | 'certify' | 'deductions' | 'tally' | 'payment' | 'delete'
  >(null);

  const bill = useQuery({
    queryKey: ['ra-bill', billId],
    queryFn: () => api.get<RaBillDetail>(`/ra-bills/${billId}`),
  });

  const submit = useMutation({
    mutationFn: (remarks: string) => api.post(`/ra-bills/${billId}/submit`, { remarks }),
    onSuccess: () => {
      toast.success('Bill submitted', 'It is now with the Assistant Engineer for measurement check.');
      void queryClient.invalidateQueries();
      setDialog(null);
      setTab('approval');
    },
    onError: (error: unknown) =>
      toast.error('Could not submit', error instanceof ApiError ? error.message : undefined),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/ra-bills/${billId}`),
    onSuccess: () => {
      toast.success('Draft bill deleted');
      void queryClient.invalidateQueries({ queryKey: ['ra-bills'] });
      navigate('/ra-bills');
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  if (bill.isLoading) return <Loading label="Loading bill…" />;
  if (bill.error || !bill.data) {
    return <Alert variant="danger" title="Bill not found">It may have been removed, or it is outside your jurisdiction.</Alert>;
  }

  const b = bill.data;
  const isDraft = b.status === 'DRAFT' || b.status === 'RETURNED';
  const isOwner = isContractor ? b.contractor.id === user?.contractorId : true;

  const canEdit = isDraft && isOwner && (isContractor || hasRole('ADMIN', 'EE', 'AEE', 'AE', 'AC'));
  const canCertify = b.status === 'IN_APPROVAL' && hasRole('EE', 'ADMIN');
  const canSetDeductions = b.status === 'IN_APPROVAL' && hasRole('AC', 'AS', 'AAO', 'CAO', 'ADMIN');
  const canSendToTally = b.status === 'APPROVED' && hasRole('ADMIN', 'CAO', 'AAO');
  const canRecordPayment = b.status === 'SENT_TO_TALLY' && hasRole('ADMIN', 'CAO', 'AAO');

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/ra-bills">RA bills</Link>
            <span className="breadcrumb__sep"><ChevronRightIcon size={14} /></span>
            <span>{b.billNo}</span>
          </>
        }
        title={`RA Bill No. ${b.raSequence} — ${b.package.name}`}
        subtitle={
          <>
            <span className="code">{b.billNo}</span>
            {b.dbrNo && <> · DBR No. <span className="code">{b.dbrNo}</span></>}
            {' · '}{b.financialYear} · {b.division.name}
          </>
        }
        actions={
          <>
            <StatusBadge status={b.status} />
            <Button icon={<PrinterIcon />} onClick={() => window.print()}>Print</Button>
            {canEdit && (
              <>
                <Link to={`/ra-bills/${b.id}/edit`} className="btn"><EditIcon /> Edit</Link>
                <Button variant="danger" icon={<TrashIcon />} onClick={() => setDialog('delete')}>
                  Delete
                </Button>
                <Button variant="primary" icon={<SendIcon />} onClick={() => setDialog('submit')}>
                  Submit for approval
                </Button>
              </>
            )}
            {canCertify && (
              <Button variant="primary" onClick={() => setDialog('certify')}>
                Certify admissible amount
              </Button>
            )}
            {canSetDeductions && (
              <Button onClick={() => setDialog('deductions')}>Revise deductions</Button>
            )}
            {canSendToTally && (
              <Button variant="primary" onClick={() => setDialog('tally')}>Send to Tally</Button>
            )}
            {canRecordPayment && (
              <Button variant="success" icon={<CheckIcon />} onClick={() => setDialog('payment')}>
                Record payment
              </Button>
            )}
          </>
        }
      />

      {b.status === 'RETURNED' && (
        <div style={{ marginBottom: 18 }}>
          <Alert variant="warn" title="Returned for correction">
            This bill was sent back. Correct it and submit again — the approval chain restarts from the
            stage it was returned to.
          </Alert>
        </div>
      )}

      {b.status === 'PAID' && (
        <div style={{ marginBottom: 18 }}>
          <Alert variant="ok" title="Payment released">
            Paid on {date(b.paymentDate)} · Reference <span className="code">{b.paymentReference}</span>
            {b.tallyVoucherNo && <> · Tally voucher <span className="code">{b.tallyVoucherNo}</span></>}
          </Alert>
        </div>
      )}

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        <div className="stat">
          <div className="stat__label">Contractor claim</div>
          <div className="stat__value stat__value--currency">{rupees(b.amounts.contractorClaimAmount)}</div>
        </div>
        <div className="stat stat--accent">
          <div className="stat__label">Admissible amount</div>
          <div className="stat__value stat__value--currency">{rupees(b.amounts.admissibleAmount)}</div>
          <div className="stat__meta"><span>Certified by the Executive Engineer</span></div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">Total deductions</div>
          <div className="stat__value stat__value--currency">{rupees(b.amounts.totalDeduction)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Net payable</div>
          <div className="stat__value stat__value--currency">{rupees(b.amounts.netPayableAmount)}</div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['bill', 'items', 'approval'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'bill' ? 'Bill summary' : key === 'items' ? 'Measurements' : 'Approval'}
            {key === 'items' ? <span className="tab__count">({b.items.length})</span> : null}
          </button>
        ))}
      </div>

      {tab === 'bill' && (
        <div className="stack">
          <Card title="Bill particulars">
            <div className="detail-grid">
              <DetailItem label="Bill number" value={<span className="code">{b.billNo}</span>} />
              <DetailItem label="DBR number" value={b.dbrNo ? <span className="code">{b.dbrNo}</span> : null} />
              <DetailItem label="Financial year" value={b.financialYear} />
              <DetailItem label="Bill type" value={b.billType === 'FINAL' ? 'Final bill' : `Running account (RA ${b.raSequence})`} />
              <DetailItem label="Project" value={<Link to={`/projects/${b.project.id}`}>{b.project.name}</Link>} />
              <DetailItem label="Package" value={<Link to={`/packages/${b.package.id}`}>{b.package.name}</Link>} />
              <DetailItem label="Contractor" value={<Link to={`/contractors/${b.contractor.id}`}>{b.contractor.name}</Link>} />
              <DetailItem label="Division" value={b.division.name} />
              <DetailItem label="Period from" value={date(b.periodFrom)} />
              <DetailItem label="Period to" value={date(b.periodTo)} />
              <DetailItem label="Measurement book" value={b.measurementBookNo} />
              <DetailItem label="Raised by" value={b.createdBy} />
            </div>
          </Card>

          {/* Payment block, laid out as on the departmental RA bill form. */}
          <div className="grid grid--2">
            <Card title="Payment details">
              <div className="totals">
                <div className="totals__row">
                  <span className="totals__label">Contractor claim amount</span>
                  <span className="totals__value">{rupees(b.amounts.contractorClaimAmount)}</span>
                </div>
                <div className="totals__row">
                  <span className="totals__label">Amount paid up to previous bill</span>
                  <span className="totals__value">{rupees(b.amounts.previousPaidAmount)}</span>
                </div>
                <div className="totals__row">
                  <span className="totals__label">Present bill amount (gross)</span>
                  <span className="totals__value">{rupees(b.amounts.presentBillAmount)}</span>
                </div>
                <div className="totals__row">
                  <span className="totals__label">Admissible amount</span>
                  <span className="totals__value">{rupees(b.amounts.admissibleAmount)}</span>
                </div>
                {b.deductions.map((d) => (
                  <div className="totals__row totals__row--sub" key={d.id}>
                    <span className="totals__label">
                      {d.description}
                      {d.basis === 'PERCENT' && ` (${percent(d.rate)})`}
                    </span>
                    <span className="totals__value">−{rupees(d.amount)}</span>
                  </div>
                ))}
                <div className="totals__row">
                  <span className="totals__label">Total deductions</span>
                  <span className="totals__value">−{rupees(b.amounts.totalDeduction)}</span>
                </div>
                <div className="totals__row totals__row--grand">
                  <span className="totals__label">Net payable amount</span>
                  <span className="totals__value">{rupees(b.amounts.netPayableAmount)}</span>
                </div>
                <div className="totals__words">{b.amounts.netPayableInWords}</div>
              </div>
            </Card>

            <Card
              title="ETP charges"
              subtitle={`Establishment, Tools & Plant and contingency, on the ${b.etp.basis.toLowerCase()}`}
            >
              <div className="totals">
                <div className="totals__row">
                  <span className="totals__label">Establishment charges ({percent(b.etp.establishment)})</span>
                  <span className="totals__value">{rupees(b.etp.establishmentAmount)}</span>
                </div>
                <div className="totals__row">
                  <span className="totals__label">Tools &amp; plants charges ({percent(b.etp.toolsPlant)})</span>
                  <span className="totals__value">{rupees(b.etp.toolsPlantAmount)}</span>
                </div>
                <div className="totals__row">
                  <span className="totals__label">Contingency charges ({percent(b.etp.contingency)})</span>
                  <span className="totals__value">{rupees(b.etp.contingencyAmount)}</span>
                </div>
                <div className="totals__row totals__row--grand">
                  <span className="totals__label">Total ETP charges ({percent(b.etp.totalPercent)})</span>
                  <span className="totals__value">{rupees(b.etp.totalAmount)}</span>
                </div>
              </div>

              {b.etp.totalPercent === 0 && (
                <div style={{ marginTop: 14 }}>
                  <Alert variant="info">
                    ETP percentages have not been set yet. The Executive Engineer records them when
                    certifying the admissible amount.
                  </Alert>
                </div>
              )}
            </Card>
          </div>

          <Card
            title="Project expenditure position"
            subtitle={`Cumulative against ${b.project.name}, financial year ${b.projectExpenditure.financialYear}`}
          >
            <div className="totals">
              <div className="totals__row">
                <span className="totals__label">
                  Expenditure up to March {b.projectExpenditure.financialYear.slice(0, 4)}
                </span>
                <span className="totals__value">{rupees(b.projectExpenditure.uptoPreviousYear)}</span>
              </div>
              <div className="totals__row">
                <span className="totals__label">Expenditure during the year</span>
                <span className="totals__value">{rupees(b.projectExpenditure.duringYear)}</span>
              </div>
              <div className="totals__row">
                <span className="totals__label">
                  ETP charges ({percent(b.projectExpenditure.etpPercent)}) on total project expenditure
                </span>
                <span className="totals__value">{rupees(b.projectExpenditure.etpOnExpenditure)}</span>
              </div>
              <div className="totals__row totals__row--grand">
                <span className="totals__label">Total expenditure including ETP charges</span>
                <span className="totals__value">{rupees(b.projectExpenditure.totalWithEtp)}</span>
              </div>
            </div>
          </Card>

          {(b.tallyVoucherNo || b.eoffice.fileNo) && (
            <Card title="Accounting and e-Office">
              <div className="detail-grid">
                <DetailItem label="Tally voucher" value={b.tallyVoucherNo ? <span className="code">{b.tallyVoucherNo}</span> : null} />
                <DetailItem label="e-Office file" value={b.eoffice.fileNo} />
                <DetailItem label="e-Office note" value={b.eoffice.noteNo} />
                <DetailItem label="Payment date" value={date(b.paymentDate)} />
                <DetailItem label="Payment reference" value={b.paymentReference} />
              </div>
              {b.eoffice.remarks && (
                <div style={{ marginTop: 14 }}>
                  <div className="detail-item__label">Remarks</div>
                  <p style={{ marginTop: 4, fontSize: 14.5 }}>{b.eoffice.remarks}</p>
                </div>
              )}
            </Card>
          )}
        </div>
      )}

      {tab === 'items' && (
        <Card
          title="Measurements"
          subtitle="Present quantity is the cumulative quantity less what was already billed."
          flush
        >
          <DataTable
            rows={b.items}
            rowKey={(row) => row.id}
            compact
            columns={[
              { key: 'sl', header: '#', width: '48px', render: (row) => row.slNo },
              { key: 'desc', header: 'Description of item', render: (row) => row.description },
              { key: 'uom', header: 'Unit', render: (row) => row.uom },
              { key: 'upto', header: 'Qty up to date', numeric: true, render: (row) => quantity(row.quantityUptoDate) },
              { key: 'prev', header: 'Qty previous', numeric: true, render: (row) => quantity(row.quantityPrevious) },
              {
                key: 'present',
                header: 'Qty this bill',
                numeric: true,
                render: (row) => <strong>{quantity(row.quantityPresent)}</strong>,
              },
              { key: 'rate', header: 'Rate (₹)', numeric: true, render: (row) => rupees(row.rate) },
              { key: 'amount', header: 'Amount (₹)', numeric: true, render: (row) => rupees(row.amount) },
            ]}
            footer={
              <tr>
                <td colSpan={7}>Present bill amount</td>
                <td className="num">{rupees(b.amounts.presentBillAmount)}</td>
              </tr>
            }
            empty={{ title: 'No measurements recorded' }}
          />
        </Card>
      )}

      {tab === 'approval' && (
        <WorkflowPanel
          workflow={b.workflow}
          onActed={() => void queryClient.invalidateQueries({ queryKey: ['ra-bill', billId] })}
        />
      )}

      {/* --- Dialogs --- */}

      <SubmitDialog
        open={dialog === 'submit'}
        bill={b}
        loading={submit.isPending}
        onClose={() => setDialog(null)}
        onSubmit={(remarks) => submit.mutate(remarks)}
      />

      <ConfirmModal
        open={dialog === 'delete'}
        title="Delete this draft bill"
        message="The bill and its measurements will be permanently removed. This cannot be undone."
        confirmLabel="Delete bill"
        danger
        loading={remove.isPending}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate()}
      />

      {dialog === 'certify' && <CertifyDialog bill={b} onClose={() => setDialog(null)} />}
      {dialog === 'deductions' && <DeductionsDialog bill={b} onClose={() => setDialog(null)} />}
      {dialog === 'tally' && <TallyDialog bill={b} onClose={() => setDialog(null)} />}
      {dialog === 'payment' && <PaymentDialog bill={b} onClose={() => setDialog(null)} />}
    </>
  );
}

function SubmitDialog({
  open, bill, loading, onClose, onSubmit,
}: {
  open: boolean;
  bill: RaBillDetail;
  loading: boolean;
  onClose: () => void;
  onSubmit: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState('');
  if (!open) return null;
  return (
    <Modal
      open
      title="Submit bill for approval"
      subtitle={bill.billNo}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => onSubmit(remarks)}>
            Submit for approval
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert variant="info" title="What happens next">
          A DBR number is allotted and the bill moves through Measurement Check (AE), Divisional
          Certification (EE), Accounts Compilation, Accounts Verification, Internal Audit, Financial
          Approval and finally Payment Release. It cannot be edited while in the chain.
        </Alert>
        <div className="totals">
          <div className="totals__row">
            <span className="totals__label">Gross bill amount</span>
            <span className="totals__value">{rupees(bill.amounts.presentBillAmount)}</span>
          </div>
          <div className="totals__row">
            <span className="totals__label">Deductions</span>
            <span className="totals__value">−{rupees(bill.amounts.totalDeduction)}</span>
          </div>
          <div className="totals__row totals__row--grand">
            <span className="totals__label">Net payable</span>
            <span className="totals__value">{rupees(bill.amounts.netPayableAmount)}</span>
          </div>
        </div>
        <TextArea
          label="Covering remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={3}
          hint="Optional."
        />
      </div>
    </Modal>
  );
}

/** Executive Engineer certification — admissible amount plus the three ETP rates. */
function CertifyDialog({ bill, onClose }: { bill: RaBillDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [admissibleAmount, setAdmissibleAmount] = useState(String(bill.amounts.admissibleAmount));
  const [establishment, setEstablishment] = useState(String(bill.etp.establishment || 2));
  const [toolsPlant, setToolsPlant] = useState(String(bill.etp.toolsPlant || 3));
  const [contingency, setContingency] = useState(String(bill.etp.contingency || 4));
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const admissible = Number(admissibleAmount) || 0;
  const totalPct = (Number(establishment) || 0) + (Number(toolsPlant) || 0) + (Number(contingency) || 0);
  const etpAmount = (admissible * totalPct) / 100;
  const exceedsClaim = admissible > bill.amounts.contractorClaimAmount;

  const certify = useMutation({
    mutationFn: () =>
      api.post(`/ra-bills/${bill.id}/certify`, {
        admissibleAmount,
        etpEstablishment: establishment || '0',
        etpToolsPlant: toolsPlant || '0',
        etpContingency: contingency || '0',
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Bill certified', 'Admissible amount and ETP charges recorded.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not certify the bill.'),
  });

  return (
    <Modal
      open
      title="Certify admissible amount"
      subtitle={`${bill.billNo} — ${bill.package.name}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={certify.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={certify.isPending}
            disabled={exceedsClaim || admissible <= 0}
            onClick={() => { setMessage(null); certify.mutate(); }}
          >
            Certify bill
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not certify">{message}</Alert>}

        <Alert variant="info">
          The admissible amount is what the department accepts as payable for the work measured. It
          may be less than the contractor's claim, but never more.
        </Alert>

        <div className="form-grid">
          <TextInput
            label="Contractor claim amount"
            prefix="₹"
            numeric
            value={rupees(bill.amounts.contractorClaimAmount).replace('₹ ', '')}
            disabled
            full
          />
          <TextInput
            label="Admissible amount"
            required
            prefix="₹"
            numeric
            inputMode="decimal"
            value={admissibleAmount}
            onChange={(event) => setAdmissibleAmount(event.target.value)}
            error={exceedsClaim ? 'Cannot exceed the amount claimed by the contractor.' : undefined}
            full
          />
        </div>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">ETP charges</legend>
          <div className="form-grid">
            <TextInput
              label="Establishment charges %"
              numeric
              inputMode="decimal"
              value={establishment}
              onChange={(event) => setEstablishment(event.target.value)}
              hint={`= ${rupees((admissible * (Number(establishment) || 0)) / 100)}`}
            />
            <TextInput
              label="Tools & plants charges %"
              numeric
              inputMode="decimal"
              value={toolsPlant}
              onChange={(event) => setToolsPlant(event.target.value)}
              hint={`= ${rupees((admissible * (Number(toolsPlant) || 0)) / 100)}`}
            />
            <TextInput
              label="Contingency charges %"
              numeric
              inputMode="decimal"
              value={contingency}
              onChange={(event) => setContingency(event.target.value)}
              hint={`= ${rupees((admissible * (Number(contingency) || 0)) / 100)}`}
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="totals">
              <div className="totals__row totals__row--grand">
                <span className="totals__label">
                  Total ETP charges ({totalPct.toFixed(2)}%) on the admissible amount
                </span>
                <span className="totals__value">{rupees(etpAmount)}</span>
              </div>
            </div>
          </div>
        </fieldset>

        <TextArea
          label="Certification remarks"
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          hint="Optional. Note any reduction from the claimed amount and why."
        />
      </div>
    </Modal>
  );
}

interface DeductionDraft {
  code: string;
  description: string;
  basis: 'PERCENT' | 'AMOUNT';
  rate: string;
  amount: string;
}

function DeductionsDialog({ bill, onClose }: { bill: RaBillDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<DeductionDraft[]>(
    bill.deductions.map((d) => ({
      code: d.code,
      description: d.description,
      basis: d.basis as 'PERCENT' | 'AMOUNT',
      rate: String(d.rate),
      amount: String(d.amount),
    })),
  );
  const [message, setMessage] = useState<string | null>(null);

  const gross = bill.amounts.presentBillAmount;
  const total = rows.reduce(
    (sum, row) =>
      sum + (row.basis === 'PERCENT' ? (gross * (Number(row.rate) || 0)) / 100 : Number(row.amount) || 0),
    0,
  );

  const save = useMutation({
    mutationFn: () =>
      api.put(`/ra-bills/${bill.id}/deductions`, {
        deductions: rows
          .filter((row) => row.description.trim())
          .map((row) => ({
            code: row.code || row.description.slice(0, 20).toUpperCase().replace(/\W+/g, '-'),
            description: row.description,
            basis: row.basis,
            rate: row.basis === 'PERCENT' ? row.rate || '0' : undefined,
            amount: row.basis === 'AMOUNT' ? row.amount || '0' : undefined,
          })),
      }),
    onSuccess: () => {
      toast.success('Deductions revised');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the deductions.'),
  });

  const update = (index: number, key: keyof DeductionDraft, value: string) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  return (
    <Modal
      open
      title="Revise deductions"
      subtitle={`${bill.billNo} — gross bill ${rupees(gross)}`}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontSize: 14 }}>
            Total deductions <strong>{rupees(total)}</strong> · Net payable{' '}
            <strong style={{ fontSize: 16 }}>{rupees(gross - total)}</strong>
          </span>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={total > gross}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Save deductions
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        {total > gross && (
          <Alert variant="danger" title="Deductions exceed the bill">
            The total deducted cannot be more than the gross bill amount.
          </Alert>
        )}

        <div className="table-wrap">
          <table className="table table--compact table--totals">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Code</th>
                <th>Description</th>
                <th style={{ width: 130 }}>Basis</th>
                <th className="num" style={{ width: 110 }}>Rate %</th>
                <th className="num" style={{ width: 150 }}>Amount (₹)</th>
                <th style={{ width: 48 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const computed =
                  row.basis === 'PERCENT' ? (gross * (Number(row.rate) || 0)) / 100 : Number(row.amount) || 0;
                return (
                  <tr key={index}>
                    <td>
                      <input
                        className="input code" value={row.code}
                        onChange={(e) => update(index, 'code', e.target.value)}
                        aria-label={`Code for deduction ${index + 1}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input" value={row.description}
                        onChange={(e) => update(index, 'description', e.target.value)}
                        aria-label={`Description for deduction ${index + 1}`}
                      />
                    </td>
                    <td>
                      <select
                        className="select" value={row.basis}
                        onChange={(e) => update(index, 'basis', e.target.value)}
                        aria-label={`Basis for deduction ${index + 1}`}
                      >
                        <option value="PERCENT">Percentage</option>
                        <option value="AMOUNT">Fixed amount</option>
                      </select>
                    </td>
                    <td>
                      <input
                        className="input input--number" inputMode="decimal" value={row.rate}
                        onChange={(e) => update(index, 'rate', e.target.value)}
                        disabled={row.basis !== 'PERCENT'}
                        aria-label={`Rate for deduction ${index + 1}`}
                      />
                    </td>
                    <td>
                      {row.basis === 'PERCENT' ? (
                        <div className="num" style={{ paddingTop: 8 }}>{rupees(computed)}</div>
                      ) : (
                        <input
                          className="input input--number" inputMode="decimal" value={row.amount}
                          onChange={(e) => update(index, 'amount', e.target.value)}
                          aria-label={`Amount for deduction ${index + 1}`}
                        />
                      )}
                    </td>
                    <td className="actions">
                      <Button
                        size="sm" variant="ghost"
                        onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                        aria-label={`Remove deduction ${index + 1}`}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total deductions</td>
                <td className="num">{rupees(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <Button
          onClick={() =>
            setRows((current) => [
              ...current,
              { code: '', description: '', basis: 'PERCENT', rate: '', amount: '' },
            ])
          }
        >
          Add a deduction
        </Button>
      </div>
    </Modal>
  );
}

function TallyDialog({ bill, onClose }: { bill: RaBillDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [eofficeFileNo, setEofficeFileNo] = useState('');
  const [eofficeNoteNo, setEofficeNoteNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api.post(`/ra-bills/${bill.id}/send-to-tally`, {
        eofficeFileNo,
        eofficeNoteNo: eofficeNoteNo || undefined,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Sent to Tally', 'A voucher number has been allotted.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not send the bill to Tally.'),
  });

  return (
    <Modal
      open
      title="Send to Tally"
      subtitle={`${bill.billNo} — net payable ${rupees(bill.amounts.netPayableAmount)}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={send.isPending}
            disabled={!eofficeFileNo.trim()}
            onClick={() => { setMessage(null); send.mutate(); }}
          >
            Send to Tally
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not send">{message}</Alert>}
        <Alert variant="info">
          Record the e-Office reference against which this payment was approved. A Tally voucher
          number is generated and the bill moves to awaiting payment.
        </Alert>
        <TextInput
          label="e-Office file number"
          required
          value={eofficeFileNo}
          onChange={(event) => setEofficeFileNo(event.target.value)}
          placeholder="e.g. PWD/NGR/RA/2026/0071"
          full
        />
        <TextInput
          label="e-Office note number"
          value={eofficeNoteNo}
          onChange={(event) => setEofficeNoteNo(event.target.value)}
          full
        />
        <TextArea
          label="Remarks"
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />
      </div>
    </Modal>
  );
}

function PaymentDialog({ bill, onClose }: { bill: RaBillDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [paymentDate, setPaymentDate] = useState(today());
  const [paymentReference, setPaymentReference] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const pay = useMutation({
    mutationFn: () => api.post(`/ra-bills/${bill.id}/payment`, { paymentDate, paymentReference }),
    onSuccess: () => {
      toast.success('Payment recorded', 'The bill is now closed as paid.');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the payment.'),
  });

  return (
    <Modal
      open
      title="Record payment"
      subtitle={`${bill.billNo} — ${rupees(bill.amounts.netPayableAmount)} to ${bill.contractor.name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={pay.isPending}>Cancel</Button>
          <Button
            variant="success"
            loading={pay.isPending}
            disabled={!paymentReference.trim()}
            onClick={() => { setMessage(null); pay.mutate(); }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <div className="totals">
          <div className="totals__row totals__row--grand">
            <span className="totals__label">Amount released</span>
            <span className="totals__value">{rupees(bill.amounts.netPayableAmount)}</span>
          </div>
          <div className="totals__words">{bill.amounts.netPayableInWords}</div>
        </div>
        <TextInput
          label="Payment date"
          type="date"
          required
          value={paymentDate}
          onChange={(event) => setPaymentDate(event.target.value)}
          full
        />
        <TextInput
          label="Payment reference"
          required
          value={paymentReference}
          onChange={(event) => setPaymentReference(event.target.value)}
          placeholder="e.g. RTGS/SBIN/2026/778341"
          hint="The RTGS, NEFT or cheque reference."
          full
        />
        <p className="field__hint">
          Tally voucher: <span className="code">{bill.tallyVoucherNo ?? '—'}</span> ·
          e-Office file: <span className="code">{bill.eoffice.fileNo ?? '—'}</span>
        </p>
        <p className="field__hint">
          Certified on {dateTime(bill.workflow?.instance.completedAt)}.
        </p>
      </div>
    </Modal>
  );
}
