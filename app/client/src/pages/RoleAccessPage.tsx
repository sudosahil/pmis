import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import type { RoleAccessCatalogue } from '../types';
import { Alert, Button, Card, Checkbox, Loading, PageHeader, ShieldIcon } from '../components/ui';
import { ConfirmModal } from '../components/Modal';

/**
 * Who may do what.
 *
 * The permissions themselves are fixed by the software — a permission means
 * something because a screen or a route checks for it — so what is edited here
 * is which roles hold which. The server enforces the same grants; this screen
 * only decides what people are shown.
 */
export function RoleAccessPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user, refreshUser } = useAuth();

  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['role-access'],
    queryFn: () => api.get<RoleAccessCatalogue>('/roles'),
  });

  const roles = data?.roles ?? [];
  const activeCode = selectedRole ?? roles[0]?.code ?? null;
  const active = roles.find((role) => role.code === activeCode) ?? null;

  // Load the selected role's grants into the draft whenever it changes.
  useEffect(() => {
    if (active) setDraft(new Set(active.permissions));
  }, [active?.code, active?.permissions.join(',')]);

  const save = useMutation({
    mutationFn: () =>
      api.put<RoleAccessCatalogue>(`/roles/${activeCode}/permissions`, {
        permissions: [...draft],
      }),
    onSuccess: (result) => {
      queryClient.setQueryData(['role-access'], result);
      toast.success(
        'Access saved',
        `${active?.name} now holds ${draft.size} permission${draft.size === 1 ? '' : 's'}.`,
      );
      setMessage(null);
      // The signed-in user may have just changed their own role's access.
      if (active?.code === user?.roleCode) void refreshUser();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the changes.'),
  });

  const reset = useMutation({
    mutationFn: () => api.post<RoleAccessCatalogue>(`/roles/${activeCode}/reset`),
    onSuccess: (result) => {
      queryClient.setQueryData(['role-access'], result);
      setResetting(false);
      toast.success('Access reset', `${active?.name} is back to what it shipped with.`);
      if (active?.code === user?.roleCode) void refreshUser();
    },
    onError: (error: unknown) =>
      toast.error('Could not reset', error instanceof ApiError ? error.message : undefined),
  });

  const grouped = useMemo(() => {
    if (!data) return [];
    return data.groups.map((group) => ({
      group,
      permissions: data.permissions.filter((permission) => permission.group === group),
    }));
  }, [data]);

  const dirty = useMemo(() => {
    if (!active) return false;
    if (draft.size !== active.permissions.length) return true;
    return active.permissions.some((key) => !draft.has(key));
  }, [active, draft]);

  function toggle(key: string) {
    setDraft((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(keys: string[], on: boolean) {
    setDraft((current) => {
      const next = new Set(current);
      for (const key of keys) {
        if (on) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  if (isLoading) return <Loading label="Loading role access…" />;
  if (isError || !data) {
    return (
      <Alert variant="danger" title="Could not load role access">
        This screen is restricted to administrators.
      </Alert>
    );
  }

  return (
    <>
      <PageHeader
        title="Role access"
        subtitle="What each role in the department is allowed to do. Changing it takes effect immediately, for everyone holding that role."
        actions={
          active ? (
            <>
              <Button
                variant="ghost"
                onClick={() => setResetting(true)}
                disabled={active.isDefault && !dirty}
              >
                Reset to default
              </Button>
              <Button
                variant="primary"
                loading={save.isPending}
                disabled={!dirty}
                onClick={() => { setMessage(null); save.mutate(); }}
              >
                {dirty ? 'Save changes' : 'Saved'}
              </Button>
            </>
          ) : undefined
        }
      />

      <Alert variant="info" title="The list of permissions is fixed; who holds them is not">
        A permission exists because some screen or action checks for it, so new ones arrive with the
        software. What you decide here is which roles hold which — and the server applies the same
        answer, so hiding a button here genuinely refuses the action too.
      </Alert>

      {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(220px, 280px) minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <nav className="card" aria-label="Roles" style={{ padding: 8 }}>
          <div className="nav-section">
            <h2 className="nav-section__title">Roles</h2>
            {roles.map((role) => (
              <button
                key={role.code}
                type="button"
                className={`nav-link${role.code === activeCode ? ' is-active' : ''}`}
                style={{
                  width: '100%', border: 'none', background: 'none',
                  font: 'inherit', textAlign: 'left', cursor: 'pointer',
                }}
                onClick={() => setSelectedRole(role.code)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: 600 }}>{role.name}</span>
                  <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-600)' }}>
                    {role.code} · {role.permissions.length} permission
                    {role.permissions.length === 1 ? '' : 's'}
                    {!role.isDefault && ' · changed'}
                  </span>
                </span>
                {role.userCount > 0 && <span className="nav-link__count">{role.userCount}</span>}
              </button>
            ))}
          </div>
        </nav>

        {active && (
          <div className="stack">
            <Card
              title={active.name}
              subtitle={active.description ?? `Access held by everyone posted as ${active.code}.`}
              actions={
                <div className="row">
                  <span className="badge badge--neutral">{active.code}</span>
                  <span className={`badge badge--${active.isDefault ? 'ok' : 'warn'}`}>
                    {active.isDefault ? 'Default access' : 'Changed from default'}
                  </span>
                </div>
              }
            >
              <p style={{ color: 'var(--ink-700)' }}>
                <strong>{active.userCount}</strong> active account
                {active.userCount === 1 ? '' : 's'} hold this role, and{' '}
                <strong>{draft.size}</strong> of {data.permissions.length} permissions are ticked.
                {dirty && ' You have unsaved changes.'}
              </p>
              {active.code === user?.roleCode && (
                <Alert variant="warn" title="This is your own role">
                  Removing something here takes it away from you as well. You cannot give up managing
                  users or role access, so you will always be able to undo a mistake.
                </Alert>
              )}
            </Card>

            {grouped.map(({ group, permissions }) => {
              const keys = permissions.map((permission) => permission.key);
              const allOn = keys.every((key) => draft.has(key));
              const someOn = keys.some((key) => draft.has(key));

              return (
                <Card
                  key={group}
                  title={group}
                  subtitle={`${keys.filter((key) => draft.has(key)).length} of ${keys.length} granted`}
                  actions={
                    <Button size="sm" onClick={() => toggleGroup(keys, !allOn)}>
                      {allOn ? 'Clear all' : someOn ? 'Grant all' : 'Grant all'}
                    </Button>
                  }
                >
                  <div className="stack stack--sm">
                    {permissions.map((permission) => {
                      const locked = permission.lockedForAdmin && active.code === 'ADMIN';
                      return (
                        <div
                          key={permission.key}
                          style={{
                            padding: '10px 12px',
                            border: '1px solid var(--line-soft)',
                            borderRadius: 8,
                            background: draft.has(permission.key) ? 'var(--brand-050)' : 'transparent',
                            opacity: locked ? 0.75 : 1,
                          }}
                        >
                          <Checkbox
                            label={permission.label}
                            checked={draft.has(permission.key)}
                            disabled={locked}
                            onChange={() => toggle(permission.key)}
                          />
                          <div
                            style={{
                              color: 'var(--ink-600)',
                              fontSize: 13,
                              marginTop: 4,
                              marginLeft: 26,
                            }}
                          >
                            {permission.description}
                            {locked && ' — the administrator cannot give this up.'}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmModal
        open={resetting}
        title={`Reset ${active?.name} to default access?`}
        message={
          <p>
            Every permission held by <strong>{active?.name}</strong> goes back to what the system
            shipped with. Anyone holding the role is affected immediately.
          </p>
        }
        confirmLabel="Reset to default"
        danger
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
        onClose={() => setResetting(false)}
      />
    </>
  );
}

/** Shown to a role that cannot reach a screen at all. */
export function NoAccess({ what }: { what: string }) {
  return (
    <Alert variant="warn" title="Not available to your role">
      <span>
        <ShieldIcon size={14} /> Your role does not have permission to {what}. An administrator can
        grant it on the role access screen.
      </span>
    </Alert>
  );
}
