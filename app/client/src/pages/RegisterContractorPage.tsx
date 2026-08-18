import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import type { LookupOption } from '../types';
import { Alert, Button, CheckIcon, Select, TextInput } from '../components/ui';

const TYPES = [
  'Proprietorship', 'Partnership', 'Private Limited', 'Public Limited', 'LLP', 'Cooperative Society',
];
const CLASSES = ['Class A', 'Class B', 'Class C', 'Class D'];
const ACCOUNT_TYPES = ['Savings', 'Current', 'Cash Credit', 'Overdraft'];

interface RegistrationResult {
  contractorCode: string;
  username: string;
  activationToken: string;
  message: string;
}

const EMPTY = {
  name: '',
  contractorType: '',
  registrationClass: '',
  registrationNo: '',
  eprocNo: '',
  pan: '',
  gstin: '',
  contactPerson: '',
  email: '',
  phone: '',
  building: '',
  street: '',
  area: '',
  city: '',
  state: '',
  zipCode: '',
  bankId: '',
  bankBranch: '',
  bankAccountNo: '',
  bankAccountType: '',
  ifscCode: '',
  validityDate: '',
};

export function RegisterContractorPage() {
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);

  const banks = useQuery({
    queryKey: ['registration-banks'],
    queryFn: () => api.get<LookupOption[]>('/contractors/register/banks'),
    staleTime: 10 * 60 * 1000,
  });

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      api.anonymousPost<RegistrationResult>('/contractors/register', {
        name: form.name,
        contractorType: form.contractorType || undefined,
        registrationClass: form.registrationClass || undefined,
        registrationNo: form.registrationNo || undefined,
        eprocNo: form.eprocNo || undefined,
        pan: form.pan,
        gstin: form.gstin || undefined,
        contactPerson: form.contactPerson || undefined,
        email: form.email,
        phone: form.phone,
        building: form.building || undefined,
        street: form.street || undefined,
        area: form.area || undefined,
        city: form.city,
        state: form.state,
        country: 'India',
        zipCode: form.zipCode,
        bankId: form.bankId ? Number(form.bankId) : undefined,
        bankBranch: form.bankBranch || undefined,
        bankAccountNo: form.bankAccountNo || undefined,
        bankAccountType: form.bankAccountType || undefined,
        ifscCode: form.ifscCode || undefined,
        validityDate: form.validityDate || undefined,
      }),
    onSuccess: (data) => setResult(data),
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not submit the registration. Please try again.');
      }
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrors({});
    setMessage(null);
    mutation.mutate();
  }

  return (
    <div className="auth-page">
      <section className="auth-hero">
        <div className="auth-hero__mark">PMIS</div>
        <h1 className="auth-hero__title">Register your firm</h1>
        <p className="auth-hero__text">
          Registration gives your firm a login to the contractor portal. From there you can bid for
          tenders, track your work packages and raise running account bills directly.
        </p>
        <ul className="auth-hero__points">
          {[
            'Your details are verified by the division office before the account is activated',
            'Bank details are used only for releasing payments due to you',
            'You may update your particulars at any time after activation',
          ].map((point) => (
            <li key={point} className="auth-hero__point">
              <CheckIcon size={18} />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="auth-panel">
        {result ? (
          <div className="auth-form auth-form--wide stack">
            <h2 className="auth-form__title">Registration submitted</h2>
            <Alert variant="ok" title="Your application has been received">
              {result.message}
            </Alert>
            <div className="detail-grid">
              <div className="detail-item">
                <div className="detail-item__label">Contractor code</div>
                <div className="detail-item__value code">{result.contractorCode}</div>
              </div>
              <div className="detail-item">
                <div className="detail-item__label">Your username</div>
                <div className="detail-item__value code">{result.username}</div>
              </div>
              <div className="detail-item">
                <div className="detail-item__label">Activation reference</div>
                <div className="detail-item__value code">{result.activationToken}</div>
              </div>
            </div>
            <Alert variant="warn" title="Keep the activation reference safe">
              Quote it if you contact the division office about your registration. You will be told by
              email when your account is activated.
            </Alert>
            <Link to="/login" className="btn btn--primary btn--block">Go to sign in</Link>
          </div>
        ) : (
          <form className="auth-form auth-form--wide stack" onSubmit={submit}>
            <div>
              <h2 className="auth-form__title">Contractor registration</h2>
              <p className="auth-form__subtitle">
                Fields marked with an asterisk are required. Enter the details exactly as they appear on
                your PAN and bank records.
              </p>
            </div>

            {message && <Alert variant="danger" title="Could not submit">{message}</Alert>}

            <fieldset className="fieldset">
              <legend className="fieldset__legend">The firm</legend>
              <div className="form-grid">
                <TextInput
                  label="Contractor or company name"
                  required
                  full
                  value={form.name}
                  onChange={set('name')}
                  error={errors.name}
                  maxLength={200}
                />
                <Select
                  label="Constitution"
                  value={form.contractorType}
                  onChange={set('contractorType')}
                  placeholder="Select"
                  error={errors.contractorType}
                  options={TYPES.map((value) => ({ value, label: value }))}
                />
                <Select
                  label="Class of registration"
                  value={form.registrationClass}
                  onChange={set('registrationClass')}
                  placeholder="Select"
                  error={errors.registrationClass}
                  hint="As granted by the department."
                  options={CLASSES.map((value) => ({ value, label: value }))}
                />
                <TextInput
                  label="Departmental registration number"
                  value={form.registrationNo}
                  onChange={set('registrationNo')}
                  error={errors.registrationNo}
                />
                <TextInput
                  label="e-Procurement number"
                  value={form.eprocNo}
                  onChange={set('eprocNo')}
                  error={errors.eprocNo}
                />
                <TextInput
                  label="Registration valid until"
                  type="date"
                  value={form.validityDate}
                  onChange={set('validityDate')}
                  error={errors.validityDate}
                />
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset__legend">Tax identifiers</legend>
              <div className="form-grid">
                <TextInput
                  label="PAN"
                  required
                  value={form.pan}
                  onChange={set('pan')}
                  error={errors.pan}
                  placeholder="ABCDE1234F"
                  maxLength={10}
                  style={{ textTransform: 'uppercase' }}
                />
                <TextInput
                  label="GSTIN"
                  value={form.gstin}
                  onChange={set('gstin')}
                  error={errors.gstin}
                  placeholder="29ABCDE1234F1Z5"
                  maxLength={15}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset__legend">Contact</legend>
              <div className="form-grid">
                <TextInput
                  label="Contact person"
                  value={form.contactPerson}
                  onChange={set('contactPerson')}
                  error={errors.contactPerson}
                />
                <TextInput
                  label="Email"
                  type="email"
                  required
                  value={form.email}
                  onChange={set('email')}
                  error={errors.email}
                  hint="Your username and all notices are sent here."
                />
                <TextInput
                  label="Mobile number"
                  required
                  value={form.phone}
                  onChange={set('phone')}
                  error={errors.phone}
                />
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset__legend">Address</legend>
              <div className="form-grid">
                <TextInput label="Building" value={form.building} onChange={set('building')} error={errors.building} />
                <TextInput label="Street" value={form.street} onChange={set('street')} error={errors.street} />
                <TextInput label="Area or locality" value={form.area} onChange={set('area')} error={errors.area} />
                <TextInput label="City" required value={form.city} onChange={set('city')} error={errors.city} />
                <TextInput label="State" required value={form.state} onChange={set('state')} error={errors.state} />
                <TextInput
                  label="PIN code"
                  required
                  value={form.zipCode}
                  onChange={set('zipCode')}
                  error={errors.zipCode}
                  maxLength={6}
                  inputMode="numeric"
                />
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend className="fieldset__legend">Bank account for payments</legend>
              <div className="form-grid">
                <Select
                  label="Bank"
                  value={form.bankId}
                  onChange={set('bankId')}
                  placeholder={banks.isLoading ? 'Loading banks…' : 'Select your bank'}
                  error={errors.bankId}
                  options={(banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }))}
                />
                <TextInput label="Branch" value={form.bankBranch} onChange={set('bankBranch')} error={errors.bankBranch} />
                <TextInput
                  label="Account number"
                  value={form.bankAccountNo}
                  onChange={set('bankAccountNo')}
                  error={errors.bankAccountNo}
                  inputMode="numeric"
                />
                <Select
                  label="Account type"
                  value={form.bankAccountType}
                  onChange={set('bankAccountType')}
                  placeholder="Select"
                  error={errors.bankAccountType}
                  options={ACCOUNT_TYPES.map((value) => ({ value, label: value }))}
                />
                <TextInput
                  label="IFSC code"
                  value={form.ifscCode}
                  onChange={set('ifscCode')}
                  error={errors.ifscCode}
                  placeholder="SBIN0001234"
                  maxLength={11}
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            </fieldset>

            <Button type="submit" variant="primary" block loading={mutation.isPending}>
              Submit registration
            </Button>

            <p style={{ textAlign: 'center', color: 'var(--ink-600)' }}>
              Already registered? <Link to="/login">Sign in</Link>
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
