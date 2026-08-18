import { useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { dateTime } from '../lib/format';
import { Alert, Button, Card, DetailItem, PageHeader, TextInput } from '../components/ui';
import { StatusBadge } from '../components/StatusBadge';

export function ProfilePage() {
  const { user } = useAuth();
  const toast = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;

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
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the password.');
    } finally {
      setSaving(false);
    }
  }

  const posting = [user.subDivisionName, user.divisionName, user.circleName, user.zoneName]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <PageHeader
        title="Profile and password"
        subtitle="Your posting decides which projects, bills and approvals you can see."
      />

      <div className="grid grid--2">
        <Card title="Your details" subtitle="Contact the system administrator to correct any of these.">
          <div className="detail-grid">
            <DetailItem label="Full name" value={user.fullName} />
            <DetailItem label="Username" value={<span className="code">{user.username}</span>} />
            <DetailItem label="Employee code" value={user.employeeCode} />
            <DetailItem label="Designation" value={user.designation ?? user.roleName} />
            <DetailItem label="Role" value={user.roleName} />
            <DetailItem label="Email" value={user.email} />
            <DetailItem label="Phone" value={user.phone} />
            <DetailItem label="Account status" value={<StatusBadge status={user.status} />} />
            {user.contractorName && <DetailItem label="Firm" value={user.contractorName} />}
            <DetailItem label="Posting" value={posting} />
            <DetailItem label="Last signed in" value={dateTime(user.lastLoginAt)} />
            <DetailItem label="Account created" value={dateTime(user.createdAt)} />
          </div>
        </Card>

        <Card
          title="Change password"
          subtitle="Choose something you do not use anywhere else. You will stay signed in on this device."
        >
          <form onSubmit={submit} className="stack">
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
            <div>
              <Button type="submit" variant="primary" loading={saving}>Change password</Button>
            </div>
          </form>
        </Card>
      </div>
    </>
  );
}
