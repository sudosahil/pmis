import { useState, type FormEvent } from 'react';
import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { api, ApiError } from './api/client';
import { useAuth } from './context/AuthContext';
import { useToast } from './components/Toast';
import { AppLayout } from './components/AppLayout';
import { Modal } from './components/Modal';
import { Alert, Button, EmptyState, Loading, PageHeader, ShieldIcon, TextInput } from './components/ui';

import { LoginPage } from './pages/LoginPage';
import { RegisterContractorPage } from './pages/RegisterContractorPage';
import { DashboardPage } from './pages/DashboardPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { PackagesPage, PackageDetailPage } from './pages/PackagesPage';
import { TendersPage } from './pages/TendersPage';
import { TenderDetailPage } from './pages/TenderDetailPage';
import { MyBidsPage } from './pages/MyBidsPage';
import { ContractorsPage } from './pages/ContractorsPage';
import { ContractorDetailPage } from './pages/ContractorDetailPage';
import { RaBillsPage } from './pages/RaBillsPage';
import { RaBillDetailPage } from './pages/RaBillDetailPage';
import { RaBillFormPage } from './pages/RaBillFormPage';
import { MiscBillsPage } from './pages/MiscBillsPage';
import { MiscBillDetailPage } from './pages/MiscBillDetailPage';
import { MiscBillFormPage } from './pages/MiscBillFormPage';
import { FundsPage } from './pages/FundsPage';
import { LocRequestDetailPage } from './pages/LocRequestDetailPage';
import { MastersPage } from './pages/MastersPage';
import { WorkflowsPage } from './pages/WorkflowsPage';
import { UsersPage } from './pages/UsersPage';
import { AuditPage } from './pages/AuditPage';
import { FilesPage } from './pages/FilesPage';
import { ChatPage } from './pages/ChatPage';
import { LiveActivityPage } from './pages/LiveActivityPage';
import { ProfilePage } from './pages/ProfilePage';
import { SearchPage } from './pages/SearchPage';
import { RoleAccessPage } from './pages/RoleAccessPage';
import { ReportsPage } from './pages/ReportsPage';
import { LandAcquisitionPage } from './pages/LandAcquisitionPage';
import { CourtCasesPage } from './pages/CourtCasesPage';
import { CommitteesPage } from './pages/CommitteesPage';
import { RtiPage } from './pages/RtiPage';

/** Sends anyone without a session to the sign-in screen, remembering where they were headed. */
function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Loading label="Restoring your session…" />
      </div>
    );
  }
  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  return (
    <>
      <MustChangePassword />
      <AppLayout />
    </>
  );
}

/**
 * Guards a route on a permission and explains the refusal rather than
 * redirecting silently. Which roles hold the permission is configured on the
 * role access screen, so moving access around needs no code change.
 */
function RequirePermission({ permission }: { permission: string }) {
  const { user, can } = useAuth();
  if (!user) return null;
  if (can(permission)) return <Outlet />;

  return (
    <>
      <PageHeader title="Not available to your role" />
      <EmptyState
        icon={<ShieldIcon size={40} />}
        title="You do not have access to this screen"
        text={`This part of PMIS is restricted. You are signed in as ${user.roleName}, and that role has not been granted this access. Your system administrator can grant it on the role access screen.`}
        action={<Link to="/dashboard" className="btn btn--primary">Back to dashboard</Link>}
      />
    </>
  );
}

/**
 * A freshly issued or reset account must set its own password before the
 * holder can work — the temporary one is known to whoever created the account.
 */
function MustChangePassword() {
  const { mustChangePassword, clearPasswordPrompt } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!mustChangePassword) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setError('The two new passwords do not match.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed', 'Use your new password the next time you sign in.');
      clearPasswordPrompt();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open
      title="Set a new password"
      subtitle="Your account is still on the password you were issued. Choose your own before you continue."
      onClose={() => {}}
    >
      <form id="first-password" onSubmit={submit} className="stack">
        {error && <Alert variant="danger" title="Could not change the password">{error}</Alert>}
        <TextInput
          label="Current password"
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <TextInput
          label="New password"
          type="password"
          required
          autoComplete="new-password"
          hint="At least 10 characters, with a letter, a number and a symbol."
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <TextInput
          label="Confirm new password"
          type="password"
          required
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
        />
        <Button type="submit" variant="primary" block loading={saving}>
          Change password
        </Button>
      </form>
    </Modal>
  );
}

