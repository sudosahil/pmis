import { useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { date, humanise } from '../lib/format';
import type { DocumentCategory, StoredDocument } from '../types';
import { Alert, Button, Card, EmptyState, Loading, PlusIcon, Select, TrashIcon } from './ui';
import { Modal } from './Modal';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const CATEGORIES: DocumentCategory[] = [
  'GENERAL', 'SANCTION', 'AGREEMENT', 'TENDER', 'MEASUREMENT',
  'INVOICE', 'PHOTOGRAPH', 'DRAWING', 'CORRESPONDENCE', 'REPORT',
];

/**
 * The documents filed against one record — the technical sanction on a project,
 * the agreement on a package, the measurement book on a bill. The same store as
 * the Files screen; this is simply the view of it that belongs to this record.
 */
export function Attachments({
  entityType,
  entityId,
  title = 'Documents',
  defaultCategory = 'GENERAL',
}: {
  entityType: string;
  entityId: number;
  title?: string;
  defaultCategory?: DocumentCategory;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isContractor } = useAuth();
  const [uploading, setUploading] = useState(false);

  const key = ['documents', 'attached', entityType, entityId];

  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: () =>
      api.get<Page<StoredDocument>>('/documents', { entityType, entityId, pageSize: 100 }),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success('Document removed');
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (error: unknown) =>
      toast.error('Could not remove', error instanceof ApiError ? error.message : undefined),
  });

  const documents = data?.items ?? [];

  return (
    <>
      <Card
        title={title}
        subtitle="Filed against this record and visible wherever it is opened."
        actions={
          !isContractor ? (
            <Button size="sm" icon={<PlusIcon />} onClick={() => setUploading(true)}>
              Attach
            </Button>
          ) : undefined
        }
      >
        {isLoading ? (
          <Loading />
        ) : !documents.length ? (
          <EmptyState
            title="Nothing attached yet"
            text={
              isContractor
                ? 'Documents filed against this record will appear here.'
                : 'Attach the sanction order, agreement, drawing or photograph that belongs on this file.'
            }
          />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {documents.map((document) => (
              <li
                key={document.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  padding: '10px 0',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{document.name}</span>
                  <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5 }}>
                    {humanise(document.category)} · {formatBytes(document.sizeBytes)} ·{' '}
                    {document.uploadedBy ?? 'Unknown'} · {date(document.createdAt)}
                  </span>
                  {document.description && (
                    <span style={{ display: 'block', color: 'var(--ink-700)', fontSize: 13 }}>
                      {document.description}
                    </span>
                  )}
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    void api
                      .download(`/documents/${document.id}/download`, document.name)
                      .catch(() => toast.error('Could not download that file.'));
                  }}
                >
                  Download
                </Button>
                {!isContractor && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<TrashIcon />}
                    aria-label={`Remove ${document.name}`}
                    onClick={() => remove.mutate(document.id)}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {uploading && (
        <AttachDialog
          entityType={entityType}
          entityId={entityId}
          defaultCategory={defaultCategory}
          onClose={() => setUploading(false)}
          onUploaded={() => void queryClient.invalidateQueries({ queryKey: key })}
        />
      )}
    </>
  );
}

function AttachDialog({
  entityType, entityId, defaultCategory, onClose, onUploaded,
}: {
  entityType: string;
  entityId: number;
  defaultCategory: DocumentCategory;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState<DocumentCategory>(defaultCategory);
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.upload<StoredDocument>(
        '/documents',
        file!,
        { entityType, entityId, category, description: description || undefined },
        setProgress,
      ),
    onSuccess: (saved) => {
      toast.success('Document attached', `${saved.name} is filed against this record.`);
      onUploaded();
      onClose();
    },
    onError: (error: unknown) => {
      setProgress(0);
      setMessage(error instanceof ApiError ? error.message : 'The upload failed.');
    },
  });

  function choose(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
  }

  return (
    <Modal
      open
      title="Attach a document"
      subtitle="It is filed against this record and appears in the file store as well."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!file}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Attach
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not attach">{message}</Alert>}
        <div className="field field--full">
          <label className="field__label" htmlFor="attach-file">
            File<span className="field__required" aria-hidden="true">*</span>
          </label>
          <input id="attach-file" ref={inputRef} type="file" className="input" onChange={choose} />
        </div>
        <Select
          label="What this document is"
          value={category}
          onChange={(event) => setCategory(event.target.value as DocumentCategory)}
          options={CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
        />
        <div className="field field--full">
          <label className="field__label" htmlFor="attach-note">Description</label>
          <input
            id="attach-note"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional — what this document is, in a line."
          />
        </div>
        {mutation.isPending && (
          <div className="progress-label">
            <div className="progress" style={{ flex: 1 }} role="progressbar" aria-valuenow={progress}>
              <div className="progress__fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}%</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
