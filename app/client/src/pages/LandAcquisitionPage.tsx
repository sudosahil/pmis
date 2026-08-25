import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { date, humanise, money, quantity, rupees, rupeesShort, today } from '../lib/format';
import {
  LAND_STAGES, LAND_TYPES,
  type LandParcel, type LandParcelDetail, type LandType, type Project,
} from '../types';
import {
  Alert, Button, Card, DetailItem, EmptyState, Loading, PageHeader, PlusIcon, SearchIcon,
  Select, SendIcon, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { WorkflowPanel } from '../components/WorkflowPanel';

/**
 * Land acquisition, parcel by parcel.
 *
 * A work that cannot get its land does not start, so this register is usually
 * where a delayed project is explained. The screen is built round the two
 * things an officer needs at a glance: how far down the statutory road each
 * parcel has come, and how much of the compensation has actually gone out.
 */

const STATUSES = [
  'IDENTIFIED', 'NOTIFIED', 'DECLARED', 'AWARDED', 'COMPENSATED', 'POSSESSED',
  'DISPUTED', 'WITHDRAWN',
];

export function LandAcquisitionPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next);
  };

  const parcels = useQuery({
    queryKey: ['land-parcels', search, status, page],
    queryFn: () =>
      api.get<Page<LandParcel>>('/land', {
        search: search || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
  });

  const rows = parcels.data?.items ?? [];
  const columns: Column<LandParcel>[] = [
    {
      key: 'parcel',
      header: 'Parcel',
      render: (row) => (
        <>
          <div className="cell-primary code">{row.parcelNo}</div>
          <div className="cell-muted">
            {row.village}, survey {row.surveyNo}
          </div>
        </>
      ),
    },
    {
      key: 'owner',
      header: 'Recorded owner',
      render: (row) => (
        <>
          <div>{row.owner.name}</div>
          <div className="cell-muted">{humanise(row.landType)}</div>
        </>
      ),
    },
    {
      key: 'area',
      header: 'Area',
      numeric: true,
      render: (row) => (
        <>
          <div>{quantity(row.areaSqm)} m²</div>
          <div className="cell-muted">{row.areaAcres} ac</div>
        </>
      ),
    },
    {
      key: 'compensation',
      header: 'Compensation',
      numeric: true,
      render: (row) => rupeesShort(row.compensation.total),
    },
    {
      key: 'paid',
      header: 'Paid',
      numeric: true,
      render: (row) =>
        row.compensation.total === 0 ? (
          '—'
        ) : (
          <>
            <div>{rupeesShort(row.compensation.paid)}</div>
            {row.compensation.balance > 0 && (
              <div className="cell-muted">{rupeesShort(row.compensation.balance)} due</div>
            )}
          </>
        ),
    },
    {
      key: 'status',
      header: 'Stage',
      render: (row) => (
        <>
          <StatusBadge status={row.status} />
          {row.openCaseCount > 0 && (
            <div className="cell-muted" style={{ color: 'var(--danger-fg)' }}>
              {row.openCaseCount} case(s) in court
            </div>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Land acquisition"
        subtitle="Parcels being acquired under the Right to Fair Compensation Act, 2013."
        actions={
          can('land.manage') ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Record a parcel
            </Button>
          ) : undefined
        }
      />

      <Card>
        <div className="filter-bar">
          <div className="input-prefix" style={{ flex: 1, minWidth: 240 }}>
            <span className="input-prefix__label" aria-hidden="true"><SearchIcon /></span>
            <input
              className="input"
              placeholder="Parcel number, village, survey number or owner"
              aria-label="Search parcels"
              defaultValue={search}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setParam('search', event.currentTarget.value);
              }}
            />
          </div>
          <select
            className="select"
            aria-label="Stage"
            style={{ maxWidth: 220 }}
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
          >
            <option value="">Every stage</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>{humanise(value)}</option>
            ))}
          </select>
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <Card flush>
        <DataTable
          rows={rows}
          rowKey={(row) => row.id}
          columns={columns}
          loading={parcels.isLoading}
          onRowClick={(row) => setSelected(row.id)}
          caption="Land parcels"
          empty={{
            title: 'No parcels on the register',
            text: 'Land taken for a work is recorded here, from the preliminary notification through to possession.',
          }}
        />
        {parcels.data && (
          <div style={{ padding: '0 18px 14px' }}>
            <Pagination
              page={parcels.data.page}
              pageSize={parcels.data.pageSize}
              total={parcels.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Card>

      {selected !== null && (
        <ParcelDialog parcelId={selected} onClose={() => setSelected(null)} />
      )}
      {creating && <ParcelFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// --- One parcel ---------------------------------------------------------------

function ParcelDialog({ parcelId, onClose }: { parcelId: number; onClose: () => void }) {
  const { can } = useAuth();
  const [tab, setTab] = useState<'file' | 'compensation' | 'approval'>('file');
  const [staging, setStaging] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  const parcel = useQuery({
    queryKey: ['land-parcel', parcelId],
    queryFn: () => api.get<LandParcelDetail>(`/land/${parcelId}`),
  });

  const p = parcel.data;

  return (
    <Modal
      open
      title={p ? `${p.village}, survey ${p.surveyNo}` : 'Parcel'}
      subtitle={p ? `${p.parcelNo} · ${p.owner.name}` : undefined}
      size="xwide"
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {parcel.isLoading || !p ? (
        <Loading label="Loading the parcel…" />
      ) : (
        <div className="stack">
          {p.openCaseCount > 0 && (
            <Alert variant="danger" title="This parcel is in litigation">
              {p.openCaseCount} case(s) are pending against it. Compensation is usually withheld
              until the court has spoken. <Link to="/court-cases">Open the litigation register</Link>.
            </Alert>
          )}

          <div className="grid grid--4">
            <div className="stat stat--accent">
              <div className="stat__label">Compensation</div>
              <div className="stat__value stat__value--currency">
                {rupeesShort(p.compensation.total)}
              </div>
              <div className="stat__meta"><span>Market value plus solatium</span></div>
            </div>
            <div className="stat">
              <div className="stat__label">Paid</div>
              <div className="stat__value stat__value--currency">
                {rupeesShort(p.compensation.paid)}
              </div>
              <div className="stat__meta">
                <span>{p.compensation.paymentCount} instalment(s)</span>
              </div>
            </div>
            <div className={`stat${p.compensation.balance > 0 ? ' stat--warn' : ''}`}>
              <div className="stat__label">Outstanding</div>
              <div className="stat__value stat__value--currency">
                {rupeesShort(p.compensation.balance)}
              </div>
            </div>
            <div className="stat">
              <div className="stat__label">Area</div>
              <div className="stat__value">{p.areaAcres}</div>
              <div className="stat__meta"><span>acres · {quantity(p.areaSqm)} m²</span></div>
            </div>
          </div>

          <div className="tabs" role="tablist">
            {(['file', 'compensation', 'approval'] as const).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className={`tab${tab === key ? ' is-active' : ''}`}
                onClick={() => setTab(key)}
              >
                {key === 'file' ? 'The file' : key === 'compensation' ? 'Compensation' : 'Approval'}
                {key === 'compensation' ? (
                  <span className="tab__count">({p.payments.length})</span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === 'file' && (
            <div className="stack">
              <Card title="Particulars">
                <div className="detail-grid">
                  <DetailItem label="Parcel number" value={<span className="code">{p.parcelNo}</span>} />
                  <DetailItem
                    label="Work"
                    value={<Link to={`/projects/${p.project.id}`}>{p.project.name}</Link>}
                  />
                  <DetailItem label="Village" value={p.village} />
                  <DetailItem label="Survey number" value={p.surveyNo} />
                  <DetailItem label="Khata" value={p.khataNo} />
                  <DetailItem label="Land type" value={humanise(p.landType)} />
                  <DetailItem label="District" value={p.district} />
                  <DetailItem label="Owner" value={p.owner.name} />
                  <DetailItem label="Owner contact" value={p.owner.contact} />
                  <DetailItem label="Status" value={<StatusBadge status={p.status} />} />
                </div>
                {p.remarks && <p style={{ marginTop: 12 }}>{p.remarks}</p>}
              </Card>

              <Card
                title="The statutory road"
                subtitle="Each stage of the 2013 Act, in the order a parcel must pass through them."
              >
                <StageTrail parcel={p} onRecord={can('land.manage') ? setStaging : undefined} />
              </Card>
            </div>
          )}

          {tab === 'compensation' && (
            <Card
              title="Compensation"
              subtitle="Market value, the statutory solatium, and what has actually been disbursed."
              actions={
                can('land.compensate') && p.compensation.balance > 0 ? (
                  <Button size="sm" variant="primary" onClick={() => setPaying(true)}>
                    Record a payment
                  </Button>
                ) : undefined
              }
              flush
            >
              <div style={{ padding: '14px 18px 0' }}>
                <div className="totals">
                  <div className="totals__row">
                    <span className="totals__label">Market value</span>
                    <span className="totals__value">{money(p.compensation.marketValue)}</span>
                  </div>
                  <div className="totals__row">
                    <span className="totals__label">
                      Solatium <span className="cell-muted">(Section 30)</span>
                    </span>
                    <span className="totals__value">{money(p.compensation.solatium)}</span>
                  </div>
                  {p.compensation.other > 0 && (
                    <div className="totals__row">
                      <span className="totals__label">Structures, trees and crops</span>
                      <span className="totals__value">{money(p.compensation.other)}</span>
                    </div>
                  )}
                  {p.compensation.interest > 0 && (
                    <div className="totals__row">
                      <span className="totals__label">Interest</span>
                      <span className="totals__value">{money(p.compensation.interest)}</span>
                    </div>
                  )}
                  <div className="totals__row totals__row--grand">
                    <span className="totals__label">Award</span>
                    <span className="totals__value">{money(p.compensation.total)}</span>
                  </div>
                </div>
              </div>

              <DataTable
                rows={p.payments}
                rowKey={(row) => row.id}
                compact
                caption="Compensation paid"
                columns={[
                  { key: 'date', header: 'Paid on', render: (row) => date(row.paymentDate) },
                  { key: 'payee', header: 'Payee', render: (row) => row.payeeName },
                  { key: 'mode', header: 'Mode', render: (row) => humanise(row.mode) },
                  {
                    key: 'ref',
                    header: 'Reference',
                    render: (row) => <span className="code">{row.referenceNo ?? '—'}</span>,
                  },
                  { key: 'amount', header: 'Amount', numeric: true, render: (row) => money(row.amount) },
                ]}
                empty={{
                  title: 'No compensation paid yet',
                  text: 'Compensation is disbursed once the award has been passed and sanctioned.',
                }}
              />
            </Card>
          )}

          {tab === 'approval' && (
            <ApprovalTab parcel={p} />
          )}
        </div>
      )}

      {staging && p && (
        <StageDialog parcel={p} stage={staging} onClose={() => setStaging(null)} />
      )}
      {paying && p && <PaymentDialog parcel={p} onClose={() => setPaying(false)} />}
    </Modal>
  );
}

/** The stages of the Act as a trail, with what is recorded against each. */
function StageTrail({
  parcel, onRecord,
}: {
  parcel: LandParcelDetail;
  onRecord?: (stage: string) => void;
}) {
  const reached: Record<string, { no: string | null; date: string | null }> = {
    NOTIFIED: parcel.stages.notification,
    DECLARED: parcel.stages.declaration,
    AWARDED: parcel.stages.award,
    POSSESSED: { no: null, date: parcel.stages.possessionDate },
  };

  return (
    <div className="stack">
      {LAND_STAGES.map((stage) => {
        const recorded = reached[stage.key];
        const done = Boolean(recorded?.date);
        const blocked = stage.key === 'POSSESSED' && !parcel.compensation.isFullyPaid;

        return (
          <div
            key={stage.key}
            className="row row--between"
            style={{
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '10px 14px',
              opacity: done ? 1 : 0.85,
            }}
          >
            <div>
              <strong>{stage.label}</strong>
              {stage.section && <span className="cell-muted"> · {stage.section}</span>}
              <div className="cell-muted">
                {done
                  ? `${recorded!.no ? `${recorded!.no} · ` : ''}${date(recorded!.date)}`
                  : blocked
                    ? 'Possession is not taken before the award is satisfied in full.'
                    : 'Not yet recorded.'}
              </div>
            </div>
            {done ? (
              <StatusBadge status="RECORDED" />
            ) : onRecord && !blocked ? (
              <Button size="sm" onClick={() => onRecord(stage.key)}>Record</Button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ApprovalTab({ parcel }: { parcel: LandParcelDetail }) {
  const { can } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [remarks, setRemarks] = useState('');

  const submit = useMutation({
    mutationFn: () => api.post(`/land/${parcel.id}/submit`, { remarks: remarks || undefined }),
    onSuccess: () => {
      toast.success('Award sent for approval');
      void queryClient.invalidateQueries();
    },
    onError: (error: unknown) =>
      toast.error(
        'Could not send it',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  if (parcel.workflow) {
    return (
      <WorkflowPanel
        workflow={parcel.workflow}
        onActed={() => void queryClient.invalidateQueries()}
      />
    );
  }

  return (
    <Card title="Approval of the award">
      {parcel.status !== 'AWARDED' ? (
        <EmptyState
          title="Nothing to approve yet"
          text="An award is sent for approval once it has been passed under Section 23. Compensation cannot be disbursed before it is sanctioned."
        />
      ) : (
        <div className="stack">
          <Alert variant="info" title="What this commits the department to">
            Sending this award for approval asks the division, the circle and the accounts cadre to
            sanction <strong>{rupees(parcel.compensation.total)}</strong> of compensation for land
            the department does not yet hold.
          </Alert>
          <TextArea
            label="Covering remarks"
            full
            rows={3}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            hint="Optional."
          />
          {can('land.manage') && (
            <Button
              variant="primary"
              icon={<SendIcon />}
              loading={submit.isPending}
              onClick={() => submit.mutate()}
            >
              Send the award for approval
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

// --- Recording a stage --------------------------------------------------------

function StageDialog({
  parcel, stage, onClose,
}: {
  parcel: LandParcelDetail;
  stage: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const definition = LAND_STAGES.find((s) => s.key === stage)!;
  const [referenceNo, setReferenceNo] = useState('');
  const [stageDate, setStageDate] = useState(today());
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      api.post(`/land/${parcel.id}/stage`, {
        stage,
        referenceNo: referenceNo || undefined,
        stageDate,
        remarks: remarks || undefined,
      }),
    onSuccess: () => {
      toast.success(`${definition.label} recorded`);
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the stage.'),
  });

  return (
    <Modal
      open
      title={definition.label}
      subtitle={`${parcel.parcelNo}${definition.section ? ` · ${definition.section}` : ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Record
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <div className="form-grid">
          {stage !== 'POSSESSED' && (
            <TextInput
              label="Notification or order number"
              full
              value={referenceNo}
              onChange={(event) => setReferenceNo(event.target.value)}
              placeholder="e.g. PWD/LA/S19/2026/214"
            />
          )}
          <TextInput
            label="Dated"
            type="date"
            required
            value={stageDate}
            onChange={(event) => setStageDate(event.target.value)}
          />
          <TextArea
            label="Remarks"
            full
            rows={3}
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function PaymentDialog({ parcel, onClose }: { parcel: LandParcelDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    paymentDate: today(),
    amount: String(parcel.compensation.balance),
    mode: 'RTGS',
    referenceNo: '',
    payeeName: parcel.owner.name,
    remarks: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/land/${parcel.id}/payments`, {
        paymentDate: form.paymentDate,
        amount: form.amount,
        mode: form.mode,
        referenceNo: form.referenceNo || undefined,
        payeeName: form.payeeName,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Compensation recorded');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the payment.'),
  });

  return (
    <Modal
      open
      title="Record compensation paid"
      subtitle={`${parcel.parcelNo} · ${rupees(parcel.compensation.balance)} outstanding`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Record payment
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Amount"
            required
            numeric
            prefix="₹"
            value={form.amount}
            onChange={set('amount')}
            hint={`Not more than the ${rupees(parcel.compensation.balance)} outstanding.`}
          />
          <TextInput label="Paid on" type="date" required value={form.paymentDate} onChange={set('paymentDate')} />
          <Select
            label="Mode"
            options={[
              { value: 'RTGS', label: 'RTGS' },
              { value: 'CHEQUE', label: 'Cheque' },
              { value: 'COURT_DEPOSIT', label: 'Deposit in court' },
            ]}
            value={form.mode}
            onChange={set('mode')}
            hint="A disputed award is deposited in court rather than paid over."
          />
          <TextInput label="Reference" value={form.referenceNo} onChange={set('referenceNo')} />
          <TextInput label="Payee" full required value={form.payeeName} onChange={set('payeeName')} />
          <TextArea label="Remarks" full rows={2} value={form.remarks} onChange={set('remarks')} />
        </div>
      </div>
    </Modal>
  );
}

// --- Recording a parcel -------------------------------------------------------

function ParcelFormDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const districts = useLookup('districts');
  const [form, setForm] = useState({
    projectId: '',
    districtId: '',
    village: '',
    surveyNo: '',
    khataNo: '',
    landType: 'AGRICULTURAL' as LandType,
    areaSqm: '',
    ownerName: '',
    ownerAddress: '',
    ownerContact: '',
    marketValue: '',
    otherAmount: '',
    remarks: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects', 'for-land'],
    queryFn: () => api.get<Page<Project>>('/projects', { pageSize: 200 }),
  });

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const market = Number(form.marketValue) || 0;

  const save = useMutation({
    mutationFn: () =>
      api.post('/land', {
        projectId: form.projectId,
        districtId: form.districtId || undefined,
        village: form.village,
        surveyNo: form.surveyNo,
        khataNo: form.khataNo || undefined,
        landType: form.landType,
        areaSqm: form.areaSqm,
        ownerName: form.ownerName,
        ownerAddress: form.ownerAddress || undefined,
        ownerContact: form.ownerContact || undefined,
        marketValue: form.marketValue || undefined,
        otherAmount: form.otherAmount || undefined,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Parcel recorded');
      void queryClient.invalidateQueries({ queryKey: ['land-parcels'] });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not record the parcel.');
      }
    },
  });

  return (
    <Modal
      open
      title="Record a land parcel"
      subtitle="The parcel enters the register at identification, before any notification is issued."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setErrors({}); setMessage(null); save.mutate(); }}
          >
            Record parcel
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <Alert variant="info" title="Solatium is added for you">
          Section 30 of the Act puts solatium at a hundred per cent of the market value, so the
          award comes to twice the market value plus anything allowed for structures, trees and
          crops. Enter the market value; the rest is computed.
        </Alert>

        <div className="form-grid">
          <Select
            label="Work"
            full
            required
            placeholder="Choose the work this land is for"
            options={(projects.data?.items ?? []).map((project) => ({
              value: String(project.id),
              label: `${project.projectCode} — ${project.name}`,
            }))}
            value={form.projectId}
            onChange={set('projectId')}
            error={errors.projectId}
          />
          <TextInput label="Village" required value={form.village} onChange={set('village')} error={errors.village} />
          <TextInput
            label="Survey number"
            required
            value={form.surveyNo}
            onChange={set('surveyNo')}
            error={errors.surveyNo}
            placeholder="e.g. 114/2"
          />
          <TextInput
            label="Khata number"
            value={form.khataNo}
            onChange={set('khataNo')}
            hint="The E-Khata reference, where the revenue record carries one."
          />
          <Select
            label="District"
            placeholder="Take it from the work"
            options={(districts.data ?? []).map((option) => ({
              value: String(option.id),
              label: option.name,
            }))}
            value={form.districtId}
            onChange={set('districtId')}
          />
          <Select
            label="Land type"
            options={LAND_TYPES.map((value) => ({ value, label: humanise(value) }))}
            value={form.landType}
            onChange={set('landType')}
          />
          <TextInput
            label="Area"
            required
            numeric
            value={form.areaSqm}
            onChange={set('areaSqm')}
            error={errors.areaSqm}
            hint="Square metres."
          />
          <TextInput
            label="Recorded owner"
            required
            value={form.ownerName}
            onChange={set('ownerName')}
            error={errors.ownerName}
          />
          <TextInput label="Owner contact" value={form.ownerContact} onChange={set('ownerContact')} />
          <TextInput
            label="Market value"
            numeric
            prefix="₹"
            value={form.marketValue}
            onChange={set('marketValue')}
            error={errors.marketValue}
            hint={market > 0 ? `Award will come to ${rupees(market * 2)} with solatium.` : undefined}
          />
          <TextInput
            label="Structures, trees and crops"
            numeric
            prefix="₹"
            value={form.otherAmount}
            onChange={set('otherAmount')}
          />
          <TextArea label="Owner address" full rows={2} value={form.ownerAddress} onChange={set('ownerAddress')} />
          <TextArea label="Remarks" full rows={2} value={form.remarks} onChange={set('remarks')} />
        </div>
      </div>
    </Modal>
  );
}
