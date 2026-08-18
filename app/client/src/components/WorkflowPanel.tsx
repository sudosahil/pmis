import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { dateTime, humanise, initials, relativeTime, rupees } from '../lib/format';
import type { User, WorkflowActionType, WorkflowView } from '../types';
import { Alert, Button, Card, CheckIcon, DetailItem, Select, TextArea } from './ui';
import { StatusBadge } from './StatusBadge';
import { Modal } from './Modal';
import { useToast } from './Toast';

const ACTION_LABEL: Record<WorkflowActionType, string> = {
  SUBMIT: 'Submit',
  APPROVE: 'Approve and forward',
  REJECT: 'Reject',
  RETURN: 'Return for correction',
  ASSIGN: 'Assign to an officer',
  CANCEL: 'Withdraw',
};

const ACTION_HELP: Record<string, string> = {
  APPROVE: 'The file moves to the next officer in the chain. If this is the last step it is finally approved.',
  REJECT: 'The file is closed as rejected and cannot move further. Record a clear reason.',
  RETURN: 'The file goes back to an earlier officer for correction and stays alive.',
  ASSIGN: 'The file stays at this step but is pinned to one named officer.',
  CANCEL: 'Withdraws the file from approval entirely. Only the originator can do this.',
};

/**
 * The approval panel shown on every approvable record: where the file sits,
 * who has handled it, and what the current user may do about it.
 */
