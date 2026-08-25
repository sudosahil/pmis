import { useState, type ChangeEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { date, humanise, relativeTime, rupees, rupeesShort, today } from '../lib/format';
import {
  CASE_OUTCOMES, CASE_TYPES, COURT_TYPES,
  type CourtCase, type CourtCaseDetail, type Project,
} from '../types';
import {
  Alert, Button, Card, DetailItem, GavelIcon, Loading, PageHeader, PlusIcon, SearchIcon,
  Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination, type Column } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';

/**
 * The litigation register.
 *
 * Two views of the same rows, because an office needs both: the register, which
 * is what a case looks like as a file, and the cause list, which is what stops
 * a department losing by default. A hearing nobody was told about is a hearing
 * nobody attends.
 */

const CASE_STATUSES = ['FILED', 'PENDING', 'RESERVED', 'DISPOSED', 'APPEALED', 'WITHDRAWN', 'SETTLED'];

export function CourtCasesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  const view = (params.get('view') ?? 'register') as 'register' | 'cause-list';
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

  const cases = useQuery({
    queryKey: ['court-cases', view, search, status, page],
    queryFn: () =>
      api.get<Page<CourtCase>>('/court-cases', {
        search: search || undefined,
        status: status || undefined,
        // The cause list is the next thirty days of listings, in date order.
        hearingWithinDays: view === 'cause-list' ? 30 : undefined,
        page,
        pageSize: 20,
      }),
  });

  const rows = cases.data?.items ?? [];
  const missed = rows.filter((row) => row.isHearingMissed);

  const columns: Column<CourtCase>[] = [
    {
      key: 'case',
      header: 'Case',
      render: (row) => (
        <>
          <div className="cell-primary code">{row.caseNo}</div>
          <div className="cell-muted">{row.court.name}</div>
        </>
      ),
    },
    {
      key: 'parties',
      header: 'Parties',
      render: (row) => (
        <>
          <div>{row.petitioner}</div>
          <div className="cell-muted">v {row.respondent}</div>
        </>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      render: (row) => (
        <>
          <div>{humanise(row.caseType)}</div>
          <div className="cell-muted">
            {row.isRespondent ? 'Department is respondent' : 'Filed by the department'}
          </div>
        </>
      ),
    },
    {
      key: 'claim',
      header: 'At stake',
      numeric: true,
      render: (row) => (row.claimAmount > 0 ? rupeesShort(row.claimAmount) : '—'),
    },
    {
      key: 'hearing',
      header: 'Next listed',
      render: (row) =>
        row.nextHearingDate ? (
          <>
            <div style={row.isHearingMissed ? { color: 'var(--danger-fg)', fontWeight: 700 } : undefined}>
              {date(row.nextHearingDate)}
            </div>
            <div className="cell-muted">{relativeTime(row.nextHearingDate)}</div>
          </>
        ) : (
          '—'
        ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <>
          <StatusBadge status={row.status} />
          {row.outcome && <div className="cell-muted">{humanise(row.outcome)}</div>}
        </>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Court cases"
        subtitle="Litigation the department is party to, and the hearings coming up."
        actions={
          can('court.manage') ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              Register a case
            </Button>
          ) : undefined
        }
      />

      {missed.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <Alert variant="danger" title={`${missed.length} case(s) are past a listed date with nothing recorded`}>
            A hearing has come and gone without proceedings being entered. Record what happened, or
            the next date will be wrong.
          </Alert>
        </div>
      )}

      <div className="tabs" role="tablist">
        {(['register', 'cause-list'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={view === key}
            className={`tab${view === key ? ' is-active' : ''}`}
            onClick={() => setParam('view', key === 'register' ? '' : key)}
          >
            {key === 'register' ? 'Register' : 'Cause list — next 30 days'}
          </button>
        ))}
      </div>

      <Card>
        <div className="filter-bar">
          <div className="input-prefix" style={{ flex: 1, minWidth: 240 }}>
            <span className="input-prefix__label" aria-hidden="true"><SearchIcon /></span>
            <input
              className="input"
              placeholder="Case number, subject or party"
              aria-label="Search cases"
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
            {CASE_STATUSES.map((value) => (
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
          loading={cases.isLoading}
          onRowClick={(row) => setSelected(row.id)}
          caption="Court cases"
          empty={{
            title: view === 'cause-list' ? 'Nothing listed in the next thirty days' : 'No cases on the register',
            text:
              view === 'cause-list'
                ? 'Cases with a date given at their last hearing appear here.'
                : 'Litigation the department is party to is recorded here, with every listing.',
          }}
        />
        {cases.data && (
          <div style={{ padding: '0 18px 14px' }}>
            <Pagination
              page={cases.data.page}
              pageSize={cases.data.pageSize}
              total={cases.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          </div>
        )}
      </Card>

      {selected !== null && <CaseDialog caseId={selected} onClose={() => setSelected(null)} />}
      {creating && <CaseFormDialog onClose={() => setCreating(false)} />}
    </>
  );
}

// --- One case -----------------------------------------------------------------

function CaseDialog({ caseId, onClose }: { caseId: number; onClose: () => void }) {
  const { can } = useAuth();
  const [hearing, setHearing] = useState(false);
  const [disposing, setDisposing] = useState(false);

  const record = useQuery({
    queryKey: ['court-case', caseId],
    queryFn: () => api.get<CourtCaseDetail>(`/court-cases/${caseId}`),
  });

  const c = record.data;

  return (
    <Modal
      open
      title={c ? c.caseNo : 'Case'}
      subtitle={c ? `${c.petitioner} v ${c.respondent}` : undefined}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          {c && can('court.manage') && !c.isClosed && (
            <>
              <Button onClick={() => setHearing(true)}>Record a hearing</Button>
              <Button variant="primary" icon={<GavelIcon size={16} />} onClick={() => setDisposing(true)}>
                Close the case
              </Button>
            </>
          )}
          <Button onClick={onClose}>Close</Button>
        </>
      }
    >
      {record.isLoading || !c ? (
        <Loading label="Loading the case…" />
      ) : (
        <div className="stack">
          {c.isHearingMissed && (
            <Alert variant="danger" title={`Listed on ${date(c.nextHearingDate)} with nothing recorded`}>
              Record what happened at that hearing. Until it is entered, the register shows a date
              that has already passed.
            </Alert>
          )}
          {c.isListedToday && (
            <Alert variant="warn" title="Listed today">
              This matter is before {c.court.name} today.
            </Alert>
          )}
          {c.isClosed && (
            <Alert variant={c.outcome === 'AGAINST' ? 'danger' : 'ok'} title={`Closed — ${humanise(c.outcome)}`}>
              Disposed of on {date(c.disposalDate)}.
              {c.decreeAmount > 0 && <> Decree of <strong>{rupees(c.decreeAmount)}</strong>.</>}
            </Alert>
          )}

          <Card title="Particulars">
            <div className="detail-grid">
              <DetailItem label="Case number" value={<span className="code">{c.caseNo}</span>} />
              <DetailItem label="Departmental file" value={c.internalRef} />
              <DetailItem label="Court" value={c.court.name} />
              <DetailItem label="Forum" value={humanise(c.court.type)} />
              <DetailItem label="Case type" value={humanise(c.caseType)} />
              <DetailItem
                label="Department's position"
                value={c.isRespondent ? 'Respondent' : 'Petitioner'}
              />
              <DetailItem label="Filed on" value={date(c.filingDate)} />
              <DetailItem label="Amount at stake" value={c.claimAmount > 0 ? rupees(c.claimAmount) : null} />
              <DetailItem label="Advocate" value={c.advocate.name} />
              <DetailItem label="Dealing officer" value={c.dealingOfficer?.name} />
              <DetailItem
                label="Work"
                value={c.project ? <Link to={`/projects/${c.project.id}`}>{c.project.name}</Link> : null}
              />
              <DetailItem
                label="Land parcel"
                value={c.parcel ? <Link to="/land">{c.parcel.parcelNo}</Link> : null}
              />
              <DetailItem
                label="Contractor"
                value={
                  c.contractor
                    ? <Link to={`/contractors/${c.contractor.id}`}>{c.contractor.name}</Link>
                    : null
                }
              />
              <DetailItem label="Status" value={<StatusBadge status={c.status} />} />
            </div>
            <div style={{ marginTop: 16 }}>
              <div className="detail-item__label">Subject</div>
              <p style={{ marginTop: 4, lineHeight: 1.6 }}>{c.subject}</p>
            </div>
            {c.remarks && (
              <div style={{ marginTop: 12 }}>
                <div className="detail-item__label">Remarks</div>
                <p style={{ marginTop: 4 }}>{c.remarks}</p>
              </div>
            )}
          </Card>

          <Card
            title="Hearings"
            subtitle="Every listing, and what came of it."
            flush
          >
            {c.hearings.length === 0 ? (
              <div style={{ padding: 18 }}>
                <p className="cell-muted">No hearing has been recorded yet.</p>
              </div>
            ) : (
              <div className="history" style={{ padding: 18 }}>
                {c.hearings.map((entry) => (
                  <div key={entry.id} className="history__item">
                    <span className="history__avatar" aria-hidden="true">
                      {entry.hearingDate.slice(8, 10)}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div className="history__head">
                        <span className="history__actor">{date(entry.hearingDate)}</span>
                        {entry.purpose && <span className="history__time">{entry.purpose}</span>}
                      </div>
                      {entry.proceedings && (
                        <p style={{ margin: '4px 0 0', lineHeight: 1.6 }}>{entry.proceedings}</p>
                      )}
                      <div className="timeline__meta">
                        {entry.appearedBy && <>Appeared: {entry.appearedBy}. </>}
                        {entry.nextDate
                          ? <>Adjourned to {date(entry.nextDate)}.</>
                          : <>No further date given.</>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {hearing && c && <HearingDialog record={c} onClose={() => setHearing(false)} />}
      {disposing && c && <DisposalDialog record={c} onClose={() => setDisposing(false)} />}
    </Modal>
  );
}

function HearingDialog({ record, onClose }: { record: CourtCaseDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    hearingDate: record.nextHearingDate ?? today(),
    purpose: '',
    appearedBy: record.advocate.name ?? '',
    proceedings: '',
    nextDate: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/court-cases/${record.id}/hearings`, {
        hearingDate: form.hearingDate,
        purpose: form.purpose || undefined,
        appearedBy: form.appearedBy || undefined,
        proceedings: form.proceedings || undefined,
        orderSummary: form.proceedings || undefined,
        nextDate: form.nextDate || undefined,
      }),
    onSuccess: () => {
      toast.success('Hearing recorded');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the hearing.'),
  });

  return (
    <Modal
      open
      title="Record a hearing"
      subtitle={record.caseNo}
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
            Record hearing
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <div className="form-grid">
          <TextInput label="Heard on" type="date" required value={form.hearingDate} onChange={set('hearingDate')} />
          <TextInput
            label="Next date"
            type="date"
            value={form.nextDate}
            onChange={set('nextDate')}
            hint="Leave blank if judgment was reserved or the matter was closed."
          />
          <TextInput label="Purpose" value={form.purpose} onChange={set('purpose')} placeholder="e.g. Arguments" />
          <TextInput label="Appeared for the department" value={form.appearedBy} onChange={set('appearedBy')} />
          <TextArea
            label="Proceedings"
            full
            rows={4}
            value={form.proceedings}
            onChange={set('proceedings')}
            hint="What the court did, in the file's own words."
          />
        </div>
      </div>
    </Modal>
  );
}

function DisposalDialog({ record, onClose }: { record: CourtCaseDetail; onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    status: 'DISPOSED',
    outcome: 'IN_FAVOUR',
    disposalDate: today(),
    decreeAmount: '',
    remarks: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/court-cases/${record.id}/disposal`, {
        status: form.status,
        outcome: form.outcome,
        disposalDate: form.disposalDate,
        decreeAmount: form.decreeAmount || undefined,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Case closed');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not close the case.'),
  });

  return (
    <Modal
      open
      title="Close the case"
      subtitle={record.caseNo}
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
            Close case
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not close">{message}</Alert>}
        <Alert variant="warn" title="A closed case is a record">
          It stops appearing on the cause list and can no longer take hearings. An appeal is
          registered as a fresh case.
        </Alert>
        <div className="form-grid">
          <Select
            label="How it ended"
            options={[
              { value: 'DISPOSED', label: 'Disposed of' },
              { value: 'SETTLED', label: 'Settled' },
              { value: 'WITHDRAWN', label: 'Withdrawn' },
              { value: 'APPEALED', label: 'Appealed to a higher forum' },
            ]}
            value={form.status}
            onChange={set('status')}
          />
          <Select
            label="Outcome"
            options={CASE_OUTCOMES.map((value) => ({ value, label: humanise(value) }))}
            value={form.outcome}
            onChange={set('outcome')}
          />
          <TextInput label="Decided on" type="date" required value={form.disposalDate} onChange={set('disposalDate')} />
          <TextInput
            label="Decree or award"
            numeric
            prefix="₹"
            value={form.decreeAmount}
            onChange={set('decreeAmount')}
            hint="What the department was ordered to pay or recover."
          />
          <TextArea label="Remarks" full rows={3} value={form.remarks} onChange={set('remarks')} />
        </div>
      </div>
    </Modal>
  );
}

// --- Registering a case --------------------------------------------------------

function CaseFormDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    caseNo: '',
    courtName: '',
    courtType: 'HIGH_COURT',
    caseType: 'WRIT',
    filedBy: 'AGAINST_DEPARTMENT',
    petitioner: '',
    respondent: 'State of Karnataka & Others',
    subject: '',
    filingDate: today(),
    projectId: '',
    claimAmount: '',
    advocateName: '',
    nextHearingDate: '',
    remarks: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects', 'for-cases'],
    queryFn: () => api.get<Page<Project>>('/projects', { pageSize: 200 }),
  });

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const save = useMutation({
    mutationFn: () =>
      api.post('/court-cases', {
        caseNo: form.caseNo,
        courtName: form.courtName,
        courtType: form.courtType,
        caseType: form.caseType,
        filedBy: form.filedBy,
        petitioner: form.petitioner,
        respondent: form.respondent,
        subject: form.subject,
        filingDate: form.filingDate,
        projectId: form.projectId || undefined,
        claimAmount: form.claimAmount || undefined,
        advocateName: form.advocateName || undefined,
        nextHearingDate: form.nextHearingDate || undefined,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Case registered');
      void queryClient.invalidateQueries({ queryKey: ['court-cases'] });
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not register the case.');
      }
    },
  });

  return (
    <Modal
      open
      title="Register a court case"
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
            Register case
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Case number"
            required
            value={form.caseNo}
            onChange={set('caseNo')}
            error={errors.caseNo}
            placeholder="e.g. WP 41822/2026"
          />
          <TextInput
            label="Court"
            required
            value={form.courtName}
            onChange={set('courtName')}
            error={errors.courtName}
            placeholder="e.g. High Court of Karnataka, Kalaburagi Bench"
          />
          <Select
            label="Forum"
            options={COURT_TYPES.map((value) => ({ value, label: humanise(value) }))}
            value={form.courtType}
            onChange={set('courtType')}
          />
          <Select
            label="Case type"
            options={CASE_TYPES.map((value) => ({ value, label: humanise(value) }))}
            value={form.caseType}
            onChange={set('caseType')}
          />
          <Select
            label="Filed by"
            options={[
              { value: 'AGAINST_DEPARTMENT', label: 'Against the department' },
              { value: 'BY_DEPARTMENT', label: 'By the department' },
            ]}
            value={form.filedBy}
            onChange={set('filedBy')}
          />
          <TextInput label="Filed on" type="date" required value={form.filingDate} onChange={set('filingDate')} />
          <TextInput
            label="Petitioner"
            required
            value={form.petitioner}
            onChange={set('petitioner')}
            error={errors.petitioner}
          />
          <TextInput
            label="Respondent"
            required
            value={form.respondent}
            onChange={set('respondent')}
            error={errors.respondent}
          />
          <Select
            label="Related work"
            placeholder="Not tied to a particular work"
            options={(projects.data?.items ?? []).map((project) => ({
              value: String(project.id),
              label: `${project.projectCode} — ${project.name}`,
            }))}
            value={form.projectId}
            onChange={set('projectId')}
          />
          <TextInput
            label="Amount at stake"
            numeric
            prefix="₹"
            value={form.claimAmount}
            onChange={set('claimAmount')}
          />
          <TextInput label="Advocate" value={form.advocateName} onChange={set('advocateName')} />
          <TextInput
            label="Next listed"
            type="date"
            value={form.nextHearingDate}
            onChange={set('nextHearingDate')}
          />
          <TextArea
            label="Subject"
            full
            required
            rows={3}
            value={form.subject}
            onChange={set('subject')}
            error={errors.subject}
            hint="What the case is actually about."
          />
          <TextArea label="Remarks" full rows={2} value={form.remarks} onChange={set('remarks')} />
        </div>
      </div>
    </Modal>
  );
}
