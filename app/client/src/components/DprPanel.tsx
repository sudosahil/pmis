import { useState, type ChangeEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { date, rupees, today } from '../lib/format';
import type { ProjectDpr } from '../types';
import {
  Alert, Button, Card, DetailItem, EditIcon, EmptyState, GavelIcon, LayersIcon, Loading,
  PlusIcon, TextArea, TextInput,
} from './ui';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';
import {
  ConvertToTenderDialog, DprAbstractStrip, DprEstimateDialog, DprEstimateView, DprStaleNotice,
} from './DprEstimate';

/**
 * The Detailed Project Report — the document an Administrative Approval is
 * granted against.
 *
 * Reusing a DPR number creates the next version rather than a duplicate,
 * because a report that comes back for correction returns as a revision and
 * both need to stay on record.
 */
export function DprPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { can } = useAuth();

  const [editing, setEditing] = useState<ProjectDpr | null>(null);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<ProjectDpr | null>(null);
  const [pricing, setPricing] = useState<ProjectDpr | null>(null);
  const [converting, setConverting] = useState<ProjectDpr | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const key = ['project-dprs', projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<ProjectDpr[]>(`/projects/${projectId}/dprs`),
  });

  const canEdit = can('projects.manage');
  const canTender = can('tenders.manage');
  const dprs = data ?? [];

  /** An approved report is a record, and a converted one belongs to its tender. */
  const isEditable = (dpr: ProjectDpr) => dpr.status !== 'APPROVED' && !dpr.tender;

  return (
    <>
      <Card
        title="Detailed Project Report"
        subtitle="The report the administrative approval is granted against."
        actions={
          canEdit ? (
            <Button size="sm" icon={<PlusIcon />} onClick={() => setAdding(true)}>
              New DPR
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <Loading />
        ) : !dprs.length ? (
          <EmptyState
            title="No DPR prepared yet"
            text="Record the Detailed Project Report — its number, cost, scope and the report itself."
          />
        ) : (
          <div className="stack">
            {dprs.map((dpr) => (
              <div
                key={dpr.id}
                style={{
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: '12px 14px',
                }}
              >
                <div className="row row--between">
                  <div>
                    <strong>{dpr.title}</strong>
                    <div style={{ color: 'var(--ink-600)', fontSize: 12.5 }}>
                      <span className="code">{dpr.dprNo}</span> · version {dpr.version}
                      {dpr.submissionDate ? ` · submitted ${date(dpr.submissionDate)}` : ''}
                    </div>
                  </div>
                  <div className="row">
                    <StatusBadge status={dpr.status} />
                    {canEdit && (
                      <div className="btn-group">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<EditIcon />}
                          aria-label="Edit"
                          onClick={() => setEditing(dpr)}
                        />
                        {isEditable(dpr) && (
                          <Button size="sm" icon={<LayersIcon size={14} />} onClick={() => setPricing(dpr)}>
                            {dpr.abstract.isPriced ? 'Edit estimate' : 'Prepare estimate'}
                          </Button>
                        )}
                        {dpr.status !== 'APPROVED' && (
                          <Button size="sm" onClick={() => setDeciding(dpr)}>Record decision</Button>
                        )}
                        {canTender && dpr.status === 'APPROVED' && !dpr.tender && dpr.abstract.isPriced && (
                          <Button
                            size="sm"
                            variant="primary"
                            icon={<GavelIcon size={14} />}
                            onClick={() => setConverting(dpr)}
                          >
                            Convert to tender
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="detail-grid" style={{ marginTop: 10 }}>
                  <DetailItem label="Estimated cost" value={rupees(dpr.estimatedCost)} />
                  <DetailItem label="Prepared by" value={dpr.preparedBy} />
                  <DetailItem label="Consultant" value={dpr.consultant} />
                  <DetailItem
                    label="Decision"
                    value={
                      dpr.approvalDate
                        ? `${dpr.approvedBy ?? '—'} · ${date(dpr.approvalDate)}`
                        : null
                    }
                  />
                </div>

                <DprAbstractStrip dpr={dpr} />

                {dpr.tender && (
                  <Alert variant="ok" title="Converted into a tender document">
                    The estimate became the bill of quantities of{' '}
                    <Link to={`/tenders/${dpr.tender.id}`} className="code">{dpr.tender.tenderNo}</Link>
                    , and the Schedule of Rates lines behind it became the bidding ceiling. A change
                    from here means a revision of the report, raised under the same DPR number.
                  </Alert>
                )}

                {dpr.abstract.isPriced && (
                  <DprStaleNotice projectId={projectId} dpr={dpr} canEdit={canEdit} />
                )}

                {dpr.status === 'APPROVED' && !dpr.abstract.isPriced && (
                  <Alert variant="warn" title="This report carries no item-wise estimate">
                    It cannot be converted into a tender document until it is priced against the
                    Schedule of Rates — a tender needs a bill of quantities and a bidding ceiling,
                    and both come from the estimate.
                  </Alert>
                )}

                {dpr.scope && (
                  <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>
                    <strong>Scope. </strong>{dpr.scope}
                  </p>
                )}
                {dpr.justification && (
                  <p style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
                    <strong>Justification. </strong>{dpr.justification}
                  </p>
                )}
                {dpr.remarks && (
                  <p style={{ marginTop: 6, color: 'var(--ink-700)' }}>{dpr.remarks}</p>
                )}

                {dpr.abstract.isPriced && (
                  <div style={{ marginTop: 10 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpanded(expanded === dpr.id ? null : dpr.id)}
                      aria-expanded={expanded === dpr.id}
                    >
                      {expanded === dpr.id ? 'Hide the estimate' : `Show the estimate (${dpr.abstract.itemCount} items)`}
                    </Button>
                    {expanded === dpr.id && (
                      <div style={{ marginTop: 8 }}>
                        <DprEstimateView projectId={projectId} dprId={dpr.id} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {(adding || editing) && (
        <DprDialog
          projectId={projectId}
          dpr={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      )}
      {deciding && (
        <DecisionDialog
          projectId={projectId}
          dpr={deciding}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            toast.success('Decision recorded');
            void queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {pricing && (
        <DprEstimateDialog
          projectId={projectId}
          dpr={pricing}
          onClose={() => setPricing(null)}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: key });
            void queryClient.invalidateQueries({ queryKey: ['dpr-estimate', pricing.id] });
          }}
        />
      )}
      {converting && (
        <ConvertToTenderDialog
          dpr={converting}
          onClose={() => setConverting(null)}
          onConverted={(tenderId) => {
            toast.success(
              'Tender document created',
              'Add the pre-qualification and technical criteria before sending it for approval.',
            );
            void queryClient.invalidateQueries({ queryKey: key });
            navigate(`/tenders/${tenderId}`);
          }}
        />
      )}
    </>
  );
}

function DprDialog({
  projectId, dpr, onClose, onSaved,
}: {
  projectId: number;
  dpr: ProjectDpr | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(dpr);
  const [form, setForm] = useState({
    dprNo: dpr?.dprNo ?? '',
    title: dpr?.title ?? '',
    preparedBy: dpr?.preparedBy ?? '',
    consultant: dpr?.consultant ?? '',
    estimatedCost: dpr ? String(dpr.estimatedCost) : '',
    submissionDate: dpr?.submissionDate ?? today(),
    scope: dpr?.scope ?? '',
    justification: dpr?.justification ?? '',
    srEdition: dpr?.abstract.srEdition ?? '',
    contingencyPercent: dpr ? String(dpr.abstract.contingencyPercent) : '3',
    establishmentPercent: dpr ? String(dpr.abstract.establishmentPercent) : '2',
    remarks: dpr?.remarks ?? '',
  });

  /** Once the report is priced, its cost is the foot of its own estimate. */
  const isPriced = Boolean(dpr?.abstract.isPriced);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        dprNo: form.dprNo,
        title: form.title,
        preparedBy: form.preparedBy || undefined,
        consultant: form.consultant || undefined,
        estimatedCost: form.estimatedCost,
        submissionDate: form.submissionDate || undefined,
        scope: form.scope || undefined,
        justification: form.justification || undefined,
        srEdition: form.srEdition || undefined,
        contingencyPercent: form.contingencyPercent || undefined,
        establishmentPercent: form.establishmentPercent || undefined,
        remarks: form.remarks || undefined,
      };
      return isEdit
        ? api.patch(`/projects/${projectId}/dprs/${dpr!.id}`, body)
        : api.post(`/projects/${projectId}/dprs`, body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'DPR updated' : 'DPR recorded');
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the DPR.');
      }
    },
  });

  return (
    <Modal
      open
      title={isEdit ? 'Edit DPR' : 'New Detailed Project Report'}
      subtitle={
        isEdit
          ? undefined
          : 'Reusing a DPR number creates the next version, so a report returned for correction keeps its history.'
      }
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
            {isEdit ? 'Save changes' : 'Record DPR'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="DPR number"
            required
            value={form.dprNo}
            onChange={set('dprNo')}
            error={errors.dprNo}
            disabled={isEdit}
            hint={isEdit ? 'The number cannot change on an existing report.' : undefined}
          />
          <TextInput
            label="Title"
            required
            value={form.title}
            onChange={set('title')}
            error={errors.title}
          />
          <TextInput
            label="Estimated cost"
            required
            numeric
            prefix="₹"
            value={form.estimatedCost}
            onChange={set('estimatedCost')}
            error={errors.estimatedCost}
            disabled={isPriced}
            hint={
              isPriced
                ? 'Taken from the abstract of cost, so it cannot be typed over.'
                : 'A single figure until the report is priced item by item.'
            }
          />
          <TextInput
            label="Submitted on"
            type="date"
            value={form.submissionDate}
            onChange={set('submissionDate')}
            error={errors.submissionDate}
          />
          <TextInput
            label="SR edition"
            value={form.srEdition}
            onChange={set('srEdition')}
            error={errors.srEdition}
            hint="The Schedule of Rates edition the estimate is priced from, e.g. 2024-25."
          />
          <TextInput
            label="Contingency"
            numeric
            value={form.contingencyPercent}
            onChange={set('contingencyPercent')}
            error={errors.contingencyPercent}
            hint="Percentage added to the priced items."
          />
          <TextInput
            label="Work-charged establishment"
            numeric
            value={form.establishmentPercent}
            onChange={set('establishmentPercent')}
            error={errors.establishmentPercent}
            hint="Percentage added to the priced items."
          />
          <TextInput
            label="Prepared by"
            value={form.preparedBy}
            onChange={set('preparedBy')}
            error={errors.preparedBy}
          />
          <TextInput
            label="Consultant"
            value={form.consultant}
            onChange={set('consultant')}
            error={errors.consultant}
          />
          <TextArea
            label="Scope of work"
            full
            rows={3}
            value={form.scope}
            onChange={set('scope')}
            error={errors.scope}
          />
          <TextArea
            label="Justification"
            full
            rows={3}
            value={form.justification}
            onChange={set('justification')}
            error={errors.justification}
            hint="Why the work is needed."
          />
        </div>
      </div>
    </Modal>
  );
}

function DecisionDialog({
  projectId, dpr, onClose, onSaved,
}: {
  projectId: number;
  dpr: ProjectDpr;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<'SUBMITTED' | 'APPROVED' | 'RETURNED'>('APPROVED');
  const [approvedBy, setApprovedBy] = useState('');
  const [remarks, setRemarks] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/projects/${projectId}/dprs/${dpr.id}/decision`, {
        status,
        approvedBy: approvedBy || undefined,
        approvalDate: today(),
        remarks: remarks || undefined,
      }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not record the decision.'),
  });

  return (
    <Modal
      open
      title="Record the decision"
      subtitle={`${dpr.dprNo} version ${dpr.version}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={() => { setMessage(null); mutation.mutate(); }}>
            Record decision
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        {status === 'APPROVED' && (
          <Alert variant="warn" title="An approved DPR cannot be edited afterwards">
            It becomes a record. A change after this point means a fresh version under the same
            DPR number.
          </Alert>
        )}
        <div className="field">
          <label className="field__label" htmlFor="dpr-status">Decision</label>
          <select
            id="dpr-status"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="SUBMITTED">Submitted for approval</option>
            <option value="APPROVED">Approved</option>
            <option value="RETURNED">Returned for correction</option>
          </select>
        </div>
        <TextInput
          label="Decided by"
          value={approvedBy}
          onChange={(event) => setApprovedBy(event.target.value)}
          hint="Leave blank to record it against your own name."
        />
        <TextArea
          label="Remarks"
          full
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
        />
      </div>
    </Modal>
  );
}
