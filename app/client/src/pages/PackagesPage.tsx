import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, percent, rupees, rupeesShort } from '../lib/format';
import type { LookupOption, Package, RaBill, User } from '../types';
import {
  Alert, Button, Card, ChevronRightIcon, DetailItem, EditIcon, Loading, PageHeader,
  PlusIcon, Progress, Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { BoqPanel } from '../components/BoqPanel';
import { Attachments } from '../components/Attachments';
import { NotingSheet } from '../components/NotingSheet';
import { ProgressUpdatesPanel } from '../components/ProgressUpdatesPanel';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';

const PACKAGE_STATUSES = ['DRAFT', 'TENDERING', 'AWARDED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED'];

export function PackagesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const { data, isLoading } = useQuery({
    queryKey: ['packages', search, status, page],
    queryFn: () =>
      api.get<Page<Package>>('/packages', {
        search: search || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title="Work packages"
        subtitle="The unit of award and billing. Every running account bill is raised against a package."
      />

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="package-search">Search</label>
            <input
              id="package-search"
              type="search"
              className="input"
              placeholder="Package name, code or agreement number"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={PACKAGE_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/packages/${row.id}`)}
          caption="Work packages"
          columns={[
            {
              key: 'pkg',
              header: 'Package',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.name}</div>
                  <div className="cell-muted code">{row.packageCode}</div>
                </>
              ),
            },
            {
              key: 'project',
              header: 'Project',
              render: (row) => (
                <>
                  <div>{row.project.name}</div>
                  <div className="cell-muted">{row.project.divisionName}</div>
                </>
              ),
            },
            {
              key: 'contractor',
              header: 'Contractor',
              render: (row) => row.contractor?.name ?? <span className="cell-muted">Not awarded</span>,
            },
            {
              key: 'value',
              header: 'Contract value',
              numeric: true,
              render: (row) => rupeesShort(row.awardedValue || row.estimatedValue),
            },
            { key: 'billed', header: 'Billed', numeric: true, render: (row) => rupeesShort(row.billedToDate) },
            {
              key: 'progress',
              header: 'Progress',
              width: '140px',
              render: (row) => <Progress value={row.physicalProgress} label={`${row.name} progress`} />,
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: 'No packages found',
            text: 'Packages are created under a sanctioned project.',
            action: <Link to="/projects" className="btn btn--primary">Go to projects</Link>,
          }}
        />

        {data && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(next) => setParam('page', String(next))}
          />
        )}
      </Card>
    </>
  );
}

/* ==========================================================================
   Package detail
   ========================================================================== */

export function PackageDetailPage() {
  const { id } = useParams<{ id: string }>();
  const packageId = Number(id);
  const { hasRole, isContractor, can } = useAuth();
  const [editing, setEditing] = useState(false);

  const pkg = useQuery({
    queryKey: ['package', packageId],
    queryFn: () => api.get<Package>(`/packages/${packageId}`),
  });

  const bills = useQuery({
    queryKey: ['ra-bills', { packageId }],
    queryFn: () => api.get<Page<RaBill>>('/ra-bills', { packageId, pageSize: 50 }),
  });

  if (pkg.isLoading) return <Loading label="Loading package…" />;
  if (pkg.error || !pkg.data) {
    return <Alert variant="danger" title="Package not found">It may have been removed, or it is outside your jurisdiction.</Alert>;
  }

  const p = pkg.data;
  const canEdit = hasRole('ADMIN', 'CE', 'SE', 'EE', 'AEE', 'AE');
  const canRaiseBill =
    (isContractor || hasRole('ADMIN', 'EE', 'AEE', 'AE', 'AC')) &&
    ['AWARDED', 'IN_PROGRESS', 'COMPLETED'].includes(p.status);
  const canSubmitProgress =
    can('packages.progress.submit') && ['AWARDED', 'IN_PROGRESS', 'COMPLETED'].includes(p.status);
  const canReviewProgress = can('projects.manage');

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/packages">Packages</Link>
            <span className="breadcrumb__sep"><ChevronRightIcon size={14} /></span>
            <Link to={`/projects/${p.project.id}`}>{p.project.code}</Link>
            <span className="breadcrumb__sep"><ChevronRightIcon size={14} /></span>
            <span>{p.packageCode}</span>
          </>
        }
        title={p.name}
        subtitle={<><span className="code">{p.packageCode}</span> · {p.project.name}</>}
        actions={
          <>
            <StatusBadge status={p.status} />
            {canEdit && <Button icon={<EditIcon />} onClick={() => setEditing(true)}>Edit</Button>}
            {canRaiseBill && (
              <Link to={`/ra-bills/new?packageId=${p.id}`} className="btn btn--primary">
                <PlusIcon /> Raise RA bill
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        <div className="stat stat--accent">
          <div className="stat__label">Contract value</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.awardedValue || p.estimatedValue)}</div>
          <div className="stat__meta"><span>Estimate {rupeesShort(p.estimatedValue)}</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Billed to date</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.billedToDate)}</div>
          <div className="stat__meta"><span>{p.billCount} bill(s)</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Balance to bill</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.balanceValue)}</div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">Payment pending</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.pendingAmount)}</div>
          <div className="stat__meta"><span>Paid {rupeesShort(p.paidAmount)}</span></div>
        </div>
      </div>

      <div className="stack">
        <Card title="Package particulars">
          <div className="detail-grid">
            <DetailItem label="Package code" value={<span className="code">{p.packageCode}</span>} />
            <DetailItem label="Work type" value={p.workType?.name} />
            <DetailItem
              label="Contractor"
              value={
                p.contractor ? (
                  <Link to={`/contractors/${p.contractor.id}`}>{p.contractor.name}</Link>
                ) : null
              }
            />
            <DetailItem label="Officer in charge" value={p.inCharge?.name} />
            <DetailItem label="Agreement number" value={p.agreementNo} />
            <DetailItem label="Agreement date" value={date(p.agreementDate)} />
            <DetailItem label="Work order number" value={p.workOrderNo} />
            <DetailItem label="Work order date" value={date(p.workOrderDate)} />
            <DetailItem label="Commencement" value={date(p.commencementDate)} />
            <DetailItem label="Completion" value={date(p.completionDate)} />
            <DetailItem label="Defect liability" value={`${p.defectLiabilityMonths} months`} />
            <DetailItem label="Security deposit" value={percent(p.securityDeposit)} />
            <DetailItem label="Retention" value={percent(p.retention)} />
            <DetailItem
              label="Physical progress"
              value={<Progress value={p.physicalProgress} label="Package progress" />}
            />
          </div>
          {p.description && (
            <div style={{ marginTop: 18 }}>
              <div className="detail-item__label">Scope</div>
              <p style={{ marginTop: 4, fontSize: 14.5, lineHeight: 1.6 }}>{p.description}</p>
            </div>
          )}
        </Card>

        <Card title="Running account bills" subtitle="In sequence, as raised against this package" flush>
          <DataTable
            rows={bills.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={bills.isLoading}
            columns={[
              {
                key: 'bill',
                header: 'Bill',
                render: (row) => (
                  <>
                    <Link to={`/ra-bills/${row.id}`} className="cell-primary code">{row.billNo}</Link>
                    <div className="cell-muted">RA {row.raSequence} · DBR {row.dbrNo ?? '—'}</div>
                  </>
                ),
              },
              {
                key: 'period',
                header: 'Period',
                render: (row) => (
                  <span className="cell-muted">
                    {date(row.periodFrom)} – {date(row.periodTo)}
                  </span>
                ),
              },
              { key: 'gross', header: 'Gross', numeric: true, render: (row) => rupees(row.amounts.presentBillAmount) },
              { key: 'deduction', header: 'Deductions', numeric: true, render: (row) => rupees(row.amounts.totalDeduction) },
              { key: 'net', header: 'Net payable', numeric: true, render: (row) => <strong>{rupees(row.amounts.netPayableAmount)}</strong> },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            ]}
            empty={{
              title: 'No bills raised yet',
              text: canRaiseBill
                ? 'Raise the first running account bill for the work executed so far.'
                : 'Bills raised against this package will appear here.',
              action: canRaiseBill
                ? <Link to={`/ra-bills/new?packageId=${p.id}`} className="btn btn--primary">Raise RA bill</Link>
                : undefined,
            }}
          />
        </Card>

        <ProgressUpdatesPanel
          packageId={p.id}
          canSubmit={canSubmitProgress}
          canReview={canReviewProgress}
        />

        <BoqPanel packageId={p.id} />

        <div className="grid grid--2">
          <Attachments
            entityType="PACKAGE"
            entityId={p.id}
            title="Package documents"
            defaultCategory="AGREEMENT"
          />
          <NotingSheet entityType="PACKAGE" entityId={p.id} />
        </div>
      </div>

      {editing && (
        <PackageEditModal packageRecord={p} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

/* ==========================================================================
   Create / edit forms
   ========================================================================== */

export function PackageFormModal({
  projectId, onClose, onCreated,
}: {
  projectId: number;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: '', description: '', workTypeId: '', estimatedValue: '',
    inChargeUserId: '', defectLiabilityMonths: '12', securityDeposit: '5', retention: '5',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const workTypes = useLookup('work-types');

  // The officer in charge of a package must be an Executive Engineer.
  const engineers = useQuery({
    queryKey: ['users', 'by-role', 'EE'],
    queryFn: () => api.get<User[]>('/users/by-role', { roleCode: 'EE' }),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Package>('/packages', {
        projectId,
        name: form.name,
        description: form.description || undefined,
        workTypeId: form.workTypeId ? Number(form.workTypeId) : undefined,
        estimatedValue: form.estimatedValue,
        inChargeUserId: form.inChargeUserId ? Number(form.inChargeUserId) : undefined,
        defectLiabilityMonths: Number(form.defectLiabilityMonths),
        securityDeposit: form.securityDeposit,
        retention: form.retention,
      }),
    onSuccess: (created) => {
      toast.success('Package created', created.packageCode);
      void queryClient.invalidateQueries({ queryKey: ['packages'] });
      onCreated(created.id);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not create the package.');
      }
    },
  });

  const set = (key: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open
      title="New work package"
      subtitle="The package code is generated from the project code and never changes."
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
            Create package
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Package name" required full value={form.name} onChange={set('name')}
            error={errors.name} placeholder="e.g. Ring road widening — Chainage 0.000 to 6.200 km"
          />
          <TextArea
            label="Scope" full value={form.description} onChange={set('description')} rows={3}
            error={errors.description}
          />
          <Select
            label="Work type" value={form.workTypeId} onChange={set('workTypeId')}
            placeholder="Same as the project" error={errors.workTypeId}
            options={(workTypes.data ?? []).map((row: LookupOption) => ({ value: row.id, label: row.name }))}
          />
          <TextInput
            label="Estimated value" required prefix="₹" numeric inputMode="decimal"
            value={form.estimatedValue} onChange={set('estimatedValue')} error={errors.estimatedValue}
            placeholder="0.00"
          />
          <Select
            label="Officer in charge" value={form.inChargeUserId} onChange={set('inChargeUserId')}
            placeholder="Select an Executive Engineer" error={errors.inChargeUserId}
            hint="A package is held by the Executive Engineer of the division."
            options={(engineers.data ?? []).map((row) => ({
              value: row.id,
              label: `${row.fullName}${row.divisionName ? ` — ${row.divisionName}` : ''}`,
            }))}
          />
          <TextInput
            label="Defect liability (months)" numeric inputMode="numeric"
            value={form.defectLiabilityMonths} onChange={set('defectLiabilityMonths')}
            error={errors.defectLiabilityMonths}
          />
          <TextInput
            label="Security deposit %" numeric inputMode="decimal"
            value={form.securityDeposit} onChange={set('securityDeposit')} error={errors.securityDeposit}
          />
          <TextInput
            label="Retention %" numeric inputMode="decimal"
            value={form.retention} onChange={set('retention')} error={errors.retention}
          />
        </div>
      </div>
    </Modal>
  );
}

function PackageEditModal({
  packageRecord, onClose,
}: {
  packageRecord: Package;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: packageRecord.name,
    description: packageRecord.description ?? '',
    contractorId: packageRecord.contractor?.id ? String(packageRecord.contractor.id) : '',
    awardedValue: packageRecord.awardedValue ? String(packageRecord.awardedValue) : '',
    agreementNo: packageRecord.agreementNo ?? '',
    agreementDate: packageRecord.agreementDate ?? '',
    workOrderNo: packageRecord.workOrderNo ?? '',
    workOrderDate: packageRecord.workOrderDate ?? '',
    commencementDate: packageRecord.commencementDate ?? '',
    completionDate: packageRecord.completionDate ?? '',
    physicalProgress: String(packageRecord.physicalProgress),
    status: packageRecord.status,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const contractors = useQuery({
    queryKey: ['contractors', 'eligible'],
    queryFn: () => api.get<{ id: number; code: string; name: string }[]>('/contractors/eligible'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<Package>(`/packages/${packageRecord.id}`, {
        name: form.name,
        description: form.description || undefined,
        contractorId: form.contractorId ? Number(form.contractorId) : undefined,
        awardedValue: form.awardedValue || undefined,
        agreementNo: form.agreementNo || undefined,
        agreementDate: form.agreementDate || undefined,
        workOrderNo: form.workOrderNo || undefined,
        workOrderDate: form.workOrderDate || undefined,
        commencementDate: form.commencementDate || undefined,
        completionDate: form.completionDate || undefined,
        physicalProgress: Number(form.physicalProgress),
        status: form.status,
      }),
    onSuccess: () => {
      toast.success('Package updated');
      void queryClient.invalidateQueries();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not update the package.');
      }
    },
  });

  const set = (key: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Modal
      open
      title="Edit package"
      subtitle={packageRecord.packageCode}
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
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <Alert variant="info">
          The package code <span className="code">{packageRecord.packageCode}</span> is permanent and
          is not affected by any change here.
        </Alert>

        <div className="form-grid">
          <TextInput label="Package name" required full value={form.name} onChange={set('name')} error={errors.name} />
          <TextArea label="Scope" full value={form.description} onChange={set('description')} rows={3} />
          <Select
            label="Contractor" value={form.contractorId} onChange={set('contractorId')}
            placeholder="Not awarded" error={errors.contractorId}
            options={(contractors.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
          />
          <TextInput
            label="Awarded value" prefix="₹" numeric inputMode="decimal"
            value={form.awardedValue} onChange={set('awardedValue')} error={errors.awardedValue}
          />
          <TextInput label="Agreement number" value={form.agreementNo} onChange={set('agreementNo')} />
          <TextInput label="Agreement date" type="date" value={form.agreementDate} onChange={set('agreementDate')} />
          <TextInput label="Work order number" value={form.workOrderNo} onChange={set('workOrderNo')} />
          <TextInput label="Work order date" type="date" value={form.workOrderDate} onChange={set('workOrderDate')} />
          <TextInput label="Commencement date" type="date" value={form.commencementDate} onChange={set('commencementDate')} />
          <TextInput label="Completion date" type="date" value={form.completionDate} onChange={set('completionDate')} />
          <TextInput
            label="Physical progress %" numeric inputMode="numeric"
            value={form.physicalProgress} onChange={set('physicalProgress')} error={errors.physicalProgress}
          />
          <Select
            label="Status" value={form.status} onChange={set('status')}
            options={PACKAGE_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
        </div>
      </div>
    </Modal>
  );
}
