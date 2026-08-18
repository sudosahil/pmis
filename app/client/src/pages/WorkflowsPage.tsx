import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { dateTime, humanise } from '../lib/format';
import type { WorkflowDefinitionView } from '../types';
import {
  Alert, Button, Card, Checkbox, EditIcon, Loading, PageHeader, PlusIcon, Select, TextArea,
  TextInput, TrashIcon,
} from '../components/ui';
import { ConfirmModal, Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

const SCOPES = [
  { value: 'DIVISION', label: 'Same division' },
  { value: 'CIRCLE', label: 'Same circle' },
  { value: 'ZONE', label: 'Same zone' },
  { value: 'GLOBAL', label: 'Head office' },
];

const SCOPE_LABELS: Record<string, string> = Object.fromEntries(
  SCOPES.map((scope) => [scope.value, scope.label]),
);

const ENTITY_TYPES = [
  { value: 'PROJECT', label: 'Project sanction' },
  { value: 'TENDER', label: 'Tender approval' },
  { value: 'RA_BILL', label: 'Running account bill' },
  { value: 'MISC_BILL', label: 'Miscellaneous bill' },
  { value: 'CONTRACTOR', label: 'Contractor registration' },
  { value: 'LOC', label: 'Letter of credit' },
];

interface StepDraft {
  key: number;
  code: string;
  name: string;
  roleCode: string;
  scope: string;
  slaDays: string;
  allowReturn: boolean;
  allowReject: boolean;
}

let nextKey = 1;

function blankStep(): StepDraft {
  return {
    key: nextKey++,
    code: '',
    name: '',
    roleCode: 'EE',
    scope: 'DIVISION',
    slaDays: '3',
    allowReturn: true,
    allowReject: true,
  };
}

function toDraft(step: WorkflowDefinitionView['steps'][number]): StepDraft {
  return {
    key: nextKey++,
    code: step.code,
    name: step.name,
    roleCode: step.roleCode,
    scope: step.scope,
    slaDays: String(step.slaDays),
    allowReturn: step.allowReturn,
    allowReject: step.allowReject,
  };
}

export function WorkflowsPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');

  const [creating, setCreating] = useState(false);
  const [editingSteps, setEditingSteps] = useState<WorkflowDefinitionView | null>(null);
  const [editingDetails, setEditingDetails] = useState<WorkflowDefinitionView | null>(null);
  const [deleting, setDeleting] = useState<WorkflowDefinitionView | null>(null);
  const [historyOf, setHistoryOf] = useState<WorkflowDefinitionView | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workflow-definitions'],
    queryFn: () => api.get<WorkflowDefinitionView[]>('/approvals/definitions'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/approvals/definitions/${id}`),
    onSuccess: () => {
      toast.success('Approval chain deleted');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['workflow-definitions'] });

  return (
    <>
      <PageHeader
        title="Approval chains"
        subtitle="The order in which each kind of file moves, and which post acts at every stage."
        actions={
          canEdit ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              New chain
            </Button>
          ) : undefined
        }
      />

      {canEdit ? (
        <Alert variant="info" title="Editing a chain never disturbs a file already moving">
          Changing the steps of a chain that has files in flight does not rewrite it. The current
          version is kept, with its files, and a new version takes over for everything raised from
          then on. When nothing is in flight the chain is simply edited in place.
        </Alert>
      ) : (
        <Alert variant="info" title="Reference only">
          These chains are configured by the system administrator. A file always follows the chain
          that was in force when it was raised.
        </Alert>
      )}

      {isLoading ? (
        <Loading label="Loading the approval chains…" />
      ) : (
        <div className="stack">
          {(data ?? []).map((definition) => (
            <Card
              key={definition.id}
              title={definition.name}
              subtitle={definition.description ?? `Applies to ${humanise(definition.entityType)} records.`}
              actions={
                <div className="row">
                  <span className="code">{definition.code}</span>
                  <span className="badge badge--neutral">v{definition.version}</span>
                  <StatusBadge status={definition.status} />
                  {canEdit && (
                    <div className="btn-group">
                      <Button size="sm" icon={<EditIcon />} onClick={() => setEditingDetails(definition)}>
                        Rename
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => setEditingSteps(definition)}>
                        Edit steps
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setHistoryOf(definition)}>
                        History
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<TrashIcon />}
                        onClick={() => setDeleting(definition)}
                        aria-label="Delete chain"
                      />
                    </div>
                  )}
                </div>
              }
            >
              {definition.inFlightCount > 0 && (
                <p style={{ color: 'var(--ink-700)', marginBottom: 10 }}>
                  <strong>{definition.inFlightCount}</strong> file
                  {definition.inFlightCount === 1 ? ' is' : 's are'} moving along this chain right now
                  {canEdit && ', so a change to its steps would create a new version.'}
                </p>
              )}

              <ol className="timeline">
                {definition.steps.map((step) => (
                  <li key={step.id} className="timeline__step timeline__step--pending">
                    <span className="timeline__marker">{step.seq}</span>
                    <div>
                      <div className="timeline__name">{step.name}</div>
                      <div className="timeline__meta">
                        Acted on by <strong>{step.roleCode}</strong>
                        {' · '}
                        {SCOPE_LABELS[step.scope] ?? humanise(step.scope)}
                        {step.slaDays > 0 && ` · ${step.slaDays} day${step.slaDays === 1 ? '' : 's'} to act`}
                      </div>
                      <div className="timeline__meta">
                        {step.allowReturn ? 'May return the file for correction' : 'Cannot return the file'}
                        {' · '}
                        {step.allowReject ? 'May reject outright' : 'Cannot reject'}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}

      {creating && (
        <ChainDialog onClose={() => setCreating(false)} onSaved={() => void refresh()} />
      )}
      {editingSteps && (
        <StepsDialog
          definition={editingSteps}
          onClose={() => setEditingSteps(null)}
          onSaved={() => void refresh()}
        />
      )}
      {editingDetails && (
        <DetailsDialog
          definition={editingDetails}
          onClose={() => setEditingDetails(null)}
          onSaved={() => void refresh()}
        />
      )}
      {historyOf && (
        <HistoryDialog definition={historyOf} onClose={() => setHistoryOf(null)} />
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete this approval chain?"
        message={
          <p>
            <strong>{deleting?.name}</strong> will be removed. A chain that has ever carried a file
            cannot be deleted — set it to Inactive instead, which stops new files using it while
            keeping its history readable.
          </p>
        }
        confirmLabel="Delete chain"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** The step grid, shared by the create and edit dialogs. */
function StepEditor({
  steps, setSteps, roles,
}: {
  steps: StepDraft[];
  setSteps: (updater: (current: StepDraft[]) => StepDraft[]) => void;
  roles: { code: string; name: string }[];
}) {
  function update(index: number, patch: Partial<StepDraft>) {
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className="table-wrap">
      <table className="table table--compact">
        <caption className="visually-hidden">Steps in this approval chain</caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: 40 }}>#</th>
            <th scope="col" style={{ width: 150 }}>Step code</th>
            <th scope="col">Shown on the file as</th>
            <th scope="col" style={{ width: 110 }}>Acted on by</th>
            <th scope="col" style={{ width: 150 }}>Whose jurisdiction</th>
            <th scope="col" style={{ width: 90 }}>Days</th>
            <th scope="col" style={{ width: 170 }}>May</th>
            <th scope="col" style={{ width: 110 }}>Order</th>
          </tr>
        </thead>
        <tbody>
          {steps.map((step, index) => (
            <tr key={step.key}>
              <td>{index + 1}</td>
              <td>
                <label className="visually-hidden" htmlFor={`code-${step.key}`}>Code of step {index + 1}</label>
                <input
                  id={`code-${step.key}`}
                  className="input"
                  value={step.code}
                  onChange={(event) => update(index, { code: event.target.value.toUpperCase() })}
                  placeholder="DIV_SANCTION"
                  maxLength={40}
                />
              </td>
              <td>
                <label className="visually-hidden" htmlFor={`name-${step.key}`}>Name of step {index + 1}</label>
                <input
                  id={`name-${step.key}`}
                  className="input"
                  value={step.name}
                  onChange={(event) => update(index, { name: event.target.value })}
                  placeholder="Divisional Sanction (EE)"
                  maxLength={120}
                />
              </td>
              <td>
                <label className="visually-hidden" htmlFor={`role-${step.key}`}>Role for step {index + 1}</label>
                <select
                  id={`role-${step.key}`}
                  className="select"
                  value={step.roleCode}
                  onChange={(event) => update(index, { roleCode: event.target.value })}
                >
                  {roles.map((role) => (
                    <option key={role.code} value={role.code}>{role.code}</option>
                  ))}
                </select>
              </td>
              <td>
                <label className="visually-hidden" htmlFor={`scope-${step.key}`}>Scope of step {index + 1}</label>
                <select
                  id={`scope-${step.key}`}
                  className="select"
                  value={step.scope}
                  onChange={(event) => update(index, { scope: event.target.value })}
                >
                  {SCOPES.map((scope) => (
                    <option key={scope.value} value={scope.value}>{scope.label}</option>
                  ))}
                </select>
              </td>
              <td>
                <label className="visually-hidden" htmlFor={`sla-${step.key}`}>Days to act on step {index + 1}</label>
                <input
                  id={`sla-${step.key}`}
                  type="number"
                  min="0"
                  max="365"
                  className="input input--number"
                  value={step.slaDays}
                  onChange={(event) => update(index, { slaDays: event.target.value })}
                />
              </td>
              <td>
                <Checkbox
                  label="Return"
                  checked={step.allowReturn}
                  onChange={(event) => update(index, { allowReturn: event.target.checked })}
                />
                <Checkbox
                  label="Reject"
                  checked={step.allowReject}
                  onChange={(event) => update(index, { allowReject: event.target.checked })}
                />
              </td>
              <td>
                <div className="btn-group">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, -1)}
                    disabled={index === 0}
                    aria-label={`Move step ${index + 1} earlier`}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => move(index, 1)}
                    disabled={index === steps.length - 1}
                    aria-label={`Move step ${index + 1} later`}
                  >
                    ↓
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<TrashIcon />}
                    onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                    disabled={steps.length === 1}
                    aria-label={`Remove step ${index + 1}`}
                  />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function useStaffRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<{ code: string; name: string }[]>('/auth/roles'),
    select: (roles) => roles.filter((role) => role.code !== 'CONTRACTOR'),
    staleTime: 30 * 60 * 1000,
  });
}

function validateSteps(steps: StepDraft[]): string | null {
  const codes = new Set<string>();
  for (const [index, step] of steps.entries()) {
    const line = index + 1;
    if (!/^[A-Z0-9_]{2,40}$/.test(step.code)) {
      return `Step ${line}: the code must be capitals, digits or underscores, e.g. DIV_SANCTION.`;
    }
    if (codes.has(step.code)) return `Step ${line}: the code "${step.code}" is used twice.`;
    codes.add(step.code);
    if (step.name.trim().length < 2) return `Step ${line}: name the step as it should read on the file.`;
  }
  return null;
}

function toPayload(steps: StepDraft[]) {
  return steps.map((step) => ({
    code: step.code,
    name: step.name.trim(),
    roleCode: step.roleCode,
    scope: step.scope,
    slaDays: Number(step.slaDays) || 0,
    allowReturn: step.allowReturn,
    allowReject: step.allowReject,
  }));
}

function ChainDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const roles = useStaffRoles();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [entityType, setEntityType] = useState('PROJECT');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([blankStep()]);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<WorkflowDefinitionView>('/approvals/definitions', {
        code,
        name,
        entityType,
        description: description || undefined,
        steps: toPayload(steps),
      }),
    onSuccess: (definition) => {
      toast.success('Approval chain created', `${definition.code} is in force from now on.`);
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not create the chain.'),
  });

  function save() {
    const problem = validateSteps(steps);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    mutation.mutate();
  }

  return (
    <Modal
      open
      title="New approval chain"
      subtitle="Every file of the chosen kind raised from now on will follow this chain."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!code.trim() || !name.trim()}
            onClick={save}
          >
            Create chain
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Chain code"
            required
            value={code}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value.toUpperCase())}
            hint="Capitals, digits and underscores. Cannot be changed later."
            placeholder="LOC_APPROVAL"
            maxLength={40}
          />
          <TextInput
            label="Chain name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Letter of Credit Approval"
          />
          <Select
            label="Applies to"
            required
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
            hint="Which kind of record this chain carries."
            options={ENTITY_TYPES}
          />
          <TextArea
            label="Description"
            full
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>

        <div className="row row--between">
          <strong>Steps</strong>
          <Button size="sm" icon={<PlusIcon />} onClick={() => setSteps((current) => [...current, blankStep()])}>
            Add step
          </Button>
        </div>
        <StepEditor steps={steps} setSteps={setSteps} roles={roles.data ?? []} />
      </div>
    </Modal>
  );
}

function StepsDialog({
  definition, onClose, onSaved,
}: {
  definition: WorkflowDefinitionView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const roles = useStaffRoles();
  const [steps, setSteps] = useState<StepDraft[]>(definition.steps.map(toDraft));
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.put<WorkflowDefinitionView>(`/approvals/definitions/${definition.id}/steps`, {
        steps: toPayload(steps),
      }),
    onSuccess: (saved) => {
      if (saved.version > definition.version) {
        toast.success(
          `Version ${saved.version} is now in force`,
          `${definition.inFlightCount} file(s) already moving continue on version ${definition.version}.`,
        );
      } else {
        toast.success('Steps saved', 'The chain has been updated in place.');
      }
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the steps.'),
  });

  function save() {
    const problem = validateSteps(steps);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    mutation.mutate();
  }

  return (
    <Modal
      open
      title={`Edit steps — ${definition.name}`}
      subtitle={`${definition.code} · version ${definition.version}`}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={save}>
            {definition.editsInPlace ? 'Save steps' : `Publish version ${definition.version + 1}`}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        {definition.editsInPlace ? (
          <Alert variant="info" title="Nothing is in flight on this chain">
            It will be edited in place and stay at version {definition.version}.
          </Alert>
        ) : (
          <Alert variant="warn" title={`${definition.inFlightCount} file(s) are moving on this chain`}>
            Saving publishes version {definition.version + 1}. Those files finish on version{' '}
            {definition.version} exactly as they started, and everything raised afterwards uses the
            new one.
          </Alert>
        )}

        <div className="row row--between">
          <strong>Steps in order</strong>
          <Button size="sm" icon={<PlusIcon />} onClick={() => setSteps((current) => [...current, blankStep()])}>
            Add step
          </Button>
        </div>
        <StepEditor steps={steps} setSteps={setSteps} roles={roles.data ?? []} />
      </div>
    </Modal>
  );
}

function DetailsDialog({
  definition, onClose, onSaved,
}: {
  definition: WorkflowDefinitionView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(definition.name);
  const [description, setDescription] = useState(definition.description ?? '');
  const [status, setStatus] = useState(definition.status);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<WorkflowDefinitionView>(`/approvals/definitions/${definition.id}`, {
        name,
        description: description || null,
        status,
      }),
    onSuccess: () => {
      toast.success('Chain updated');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the changes.'),
  });

  return (
    <Modal
      open
      title="Rename chain"
      subtitle={`${definition.code} · version ${definition.version}. Labels only — the steps are unaffected.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => { setMessage(null); mutation.mutate(); }}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <TextInput label="Chain name" required value={name} onChange={(event) => setName(event.target.value)} />
        <TextArea
          label="Description"
          full
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          hint="An inactive chain carries no new files, but the ones already on it finish normally."
          options={[
            { value: 'ACTIVE', label: 'Active' },
            { value: 'INACTIVE', label: 'Inactive' },
          ]}
        />
      </div>
    </Modal>
  );
}

