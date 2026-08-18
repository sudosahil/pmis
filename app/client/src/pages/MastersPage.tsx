import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { date, money, percent } from '../lib/format';
import type { MasterDefinition, MasterField, MasterRecord } from '../types';
import {
  Alert, Button, Card, Checkbox, EditIcon, Loading, PageHeader, PlusIcon, Select, TextArea,
  TextInput, TrashIcon,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { ConfirmModal, Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

const GROUP_ORDER = ['Organisation', 'Geography', 'Classification', 'Finance'] as const;

export function MastersPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasRole } = useAuth();
  const [params, setParams] = useSearchParams();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<MasterRecord | null>(null);
  const [deleting, setDeleting] = useState<MasterRecord | null>(null);

  const search = params.get('search') ?? '';
  const page = Number(params.get('page') ?? 1);

  const definitions = useQuery({
    queryKey: ['master-definitions'],
    queryFn: () => api.get<MasterDefinition[]>('/masters/definitions'),
    staleTime: 30 * 60 * 1000,
  });

  const activeKey = key ?? definitions.data?.[0]?.key;
  const definition = definitions.data?.find((item) => item.key === activeKey);

  // Land on the first master when the page is opened without one.
  useEffect(() => {
    if (!key && definitions.data?.length) {
      navigate(`/masters/${definitions.data[0]!.key}`, { replace: true });
    }
  }, [key, definitions.data, navigate]);

  const records = useQuery({
    queryKey: ['master-records', activeKey, search, page],
    queryFn: () =>
      api.get<Page<MasterRecord>>(`/masters/${activeKey}`, {
        search: search || undefined,
        page,
        pageSize: 50,
      }),
    enabled: Boolean(activeKey),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/masters/${activeKey}/${id}`),
    onSuccess: () => {
      toast.success(`${definition?.singular ?? 'Record'} deleted`);
      setDeleting(null);
      void queryClient.invalidateQueries({ queryKey: ['master-records', activeKey] });
      void queryClient.invalidateQueries({ queryKey: ['masters'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not delete', error instanceof ApiError ? error.message : undefined),
  });

  const grouped = useMemo(() => {
    const map = new Map<string, MasterDefinition[]>();
    for (const item of definitions.data ?? []) {
      const bucket = map.get(item.group) ?? [];
      bucket.push(item);
      map.set(item.group, bucket);
    }
    return GROUP_ORDER.map((group) => ({ group, items: map.get(group) ?? [] })).filter(
      (entry) => entry.items.length > 0,
    );
  }, [definitions.data]);

  function setParam(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    if (name !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const canMaintain = hasRole('ADMIN', 'CE', 'SE');
  const listFields = (definition?.fields ?? []).filter((field) => field.inList);

  if (definitions.isLoading) return <Loading label="Loading master data…" />;

  return (
    <>
      <PageHeader
        title="Master data"
        subtitle="The reference lists every form in PMIS draws on. Changing them changes what appears in every dropdown."
        actions={
          canMaintain && definition ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              New {definition.singular.toLowerCase()}
            </Button>
          ) : undefined
        }
      />

      {!canMaintain && (
        <Alert variant="info" title="You are viewing master data">
          Only the administrative cadre may add or change these lists. Ask your administrator if
          something is missing.
        </Alert>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 240px) 1fr', gap: 18, alignItems: 'start' }}>
        <nav aria-label="Master lists" className="card" style={{ padding: 10 }}>
          {grouped.map((entry) => (
            <div key={entry.group} className="nav-section">
              <h2 className="nav-section__title">{entry.group}</h2>
              {entry.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`nav-link${item.key === activeKey ? ' is-active' : ''}`}
                  style={{ width: '100%', border: 'none', background: 'none', font: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                  onClick={() => navigate(`/masters/${item.key}`)}
                >
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div>
          {definition && (
            <Card title={definition.label} subtitle={definition.description} flush>
              <div className="filter-bar">
                <div className="field field--search">
                  <label className="field__label" htmlFor="master-search">Search</label>
                  <input
                    id="master-search"
                    type="search"
                    className="input"
                    placeholder={`Search ${definition.label.toLowerCase()}`}
                    defaultValue={search}
                    key={definition.key}
                    onChange={(event) => setParam('search', event.target.value)}
                  />
                </div>
              </div>

              <DataTable
                rows={records.data?.items ?? []}
                rowKey={(row) => row.id}
                loading={records.isLoading}
                compact
                caption={definition.label}
                columns={[
                  ...listFields.map((field) => ({
                    key: field.column,
                    header: field.label,
                    numeric: field.type === 'money' || field.type === 'percent' || field.type === 'number',
                    render: (row: MasterRecord) => renderValue(field, row),
                  })),
                  ...(canMaintain
                    ? [
                        {
                          key: '__actions',
                          header: '',
                          actions: true,
                          render: (row: MasterRecord) => (
                            <div className="btn-group">
                              <Button size="sm" icon={<EditIcon />} onClick={() => setEditing(row)}>
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                icon={<TrashIcon />}
                                onClick={() => setDeleting(row)}
                                aria-label="Delete"
                              />
                            </div>
                          ),
                        },
                      ]
                    : []),
                ]}
                empty={{
                  title: `No ${definition.label.toLowerCase()} yet`,
                  text: canMaintain
                    ? `Add the first ${definition.singular.toLowerCase()} to make it available in forms.`
                    : 'Nothing has been added to this list yet.',
                }}
              />

              {records.data && (
                <Pagination
                  page={records.data.page}
                  pageSize={records.data.pageSize}
                  total={records.data.total}
                  onPageChange={(next) => setParam('page', String(next))}
                />
              )}
            </Card>
          )}
        </div>
      </div>

      {definition && (creating || editing) && (
        <MasterFormDialog
          definition={definition}
          record={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => {
            void queryClient.invalidateQueries({ queryKey: ['master-records', activeKey] });
            void queryClient.invalidateQueries({ queryKey: ['masters'] });
          }}
        />
      )}

      <ConfirmModal
        open={Boolean(deleting)}
        title={`Delete this ${definition?.singular.toLowerCase() ?? 'record'}?`}
        message={
          <>
            <p>
              <strong>{String(deleting?.name ?? deleting?.code ?? '')}</strong> will be removed from every
              dropdown. Records that already reference it are unaffected.
            </p>
            <p style={{ marginTop: 8 }}>
              If it is in use, the system will refuse the deletion — set its status to Inactive instead.
            </p>
          </>
        }
        confirmLabel="Delete"
        danger
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

/** Formats one master cell according to the field's declared type. */
function renderValue(field: MasterField, row: MasterRecord) {
  const value = row[field.column];
  if (field.type === 'lookup') {
    const label = row[`${field.column}__label`];
    return label ? String(label) : '—';
  }
  if (field.column === 'status') return <StatusBadge status={value ? String(value) : null} />;
  if (value === null || value === undefined || value === '') return '—';
  if (field.type === 'money') return money(Number(value));
  if (field.type === 'percent') return percent(Number(value));
  if (field.type === 'date') return date(String(value));
  if (field.type === 'boolean') return value ? 'Yes' : 'No';
  if (field.column === 'code') return <span className="code">{String(value)}</span>;
  return String(value);
}

function MasterFormDialog({
  definition, record, onClose, onSaved,
}: {
  definition: MasterDefinition;
  record: MasterRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(record);
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const initial: Record<string, string | boolean> = {};
    for (const field of definition.fields) {
      const current = record?.[field.column];
      if (field.type === 'boolean') initial[field.column] = Boolean(current);
      else if (current === null || current === undefined) initial[field.column] = '';
      else initial[field.column] = String(current);
    }
    return initial;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {};
      for (const field of definition.fields) {
        const value = values[field.column];
        if (field.type === 'boolean') payload[field.column] = Boolean(value);
        else if (value === '' || value === undefined) {
          if (!isEdit) continue;
          payload[field.column] = null;
        } else payload[field.column] = value;
      }
      return isEdit
        ? api.patch(`/masters/${definition.key}/${record!.id}`, payload)
        : api.post(`/masters/${definition.key}`, payload);
    },
    onSuccess: () => {
      toast.success(isEdit ? `${definition.singular} updated` : `${definition.singular} added`);
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the record.');
      }
    },
  });

  return (
    <Modal
      open
      title={isEdit ? `Edit ${definition.singular.toLowerCase()}` : `New ${definition.singular.toLowerCase()}`}
      subtitle={definition.description}
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
            {isEdit ? 'Save changes' : `Add ${definition.singular.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}
        <div className="form-grid">
          {definition.fields.map((field) => (
            <MasterFieldInput
              key={field.column}
              field={field}
              value={values[field.column] ?? ''}
              error={errors[field.column]}
              onChange={(next) => setValues((current) => ({ ...current, [field.column]: next }))}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function MasterFieldInput({
  field, value, error, onChange,
}: {
  field: MasterField;
  value: string | boolean;
  error?: string;
  onChange: (value: string | boolean) => void;
}) {
  const text = typeof value === 'boolean' ? '' : value;

  const handle = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange(event.target.value);

  switch (field.type) {
    case 'boolean':
      return (
        <div className="field">
          <Checkbox
            label={field.label}
            checked={Boolean(value)}
            onChange={(event) => onChange(event.target.checked)}
          />
          {field.help && <span className="field__hint">{field.help}</span>}
        </div>
      );
    case 'textarea':
      return (
        <TextArea
          label={field.label}
          full
          rows={3}
          required={field.required}
          value={text}
          onChange={handle}
          hint={field.help}
          error={error}
        />
      );
    case 'select':
      return (
        <Select
          label={field.label}
          required={field.required}
          value={text}
          onChange={handle}
          placeholder="Select"
          hint={field.help}
          error={error}
          options={(field.options ?? []).map((option) => ({
            value: option,
            label: option.charAt(0) + option.slice(1).toLowerCase().replace(/_/g, ' '),
          }))}
        />
      );
    case 'lookup':
      return <LookupField field={field} value={text} error={error} onChange={handle} />;
    case 'money':
    case 'percent':
    case 'number':
      return (
        <TextInput
          label={field.type === 'percent' ? `${field.label} (%)` : field.label}
          type="number"
          step={field.type === 'number' ? '1' : '0.01'}
          numeric
          required={field.required}
          value={text}
          onChange={handle}
          hint={field.help}
          error={error}
          prefix={field.type === 'money' ? '₹' : undefined}
        />
      );
    case 'date':
      return (
        <TextInput
          label={field.label}
          type="date"
          required={field.required}
          value={text}
          onChange={handle}
          hint={field.help}
          error={error}
        />
      );
    default:
      return (
        <TextInput
          label={field.label}
          required={field.required}
          value={text}
          onChange={handle}
          hint={field.help}
          error={error}
          maxLength={field.maxLength}
        />
      );
  }
}

/** A dropdown backed by another master. Kept separate so the lookup query only
    runs for fields that actually need it. */
function LookupField({
  field, value, error, onChange,
}: {
  field: MasterField;
  value: string;
  error?: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
}) {
  const lookup = useLookup(field.refKey ?? '');
  return (
    <Select
      label={field.label}
      required={field.required}
      value={value}
      onChange={onChange}
      placeholder={lookup.isLoading ? 'Loading…' : 'Select'}
      hint={field.help}
      error={error}
      options={(lookup.data ?? []).map((option) => ({
        value: option.id,
        label: `${option.name} (${option.code})`,
      }))}
    />
  );
}
