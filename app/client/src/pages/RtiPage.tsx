import { useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { date, humanise, percent, rupees, today } from '../lib/format';
import {
  RTI_RECEIVED_VIA,
  type RtiCompliance, type RtiExemption, type RtiRequest, type RtiRequestDetail, type User,
} from '../types';
import {
  Alert, Button, Card, Checkbox, DetailItem, Loading, PageHeader, PlusIcon, SearchIcon,
  Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';

/**
 * The Right to Information register.
 *
 * The clock is what this screen is for. Section 7(1) gives the Public
 * Information Officer thirty days, and Section 20 makes them personally liable
 * at ₹250 a day for missing it — so the register sorts by how little time is
 * left and says what the exposure is while it can still be avoided.
 */

type RtiListResponse = Page<RtiRequest> & { compliance: RtiCompliance };

const STATUSES = [
  'RECEIVED', 'IN_PROGRESS', 'TRANSFERRED', 'REPLIED', 'PARTLY_REJECTED', 'REJECTED', 'CLOSED',
];

export function RtiPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const overdueOnly = params.get('overdue') === 'true';
  const mineOnly = params.get('mine') === 'true';
  const page = Number(params.get('page') ?? 1);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next);
  };

  const requests = useQuery({
    queryKey: ['rti', search, status, overdueOnly, mineOnly, page],
    queryFn: () =>
      api.get<RtiListResponse>('/rti', {
        search: search || undefined,
        status: status || undefined,
        overdueOnly: overdueOnly ? 'true' : undefined,
        mineOnly: mineOnly ? 'true' : undefined,
        page,
        pageSize: 20,
      }),
  });

  const compliance = requests.data?.compliance;
  const answered = compliance ? compliance.onTime + compliance.late : 0;

  const columns: Column<RtiRequest>[] = [
    {
      key: 'request',
      header: 'Application',
      render: (row) => (
        <>
          <div className="cell-primary code">{row.requestNo}</div>
          <div className="cell-muted">{row.subject}</div>
        </>
      ),
    },
    {
      key: 'applicant',
      header: 'Applicant',
      render: (row) => (
        <>
          <div>{row.applicant.name}</div>
          <div className="cell-muted">
            {humanise(row.receivedVia)}
            {row.applicant.isBpl && ' · below poverty line'}
          </div>
        </>
      ),
    },
    { key: 'received', header: 'Received', render: (row) => date(row.receivedOn) },
    {
      key: 'due',
      header: 'Statutory date',
      render: (row) => (
        <>
          <div>{date(row.dueDate)}</div>
          <div
            className="cell-muted"
            style={row.isOverdue ? { color: 'var(--danger-fg)', fontWeight: 700 } : undefined}
          >
            {!row.isOpen
              ? row.wasLate
                ? `answered ${-row.daysRemaining} day(s) late`
                : 'answered in time'
              : row.daysRemaining < 0
                ? `${-row.daysRemaining} day(s) over`
                : `${row.daysRemaining} day(s) left`}
          </div>
        </>
      ),
    },
    {
      key: 'exposure',
      header: 'Penalty exposure',
      numeric: true,
      render: (row) =>
        row.penaltyExposure > 0 ? (
          <strong style={{ color: 'var(--danger-fg)' }}>{rupees(row.penaltyExposure)}</strong>
        ) : (
          '—'
        ),
    },
    { key: 'pio', header: 'With', render: (row) => row.pio?.name ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <>
          <StatusBadge status={row.status} />
          {row.appealCount > 0 && (
            <div className="cell-muted">{row.appealCount} appeal(s)</div>
          )}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Right to Information"
        subtitle="Applications under the RTI Act, 2005, and appeals against how they were answered."
        actions={
          can('rti.manage') ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Record an application
            </Button>
          ) : undefined
        }
      />

      {compliance && compliance.overdue > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alert
            variant="danger"
            title={`${compliance.overdue} application(s) are past their statutory date`}
          >
            Section 20 of the Act makes the Public Information Officer personally liable at ₹250 a
            day, to a ceiling of ₹25,000. Answering late is better than not answering.{' '}
            <button
              type="button"
              className="link-button"
              onClick={() => setParam('overdue', overdueOnly ? '' : 'true')}
            >
              {overdueOnly ? 'Show every application' : 'Show only the overdue ones'}
            </button>
          </Alert>
        </div>
      )}

      {compliance && (
        <div className="grid grid--4" style={{ marginBottom: 14 }}>
          <div className="stat stat--accent">
            <div className="stat__label">Applications</div>
            <div className="stat__value">{compliance.total}</div>
            <div className="stat__meta"><span>{compliance.open} still open</span></div>
          </div>
          <div className={`stat${compliance.overdue > 0 ? ' stat--warn' : ''}`}>
            <div className="stat__label">Past the statutory date</div>
            <div className="stat__value">{compliance.overdue}</div>
          </div>
          <div className="stat">
            <div className="stat__label">Answered in time</div>
            <div className="stat__value">
              {answered > 0 ? percent((compliance.onTime / answered) * 100, 0) : '—'}
            </div>
            <div className="stat__meta">
              <span>{compliance.onTime} of {answered} answered</span>
            </div>
          </div>
          <div className="stat">
            <div className="stat__label">Appeals</div>
            <div className="stat__value">{compliance.appeals}</div>
            <div className="stat__meta"><span>{compliance.rejected} refused outright</span></div>
          </div>
        </div>
      )}

      <Card>
        <div className="filter-bar">
          <div className="input-prefix" style={{ flex: 1, minWidth: 240 }}>
            <span className="input-prefix__label" aria-hidden="true"><SearchIcon /></span>
            <input
              className="input"
              placeholder="Application number, applicant or subject"
              aria-label="Search applications"
              defaultValue={search}
              onKeyDown={(event) => {
                if (event.key === 'Enter') setParam('search', event.currentTarget.value);
              }}
            />
          </div>
          <select
            className="select"
            aria-label="Status"
            style={{ maxWidth: 200 }}
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
          >
            <option value="">Every status</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>{humanise(value)}</option>
            ))}
          </select>
          <Checkbox
            label="Only mine"
            checked={mineOnly}
            onChange={(event) => setParam('mine', event.target.checked ? 'true' : '')}
          />
        </div>
      </Card>

      <div style={{ height: 14 }} />

      <Card flush>
        <DataTable
          rows={requests.data?.items ?? []}
          rowKey={(row) => row.id}
          columns={columns}
          loading={requests.isLoading}
          onRowClick={(row) => setSelected(row.id)}
          caption="RTI applications"
          empty={{
            title: 'No applications on the register',
            text: 'Applications under the Act are recorded here, with the statutory clock running from the day they arrive.',
          }}
        />
        {requests.data && (
          <div style={{ padding: '0 18px 14px' }}>
            <Pagination
              page={requests.data.page}
              pageSize={requests.data.pageSize}
              total={requests.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Card>

      {selected !== null && <RtiDialog requestId={selected} onClose={() => setSelected(null)} />}
      {creating && <RtiFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// --- One application ------------------------------------------------------------

function RtiDialog({ requestId, onClose }: { requestId: number; onClose: () => void }) {
  const { can } = useAuth();
  const [replying, setReplying] = useState(false);
  const [appealing, setAppealing] = useState(false);

  const request = useQuery({
    queryKey: ['rti-request', requestId],
    queryFn: () => api.get<RtiRequestDetail>(`/rti/${requestId}`),
  });

  const r = request.data;

  return (
    <Modal
      open
      title={r ? r.subject : 'Application'}
      subtitle={r ? `${r.requestNo} · ${r.applicant.name}` : undefined}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          {r && r.isOpen && can('rti.reply') && (
            <Button variant="primary" onClick={() => setReplying(true)}>Answer it</Button>
          )}
          {r && !r.isOpen && r.appealCount === 0 && can('rti.manage') && (
            <Button onClick={() => setAppealing(true)}>Record an appeal</Button>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {request.isLoading || !r ? (
        <Loading />
      ) : (
        <div className="stack">
          {r.isOverdue && (
            <Alert
              variant="danger"
              title={`${-r.daysRemaining} day(s) past the statutory date`}
            >
              The exposure under Section 20 stands at <strong>{rupees(r.penaltyExposure)}</strong>,
              and it is on the Public Information Officer personally. It stops growing the day the
              application is answered.
            </Alert>
          )}
          {r.isLifeOrLiberty && r.isOpen && (
            <Alert variant="warn" title="Life or liberty — forty-eight hours, not thirty days">
              The proviso to Section 7(1) applies to this application.
            </Alert>
          )}

          <Card title="The application">
            <div className="detail-grid">
              <DetailItem label="Number" value={<span className="code">{r.requestNo}</span>} />
              <DetailItem label="Applicant" value={r.applicant.name} />
              <DetailItem label="Received" value={`${date(r.receivedOn)} · ${humanise(r.receivedVia)}`} />
              <DetailItem label="Statutory date" value={date(r.dueDate)} />
              <DetailItem
                label="Fee"
                value={r.applicant.isBpl ? 'Exempt — below poverty line' : rupees(r.feePaid)}
              />
              <DetailItem label="Public Information Officer" value={r.pio?.name} />
              <DetailItem label="Division" value={r.division?.name} />
              <DetailItem label="Status" value={<StatusBadge status={r.status} />} />
              {r.replyDate && (
                <DetailItem
                  label="Answered"
                  value={`${date(r.replyDate)} · in ${r.daysTaken} day(s)`}
                />
              )}
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="detail-item__label">Information sought</div>
              <p style={{ marginTop: 4, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
                {r.informationSought}
              </p>
            </div>
          </Card>

          {r.replySummary && (
            <Card title="The reply">
              <p style={{ lineHeight: 1.7 }}>{r.replySummary}</p>
              {r.transferredTo && (
                <p className="cell-muted" style={{ marginTop: 8 }}>
                  Transferred to {r.transferredTo} under Section 6(3).
                </p>
              )}
            </Card>
          )}

          {r.rejection && (
            <Card title="What was withheld, and under which clause">
              <Alert variant="warn" title={`Section ${r.rejection.section}`}>
                {r.rejection.label}
              </Alert>
              <p style={{ marginTop: 10, lineHeight: 1.7 }}>{r.rejection.ground}</p>
            </Card>
          )}

          {r.appeals.length > 0 && (
            <Card title="Appeals" flush>
              <div className="stack" style={{ padding: 18 }}>
                {r.appeals.map((appeal) => (
                  <div
                    key={appeal.id}
                    style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}
                  >
                    <div className="row row--between">
                      <div>
                        <strong>{humanise(appeal.level)} appeal</strong>
                        <div className="cell-muted code">{appeal.appealNo}</div>
                      </div>
                      <StatusBadge status={appeal.status} />
                    </div>
                    <div className="detail-grid" style={{ marginTop: 10 }}>
                      <DetailItem label="Filed" value={date(appeal.filedOn)} />
                      <DetailItem label="To be decided by" value={date(appeal.dueDate)} />
                      <DetailItem label="Appellate authority" value={appeal.appellateAuthority} />
                      <DetailItem label="Decided" value={appeal.decidedOn ? date(appeal.decidedOn) : null} />
                      {appeal.penaltyImposed > 0 && (
                        <DetailItem
                          label="Penalty under Section 20"
                          value={<strong style={{ color: 'var(--danger-fg)' }}>{rupees(appeal.penaltyImposed)}</strong>}
                        />
                      )}
                    </div>
                    <p style={{ marginTop: 10 }}>
                      <strong>Grounds. </strong>{appeal.grounds}
                    </p>
                    {appeal.decision && (
                      <p style={{ marginTop: 6 }}>
                        <strong>Decision. </strong>{appeal.decision}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {replying && r && <ReplyDialog request={r} onClose={() => setReplying(false)} />}
      {appealing && r && <AppealDialog request={r} onClose={() => setAppealing(false)} />}
    </Modal>
  );
}

function ReplyDialog({ request, onClose }: { request: RtiRequestDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    status: 'REPLIED',
    replyDate: today(),
    replySummary: '',
    rejectionSection: '',
    rejectionGround: '',
    transferredTo: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const exemptions = useQuery({
    queryKey: ['rti-exemptions'],
    queryFn: () => api.get<RtiExemption[]>('/rti/exemptions'),
    staleTime: 60 * 60 * 1000,
  });

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const refusing = form.status === 'REJECTED' || form.status === 'PARTLY_REJECTED';
  const transferring = form.status === 'TRANSFERRED';

  const save = useMutation({
    mutationFn: () =>
      api.post(`/rti/${request.id}/reply`, {
        status: form.status,
        replyDate: form.replyDate,
        replySummary: form.replySummary || undefined,
        rejectionSection: refusing ? form.rejectionSection : undefined,
        rejectionGround: refusing ? form.rejectionGround : undefined,
        transferredTo: transferring ? form.transferredTo : undefined,
      }),
    onSuccess: () => {
      toast.success('Application answered');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not record the reply.');
      }
    },
  });

  return (
    <Modal
      open
      title="Answer the application"
      subtitle={`${request.requestNo} · due ${date(request.dueDate)}`}
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
            Record the reply
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}

        {refusing && (
          <Alert variant="warn" title="A refusal has to stand on a clause">
            The Act allows information to be withheld only under Section 8, 9 or 11. A refusal that
            does not cite the clause it rests on — and say why it applies — is one the appellate
            authority will set aside.
          </Alert>
        )}

        <div className="form-grid">
          <Select
            label="How it is being answered"
            options={[
              { value: 'REPLIED', label: 'Information supplied' },
              { value: 'PARTLY_REJECTED', label: 'Supplied in part, rest withheld' },
              { value: 'REJECTED', label: 'Refused' },
              { value: 'TRANSFERRED', label: 'Transferred to another authority (Section 6(3))' },
            ]}
            value={form.status}
            onChange={set('status')}
          />
          <TextInput label="Answered on" type="date" required value={form.replyDate} onChange={set('replyDate')} />

          {transferring && (
            <TextInput
              label="Transferred to"
              full
              required
              value={form.transferredTo}
              onChange={set('transferredTo')}
              error={errors.transferredTo}
              hint="The public authority that actually holds the information."
            />
          )}

          {refusing && (
            <>
              <Select
                label="Clause relied on"
                full
                required
                placeholder="Choose the exemption"
                options={(exemptions.data ?? []).map((exemption) => ({
                  value: exemption.code,
                  label: `Section ${exemption.code} — ${exemption.label}`,
                }))}
                value={form.rejectionSection}
                onChange={set('rejectionSection')}
                error={errors.rejectionSection}
              />
              <TextArea
                label="Why the exemption applies"
                full
                required
                rows={3}
                value={form.rejectionGround}
                onChange={set('rejectionGround')}
                error={errors.rejectionGround}
                hint="A bare citation is not a reason. Say what about this information brings it within the clause."
              />
            </>
          )}

          <TextArea
            label={refusing ? 'What was supplied, if anything' : 'What was supplied'}
            full
            rows={4}
            value={form.replySummary}
            onChange={set('replySummary')}
            error={errors.replySummary}
          />
        </div>
      </div>
    </Modal>
  );
}

function AppealDialog({ request, onClose }: { request: RtiRequestDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    appealLevel: 'FIRST',
    filedOn: today(),
    grounds: '',
    appellateAuthority: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/rti/${request.id}/appeals`, {
        appealLevel: form.appealLevel,
        filedOn: form.filedOn,
        grounds: form.grounds,
        appellateAuthority: form.appellateAuthority || undefined,
      }),
    onSuccess: () => {
      toast.success('Appeal recorded');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the appeal.'),
  });

  return (
    <Modal
      open
      title="Record an appeal"
      subtitle={request.requestNo}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Record appeal
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <Alert variant="info" title="Thirty days, again">
          A first appeal lies to a departmental appellate authority and must be decided within
          thirty days of filing. A second appeal lies to the Information Commission.
        </Alert>
        <div className="form-grid">
          <Select
            label="Level"
            options={[
              { value: 'FIRST', label: 'First appeal — departmental' },
              { value: 'SECOND', label: 'Second appeal — Information Commission' },
            ]}
            value={form.appealLevel}
            onChange={set('appealLevel')}
          />
          <TextInput label="Filed on" type="date" required value={form.filedOn} onChange={set('filedOn')} />
          <TextInput
            label="Appellate authority"
            full
            value={form.appellateAuthority}
            onChange={set('appellateAuthority')}
            placeholder="e.g. Chief Engineer, First Appellate Authority"
          />
          <TextArea
            label="Grounds of appeal"
            full
            required
            rows={4}
            value={form.grounds}
            onChange={set('grounds')}
          />
        </div>
      </div>
    </Modal>
  );
}

// --- Recording an application ----------------------------------------------------

function RtiFormDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    applicantName: '',
    applicantAddress: '',
    applicantEmail: '',
    applicantPhone: '',
    isBpl: false,
    feePaid: '10',
    receivedOn: today(),
    receivedVia: 'ONLINE',
    subject: '',
    informationSought: '',
    isLifeOrLiberty: false,
    pioUserId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const staff = useQuery({
    queryKey: ['users', 'for-pio'],
    queryFn: () => api.get<Page<User>>('/users', { pageSize: 200 }),
  });

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  // Section 7(1): thirty days, or forty-eight hours where life or liberty is at stake.
  const due = new Date(`${form.receivedOn}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() + (form.isLifeOrLiberty ? 2 : 30));

  const save = useMutation({
    mutationFn: () =>
      api.post('/rti', {
        applicantName: form.applicantName,
        applicantAddress: form.applicantAddress || undefined,
        applicantEmail: form.applicantEmail || undefined,
        applicantPhone: form.applicantPhone || undefined,
        isBpl: form.isBpl,
        feePaid: form.isBpl ? undefined : form.feePaid,
        receivedOn: form.receivedOn,
        receivedVia: form.receivedVia,
        subject: form.subject,
        informationSought: form.informationSought,
        isLifeOrLiberty: form.isLifeOrLiberty,
        pioUserId: form.pioUserId || undefined,
      }),
    onSuccess: () => {
      toast.success('Application recorded', 'The statutory clock is running.');
      void queryClient.invalidateQueries({ queryKey: ['rti'] });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not record the application.');
      }
    },
  });

  return (
    <Modal
      open
      title="Record an RTI application"
      size="wide"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontSize: 14 }}>
            Reply due <strong>{date(due.toISOString().slice(0, 10))}</strong>
          </span>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            onClick={() => { setErrors({}); setMessage(null); save.mutate(); }}
          >
            Record application
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <Alert variant="info" title="The clock starts the day it arrives">
          Thirty days from receipt, or forty-eight hours if life or liberty is at stake. The date is
          computed here and does not move afterwards unless the receipt is corrected.
        </Alert>

        <div className="form-grid">
          <TextInput
            label="Applicant"
            required
            value={form.applicantName}
            onChange={set('applicantName')}
            error={errors.applicantName}
          />
          <TextInput
            label="Email"
            type="email"
            value={form.applicantEmail}
            onChange={set('applicantEmail')}
            error={errors.applicantEmail}
          />
          <TextInput label="Telephone" value={form.applicantPhone} onChange={set('applicantPhone')} />
          <TextInput
            label="Received on"
            type="date"
            required
            value={form.receivedOn}
            onChange={set('receivedOn')}
            error={errors.receivedOn}
          />
          <Select
            label="Received by"
            options={RTI_RECEIVED_VIA.map((value) => ({ value, label: humanise(value) }))}
            value={form.receivedVia}
            onChange={set('receivedVia')}
          />
          <Select
            label="Public Information Officer"
            placeholder="Yourself"
            options={(staff.data?.items ?? []).map((user) => ({
              value: String(user.id),
              label: `${user.fullName} — ${user.roleName}`,
            }))}
            value={form.pioUserId}
            onChange={set('pioUserId')}
            hint="The officer the statutory penalty would fall on."
          />
          <TextInput
            label="Fee paid"
            numeric
            prefix="₹"
            value={form.isBpl ? '0' : form.feePaid}
            disabled={form.isBpl}
            onChange={set('feePaid')}
            error={errors.feePaid}
            hint={form.isBpl ? 'Exempt under the Act.' : 'Ordinarily ₹10.'}
          />
          <div className="field">
            <span className="field__label">Exemptions</span>
            <Checkbox
              label="Applicant is below the poverty line — no fee"
              checked={form.isBpl}
              onChange={(event) => setForm((c) => ({ ...c, isBpl: event.target.checked }))}
            />
            <Checkbox
              label="Concerns the life or liberty of a person — 48 hours"
              checked={form.isLifeOrLiberty}
              onChange={(event) => setForm((c) => ({ ...c, isLifeOrLiberty: event.target.checked }))}
            />
          </div>
          <TextInput
            label="Subject"
            full
            required
            value={form.subject}
            onChange={set('subject')}
            error={errors.subject}
          />
          <TextArea
            label="Information sought"
            full
            required
            rows={5}
            value={form.informationSought}
            onChange={set('informationSought')}
            error={errors.informationSought}
            hint="As the applicant worded it."
          />
          <TextArea
            label="Applicant's address"
            full
            rows={2}
            value={form.applicantAddress}
            onChange={set('applicantAddress')}
          />
        </div>
      </div>
    </Modal>
  );
}
