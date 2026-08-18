import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, rupees, rupeesShort } from '../lib/format';
import type { LookupOption, Project } from '../types';
import {
  Alert, Button, Card, PageHeader, PlusIcon, Progress, Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';

const PROJECT_STATUSES = [
  'DRAFT', 'PENDING_SANCTION', 'SANCTIONED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'REJECTED',
];

export function ProjectsPage() {
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const canCreate = hasRole('ADMIN', 'CE', 'SE', 'EE', 'AEE', 'AE');

  const { data, isLoading } = useQuery({
    queryKey: ['projects', search, status, page],
    queryFn: () =>
      api.get<Page<Project>>('/projects', {
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
        title="Projects"
        subtitle="Every sanctioned and proposed work in your jurisdiction."
        actions={
          canCreate ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              New project
            </Button>
          ) : undefined
        }
      />

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="project-search">Search</label>
            <input
              id="project-search"
              type="search"
              className="input"
              placeholder="Project name, code or sanction number"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={PROJECT_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/projects/${row.id}`)}
          caption="Projects"
          columns={[
            {
              key: 'project',
              header: 'Project',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.name}</div>
                  <div className="cell-muted code">{row.projectCode}</div>
                </>
              ),
            },
            {
              key: 'scheme',
              header: 'Scheme / division',
              render: (row) => (
                <>
                  <div>{row.scheme.code}</div>
                  <div className="cell-muted">{row.location.divisionName}</div>
                </>
              ),
            },
            {
              key: 'cost',
              header: 'Sanctioned',
              numeric: true,
              render: (row) => (
                <>
                  <div>{rupeesShort(row.sanctionedCost || row.estimatedCost)}</div>
                  {!row.sanctionedCost && <div className="cell-muted">Estimate</div>}
                </>
              ),
            },
            {
              key: 'paid',
              header: 'Paid',
              numeric: true,
              render: (row) => rupeesShort(row.paidAmount),
            },
            {
              key: 'progress',
              header: 'Physical progress',
              width: '150px',
              render: (row) => <Progress value={row.physicalProgress} label={`${row.name} progress`} />,
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: 'No projects found',
            text: search || status
              ? 'Try clearing the filters above.'
              : 'Create the first project to begin.',
            action: canCreate && !search && !status
              ? <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>New project</Button>
              : undefined,
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

      {creating && (
        <ProjectFormModal
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/projects/${id}`)}
        />
      )}
    </>
  );
}

/* ==========================================================================
   Create form
   ========================================================================== */

interface ProjectFormState {
  name: string;
  description: string;
  schemeId: string;
  workTypeId: string;
  projectCategoryId: string;
  zoneId: string;
  circleId: string;
  divisionId: string;
  subDivisionId: string;
  districtId: string;
  townId: string;
  estimatedCost: string;
  sanctionNo: string;
  sanctionDate: string;
  targetCompletionDate: string;
}

const EMPTY_FORM: ProjectFormState = {
  name: '', description: '', schemeId: '', workTypeId: '', projectCategoryId: '',
  zoneId: '', circleId: '', divisionId: '', subDivisionId: '', districtId: '', townId: '',
  estimatedCost: '', sanctionNo: '', sanctionDate: '', targetCompletionDate: '',
};

