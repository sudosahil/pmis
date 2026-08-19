import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useToast } from './Toast';
import { today } from '../lib/format';
import type { PackageProgressUpdate, StoredDocument } from '../types';
import {
  Alert, Button, Card, EditIcon, EmptyState, Loading, PlusIcon, TextArea, TextInput, TrashIcon,
} from './ui';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';

/** "18 Aug 2026, 3:40 pm" from a browser-supplied ISO timestamp. */
function whenCaptured(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  });
}

function coord(value: string | null): string | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : value;
}

/** Fetches a document's bytes with the bearer token and renders them as an image. */
function AuthedThumbnail({ documentId, alt }: { documentId: number; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void api.blobUrl(`/documents/${documentId}/download`).then((url) => {
      if (cancelled) {
        URL.revokeObjectURL(url);
        return;
      }
      objectUrl = url;
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

  if (!src) return <div style={{ width: '100%', height: '100%', background: 'var(--line-soft)' }} />;
  return <img src={src} alt={alt} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

/**
 * The contractor's dated site update against an awarded package — physical
 * progress, a note, and geotagged photographs — reviewed once by the officer
 * in charge.
 */
export function ProgressUpdatesPanel({
  packageId,
  canSubmit,
  canReview,
}: {
  packageId: number;
  /** May the signed-in user file an update against this specific package. */
  canSubmit: boolean;
  /** May the signed-in user accept or return an update. */
  canReview: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PackageProgressUpdate | null>(null);
  const [reviewing, setReviewing] = useState<PackageProgressUpdate | null>(null);
  const [deleting, setDeleting] = useState<PackageProgressUpdate | null>(null);

  const key = ['package-progress-updates', packageId];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () => api.get<PackageProgressUpdate[]>(`/packages/${packageId}/progress-updates`),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: key });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/packages/${packageId}/progress-updates/${id}`),
    onSuccess: () => {
      toast.success('Progress update withdrawn');
      invalidate();
      setDeleting(null);
    },
    onError: (error: unknown) =>
      toast.error('Could not withdraw', error instanceof ApiError ? error.message : undefined),
  });

  const updates = data ?? [];

  return (
    <>
      <Card
        title="Site progress updates"
        subtitle="Dated updates the contractor files against this package, each with geotagged site photographs."
        actions={
          canSubmit ? (
            <Button size="sm" icon={<PlusIcon />} onClick={() => setAdding(true)}>
              New update
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <Loading />
        ) : !updates.length ? (
          <EmptyState
            title="No progress updates filed yet"
            text={
              canSubmit
                ? 'Log the work done since the last update, with photographs taken on site.'
                : 'The contractor’s dated site updates will appear here.'
            }
          />
        ) : (
          <div className="stack">
            {updates.map((update) => (
              <ProgressUpdateCard
                key={update.id}
                packageId={packageId}
                update={update}
                canEdit={canSubmit && update.status !== 'REVIEWED'}
                canReview={canReview && update.status === 'SUBMITTED'}
                onEdit={() => setEditing(update)}
                onReview={() => setReviewing(update)}
                onDelete={() => setDeleting(update)}
              />
            ))}
          </div>
        )}
      </Card>

      {(adding || editing) && (
        <UpdateDialog
          packageId={packageId}
          update={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={invalidate}
        />
      )}
      {reviewing && (
        <ReviewDialog
          packageId={packageId}
          update={reviewing}
          onClose={() => setReviewing(null)}
          onSaved={() => { toast.success('Decision recorded'); invalidate(); }}
        />
      )}
      {deleting && (
        <Modal
          open
          title="Withdraw this update?"
          onClose={() => setDeleting(null)}
          footer={
            <>
              <Button onClick={() => setDeleting(null)} disabled={remove.isPending}>Cancel</Button>
              <Button
                variant="danger"
                loading={remove.isPending}
                onClick={() => remove.mutate(deleting.id)}
              >
                Withdraw
              </Button>
            </>
          }
        >
          <p>
            The update of {deleting.updateDate} and its photographs will be removed. This cannot
            be undone.
          </p>
        </Modal>
      )}
    </>
  );
}

function ProgressUpdateCard({
  packageId, update, canEdit, canReview, onEdit, onReview, onDelete,
}: {
  packageId: number;
  update: PackageProgressUpdate;
  canEdit: boolean;
  canReview: boolean;
  onEdit: () => void;
  onReview: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
      <div className="row row--between">
        <div>
          <strong>{update.updateDate}</strong>
          {update.physicalProgress !== null && (
            <span style={{ color: 'var(--ink-600)', fontSize: 12.5, marginLeft: 8 }}>
              {update.physicalProgress}% complete at this update
            </span>
          )}
          <div style={{ color: 'var(--ink-600)', fontSize: 12.5 }}>
            {update.contractor?.name ?? 'Unknown contractor'}
            {update.submittedBy ? ` · filed by ${update.submittedBy}` : ''}
          </div>
        </div>
        <div className="row">
          <StatusBadge status={update.status} />
          <div className="btn-group">
            {canEdit && (
              <Button size="sm" variant="ghost" icon={<EditIcon />} aria-label="Edit" onClick={onEdit} />
            )}
            {canEdit && (
              <Button size="sm" variant="ghost" icon={<TrashIcon />} aria-label="Withdraw" onClick={onDelete} />
            )}
            {canReview && <Button size="sm" onClick={onReview}>Review</Button>}
          </div>
        </div>
      </div>

      <p style={{ marginTop: 8, whiteSpace: 'pre-wrap' }}>{update.narrative}</p>

      {update.reviewedBy && (
        <p style={{ marginTop: 6, color: 'var(--ink-700)', fontSize: 13.5 }}>
          <strong>{update.status === 'RETURNED' ? 'Returned' : 'Reviewed'} by {update.reviewedBy}.</strong>
          {update.reviewRemarks ? ` ${update.reviewRemarks}` : ''}
        </p>
      )}

      <ProgressPhotos
        packageId={packageId}
        update={update}
        canUpload={canEdit}
      />
    </div>
  );
}

/* ==========================================================================
   Site photographs — geotagged at the moment of upload
   ========================================================================== */

function getPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('This device does not report a location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 15_000,
      maximumAge: 0,
    });
  });
}

function ProgressPhotos({
  packageId, update, canUpload,
}: {
  packageId: number;
  update: PackageProgressUpdate;
  canUpload: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [locating, setLocating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const key = ['documents', 'attached', 'PACKAGE_PROGRESS_UPDATE', update.id];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<Page<StoredDocument>>('/documents', {
        entityType: 'PACKAGE_PROGRESS_UPDATE', entityId: update.id, pageSize: 50,
      }),
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ['package-progress-updates', packageId] });
  };

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/documents/${id}`),
    onSuccess: () => { toast.success('Photograph removed'); invalidateAll(); },
    onError: (error: unknown) =>
      toast.error('Could not remove', error instanceof ApiError ? error.message : undefined),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setLocating(true);
      let position: GeolocationPosition;
      try {
        position = await getPosition();
      } finally {
        setLocating(false);
      }
      return api.upload<StoredDocument>(
        `/packages/${packageId}/progress-updates/${update.id}/photos`,
        file,
        {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          capturedAt: new Date().toISOString(),
        },
        setProgress,
      );
    },
    onSuccess: () => {
      toast.success('Photograph attached', 'Its location and time are recorded with it.');
      setProgress(0);
      invalidateAll();
    },
    onError: (error: unknown) => {
      setProgress(0);
      setMessage(
        error instanceof ApiError
          ? error.message
          : 'Could not get this photo’s location. Allow location access for this site and try again.',
      );
    },
  });

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) {
      setMessage(null);
      upload.mutate(file);
    }
  }

  const photos = data?.items ?? [];
  const busy = locating || upload.isPending;

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line-soft)' }}>
      <div className="row row--between">
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>
          Site photographs {photos.length ? `(${photos.length})` : ''}
        </span>
        {canUpload && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={choose}
            />
            <Button size="sm" loading={busy} onClick={() => inputRef.current?.click()}>
              {locating ? 'Getting location…' : 'Add photograph'}
            </Button>
          </>
        )}
      </div>

      {message && (
        <Alert variant="danger" title="Could not attach the photograph">{message}</Alert>
      )}
      {upload.isPending && !locating && (
        <div className="progress-label" style={{ marginTop: 8 }}>
          <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={progress}>
            <div className="progress__fill" style={{ width: `${progress}%` }} />
          </div>
          <span>{progress}%</span>
        </div>
      )}

      {isLoading ? (
        <Loading label="Loading photographs…" />
      ) : photos.length > 0 ? (
        <ul
          style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 10, listStyle: 'none', margin: '10px 0 0', padding: 0,
          }}
        >
          {photos.map((photo) => (
            <li key={photo.id} style={{ border: '1px solid var(--line)', borderRadius: 8, overflow: 'hidden' }}>
              <button
                type="button"
                onClick={() => void api.download(`/documents/${photo.id}/download`, photo.name)}
                style={{
                  display: 'block', width: '100%', aspectRatio: '4 / 3', border: 0, cursor: 'pointer',
                  background: `var(--surface-2, #eee)`,
                }}
                title="Download the original photograph"
              >
                {photo.mimeType.startsWith('image/') && (
                  <AuthedThumbnail documentId={photo.id} alt={photo.description ?? photo.name} />
                )}
              </button>
              <div style={{ padding: '6px 8px', fontSize: 11.5, color: 'var(--ink-600)' }}>
                <div>{whenCaptured(photo.capturedAt)}</div>
                {photo.latitude && photo.longitude && (
                  <div>{coord(photo.latitude)}, {coord(photo.longitude)}</div>
                )}
                {canUpload && photo.uploadedById && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    style={{ marginTop: 4, padding: '2px 6px' }}
                    onClick={() => remove.mutate(photo.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ marginTop: 8, color: 'var(--ink-600)', fontSize: 13 }}>
          No photographs attached yet.
        </p>
      )}
    </div>
  );
}

