import { useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { date, rupees, today } from '../lib/format';
import type { ProjectSanction, ProjectSanctions, SanctionKind } from '../types';
import {
  Alert, Button, Card, DetailItem, EditIcon, EmptyState, Loading, PlusIcon, Select,
  TextArea, TextInput, TrashIcon,
} from './ui';
import { ConfirmModal, Modal } from './Modal';

/**
 * The government orders that authorise a work: Administrative Approval &
 * Financial Sanction, Technical Sanction, and the revisions of each.
 *
 * These are distinct things. An AA&FS sanctions the work and its cost and comes
 * from the administrative authority; a Technical Sanction certifies that the
 * estimate is sound and comes from the engineering side. A work is not properly
 * authorised until it has both, which is what the summary at the top shows.
 */

const KINDS: { value: SanctionKind; label: string }[] = [
  { value: 'ADMINISTRATIVE', label: 'Administrative Approval & Financial Sanction' },
  { value: 'REVISED_ADMINISTRATIVE', label: 'Revised Administrative Approval' },
  { value: 'TECHNICAL', label: 'Technical Sanction' },
  { value: 'REVISED_TECHNICAL', label: 'Revised Technical Sanction' },
  { value: 'EXPENDITURE', label: 'Expenditure Sanction' },
];

export function SanctionsPanel({ projectId }: { projectId: number }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useAuth();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ProjectSanction | null>(null);
  const [deleting, setDeleting] = useState<ProjectSanction | null>(null);

  const key = ['project-sanctions', projectId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<ProjectSanctions>(`/projects/${projectId}/sanctions`),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/projects/${projectId}/sanctions/${id}`),
    onSuccess: () => {
      toast.success('Sanction removed');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) =>
      toast.error('Could not remove', error instanceof ApiError ? error.message : undefined),
  });

  const canEdit = can('projects.manage');
  const summary = data?.summary;

  return (
    <>
      <Card
        title="Sanctions"
        subtitle="The orders that authorise this work and its cost."
        actions={
          canEdit ? (
            <Button size="sm" icon={<PlusIcon />} onClick={() => setAdding(true)}>
              Record a sanction
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <Loading />
        ) : (
          <div className="stack">
            {summary && (!summary.hasAdministrative || !summary.hasTechnical) && (
              <Alert variant="warn" title="This work is not fully authorised on record">
                {!summary.hasAdministrative && !summary.hasTechnical
                  ? 'Neither the Administrative Approval nor the Technical Sanction has been recorded.'
                  : !summary.hasAdministrative
                    ? 'The Administrative Approval & Financial Sanction has not been recorded.'
                    : 'The Technical Sanction has not been recorded.'}
              </Alert>
            )}

            {summary && (summary.administrative || summary.technical) && (
              <div className="detail-grid">
                <DetailItem
                  label="Administrative Approval"
                  value={
                    summary.administrative
                      ? `${summary.administrative.referenceNo} · ${date(summary.administrative.sanctionDate)} · ${rupees(summary.administrative.amount)}`
                      : null
                  }
                />
                <DetailItem
                  label="Technical Sanction"
                  value={
                    summary.technical
                      ? `${summary.technical.referenceNo} · ${date(summary.technical.sanctionDate)} · ${rupees(summary.technical.amount)}`
                      : null
                  }
                />
              </div>
            )}

            {!data?.items.length ? (
              <EmptyState
                title="No sanction recorded"
                text="Record the Administrative Approval and the Technical Sanction, with the signed orders attached."
              />
            ) : (
              <div className="table-wrap">
                <table className="table table--compact">
                  <caption className="visually-hidden">Sanctions recorded on this project</caption>
                  <thead>
                    <tr>
                      <th scope="col">Sanction</th>
                      <th scope="col">Order number</th>
                      <th scope="col">Dated</th>
                      <th scope="col" className="num">Amount</th>
                      <th scope="col">Sanctioning authority</th>
                      <th scope="col">Order</th>
                      {canEdit && <th scope="col" className="num" />}
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((sanction) => (
                      <tr key={sanction.id}>
                        <td>{sanction.kindLabel}</td>
                        <td className="code">{sanction.referenceNo}</td>
                        <td>{date(sanction.sanctionDate)}</td>
                        <td className="num">{rupees(sanction.amount)}</td>
                        <td>
                          <div>{sanction.authority}</div>
                          {sanction.designation && (
                            <div className="cell-muted">{sanction.designation}</div>
                          )}
                        </td>
                        <td>
                          {sanction.document ? (
                            <Button
                              size="sm"
                              onClick={() => {
                                void api
                                  .download(
                                    `/documents/${sanction.document!.id}/download`,
                                    sanction.document!.name ?? 'order',
                                  )
                                  .catch(() => toast.error('Could not download that order.'));
                              }}
                            >
                              Download
                            </Button>
                          ) : (
                            <span className="cell-muted">Not attached</span>
                          )}
                        </td>
                        {canEdit && (
                          <td className="num">
                            <div className="btn-group">
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<EditIcon />}
                                aria-label="Edit"
                                onClick={() => setEditing(sanction)}
                              />
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<TrashIcon />}
                                aria-label="Remove"
                                onClick={() => setDeleting(sanction)}
                              />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Card>

      {(adding || editing) && (
        <SanctionDialog
          projectId={projectId}
          sanction={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        title="Remove this sanction?"
        message={
          <p>
            <strong>{deleting?.kindLabel} {deleting?.referenceNo}</strong> will be removed from the
            project record. The attached order stays in the file store.
          </p>
        }
        confirmLabel="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function SanctionDialog({
  projectId, sanction, onClose, onSaved,
}: {
  projectId: number;
  sanction: ProjectSanction | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(sanction);
  const [form, setForm] = useState({
    kind: (sanction?.kind ?? 'ADMINISTRATIVE') as SanctionKind,
    referenceNo: sanction?.referenceNo ?? '',
    sanctionDate: sanction?.sanctionDate ?? today(),
    amount: sanction ? String(sanction.amount) : '',
    authority: sanction?.authority ?? '',
    designation: sanction?.designation ?? '',
    remarks: sanction?.remarks ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        kind: form.kind,
        referenceNo: form.referenceNo,
        sanctionDate: form.sanctionDate,
        amount: form.amount,
        authority: form.authority,
        designation: form.designation || undefined,
        remarks: form.remarks || undefined,
      };
      return isEdit
        ? api.patch(`/projects/${projectId}/sanctions/${sanction!.id}`, body)
        : api.post(`/projects/${projectId}/sanctions`, body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Sanction updated' : 'Sanction recorded');
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the sanction.');
      }
    },
  });

  return (
    <Modal
      open
      title={isEdit ? 'Edit sanction' : 'Record a sanction'}
      subtitle="Attach the signed order through the Documents panel once this is saved."
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
            {isEdit ? 'Save changes' : 'Record sanction'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <Select
            label="Which sanction"
            required
            full
            value={form.kind}
            onChange={set('kind')}
            error={errors.kind}
            hint="Administrative Approval sanctions the work and its cost; Technical Sanction certifies the estimate."
            options={KINDS}
          />
          <TextInput
            label="Order number"
            required
            value={form.referenceNo}
            onChange={set('referenceNo')}
            error={errors.referenceNo}
            placeholder="e.g. PWD/AA/1187/2026"
          />
          <TextInput
            label="Dated"
            type="date"
            required
            value={form.sanctionDate}
            onChange={set('sanctionDate')}
            error={errors.sanctionDate}
          />
          <TextInput
            label="Amount sanctioned"
            required
            numeric
            prefix="₹"
            value={form.amount}
            onChange={set('amount')}
            error={errors.amount}
          />
          <TextInput
            label="Sanctioning authority"
            required
            value={form.authority}
            onChange={set('authority')}
            error={errors.authority}
            placeholder="e.g. Government of Karnataka, PWD"
          />
          <TextInput
            label="Designation"
            value={form.designation}
            onChange={set('designation')}
            error={errors.designation}
            placeholder="e.g. Principal Secretary"
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