export function WorkflowPanel({
  workflow, onActed,
}: {
  workflow: WorkflowView | null;
  onActed?: () => void;
}) {
  const [action, setAction] = useState<WorkflowActionType | null>(null);

  if (!workflow) {
    return (
      <Card title="Approval">
        <Alert variant="info" title="Not yet submitted">
          This record has not entered an approval chain. Submit it to start the workflow.
        </Alert>
      </Card>
    );
  }

  const { instance, steps, history, availableActions } = workflow;
  const overdue = Boolean(
    instance.dueAt && instance.status === 'IN_PROGRESS' && new Date(`${instance.dueAt.replace(' ', 'T')}Z`) < new Date(),
  );

  return (
    <>
      <Card
        title="Approval"
        subtitle={instance.definitionName}
        actions={<StatusBadge status={instance.status} />}
      >
        <div className="stack">
          {instance.status === 'IN_PROGRESS' && (
            <Alert variant={overdue ? 'warn' : 'info'} title={`Pending with ${instance.assignedRole ?? '—'}`}>
              <div>
                Currently at step <strong>{instance.currentStepName}</strong>
                {instance.assignedUserName ? <> — assigned to <strong>{instance.assignedUserName}</strong></> : null}.
                {instance.dueAt && (
                  <> Due {relativeTime(instance.dueAt)} ({dateTime(instance.dueAt)}).</>
                )}
              </div>
            </Alert>
          )}

          {instance.status === 'APPROVED' && (
            <Alert variant="ok" title="Fully approved">
              All approval stages completed on {dateTime(instance.completedAt)}.
            </Alert>
          )}

          {instance.status === 'REJECTED' && (
            <Alert variant="danger" title="Rejected">
              {history.find((h) => h.action === 'REJECT')?.remarks ?? 'This record was rejected.'}
            </Alert>
          )}

          {availableActions.length > 0 && (
            <div className="btn-group">
              {availableActions.map((available) => (
                <Button
                  key={available}
                  variant={
                    available === 'APPROVE' ? 'success' :
                    available === 'REJECT' ? 'danger' : 'default'
                  }
                  icon={available === 'APPROVE' ? <CheckIcon /> : undefined}
                  onClick={() => setAction(available)}
                >
                  {ACTION_LABEL[available]}
                </Button>
              ))}
            </div>
          )}

          <div className="detail-grid">
            <DetailItem label="Reference" value={<span className="code">{instance.entityRef}</span>} />
            <DetailItem label="Amount" value={instance.amount > 0 ? rupees(instance.amount) : '—'} />
            <DetailItem label="Raised on" value={dateTime(instance.createdAt)} />
          </div>

          <div>
            <h3 className="card__title" style={{ marginBottom: 12 }}>Approval chain</h3>
            <ol className="timeline">
              {steps.map((step) => (
                <li key={step.stepId} className={`timeline__step timeline__step--${step.state.toLowerCase()}`}>
                  <span className="timeline__marker">
                    {step.state === 'DONE' ? <CheckIcon size={14} /> : step.seq}
                  </span>
                  <div>
                    <div className="timeline__name">{step.name}</div>
                    <div className="timeline__meta">
                      {step.roleCode}
                      {step.state === 'CURRENT' && ' — pending now'}
                      {step.state === 'SKIPPED' && ' — not reached'}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </Card>

      <Card title="File movement" subtitle={`${history.length} action${history.length === 1 ? '' : 's'} recorded`}>
        <div className="history">
          {history.map((entry) => (
            <div key={entry.id} className="history__item">
              <span className="history__avatar">{initials(entry.actorName)}</span>
              <div style={{ minWidth: 0 }}>
                <div className="history__head">
                  <span className="history__actor">{entry.actorName ?? 'System'}</span>
                  <StatusBadge status={entry.action} showDot={false} />
                  <span className="history__time">{dateTime(entry.createdAt)}</span>
                </div>
                <div className="timeline__meta">
                  {entry.actorRole ? `${entry.actorRole} · ` : ''}{entry.stepName}
                </div>
                {entry.remarks && <p className="history__remarks">{entry.remarks}</p>}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {action && (
        <ActionDialog
          workflow={workflow}
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setAction(null);
            onActed?.();
          }}
        />
      )}
    </>
  );
}

function ActionDialog({
  workflow, action, onClose, onDone,
}: {
  workflow: WorkflowView;
  action: WorkflowActionType;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [remarks, setRemarks] = useState('');
  const [assignToUserId, setAssignToUserId] = useState('');
  const [returnToStepId, setReturnToStepId] = useState(
    workflow.returnTargets.length ? String(workflow.returnTargets[workflow.returnTargets.length - 1]!.stepId) : '',
  );
  const [error, setError] = useState<string | null>(null);

  // The assignee list is only needed for ASSIGN, so it is fetched lazily.
  const officers = useQuery({
    queryKey: ['users', 'by-role', workflow.instance.assignedRole],
    queryFn: () => api.get<User[]>('/users/by-role', { roleCode: workflow.instance.assignedRole ?? '' }),
    enabled: action === 'ASSIGN' && Boolean(workflow.instance.assignedRole),
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (action === 'CANCEL') {
        return api.post(`/approvals/${workflow.instance.id}/cancel`, { remarks });
      }
      return api.post(`/approvals/${workflow.instance.id}/action`, {
        action,
        remarks: remarks || undefined,
        assignToUserId: assignToUserId ? Number(assignToUserId) : undefined,
        returnToStepId: action === 'RETURN' && returnToStepId ? Number(returnToStepId) : undefined,
      });
    },
    onSuccess: () => {
      toast.success(
        action === 'APPROVE' ? 'Approved' :
        action === 'REJECT' ? 'Rejected' :
        action === 'RETURN' ? 'Returned for correction' :
        action === 'ASSIGN' ? 'Assigned' : 'Withdrawn',
        action === 'APPROVE' ? 'The file has moved to the next stage.' : undefined,
      );
      void queryClient.invalidateQueries();
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Could not complete the action.');
    },
  });

  const remarksRequired = action === 'REJECT' || action === 'RETURN' || action === 'CANCEL';

  return (
    <Modal
      open
      title={ACTION_LABEL[action]}
      subtitle={`${workflow.instance.entityRef} — ${workflow.instance.title ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant={action === 'REJECT' ? 'danger' : action === 'APPROVE' ? 'success' : 'primary'}
            loading={mutation.isPending}
            disabled={remarksRequired && remarks.trim().length < 5}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {ACTION_LABEL[action]}
          </Button>
        </>
      }
    >
      <div className="stack">
        {error && <Alert variant="danger" title="Could not complete">{error}</Alert>}
        <Alert variant="info">{ACTION_HELP[action]}</Alert>

        {action === 'ASSIGN' && (
          <Select
            label="Assign to"
            required
            placeholder={officers.isLoading ? 'Loading officers…' : 'Select an officer'}
            value={assignToUserId}
            onChange={(event) => setAssignToUserId(event.target.value)}
            options={(officers.data ?? []).map((officer) => ({
              value: officer.id,
              label: `${officer.fullName} — ${officer.designation ?? officer.roleName}${officer.divisionName ? ` (${officer.divisionName})` : ''}`,
            }))}
            hint="The file stays at this step but only this officer can act on it."
          />
        )}

        {action === 'RETURN' && workflow.returnTargets.length > 0 && (
          <Select
            label="Return to"
            required
            value={returnToStepId}
            onChange={(event) => setReturnToStepId(event.target.value)}
            options={workflow.returnTargets.map((target) => ({
              value: target.stepId,
              label: `${target.name} (${target.roleCode})`,
            }))}
            hint="The file goes back to this stage and continues forward again after correction."
          />
        )}

        <TextArea
          label="Remarks"
          required={remarksRequired}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          placeholder={
            action === 'APPROVE'
              ? 'Optional note recorded against your approval'
              : 'State the reason clearly — it is recorded in the file movement and is auditable'
          }
          rows={4}
          hint={
            remarksRequired
              ? 'Required. At least 5 characters.'
              : 'Optional, but a short note helps the next officer.'
          }
        />

        {action === 'APPROVE' && (
          <p className="field__hint">
            Next stage:{' '}
            <strong>
              {workflow.steps.find((s) => s.seq === (workflow.steps.find((x) => x.state === 'CURRENT')?.seq ?? 0) + 1)
                ?.name ?? 'Final approval — the file completes here.'}
            </strong>
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Compact single-line summary used in list rows. */
export function WorkflowSummary({ workflow }: { workflow: WorkflowView | null }) {
  if (!workflow) return <span className="cell-muted">Not submitted</span>;
  const { instance } = workflow;
  if (instance.status !== 'IN_PROGRESS') return <StatusBadge status={instance.status} />;
  return (
    <span className="cell-muted">
      {instance.currentStepName} · {humanise(instance.assignedRole)}
    </span>
  );
}