/* ==========================================================================
   Create / edit
   ========================================================================== */

function UpdateDialog({
  packageId, update, onClose, onSaved,
}: {
  packageId: number;
  update: PackageProgressUpdate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(update);
  const [form, setForm] = useState({
    updateDate: update?.updateDate ?? today(),
    physicalProgressPct: update?.physicalProgress !== null && update?.physicalProgress !== undefined
      ? String(update.physicalProgress)
      : '',
    narrative: update?.narrative ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        updateDate: form.updateDate,
        physicalProgressPct: form.physicalProgressPct !== '' ? Number(form.physicalProgressPct) : undefined,
        narrative: form.narrative,
      };
      return isEdit
        ? api.patch(`/packages/${packageId}/progress-updates/${update!.id}`, body)
        : api.post(`/packages/${packageId}/progress-updates`, body);
    },
    onSuccess: () => {
      toast.success(isEdit ? 'Update saved' : 'Progress update filed');
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the update.');
      }
    },
  });

  return (
    <Modal
      open
      title={isEdit ? 'Edit progress update' : 'New site progress update'}
      subtitle="Add photographs from this record once it is saved."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            {isEdit ? 'Save changes' : 'File update'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          <TextInput
            label="Date of this update"
            type="date"
            required
            value={form.updateDate}
            onChange={(event) => setForm((f) => ({ ...f, updateDate: event.target.value }))}
            error={errors.updateDate}
          />
          <TextInput
            label="Physical progress at this update (%)"
            numeric
            inputMode="numeric"
            value={form.physicalProgressPct}
            onChange={(event) => setForm((f) => ({ ...f, physicalProgressPct: event.target.value }))}
            error={errors.physicalProgressPct}
          />
          <TextArea
            label="What was done"
            full
            rows={4}
            required
            value={form.narrative}
            onChange={(event) => setForm((f) => ({ ...f, narrative: event.target.value }))}
            error={errors.narrative}
            placeholder="Describe the work executed since the last update."
          />
        </div>
      </div>
    </Modal>
  );
}

