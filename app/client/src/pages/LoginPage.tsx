import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Alert, Button, CheckIcon, TextInput } from '../components/ui';

/** Demo accounts, offered as one-click fill so reviewers can switch roles fast. */
const DEMO_ACCOUNTS: { username: string; role: string }[] = [
  { username: 'ee.kumar', role: 'Executive Engineer' },
  { username: 'ae.reddy', role: 'Assistant Engineer' },
  { username: 'ac.nair', role: 'Account Clerk' },
  { username: 'cao.desai', role: 'Chief Accounts Officer' },
  { username: 'md.rao', role: 'Managing Director' },
  { username: 'admin', role: 'System Administrator' },
];

const HIGHLIGHTS = [
  'One workflow from project sanction through tender award to bill payment',
  'Every file movement recorded, timestamped and auditable',
  'Contractors submit bids and running account bills directly',
  'Bill totals computed to the paisa — never a rounding surprise',
];

export function LoginPage() {
  const { signIn, status } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'authenticated') {
    const from = (location.state as { from?: string })?.from ?? '/dashboard';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(username.trim(), password);
      const from = (location.state as { from?: string })?.from ?? '/dashboard';
      navigate(from, { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="auth-hero__mark">PMIS</div>
        <h1 className="auth-hero__title">Project Management Information System</h1>
        <p className="auth-hero__text">
          The single record for works, procurement and payments across the department — from
          administrative sanction to the final running account bill.
        </p>
        <ul className="auth-hero__points">
          {HIGHLIGHTS.map((point) => (
            <li key={point} className="auth-hero__point">
              <CheckIcon size={18} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="auth-panel">
        <div className="auth-form">
          <h2 className="auth-form__title">Sign in</h2>
          <p className="auth-form__subtitle">
            Use your departmental username, or your registered email if you are a contractor.
          </p>

          <form onSubmit={onSubmit} className="stack">
            {error && <Alert variant="danger" title="Sign in failed">{error}</Alert>}

            <TextInput
              label="Username or email"
              required
              autoComplete="username"
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. ee.kumar"
            />
            <TextInput
              label="Password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <Button type="submit" variant="primary" block loading={submitting}>
              Sign in
            </Button>
          </form>

          <p style={{ marginTop: 18, fontSize: 14, textAlign: 'center', color: 'var(--ink-600)' }}>
            New contractor? <Link to="/register">Register your firm</Link>
          </p>

          <div className="auth-demo">
            <div className="auth-demo__title">Demonstration accounts</div>
            <div className="auth-demo__list">
              {DEMO_ACCOUNTS.map((account) => (
                <div key={account.username} className="auth-demo__row">
                  <button
                    type="button"
                    className="auth-demo__user"
                    onClick={() => {
                      setUsername(account.username);
                      setPassword('Pmis@12345');
                    }}
                  >
                    {account.username}
                  </button>
                  <span className="auth-demo__role">{account.role}</span>
                </div>
              ))}
            </div>
            <p style={{ marginTop: 9, color: 'var(--ink-600)' }}>
              Password for all demo accounts: <strong>Pmis@12345</strong>. Select a name to fill the form.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