export function ProjectFormModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<ProjectFormState>({
    ...EMPTY_FORM,
    zoneId: user?.zoneId ? String(user.zoneId) : '',
    circleId: user?.circleId ? String(user.circleId) : '',
    divisionId: user?.divisionId ? String(user.divisionId) : '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof ProjectFormState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const value = event.target.value;
    setForm((prev) => {
      const next = { ...prev, [key]: value };
      // Clearing a parent must clear the children below it in the hierarchy.
      if (key === 'zoneId') { next.circleId = ''; next.divisionId = ''; next.subDivisionId = ''; }
      if (key === 'circleId') { next.divisionId = ''; next.subDivisionId = ''; }
      if (key === 'divisionId') { next.subDivisionId = ''; }
      if (key === 'districtId') { next.townId = ''; }
      return next;
    });
  };

  const schemes = useLookup('schemes');
  const workTypes = useLookup('work-types');
  const categories = useLookup('project-categories');
  const zones = useLookup('zones');
  const circles = useLookup('circles', form.zoneId);
  const divisions = useLookup('divisions', form.circleId);
  const subDivisions = useLookup('sub-divisions', form.divisionId);
  const districts = useLookup('districts');
  const towns = useLookup('towns', form.districtId);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Project>('/projects', {
        name: form.name,
        description: form.description || undefined,
        schemeId: Number(form.schemeId),
        workTypeId: Number(form.workTypeId),
        projectCategoryId: Number(form.projectCategoryId),
        zoneId: Number(form.zoneId),
        circleId: Number(form.circleId),
        divisionId: Number(form.divisionId),
        subDivisionId: form.subDivisionId ? Number(form.subDivisionId) : undefined,
        districtId: form.districtId ? Number(form.districtId) : undefined,
        townId: form.townId ? Number(form.townId) : undefined,
        estimatedCost: form.estimatedCost,
        sanctionNo: form.sanctionNo || undefined,
        sanctionDate: form.sanctionDate || undefined,
        targetCompletionDate: form.targetCompletionDate || undefined,
      }),
    onSuccess: (project) => {
      toast.success('Project created', `${project.projectCode} is saved as a draft.`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      onCreated(project.id);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not create the project.');
      }
    },
  });

  const toOptions = (rows: LookupOption[] | undefined) =>
    (rows ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }));

  return (
    <Modal
      open
      title="New project"
      subtitle="The project code is generated automatically and never changes afterwards."
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
            Create project
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Identification</legend>
          <div className="form-grid">
            <TextInput
              label="Project name"
              required
              full
              value={form.name}
              onChange={set('name')}
              error={errors.name}
              placeholder="e.g. Widening of the Kalburgi ring road, Phase II"
              maxLength={250}
            />
            <TextArea
              label="Scope description"
              full
              value={form.description}
              onChange={set('description')}
              error={errors.description}
              hint="Briefly describe what the work covers."
              rows={3}
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Classification</legend>
          <div className="form-grid">
            <Select
              label="Scheme" required value={form.schemeId} onChange={set('schemeId')}
              placeholder="Select the funding scheme" options={toOptions(schemes.data)}
              error={errors.schemeId}
            />
            <Select
              label="Work type" required value={form.workTypeId} onChange={set('workTypeId')}
              placeholder="Select the type of work" options={toOptions(workTypes.data)}
              error={errors.workTypeId}
            />
            <Select
              label="Project category" required value={form.projectCategoryId}
              onChange={set('projectCategoryId')} placeholder="Select the size band"
              options={toOptions(categories.data)} error={errors.projectCategoryId}
              hint="Determines which authority sanctions the work."
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Jurisdiction</legend>
          <div className="form-grid">
            <Select
              label="Zone" required value={form.zoneId} onChange={set('zoneId')}
              placeholder="Select a zone" options={toOptions(zones.data)} error={errors.zoneId}
            />
            <Select
              label="Circle" required value={form.circleId} onChange={set('circleId')}
              placeholder={form.zoneId ? 'Select a circle' : 'Select a zone first'}
              options={toOptions(circles.data)} disabled={!form.zoneId} error={errors.circleId}
            />
            <Select
              label="Division" required value={form.divisionId} onChange={set('divisionId')}
              placeholder={form.circleId ? 'Select a division' : 'Select a circle first'}
              options={toOptions(divisions.data)} disabled={!form.circleId} error={errors.divisionId}
            />
            <Select
              label="Sub division" value={form.subDivisionId} onChange={set('subDivisionId')}
              placeholder={form.divisionId ? 'Optional' : 'Select a division first'}
              options={toOptions(subDivisions.data)} disabled={!form.divisionId}
            />
            <Select
              label="District" value={form.districtId} onChange={set('districtId')}
              placeholder="Select a district" options={toOptions(districts.data)}
            />
            <Select
              label="Town / city" value={form.townId} onChange={set('townId')}
              placeholder={form.districtId ? 'Optional' : 'Select a district first'}
              options={toOptions(towns.data)} disabled={!form.districtId}
              hint="Used in the generated project code."
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Cost and sanction</legend>
          <div className="form-grid">
            <TextInput
              label="Estimated cost" required prefix="₹" numeric inputMode="decimal"
              value={form.estimatedCost} onChange={set('estimatedCost')} error={errors.estimatedCost}
              placeholder="0.00" hint="In rupees, up to two decimals."
            />
            <TextInput
              label="Sanction number" value={form.sanctionNo} onChange={set('sanctionNo')}
              error={errors.sanctionNo} placeholder="e.g. GO/PWD/2026/0412"
              hint="If the government order is already issued."
            />
            <TextInput
              label="Sanction date" type="date" value={form.sanctionDate}
              onChange={set('sanctionDate')} error={errors.sanctionDate}
            />
            <TextInput
              label="Target completion" type="date" value={form.targetCompletionDate}
              onChange={set('targetCompletionDate')} error={errors.targetCompletionDate}
            />
          </div>
        </fieldset>

        <Alert variant="info">
          The project is created as a <strong>draft</strong>. Send it for administrative sanction from the
          project page once the details are complete.
        </Alert>
      </div>
    </Modal>
  );
}

/** Small read-only summary card reused on the package and bill screens. */
export function ProjectSummaryCard({ project }: { project: Project }) {
  return (
    <Card
      title={project.name}
      subtitle={<span className="code">{project.projectCode}</span>}
      actions={<StatusBadge status={project.status} />}
    >
      <div className="detail-grid">
        <div className="detail-item">
          <div className="detail-item__label">Scheme</div>
          <div className="detail-item__value">{project.scheme.name}</div>
        </div>
        <div className="detail-item">
          <div className="detail-item__label">Division</div>
          <div className="detail-item__value">{project.location.divisionName}</div>
        </div>
        <div className="detail-item">
          <div className="detail-item__label">Sanctioned cost</div>
          <div className="detail-item__value detail-item__value--strong">
            {rupees(project.sanctionedCost || project.estimatedCost)}
          </div>
        </div>
        <div className="detail-item">
          <div className="detail-item__label">Target completion</div>
          <div className="detail-item__value">{date(project.targetCompletionDate)}</div>
        </div>
      </div>
      <div style={{ marginTop: 14 }}>
        <Link to={`/projects/${project.id}`} className="btn btn--sm">Open project</Link>
      </div>
    </Card>
  );
}