function ReviewDialog({
  packageId, update, onClose, onSaved,
}: {
  packageId: number;
  update: PackageProgressUpdate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<'REVIEWED' | 'RETURNED'>('REVIEWED');
  const [remarks, setRemarks] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/packages/${packageId}/progress-updates/${update.id}/review`, {
        status,
        remarks: remarks || undefined,
      }),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not record the decision.');
      }
    },
  });

  return (
    <Modal
      open
      title="Review this progress update"
      subtitle={`${update.updateDate} · ${update.contractor?.name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            Record decision
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not record">{message}</Alert>}
        <p style={{ whiteSpace: 'pre-wrap' }}>{update.narrative}</p>
        <div className="field">
          <label className="field__label" htmlFor="progress-review-status">Decision</label>
          <select
            id="progress-review-status"
            className="select"
            value={status}
            onChange={(event) => setStatus(event.target.value as typeof status)}
          >
            <option value="REVIEWED">Accept this update</option>
            <option value="RETURNED">Return for correction</option>
          </select>
        </div>
        <TextArea
          label="Remarks"
          full
          rows={3}
          value={remarks}
          onChange={(event) => setRemarks(event.target.value)}
          error={errors.remarks}
          hint={status === 'RETURNED' ? 'Say what needs correcting.' : 'Optional.'}
        />
      </div>
    </Modal>
  );
}
