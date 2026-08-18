import { useState, type ChangeEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { dateTime } from '../lib/format';
import type { User } from '../types';
import {
  Alert, Button, Card, EditIcon, PageHeader, PlusIcon, Select, ShieldIcon, TextInput,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { ConfirmModal, Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';

interface Role {
  code: string;
  name: string;
  description: string | null;
  scope: string;
}

interface CredentialResult {
  user: User;
  temporaryPassword: string;
}

export function UsersPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [credentials, setCredentials] = useState<CredentialResult | null>(null);

  const search = params.get('search') ?? '';
  const roleCode = params.get('roleCode') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const roles = useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<Role[]>('/auth/roles'),
    staleTime: 30 * 60 * 1000,
  });

  const users = useQuery({
    queryKey: ['users', search, roleCode, status, page],
    queryFn: () =>
      api.get<Page<User>>('/users', {
        search: search || undefined,
        roleCode: roleCode || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
  });

  const resetPassword = useMutation({
    mutationFn: (id: number) => api.post<CredentialResult>(`/users/${id}/reset-password`),
    onSuccess: (result) => {
      setResetting(null);
      setCredentials(result);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: unknown) =>
      toast.error('Could not reset the password', error instanceof ApiError ? error.message : undefined),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Departmental accounts, their role and their posting. A user only sees work in their own jurisdiction."
        actions={
          <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
            Add a user
          </Button>
        }
      />

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="user-search">Search</label>
            <input
              id="user-search"
              type="search"
              className="input"
              placeholder="Name, username, email or employee code"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Role"
            value={roleCode}
            onChange={(event) => setParam('roleCode', event.target.value)}
            placeholder="All roles"
            options={(roles.data ?? []).map((role) => ({ value: role.code, label: role.name }))}
          />
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'INACTIVE', label: 'Inactive' },
              { value: 'LOCKED', label: 'Locked' },
            ]}
          />
        </div>

        <DataTable
          rows={users.data?.items ?? []}
          rowKey={(row) => row.id}
          loading={users.isLoading}
          caption="Users"
          columns={[
            {
              key: 'name',
              header: 'Officer',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.fullName}</div>
                  <div className="cell-muted code">{row.username}</div>
                </>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              render: (row) => (
                <>
                  <div>{row.roleName}</div>
                  <div className="cell-muted">{row.designation ?? row.roleCode}</div>
                </>
              ),
            },
            {
              key: 'posting',
              header: 'Posting',
              render: (row) =>
                [row.subDivisionName, row.divisionName, row.circleName, row.zoneName]
                  .filter(Boolean)
                  .join(' · ') || (row.contractorName ? `Contractor: ${row.contractorName}` : 'Head office'),
            },
            {
              key: 'contact',
              header: 'Contact',
              render: (row) => (
                <>
                  <div>{row.email}</div>
                  <div className="cell-muted">{row.phone ?? '—'}</div>
                </>
              ),
            },
            {
              key: 'lastLogin',
              header: 'Last signed in',
              render: (row) => (row.lastLoginAt ? dateTime(row.lastLoginAt) : 'Never'),
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
            {
              key: 'actions',
              header: '',
              actions: true,
              render: (row) => (
                <div className="btn-group">
                  <Button size="sm" icon={<EditIcon />} onClick={() => setEditing(row)}>Edit</Button>
                  <Button size="sm" variant="ghost" icon={<ShieldIcon size={16} />} onClick={() => setResetting(row)}>
                    Reset password
                  </Button>
                </div>
              ),
            },
          ]}
          empty={{ title: 'No users match', text: 'Clear the filters, or add a new user.' }}
        />

        {users.data && (
          <Pagination
            page={users.data.page}
            pageSize={users.data.pageSize}
            total={users.data.total}
            onPageChange={(next) => setParam('page', String(next))}
          />
        )}
      </Card>

      {creating && (
        <UserFormDialog
          roles={roles.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(result) => { setCreating(false); setCredentials(result); void refresh(); }}
        />
      )}
      {editing && (
        <UserFormDialog
          roles={roles.data ?? []}
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); void refresh(); }}
        />
      )}

      <ConfirmModal
        open={Boolean(resetting)}
        title="Reset this user’s password?"
        message={
          <>
            <p>
              <strong>{resetting?.fullName}</strong> will be signed out everywhere and issued a temporary
              password, which they must change at their next sign-in.
            </p>
          </>
        }
        confirmLabel="Reset password"
        danger
        loading={resetPassword.isPending}
        onConfirm={() => resetting && resetPassword.mutate(resetting.id)}
        onClose={() => setResetting(null)}
      />

      <Modal
        open={Boolean(credentials)}
        title="Temporary password issued"
        subtitle={credentials?.user.fullName}
        onClose={() => setCredentials(null)}
        footer={<Button variant="primary" onClick={() => setCredentials(null)}>Done</Button>}
      >
        <div className="stack">
          <Alert variant="warn" title="Shown once only">
            Pass this to the officer through a channel you trust. It is not stored anywhere and cannot be
            shown again — you would have to reset the password afresh.
          </Alert>
          <div className="detail-grid">
            <div className="detail-item">
              <div className="detail-item__label">Username</div>
              <div className="detail-item__value code">{credentials?.user.username}</div>
            </div>
            <div className="detail-item">
              <div className="detail-item__label">Temporary password</div>
              <div className="detail-item__value code">{credentials?.temporaryPassword}</div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function UserFormDialog({
  roles, user, onClose, onCreated, onSaved,
}: {
  roles: Role[];
  user?: User;
  onClose: () => void;
  onCreated?: (result: CredentialResult) => void;
  onSaved?: () => void;
}) {
  const toast = useToast();
  const isEdit = Boolean(user);
  const [form, setForm] = useState({
    username: user?.username ?? '',
    email: user?.email ?? '',
    fullName: user?.fullName ?? '',
    employeeCode: user?.employeeCode ?? '',
    designation: user?.designation ?? '',
    roleCode: user?.roleCode ?? '',
    phone: user?.phone ?? '',
    zoneId: user?.zoneId ? String(user.zoneId) : '',
    circleId: user?.circleId ? String(user.circleId) : '',
    divisionId: user?.divisionId ? String(user.divisionId) : '',
    subDivisionId: user?.subDivisionId ? String(user.subDivisionId) : '',
    status: user?.status ?? 'ACTIVE',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const zones = useLookup('zones');
  const circles = useLookup('circles', form.zoneId);
  const divisions = useLookup('divisions', form.circleId);
  const subDivisions = useLookup('sub-divisions', form.divisionId);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => {
        const next = { ...current, [key]: event.target.value };
        // Changing a parent invalidates everything below it in the chain.
        if (key === 'zoneId') { next.circleId = ''; next.divisionId = ''; next.subDivisionId = ''; }
        if (key === 'circleId') { next.divisionId = ''; next.subDivisionId = ''; }
        if (key === 'divisionId') { next.subDivisionId = ''; }
        return next;
      });

  const payload = () => ({
    email: form.email,
    fullName: form.fullName,
    employeeCode: form.employeeCode || undefined,
    designation: form.designation || undefined,
    roleCode: form.roleCode,
    phone: form.phone || undefined,
    zoneId: form.zoneId ? Number(form.zoneId) : undefined,
    circleId: form.circleId ? Number(form.circleId) : undefined,
    divisionId: form.divisionId ? Number(form.divisionId) : undefined,
    subDivisionId: form.subDivisionId ? Number(form.subDivisionId) : undefined,
  });

  const mutation = useMutation<User | CredentialResult>({
    mutationFn: () =>
      isEdit
        ? api.patch<User>(`/users/${user!.id}`, { ...payload(), status: form.status })
        : api.post<CredentialResult>('/users', { username: form.username, ...payload() }),
    onSuccess: (result) => {
      if (isEdit) {
        toast.success('User updated', `${form.fullName} has been saved.`);
        onSaved?.();
      } else {
        onCreated?.(result as CredentialResult);
      }
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the user.');
      }
    },
  });

  // Staff roles only — contractor accounts are created by self-registration.
  const staffRoles = roles.filter((role) => role.code !== 'CONTRACTOR');

  return (
    <Modal
      open
      title={isEdit ? 'Edit user' : 'Add a user'}
      subtitle={
        isEdit
          ? user!.username
          : 'A temporary password is generated on saving. The user must change it at first sign-in.'
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
            {isEdit ? 'Save changes' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Identity</legend>
          <div className="form-grid">
            {!isEdit && (
              <TextInput
                label="Username"
                required
                value={form.username}
                onChange={set('username')}
                error={errors.username}
                hint="Letters, numbers, dots, hyphens and underscores. Cannot be changed later."
                placeholder="e.g. ee.kumar"
              />
            )}
            <TextInput label="Full name" required value={form.fullName} onChange={set('fullName')} error={errors.fullName} />
            <TextInput label="Email" type="email" required value={form.email} onChange={set('email')} error={errors.email} />
            <TextInput label="Phone" value={form.phone} onChange={set('phone')} error={errors.phone} />
            <TextInput label="Employee code" value={form.employeeCode} onChange={set('employeeCode')} error={errors.employeeCode} />
            <TextInput label="Designation" value={form.designation} onChange={set('designation')} error={errors.designation} hint="As printed on the file, e.g. Executive Engineer (Civil)." />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Role and posting</legend>
          <div className="form-grid">
            <Select
              label="Role"
              required
              value={form.roleCode}
              onChange={set('roleCode')}
              placeholder="Select a role"
              error={errors.roleCode}
              hint="The role decides which approval steps land in this user’s inbox."
              options={staffRoles.map((role) => ({ value: role.code, label: `${role.name} (${role.code})` }))}
            />
            {isEdit && (
              <Select
                label="Account status"
                value={form.status}
                onChange={set('status')}
                error={errors.status}
                options={[
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'INACTIVE', label: 'Inactive' },
                  { value: 'LOCKED', label: 'Locked' },
                ]}
              />
            )}
            <Select
              label="Zone"
              value={form.zoneId}
              onChange={set('zoneId')}
              placeholder="Head office"
              error={errors.zoneId}
              options={(zones.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
            />
            <Select
              label="Circle"
              value={form.circleId}
              onChange={set('circleId')}
              placeholder={form.zoneId ? 'Select a circle' : 'Choose a zone first'}
              error={errors.circleId}
              options={(circles.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
            />
            <Select
              label="Division"
              value={form.divisionId}
              onChange={set('divisionId')}
              placeholder={form.circleId ? 'Select a division' : 'Choose a circle first'}
              error={errors.divisionId}
              hint="Engineers and accounts staff must be posted to a division."
              options={(divisions.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
            />
            <Select
              label="Sub division"
              value={form.subDivisionId}
              onChange={set('subDivisionId')}
              placeholder={form.divisionId ? 'Optional' : 'Choose a division first'}
              error={errors.subDivisionId}
              options={(subDivisions.data ?? []).map((row) => ({ value: row.id, label: `${row.name} (${row.code})` }))}
            />
          </div>
        </fieldset>
      </div>
    </Modal>
  );
}
