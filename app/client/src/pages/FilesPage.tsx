import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { dateTime, humanise } from '../lib/format';
import type { DocumentCategory, DocumentFolder, DocumentStoreSummary, StoredDocument } from '../types';
import {
  Alert, Button, Card, EditIcon, FolderIcon, Loading, PageHeader, PlusIcon,
  Select, TextArea, TextInput, TrashIcon,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { ConfirmModal, Modal } from '../components/Modal';

const CATEGORIES: DocumentCategory[] = [
  'GENERAL', 'SANCTION', 'AGREEMENT', 'TENDER', 'MEASUREMENT',
  'INVOICE', 'PHOTOGRAPH', 'DRAWING', 'CORRESPONDENCE', 'REPORT',
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function FilesPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { isContractor } = useAuth();
  const [params, setParams] = useSearchParams();

  const folderId = params.get('folder') ? Number(params.get('folder')) : null;
  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);

  const [uploading, setUploading] = useState(false);
  const [newFolder, setNewFolder] = useState(false);
  const [editing, setEditing] = useState<StoredDocument | null>(null);
  const [deleting, setDeleting] = useState<StoredDocument | null>(null);
  const [deletingFolder, setDeletingFolder] = useState<DocumentFolder | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const summary = useQuery({
    queryKey: ['documents', 'summary'],
    queryFn: () => api.get<DocumentStoreSummary>('/documents/summary'),
    staleTime: 5 * 60 * 1000,
  });

  const folders = useQuery({
    queryKey: ['documents', 'folders', folderId],
    queryFn: () =>
      api.get<DocumentFolder[]>('/documents/folders', { parentId: folderId ?? undefined }),
  });

  const breadcrumb = useQuery({
    queryKey: ['documents', 'folder-path', folderId],
    queryFn: () => api.get<{ id: number; name: string }[]>(`/documents/folders/${folderId}/path`),
    enabled: folderId !== null,
  });

  const documents = useQuery({
    queryKey: ['documents', 'list', folderId, search, category, page],
    queryFn: () =>
      api.get<Page<StoredDocument>>('/documents', {
        // A search looks across the whole store; otherwise stay in this folder.
        ...(search
          ? {}
          : folderId === null
            ? { root: 'true' }
            : { folderId }),
        search: search || undefined,
        category: category || undefined,
        page,
        pageSize: 30,
      }),
  });

  const removeDocument = useMutation({
    mutationFn: (id: number) => api.delete(`/documents/${id}`),
    onSuccess: () => {
      toast.success('File deleted');
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  const removeFolder = useMutation({
    mutationFn: (id: number) => api.delete(`/documents/folders/${id}`),
    onSuccess: () => {
      toast.success('Folder deleted');
      setDeletingFolder(null);
      void queryClient.invalidateQueries({ queryKey: ['documents'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  function openFolder(id: number | null) {
    const next = new URLSearchParams(params);
    if (id === null) next.delete('folder');
    else next.set('folder', String(id));
    next.delete('page');
    next.delete('search');
    setParams(next);
  }

  const [dropped, setDropped] = useState<File | null>(null);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    if (isContractor) return;
    const file = event.dataTransfer.files?.[0];
    if (file) {
      setDropped(file);
      setUploading(true);
    }
  }

  const path = breadcrumb.data ?? [];

  return (
    <>
      <PageHeader
        title="Files"
        subtitle="The departmental filing cabinet. Anything uploaded here is available to the officers who can see the folder it sits in."
        actions={
          !isContractor ? (
            <>
              <Button icon={<FolderIcon size={16} />} onClick={() => setNewFolder(true)}>
                New folder
              </Button>
              <Button variant="primary" icon={<PlusIcon />} onClick={() => { setDropped(null); setUploading(true); }}>
                Upload a file
              </Button>
            </>
          ) : undefined
        }
      />

      {summary.data && (
        <div className="grid grid--3">
          <div className="stat stat--accent">
            <div className="stat__label">Files stored</div>
            <div className="stat__value">{summary.data.totalFiles}</div>
            <div className="stat__meta">{formatBytes(summary.data.totalBytes)} in total</div>
          </div>
          <div className="stat">
            <div className="stat__label">Largest accepted upload</div>
            <div className="stat__value">{formatBytes(summary.data.maxUploadBytes)}</div>
            <div className="stat__meta">One file at a time</div>
          </div>
          <div className="stat">
            <div className="stat__label">Accepted types</div>
            <div className="stat__value" style={{ fontSize: 15, lineHeight: 1.5, fontWeight: 600 }}>
              {summary.data.acceptedTypes}
            </div>
          </div>
        </div>
      )}

      <nav className="breadcrumb" aria-label="Folder path">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => openFolder(null)}
        >
          All files
        </button>
        {path.map((entry) => (
          <span key={entry.id} style={{ display: 'contents' }}>
            <span className="breadcrumb__sep">/</span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => openFolder(entry.id)}
            >
              {entry.name}
            </button>
          </span>
        ))}
      </nav>

      <div
        onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        style={
          dragOver
            ? { outline: '2px dashed var(--brand-700)', outlineOffset: 4, borderRadius: 10 }
            : undefined
        }
      >
        {dragOver && !isContractor && (
          <Alert variant="info" title="Drop to upload">
            The file will be filed in {path.length ? path[path.length - 1]!.name : 'the top level'}.
          </Alert>
        )}

        <Card
          title="Folders"
          subtitle={
            folderId === null
              ? 'Top-level cabinets. Open one to see what is filed inside.'
              : 'Sub-folders of the folder you are in.'
          }
        >
          {folders.isLoading ? (
            <Loading />
          ) : !folders.data?.length ? (
            <p style={{ color: 'var(--ink-600)' }}>No sub-folders here.</p>
          ) : (
            <div className="grid grid--3">
              {folders.data.map((folder) => (
                <div key={folder.id} className="card" style={{ padding: 0 }}>
                  <button
                    type="button"
                    onClick={() => openFolder(folder.id)}
                    style={{
                      display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%',
                      padding: '14px 16px', border: 'none', background: 'transparent',
                      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
                    }}
                  >
                    <span style={{ color: 'var(--brand-700)', flex: 'none', marginTop: 2 }}>
                      <FolderIcon size={22} />
                    </span>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span style={{ display: 'block', fontWeight: 700 }}>{folder.name}</span>
                      {folder.description && (
                        <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 13, marginTop: 2 }}>
                          {folder.description}
                        </span>
                      )}
                      <span style={{ display: 'block', color: 'var(--ink-600)', fontSize: 12.5, marginTop: 4 }}>
                        {folder.documentCount} file{folder.documentCount === 1 ? '' : 's'}
                        {folder.childCount > 0 && ` · ${folder.childCount} sub-folder${folder.childCount === 1 ? '' : 's'}`}
                        {folder.division?.name ? ` · ${folder.division.name}` : ' · Departmental'}
                      </span>
                    </span>
                  </button>
                  {!isContractor && (
                    <div style={{ padding: '0 16px 12px' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<TrashIcon />}
                        onClick={() => setDeletingFolder(folder)}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title={search ? `Files matching “${search}”` : 'Files'}
          subtitle={
            search
              ? 'Searching looks across every folder you can see.'
              : 'Files filed directly in this folder.'
          }
          flush
        >
          <div className="filter-bar">
            <div className="field field--search">
              <label className="field__label" htmlFor="file-search">Search</label>
              <input
                id="file-search"
                type="search"
                className="input"
                placeholder="File name or description"
                defaultValue={search}
                onChange={(event) => setParam('search', event.target.value)}
              />
            </div>
            <Select
              label="Category"
              value={category}
              onChange={(event) => setParam('category', event.target.value)}
              placeholder="All categories"
              options={CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
            />
          </div>

          <DataTable
            rows={documents.data?.items ?? []}
            rowKey={(row) => row.id}
            loading={documents.isLoading}
            caption="Files"
            columns={[
              {
                key: 'name',
                header: 'File',
                render: (row) => (
                  <>
                    <div className="cell-primary">{row.name}</div>
                    <div className="cell-muted">
                      {row.description || `${row.extension.replace('.', '').toUpperCase()} file`}
                    </div>
                  </>
                ),
              },
              { key: 'category', header: 'Category', render: (row) => humanise(row.category) },
              {
                key: 'folder',
                header: 'Folder',
                render: (row) =>
                  row.folder ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => openFolder(row.folder!.id)}
                    >
                      {row.folder.name}
                    </button>
                  ) : (
                    'Top level'
                  ),
              },
              { key: 'size', header: 'Size', numeric: true, render: (row) => formatBytes(row.sizeBytes) },
              {
                key: 'uploaded',
                header: 'Uploaded',
                render: (row) => (
                  <>
                    <div>{row.uploadedBy ?? 'Unknown'}</div>
                    <div className="cell-muted">{dateTime(row.createdAt)}</div>
                  </>
                ),
              },
              {
                key: 'downloads',
                header: 'Downloads',
                numeric: true,
                render: (row) => row.downloadCount,
              },
              {
                key: 'actions',
                header: '',
                actions: true,
                render: (row) => (
                  <div className="btn-group">
                    <Button
                      size="sm"
                      onClick={() => {
                        void api
                          .download(`/documents/${row.id}/download`, row.name)
                          .catch(() => toast.error('Could not download that file.'));
                      }}
                    >
                      Download
                    </Button>
                    {!isContractor && (
                      <>
                        <Button size="sm" variant="ghost" icon={<EditIcon />} onClick={() => setEditing(row)} aria-label="Edit" />
                        <Button size="sm" variant="ghost" icon={<TrashIcon />} onClick={() => setDeleting(row)} aria-label="Delete" />
                      </>
                    )}
                  </div>
                ),
              },
            ]}
            empty={{
              title: search ? 'Nothing matched' : 'No files here yet',
              text: isContractor
                ? 'Files shared with you appear here.'
                : 'Upload a file, or drag one onto this page.',
            }}
          />

          {documents.data && (
            <Pagination
              page={documents.data.page}
              pageSize={documents.data.pageSize}
              total={documents.data.total}
              onPageChange={(next) => setParam('page', String(next))}
            />
          )}
        </Card>
      </div>

      {uploading && (
        <UploadDialog
          folderId={folderId}
          folderName={path.length ? path[path.length - 1]!.name : 'the top level'}
          initialFile={dropped}
          onClose={() => { setUploading(false); setDropped(null); }}
          onUploaded={() => {
            void queryClient.invalidateQueries({ queryKey: ['documents'] });
          }}
        />
      )}

      {newFolder && (
        <FolderDialog
          parentId={folderId}
          onClose={() => setNewFolder(false)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['documents'] })}
        />
      )}

      {editing && (
        <EditDocumentDialog
          document={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ['documents'] })}
        />
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        title="Delete this file?"
        message={
          <p>
            <strong>{deleting?.name}</strong> will be removed from the system and the stored copy
            deleted. This cannot be undone.
          </p>
        }
        confirmLabel="Delete file"
        danger
        loading={removeDocument.isPending}
        onConfirm={() => deleting && removeDocument.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />

      <ConfirmModal
        open={Boolean(deletingFolder)}
        title="Delete this folder?"
        message={
          <p>
            <strong>{deletingFolder?.name}</strong> will be removed. A folder must be empty before
            it can be deleted.
          </p>
        }
        confirmLabel="Delete folder"
        danger
        loading={removeFolder.isPending}
        onConfirm={() => deletingFolder && removeFolder.mutate(deletingFolder.id)}
        onClose={() => setDeletingFolder(null)}
      />
    </>
  );
}

function UploadDialog({
  folderId, folderName, initialFile, onClose, onUploaded,
}: {
  folderId: number | null;
  folderName: string;
  initialFile: File | null;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(initialFile);
  const [name, setName] = useState(initialFile?.name ?? '');
  const [category, setCategory] = useState<DocumentCategory>('GENERAL');
  const [description, setDescription] = useState('');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const summary = useQuery({
    queryKey: ['documents', 'summary'],
    queryFn: () => api.get<DocumentStoreSummary>('/documents/summary'),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.upload<StoredDocument>(
        '/documents',
        file!,
        {
          folderId: folderId ?? undefined,
          category,
          description: description || undefined,
          name: name || undefined,
        },
        setProgress,
      ),
    onSuccess: (saved) => {
      toast.success('File uploaded', `${saved.name} is filed in ${folderName}.`);
      onUploaded();
      onClose();
    },
    onError: (error: unknown) => {
      setProgress(0);
      setMessage(error instanceof ApiError ? error.message : 'The upload failed.');
    },
  });

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    if (chosen && !name) setName(chosen.name);
  }

  const tooLarge = Boolean(file && summary.data && file.size > summary.data.maxUploadBytes);

  return (
    <Modal
      open
      title="Upload a file"
      subtitle={`It will be filed in ${folderName}.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!file || tooLarge}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not upload">{message}</Alert>}

        <div className="field field--full">
          <label className="field__label" htmlFor="upload-input">
            File<span className="field__required" aria-hidden="true">*</span>
          </label>
          <input
            id="upload-input"
            ref={inputRef}
            type="file"
            className="input"
            onChange={choose}
          />
          {summary.data && (
            <span className="field__hint">
              Up to {formatBytes(summary.data.maxUploadBytes)}. Accepted: {summary.data.acceptedTypes}.
            </span>
          )}
        </div>

        {file && (
          <Alert variant={tooLarge ? 'danger' : 'info'} title={file.name}>
            {formatBytes(file.size)}
            {tooLarge && summary.data
              ? ` — too large. The limit is ${formatBytes(summary.data.maxUploadBytes)}.`
              : ''}
          </Alert>
        )}

        <div className="form-grid">
          <TextInput
            label="File name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            hint="What officers will see. Defaults to the name on disk."
          />
          <Select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            options={CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
          />
          <TextArea
            label="Description"
            full
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            hint="Optional. What this file is, in a line."
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

function FolderDialog({
  parentId, onClose, onSaved,
}: {
  parentId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<DocumentFolder>('/documents/folders', {
        name,
        parentId: parentId ?? undefined,
        description: description || undefined,
      }),
    onSuccess: (folder) => {
      toast.success('Folder created', `“${folder.name}” is ready.`);
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not create the folder.');
      }
    },
  });

  return (
    <Modal
      open
      title="New folder"
      subtitle={parentId ? 'Created inside the folder you are in.' : 'Created at the top level.'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!name.trim()}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            Create folder
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not create">{message}</Alert>}
        <TextInput
          label="Folder name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errors.name}
          maxLength={120}
        />
        <TextArea
          label="Description"
          full
          rows={2}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          error={errors.description}
          hint="Optional. What belongs in this folder."
        />
      </div>
    </Modal>
  );
}

function EditDocumentDialog({
  document: file, onClose, onSaved,
}: {
  document: StoredDocument;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState(file.description ?? '');
  const [category, setCategory] = useState<DocumentCategory>(file.category);
  const [folderId, setFolderId] = useState(file.folder ? String(file.folder.id) : '');
  const [message, setMessage] = useState<string | null>(null);

  const folders = useQuery({
    queryKey: ['documents', 'all-folders'],
    queryFn: () => api.get<DocumentFolder[]>('/documents/folders', { all: 'true' }),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<StoredDocument>(`/documents/${file.id}`, {
        name,
        description: description || null,
        category,
        folderId: folderId ? Number(folderId) : null,
      }),
    onSuccess: () => {
      toast.success('File updated');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the changes.'),
  });

  return (
    <Modal
      open
      title="Edit file"
      subtitle={`${formatBytes(file.sizeBytes)} · uploaded by ${file.uploadedBy ?? 'unknown'}`}
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
        <div className="form-grid">
          <TextInput label="File name" required value={name} onChange={(event) => setName(event.target.value)} />
          <Select
            label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value as DocumentCategory)}
            options={CATEGORIES.map((value) => ({ value, label: humanise(value) }))}
          />
          <Select
            label="Folder"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="Top level"
            options={(folders.data ?? []).map((folder) => ({
              value: folder.id,
              label: folder.parentName ? `${folder.parentName} / ${folder.name}` : folder.name,
            }))}
          />
          <TextArea
            label="Description"
            full
            rows={2}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}