function HistoryDialog({
  definition, onClose,
}: {
  definition: WorkflowDefinitionView;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['workflow-definitions', 'history', definition.id],
    queryFn: () => api.get<WorkflowDefinitionView[]>(`/approvals/definitions/${definition.id}/history`),
  });

  return (
    <Modal
      open
      title={`History — ${definition.name}`}
      subtitle="Every version this chain has had, and what is still moving on each."
      size="wide"
      onClose={onClose}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      {isLoading ? (
        <Loading />
      ) : (
        <div className="stack">
          {(data ?? []).map((version) => (
            <Card
              key={version.id}
              title={`Version ${version.version}`}
              subtitle={
                version.isCurrent
                  ? `In force since ${dateTime(version.createdAt)}`
                  : `Superseded ${dateTime(version.supersededAt)}`
              }
              actions={
                <span className={`badge badge--${version.isCurrent ? 'ok' : 'neutral'}`}>
                  {version.isCurrent ? 'Current' : 'Superseded'}
                </span>
              }
            >
              <p style={{ color: 'var(--ink-700)', marginBottom: 8 }}>
                {version.totalInstances} file{version.totalInstances === 1 ? '' : 's'} raised on this
                version, {version.inFlightCount} still moving.
              </p>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {version.steps.map((step) => (
                  <li key={step.id} style={{ marginBottom: 4 }}>
                    {step.name} — <strong>{step.roleCode}</strong>,{' '}
                    {SCOPE_LABELS[step.scope] ?? humanise(step.scope)}
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}