function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title="That page does not exist"
        text="The link may be out of date, or the record may have been removed."
        action={<Link to="/dashboard" className="btn btn--primary">Back to dashboard</Link>}
      />
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterContractorPage />} />

      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route element={<RequirePermission permission="files.view" />}>
          <Route path="/files" element={<FilesPage />} />
        </Route>
        <Route element={<RequirePermission permission="chat.use" />}>
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/chat/:id" element={<ChatPage />} />
        </Route>

        <Route element={<RequirePermission permission="projects.view" />}>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="/packages/:id" element={<PackageDetailPage />} />
        </Route>

        <Route element={<RequirePermission permission="tenders.view" />}>
          <Route path="/tenders" element={<TendersPage />} />
          <Route path="/tenders/:id" element={<TenderDetailPage />} />
        </Route>

        <Route element={<RequirePermission permission="bills.ra.view" />}>
          <Route path="/ra-bills" element={<RaBillsPage />} />
          <Route path="/ra-bills/new" element={<RaBillFormPage />} />
          <Route path="/ra-bills/:id" element={<RaBillDetailPage />} />
          <Route path="/ra-bills/:id/edit" element={<RaBillFormPage />} />
        </Route>

        <Route element={<RequirePermission permission="tenders.bid" />}>
          <Route path="/my-bids" element={<MyBidsPage />} />
        </Route>

        <Route element={<RequirePermission permission="approvals.act" />}>
          <Route path="/approvals" element={<ApprovalsPage />} />
        </Route>

        <Route element={<RequirePermission permission="contractors.view" />}>
          <Route path="/contractors" element={<ContractorsPage />} />
          <Route path="/contractors/:id" element={<ContractorDetailPage />} />
        </Route>

        <Route element={<RequirePermission permission="bills.misc.view" />}>
          <Route path="/misc-bills" element={<MiscBillsPage />} />
          <Route path="/misc-bills/new" element={<MiscBillFormPage />} />
          <Route path="/misc-bills/:id" element={<MiscBillDetailPage />} />
          <Route path="/misc-bills/:id/edit" element={<MiscBillFormPage />} />
        </Route>

        <Route element={<RequirePermission permission="funds.view" />}>
          <Route path="/funds" element={<FundsPage />} />
          <Route path="/funds/loc/:id" element={<LocRequestDetailPage />} />
        </Route>

        <Route element={<RequirePermission permission="land.view" />}>
          <Route path="/land" element={<LandAcquisitionPage />} />
        </Route>

        <Route element={<RequirePermission permission="court.view" />}>
          <Route path="/court-cases" element={<CourtCasesPage />} />
        </Route>

        <Route element={<RequirePermission permission="committees.view" />}>
          <Route path="/committees" element={<CommitteesPage />} />
        </Route>

        <Route element={<RequirePermission permission="rti.view" />}>
          <Route path="/rti" element={<RtiPage />} />
        </Route>

        <Route element={<RequirePermission permission="reports.view" />}>
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:key" element={<ReportsPage />} />
        </Route>

        <Route element={<RequirePermission permission="masters.view" />}>
          <Route path="/masters" element={<MastersPage />} />
          <Route path="/masters/:key" element={<MastersPage />} />
        </Route>

        <Route element={<RequirePermission permission="workflows.view" />}>
          <Route path="/workflows" element={<WorkflowsPage />} />
        </Route>

        <Route element={<RequirePermission permission="users.manage" />}>
          <Route path="/users" element={<UsersPage />} />
        </Route>

        <Route element={<RequirePermission permission="roles.manage" />}>
          <Route path="/roles" element={<RoleAccessPage />} />
        </Route>

        <Route element={<RequirePermission permission="audit.view" />}>
          <Route path="/audit" element={<AuditPage />} />
        </Route>

        <Route element={<RequirePermission permission="activity.view" />}>
          <Route path="/activity" element={<LiveActivityPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
