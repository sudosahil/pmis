import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, rupees, rupeesShort } from '../lib/format';
import type { Milestone, Package, ProjectDetail } from '../types';
import {
  Alert, Button, Card, ChevronRightIcon, DetailItem, EditIcon, Loading, PageHeader,
  PlusIcon, Progress, SendIcon, TextInput, Select, TextArea,
} from '../components/ui';
import { DataTable } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { WorkflowPanel } from '../components/WorkflowPanel';
import { SanctionsPanel } from '../components/SanctionsPanel';
import { DprPanel } from '../components/DprPanel';
import { Attachments } from '../components/Attachments';
import { NotingSheet } from '../components/NotingSheet';
import { useToast } from '../components/Toast';
import { PackageFormModal } from './PackagesPage';

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<
    'overview' | 'sanctions' | 'dpr' | 'packages' | 'milestones' | 'documents' | 'approval'
  >('overview');
  const [submitting, setSubmitting] = useState(false);
  const [editingMilestones, setEditingMilestones] = useState(false);
  const [creatingPackage, setCreatingPackage] = useState(false);

  const canEdit = hasRole('ADMIN', 'CE', 'SE', 'EE', 'AEE', 'AE');

  const project = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/projects/${projectId}`),
  });

  const packages = useQuery({
    queryKey: ['packages', { projectId }],
    queryFn: () => api.get<Page<Package>>('/packages', { projectId, pageSize: 100 }),
  });

  const submit = useMutation({
    mutationFn: (remarks: string) => api.post(`/projects/${projectId}/submit`, { remarks }),
    onSuccess: () => {
      toast.success('Sent for sanction', 'The file is now with the Executive Engineer.');
      void queryClient.invalidateQueries();
      setSubmitting(false);
      setTab('approval');
    },
    onError: (error: unknown) => {
      toast.error('Could not submit', error instanceof ApiError ? error.message : undefined);
    },
  });

  if (project.isLoading) return <Loading label="Loading project…" />;
  if (project.error || !project.data) {
    return <Alert variant="danger" title="Project not found">This project may have been removed, or it is outside your jurisdiction.</Alert>;
  }

  const p = project.data;
  const canSubmit = canEdit && (p.status === 'DRAFT' || p.status === 'REJECTED');

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/projects">Projects</Link>
            <span className="breadcrumb__sep"><ChevronRightIcon size={14} /></span>
            <span>{p.projectCode}</span>
          </>
        }
        title={p.name}
        subtitle={
          <>
            <span className="code">{p.projectCode}</span> · {p.scheme.name} · {p.location.divisionName}
          </>
        }
        actions={
          <>
            <StatusBadge status={p.status} />
            {canSubmit && (
              <Button variant="primary" icon={<SendIcon />} onClick={() => setSubmitting(true)}>
                Send for sanction
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid--4" style={{ marginBottom: 18 }}>
        <div className="stat stat--accent">
          <div className="stat__label">Sanctioned cost</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.sanctionedCost || p.estimatedCost)}</div>
          <div className="stat__meta"><span>Estimate {rupeesShort(p.estimatedCost)}</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Paid to date</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.paidAmount)}</div>
          <div className="stat__meta"><span>{p.financialProgress}% of sanction</span></div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">In approval</div>
          <div className="stat__value stat__value--currency">{rupeesShort(p.pendingAmount)}</div>
          <div className="stat__meta"><span>Bills not yet paid</span></div>
        </div>
        <div className="stat">
          <div className="stat__label">Physical progress</div>
          <div className="stat__value">{p.physicalProgress}%</div>
          <div className="stat__meta"><span>{p.packageCount} package(s)</span></div>
        </div>
      </div>

      <div className="tabs" role="tablist">
        {(['overview', 'sanctions', 'dpr', 'packages', 'milestones', 'documents', 'approval'] as const).map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`tab${tab === key ? ' is-active' : ''}`}
            onClick={() => setTab(key)}
          >
            {key === 'overview' ? 'Overview'
              : key === 'sanctions' ? 'Sanctions'
              : key === 'dpr' ? 'DPR'
              : key === 'packages' ? 'Packages'
              : key === 'milestones' ? 'Milestones'
              : key === 'documents' ? 'Documents & notes'
              : 'Approval'}
            {key === 'packages' && packages.data ? <span className="tab__count">({packages.data.total})</span> : null}
          </button>
        ))}
      </div>

      {tab === 'sanctions' && <SanctionsPanel projectId={projectId} />}
      {tab === 'dpr' && <DprPanel projectId={projectId} />}
      {tab === 'documents' && (
        <div className="grid grid--2">
          <Attachments
            entityType="PROJECT"
            entityId={projectId}
            title="Project documents"
            defaultCategory="SANCTION"
          />
          <NotingSheet entityType="PROJECT" entityId={projectId} />
        </div>
      )}

      {tab === 'overview' && (
        <div className="stack">
          <Card title="Project particulars">
            <div className="detail-grid">
              <DetailItem label="Project code" value={<span className="code">{p.projectCode}</span>} />
              <DetailItem label="Scheme" value={`${p.scheme.name} (${p.scheme.code})`} />
              <DetailItem label="Work type" value={p.workType.name} />
              <DetailItem label="Category" value={p.category.name} />
              <DetailItem label="Zone" value={p.location.zoneName} />
              <DetailItem label="Circle" value={p.location.circleName} />
              <DetailItem label="Division" value={p.location.divisionName} />
              <DetailItem label="Sub division" value={p.location.subDivisionName} />
              <DetailItem label="District" value={p.location.districtName} />
              <DetailItem label="Town / city" value={p.location.townName} />
              <DetailItem label="Sanction number" value={p.sanctionNo} />
              <DetailItem label="Sanction date" value={date(p.sanctionDate)} />
              <DetailItem label="Start date" value={date(p.startDate)} />
              <DetailItem label="Target completion" value={date(p.targetCompletionDate)} />
              <DetailItem label="Actual completion" value={date(p.actualCompletionDate)} />
              <DetailItem label="Created by" value={p.createdBy} />
            </div>
            {p.description && (
              <div style={{ marginTop: 18 }}>
                <div className="detail-item__label">Scope</div>
                <p style={{ marginTop: 4, fontSize: 14.5, lineHeight: 1.6 }}>{p.description}</p>
              </div>
            )}
          </Card>

          <Card title="Expenditure position" subtitle={`Financial year ${p.expenditure.financialYear}`}>
            <div className="totals">
              <div className="totals__row">
                <span className="totals__label">Expenditure up to previous financial year</span>
                <span className="totals__value">{rupees(p.expenditure.uptoPreviousYear)}</span>
              </div>
              <div className="totals__row">
                <span className="totals__label">Expenditure during {p.expenditure.financialYear}</span>
                <span className="totals__value">{rupees(p.expenditure.duringYear)}</span>
              </div>
              <div className="totals__row">
                <span className="totals__label">Miscellaneous expenditure charged to the project</span>
                <span className="totals__value">{rupees(p.miscExpenditure)}</span>
              </div>
              <div className="totals__row totals__row--grand">
                <span className="totals__label">Total expenditure</span>
                <span className="totals__value">{rupees(p.expenditure.total + p.miscExpenditure)}</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {tab === 'packages' && (
        <Card
          title="Work packages"
          subtitle="A project is executed through one or more packages, each awarded to a contractor."
          actions={
            canEdit && p.status !== 'DRAFT' && p.status !== 'PENDING_SANCTION' ? (
              <Button size="sm" variant="primary" icon={<PlusIcon />} onClick={() => setCreatingPackage(true)}>
                New package
              </Button>
            ) : undefined
          }
          flush
        >
          <DataTable
            rows={packages.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={packages.isLoading}
            columns={[
              {
                key: 'pkg',
                header: 'Package',
                render: (row) => (
                  <>
                    <Link to={`/packages/${row.id}`} className="cell-primary">{row.name}</Link>
                    <div className="cell-muted code">{row.packageCode}</div>
                  </>
                ),
              },
              {
                key: 'contractor',
                header: 'Contractor',
                render: (row) =>
                  row.contractor?.name ?? <span className="cell-muted">Not awarded</span>,
              },
              { key: 'value', header: 'Value', numeric: true, render: (row) => rupeesShort(row.awardedValue || row.estimatedValue) },
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
              title: 'No packages yet',
              text: p.status === 'DRAFT' || p.status === 'PENDING_SANCTION'
                ? 'Packages can be created once the project is sanctioned.'
                : 'Split the work into packages so it can be tendered and billed.',
            }}
          />
        </Card>
      )}

      {tab === 'milestones' && (
        <Card
          title="Milestones"
          subtitle="Physical progress is calculated from completed milestones, weighted as set here."
          actions={
            canEdit ? (
              <Button size="sm" icon={<EditIcon />} onClick={() => setEditingMilestones(true)}>
                Edit milestones
              </Button>
            ) : undefined
          }
          flush
        >
          <DataTable
            rows={p.milestones}
            rowKey={(row) => row.id}
            columns={[
              { key: 'seq', header: '#', width: '48px', render: (row) => row.seq },
              { key: 'name', header: 'Milestone', render: (row) => <span className="cell-primary">{row.name}</span> },
              { key: 'planned', header: 'Planned', render: (row) => date(row.plannedDate) },
              { key: 'actual', header: 'Actual', render: (row) => date(row.actualDate) },
              { key: 'weight', header: 'Weightage', numeric: true, render: (row) => `${row.weightage}%` },
              { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            ]}
            empty={{
              title: 'No milestones recorded',
              text: 'Add milestones so physical progress is measured rather than estimated.',
              action: canEdit
                ? <Button variant="primary" onClick={() => setEditingMilestones(true)}>Add milestones</Button>
                : undefined,
            }}
          />
        </Card>
      )}

      {tab === 'approval' && (
        <WorkflowPanel
          workflow={p.workflow}
          onActed={() => void queryClient.invalidateQueries({ queryKey: ['project', projectId] })}
        />
      )}

      <SubmitDialog
        open={submitting}
        onClose={() => setSubmitting(false)}
        loading={submit.isPending}
        onSubmit={(remarks) => submit.mutate(remarks)}
      />

      {editingMilestones && (
        <MilestoneEditor
          projectId={projectId}
          milestones={p.milestones}
          onClose={() => setEditingMilestones(false)}
        />
      )}

      {creatingPackage && (
        <PackageFormModal
          projectId={projectId}
          onClose={() => setCreatingPackage(false)}
          onCreated={(newId) => {
            setCreatingPackage(false);
            void queryClient.invalidateQueries({ queryKey: ['packages'] });
            navigate(`/packages/${newId}`);
          }}
        />
      )}
    </>
  );
}

function SubmitDialog({
  open, onClose, loading, onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  loading: boolean;
  onSubmit: (remarks: string) => void;
}) {
  const [remarks, setRemarks] = useState('');
  return (
    <Modal
      open={open}
      title="Send for administrative sanction"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => onSubmit(remarks)}>
            Send for sanction
          </Button>
        </>
      }
    >
      <div className="stack">
        <Alert variant="info" title="What happens next">
          The file moves through Divisional Scrutiny, Circle Review, Technical Sanction and finally
          Administrative Sanction. You will be notified at each stage, and the project cannot be
          edited while it is in the chain.
        </Alert>
        <TextArea
          label="Covering remarks"
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          rows={4}
          hint="Optional. Anything the reviewing officer should know."
        />
      </div>
    </Modal>
  );
}

/* Milestone editor — weightage must total 100% before it can be saved. */
interface MilestoneDraft {
  name: string;
  plannedDate: string;
  actualDate: string;
  weightage: string;
  status: string;
  remarks: string;
}

function MilestoneEditor({
  projectId, milestones, onClose,
}: {
  projectId: number;
  milestones: Milestone[];
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rows, setRows] = useState<MilestoneDraft[]>(
    milestones.length
      ? milestones.map((m) => ({
          name: m.name,
          plannedDate: m.plannedDate ?? '',
          actualDate: m.actualDate ?? '',
          weightage: String(m.weightage),
          status: m.status,
          remarks: m.remarks ?? '',
        }))
      : [{ name: '', plannedDate: '', actualDate: '', weightage: '', status: 'PENDING', remarks: '' }],
  );
  const [message, setMessage] = useState<string | null>(null);

  const total = rows.reduce((sum, row) => sum + (Number(row.weightage) || 0), 0);

  const save = useMutation({
    mutationFn: () =>
      api.put(`/projects/${projectId}/milestones`, {
        milestones: rows
          .filter((row) => row.name.trim())
          .map((row) => ({
            name: row.name,
            plannedDate: row.plannedDate || undefined,
            actualDate: row.actualDate || undefined,
            weightage: Number(row.weightage) || 0,
            status: row.status,
            remarks: row.remarks || undefined,
          })),
      }),
    onSuccess: () => {
      toast.success('Milestones saved', 'Physical progress has been recalculated.');
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      onClose();
    },
    onError: (error: unknown) => {
      setMessage(error instanceof ApiError ? error.message : 'Could not save the milestones.');
    },
  });

  const update = (index: number, key: keyof MilestoneDraft, value: string) => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };

  return (
    <Modal
      open
      title="Milestones"
      subtitle="Weightage across all milestones must total exactly 100%."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <span style={{ marginRight: 'auto', fontWeight: 600, color: total === 100 ? 'var(--ok-fg)' : 'var(--warn-fg)' }}>
            Total weightage: {total}% {total === 100 ? '✓' : `(needs ${100 - total > 0 ? `${100 - total}% more` : `${total - 100}% less`})`}
          </span>
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={total !== 100}
            onClick={() => { setMessage(null); save.mutate(); }}
          >
            Save milestones
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        {rows.map((row, index) => (
          <fieldset className="fieldset" key={index}>
            <legend className="fieldset__legend">Milestone {index + 1}</legend>
            <div className="form-grid">
              <TextInput
                label="Description" required full value={row.name}
                onChange={(event) => update(index, 'name', event.target.value)}
                placeholder="e.g. Earthwork and subgrade preparation"
              />
              <TextInput
                label="Planned date" type="date" value={row.plannedDate}
                onChange={(event) => update(index, 'plannedDate', event.target.value)}
              />
              <TextInput
                label="Actual date" type="date" value={row.actualDate}
                onChange={(event) => update(index, 'actualDate', event.target.value)}
              />
              <TextInput
                label="Weightage %" required numeric inputMode="numeric" value={row.weightage}
                onChange={(event) => update(index, 'weightage', event.target.value)}
              />
              <Select
                label="Status" value={row.status}
                onChange={(event) => update(index, 'status', event.target.value)}
                options={[
                  { value: 'PENDING', label: 'Pending' },
                  { value: 'IN_PROGRESS', label: 'In progress' },
                  { value: 'COMPLETED', label: 'Completed' },
                  { value: 'DELAYED', label: 'Delayed' },
                ]}
              />
            </div>
            {rows.length > 1 && (
              <div style={{ marginTop: 10 }}>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
                >
                  Remove this milestone
                </Button>
              </div>
            )}
          </fieldset>
        ))}

        <Button
          icon={<PlusIcon />}
          onClick={() =>
            setRows((current) => [
              ...current,
              { name: '', plannedDate: '', actualDate: '', weightage: '', status: 'PENDING', remarks: '' },
            ])
          }
        >
          Add another milestone
        </Button>
      </div>
    </Modal>
  );
}
