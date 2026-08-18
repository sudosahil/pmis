import { useState, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { currentFinancialYear, date, rupees, today } from '../lib/format';
import type { FundRelease, LocRequest } from '../types';
import { Alert, Button, Card, PageHeader, PlusIcon, Select, TextArea, TextInput } from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

type TabKey = 'releases' | 'loc';

export function FundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const [releaseForm, setReleaseForm] = useState(false);
  const [locForm, setLocForm] = useState(false);

  const tab = (params.get('tab') as TabKey | null) ?? 'releases';
  const financialYear = params.get('financialYear') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const releases = useQuery({
    queryKey: ['fund-releases', financialYear, page],
    queryFn: () =>
      api.get<Page<FundRelease>>('/funds/releases', {
        financialYear: financialYear || undefined,
        page,
        pageSize: 20,
      }),
    enabled: tab === 'releases',
  });

  const locRequests = useQuery({
    queryKey: ['loc-requests', financialYear, status, page],
    queryFn: () =>
      api.get<Page<LocRequest>>('/funds/loc', {
        financialYear: financialYear || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
    enabled: tab === 'loc',
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const canRelease = hasRole('ADMIN', 'CAO', 'MD', 'CE');
  const canRequestLoc = hasRole('ADMIN', 'EE', 'AC', 'AS');

  const currentFy = currentFinancialYear();
  const startYear = Number(currentFy.slice(0, 4));
  const fyOptions = Array.from({ length: 5 }, (_, index) => {
    const year = startYear - index;
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['fund-releases'] });
    void queryClient.invalidateQueries({ queryKey: ['loc-requests'] });
  };

  return (
    <>
      <PageHeader
        title="Funds and letters of credit"
        subtitle="Budget released against schemes, and the letters of credit divisions draw against to pay bills."
        actions={
          tab === 'releases'
            ? canRelease && (
                <Button variant="primary" icon={<PlusIcon />} onClick={() => setReleaseForm(true)}>
                  Record a release
                </Button>
              )
            : canRequestLoc && (
                <Button variant="primary" icon={<PlusIcon />} onClick={() => setLocForm(true)}>
                  Request a letter of credit
                </Button>
              )
        }
      />

      <div className="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'releases'}
          className={`tab${tab === 'releases' ? ' is-active' : ''}`}
          onClick={() => setParam('tab', 'releases')}
        >
          Fund releases
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'loc'}
          className={`tab${tab === 'loc' ? ' is-active' : ''}`}
          onClick={() => setParam('tab', 'loc')}
        >
          Letters of credit
        </button>
      </div>

      <Card flush>
        <div className="filter-bar">
          <Select
            label="Financial year"
            value={financialYear}
            onChange={(event) => setParam('financialYear', event.target.value)}
            placeholder="All years"
            options={fyOptions.map((value) => ({ value, label: value }))}
          />
          {tab === 'loc' && (
            <Select
              label="Status"
              value={status}
              onChange={(event) => setParam('status', event.target.value)}
              placeholder="All statuses"
              options={['DRAFT', 'IN_APPROVAL', 'APPROVED', 'REJECTED', 'RETURNED'].map((value) => ({
                value,
                label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
              }))}
            />
          )}
        </div>

        {tab === 'releases' ? (
          <>
            <DataTable
              rows={releases.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={releases.isLoading}
              caption="Fund releases"
              columns={[
                {
                  key: 'release',
                  header: 'Release',
                  render: (row) => (
                    <>
                      <div className="cell-primary code">{row.releaseNo}</div>
                      <div className="cell-muted">{date(row.releaseDate)}</div>
                    </>
                  ),
                },
                {
                  key: 'scheme',
                  header: 'Scheme',
                  render: (row) => (
                    <>
                      <div>{row.scheme.name}</div>
                      <div className="cell-muted code">{row.scheme.code}</div>
                    </>
                  ),
                },
                {
                  key: 'project',
                  header: 'Project',
                  render: (row) => row.project?.name ?? 'Scheme-wide',
                },
                { key: 'division', header: 'Division', render: (row) => row.division.name },
                { key: 'fy', header: 'Year', render: (row) => row.financialYear },
                {
                  key: 'sanctioned',
                  header: 'Sanctioned',
                  numeric: true,
                  render: (row) => rupees(row.sanctionedAmount),
                },
                {
                  key: 'released',
                  header: 'Released',
                  numeric: true,
                  render: (row) => <strong>{rupees(row.releasedAmount)}</strong>,
                },
                {
                  key: 'balance',
                  header: 'Balance',
                  numeric: true,
                  render: (row) => rupees(row.balanceAmount),
                },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              ]}
              empty={{
                title: 'No fund releases recorded',
                text: 'Releases sanctioned against a scheme appear here.',
              }}
            />
            {releases.data && (
              <Pagination
                page={releases.data.page}
                pageSize={releases.data.pageSize}
                total={releases.data.total}
                onPageChange={(next) => setParam('page', String(next))}
              />
            )}
          </>
        ) : (
          <>
            <DataTable
              rows={locRequests.data?.items ?? []}
              rowKey={(row) => row.id}
              loading={locRequests.isLoading}
              onRowClick={(row) => navigate(`/funds/loc/${row.id}`)}
              caption="Letters of credit"
              columns={[
                {
                  key: 'loc',
                  header: 'Letter of credit',
                  render: (row) => (
                    <>
                      <div className="cell-primary code">{row.locNo}</div>
                      <div className="cell-muted">{date(row.requestDate)}</div>
                    </>
                  ),
                },
                { key: 'division', header: 'Division', render: (row) => row.division.name },
                { key: 'scheme', header: 'Scheme', render: (row) => row.scheme?.name ?? 'All schemes' },
                { key: 'fy', header: 'Year', render: (row) => row.financialYear },
                {
                  key: 'requested',
                  header: 'Requested',
                  numeric: true,
                  render: (row) => rupees(row.requestedAmount),
                },
                {
                  key: 'approved',
                  header: 'Approved',
                  numeric: true,
                  render: (row) =>
                    row.approvedAmount ? <strong>{rupees(row.approvedAmount)}</strong> : '—',
                },
                { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
              ]}
              empty={{
                title: 'No letters of credit yet',
                text: canRequestLoc
                  ? 'Raise a request when the division needs funds released to pay bills.'
                  : 'Requests raised in your jurisdiction appear here.',
              }}
            />
            {locRequests.data && (
              <Pagination
                page={locRequests.data.page}
                pageSize={locRequests.data.pageSize}
                total={locRequests.data.total}
                onPageChange={(next) => setParam('page', String(next))}
              />
            )}
          </>
        )}
      </Card>

      {releaseForm && (
        <FundReleaseDialog onClose={() => setReleaseForm(false)} onSaved={refresh} />
      )}
      {locForm && (
        <LocRequestDialog
          onClose={() => setLocForm(false)}
          onCreated={(id) => { setLocForm(false); refresh(); navigate(`/funds/loc/${id}`); }}
        />
      )}
    </>
  );
}

function FundReleaseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [form, setForm] = useState({
    schemeId: '',
    projectId: '',
    zoneId: '',
    circleId: '',
    divisionId: '',
    financialYear: currentFinancialYear(),
    sanctionedAmount: '',
    releasedAmount: '',
    releaseDate: today(),
    referenceNo: '',
    remarks: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const schemes = useLookup('schemes');
  const zones = useLookup('zones');
  const circles = useLookup('circles', form.zoneId);
  const divisions = useLookup('divisions', form.circleId);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => {
        const next = { ...current, [key]: event.target.value };
        if (key === 'zoneId') { next.circleId = ''; next.divisionId = ''; }
        if (key === 'circleId') { next.divisionId = ''; }
        return next;
      });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<FundRelease>('/funds/releases', {
        schemeId: Number(form.schemeId),
        projectId: form.projectId ? Number(form.projectId) : undefined,
        divisionId: Number(form.divisionId),
        financialYear: form.financialYear,
        sanctionedAmount: form.sanctionedAmount,
        releasedAmount: form.releasedAmount,
        releaseDate: form.releaseDate,
        referenceNo: form.referenceNo || undefined,
        remarks: form.remarks || undefined,
      }),
    onSuccess: (release) => {
      toast.success('Release recorded', `${release.releaseNo} has been saved.`);
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not record the release.');
      }
    },
  });

  return (
    <Modal
      open
      title="Record a fund release"
      subtitle="Budget released to a division against a scheme, for the stated financial year."
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            Record release
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <Select
            label="Scheme"
            required
            value={form.schemeId}
            onChange={set('schemeId')}
            placeholder="Select a scheme"
            error={errors.schemeId}
            options={(schemes.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
          />
          <TextInput
            label="Financial year"
            required
            value={form.financialYear}
            onChange={set('financialYear')}
            error={errors.financialYear}
            placeholder="2026-27"
          />
          <Select
            label="Zone"
            required
            value={form.zoneId}
            onChange={set('zoneId')}
            placeholder="Select a zone"
            options={(zones.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
          />
          <Select
            label="Circle"
            required
            value={form.circleId}
            onChange={set('circleId')}
            placeholder={form.zoneId ? 'Select a circle' : 'Choose a zone first'}
            options={(circles.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
          />
          <Select
            label="Division"
            required
            value={form.divisionId}
            onChange={set('divisionId')}
            placeholder={form.circleId ? 'Select a division' : 'Choose a circle first'}
            error={errors.divisionId}
            options={(divisions.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
          />
          <TextInput
            label="Sanctioned amount"
            required
            numeric
            prefix="₹"
            value={form.sanctionedAmount}
            onChange={set('sanctionedAmount')}
            error={errors.sanctionedAmount}
            hint="The total sanctioned under this order."
          />
          <TextInput
            label="Released amount"
            required
            numeric
            prefix="₹"
            value={form.releasedAmount}
            onChange={set('releasedAmount')}
            error={errors.releasedAmount}
            hint="The portion actually released now."
          />
          <TextInput
            label="Release date"
            type="date"
            required
            value={form.releaseDate}
            onChange={set('releaseDate')}
            error={errors.releaseDate}
          />
          <TextInput
            label="Government order reference"
            value={form.referenceNo}
            onChange={set('referenceNo')}
            error={errors.referenceNo}
            placeholder="e.g. GO/PWD/234/2026"
          />
          <TextArea
            label="Remarks"
            full
            rows={2}
            value={form.remarks}
            onChange={set('remarks')}
            error={errors.remarks}
          />
        </div>
      </div>
    </Modal>
  );
}

function LocRequestDialog({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    schemeId: '',
    financialYear: currentFinancialYear(),
    requestDate: today(),
    requestedAmount: '',
    purpose: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const schemes = useLookup('schemes');

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      api.post<LocRequest>('/funds/loc', {
        schemeId: form.schemeId ? Number(form.schemeId) : undefined,
        financialYear: form.financialYear,
        requestDate: form.requestDate,
        requestedAmount: form.requestedAmount,
        purpose: form.purpose,
      }),
    onSuccess: (loc) => {
      toast.success('Request created', `${loc.locNo} is saved as a draft. Submit it for approval.`);
      onCreated(loc.id);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not create the request.');
      }
    },
  });

  return (
    <Modal
      open
      title="Request a letter of credit"
      subtitle="The request is raised for your own division and goes up the accounts chain for approval."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            Create request
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <Select
            label="Scheme"
            value={form.schemeId}
            onChange={set('schemeId')}
            placeholder="All schemes"
            error={errors.schemeId}
            options={(schemes.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
          />
          <TextInput
            label="Financial year"
            required
            value={form.financialYear}
            onChange={set('financialYear')}
            error={errors.financialYear}
          />
          <TextInput
            label="Request date"
            type="date"
            required
            value={form.requestDate}
            onChange={set('requestDate')}
            error={errors.requestDate}
          />
          <TextInput
            label="Amount requested"
            required
            numeric
            prefix="₹"
            value={form.requestedAmount}
            onChange={set('requestedAmount')}
            error={errors.requestedAmount}
          />
          <TextArea
            label="Purpose"
            required
            full
            rows={3}
            value={form.purpose}
            onChange={set('purpose')}
            error={errors.purpose}
            hint="State which bills or commitments the funds will settle."
          />
        </div>
      </div>
    </Modal>
  );
}
