import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { date, dateTime, percent, rupeesShort } from '../lib/format';
import type { ContractorDetail } from '../types';
import {
  Alert, Button, Card, DetailItem, EditIcon, Loading, PageHeader, Select, TextArea, TextInput,
} from '../components/ui';
import { Modal } from '../components/Modal';
import { StatusBadge } from '../components/StatusBadge';
import { WorkflowPanel } from '../components/WorkflowPanel';

const CLASSES = ['Class A', 'Class B', 'Class C', 'Class D'];
const TYPES = [
  'Proprietorship', 'Partnership', 'Private Limited', 'Public Limited', 'LLP', 'Cooperative Society',
];

export function ContractorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const [editing, setEditing] = useState(false);
  const [blacklisting, setBlacklisting] = useState(false);

  const { data: contractor, isLoading, isError } = useQuery({
    queryKey: ['contractor', id],
    queryFn: () => api.get<ContractorDetail>(`/contractors/${id}`),
    enabled: Boolean(id),
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['contractor', id] });
    void queryClient.invalidateQueries({ queryKey: ['contractors'] });
    void queryClient.invalidateQueries({ queryKey: ['approvals'] });
  };

  if (isLoading) return <Loading label="Loading the contractor…" />;
  if (isError || !contractor) {
    return (
      <Alert variant="danger" title="Contractor not found">
        This firm does not exist, or you do not have access to it.
      </Alert>
    );
  }

  const canEdit = hasRole('ADMIN', 'EE', 'AEE', 'AC', 'AS', 'CAO', 'AAO');
  const canBlacklist = hasRole('ADMIN', 'CE', 'SE', 'CAO');
  const stats = contractor.stats;

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/contractors">Contractors</Link>
            <span className="breadcrumb__sep">/</span>
            <span>{contractor.code}</span>
          </>
        }
        title={contractor.name}
        subtitle={
          <>
            <span className="code">{contractor.code}</span>
            {contractor.registrationClass ? ` · ${contractor.registrationClass}` : ''}
            {contractor.contractorType ? ` · ${contractor.contractorType}` : ''}
          </>
        }
        actions={
          <>
            {canEdit && (
              <Button icon={<EditIcon />} onClick={() => setEditing(true)}>Edit details</Button>
            )}
            {canBlacklist && (
              <Button
                variant={contractor.isBlacklisted ? 'success' : 'danger'}
                onClick={() => setBlacklisting(true)}
              >
                {contractor.isBlacklisted ? 'Remove from blacklist' : 'Blacklist firm'}
              </Button>
            )}
          </>
        }
      />

      {contractor.isBlacklisted && (
        <Alert variant="danger" title="This firm is blacklisted">
          It cannot bid for new tenders or be awarded work. {contractor.remarks}
        </Alert>
      )}

      <div className="grid grid--4">
        <div className="stat stat--accent">
          <div className="stat__label">Live works</div>
          <div className="stat__value">{stats.activePackages}</div>
          <div className="stat__meta">{stats.completedPackages} completed</div>
        </div>
        <div className="stat">
          <div className="stat__label">Value awarded</div>
          <div className="stat__value stat__value--currency">{rupeesShort(stats.awardedValue)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">Paid to date</div>
          <div className="stat__value stat__value--currency">{rupeesShort(stats.amountPaid)}</div>
          <div className="stat__meta">{stats.billsPaid} of {stats.billsSubmitted} bills paid</div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__label">Awaiting payment</div>
          <div className="stat__value stat__value--currency">{rupeesShort(stats.amountPending)}</div>
        </div>
      </div>

      <div className="grid grid--2">
        <div className="stack">
          <Card title="Registration">
            <div className="detail-grid">
              <DetailItem label="Registration status" value={<StatusBadge status={contractor.registrationStatus} />} />
              <DetailItem label="Account status" value={<StatusBadge status={contractor.status} />} />
              <DetailItem label="Class" value={contractor.registrationClass} />
              <DetailItem label="Constitution" value={contractor.contractorType} />
              <DetailItem label="Registration number" value={contractor.registrationNo} />
              <DetailItem label="e-Procurement number" value={contractor.eprocNo} />
              <DetailItem label="Valid until" value={date(contractor.validityDate)} />
              <DetailItem label="Registered on" value={dateTime(contractor.createdAt)} />
            </div>
          </Card>

          <Card title="Contact and address">
            <div className="detail-grid">
              <DetailItem label="Contact person" value={contractor.contactPerson} />
              <DetailItem label="Email" value={contractor.email} />
              <DetailItem label="Phone" value={contractor.phone} />
              <DetailItem
                label="Address"
                value={
                  [
                    contractor.address.building,
                    contractor.address.street,
                    contractor.address.area,
                    contractor.address.city,
                    contractor.address.state,
                    contractor.address.zipCode,
                  ]
                    .filter(Boolean)
                    .join(', ') || null
                }
              />
            </div>
          </Card>

          <Card
            title="Tax and banking"
            subtitle="Bank account numbers are masked. Payments are released only to the account on record."
          >
            <div className="detail-grid">
              <DetailItem label="PAN" value={<span className="code">{contractor.pan}</span>} />
              <DetailItem label="GSTIN" value={contractor.gstin ? <span className="code">{contractor.gstin}</span> : null} />
              <DetailItem label="TDS rate" value={percent(contractor.tdsRate)} />
              <DetailItem label="Bank" value={contractor.bank.bankName} />
              <DetailItem label="Branch" value={contractor.bank.branch} />
              <DetailItem label="Account number" value={contractor.bank.accountNo ? <span className="code">{contractor.bank.accountNo}</span> : null} />
              <DetailItem label="Account type" value={contractor.bank.accountType} />
              <DetailItem label="IFSC" value={contractor.bank.ifscCode ? <span className="code">{contractor.bank.ifscCode}</span> : null} />
            </div>
          </Card>
        </div>

        <WorkflowPanel workflow={contractor.workflow} onActed={refresh} />
      </div>

      {editing && (
        <EditContractorDialog contractor={contractor} onClose={() => setEditing(false)} onSaved={refresh} />
      )}
      {blacklisting && (
        <BlacklistDialog contractor={contractor} onClose={() => setBlacklisting(false)} onSaved={refresh} />
      )}
    </>
  );
}

function EditContractorDialog({
  contractor, onClose, onSaved,
}: {
  contractor: ContractorDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const banks = useLookup('banks');
  const [form, setForm] = useState({
    contactPerson: contractor.contactPerson ?? '',
    email: contractor.email,
    phone: contractor.phone ?? '',
    registrationClass: contractor.registrationClass ?? '',
    contractorType: contractor.contractorType ?? '',
    registrationNo: contractor.registrationNo ?? '',
    eprocNo: contractor.eprocNo ?? '',
    validityDate: contractor.validityDate ?? '',
    tdsRate: String(contractor.tdsRate),
    bankId: contractor.bank.bankId ? String(contractor.bank.bankId) : '',
    bankBranch: contractor.bank.branch ?? '',
    bankAccountType: contractor.bank.accountType ?? '',
    remarks: contractor.remarks ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/contractors/${contractor.id}`, {
        contactPerson: form.contactPerson || undefined,
        email: form.email,
        phone: form.phone,
        registrationClass: form.registrationClass || undefined,
        contractorType: form.contractorType || undefined,
        registrationNo: form.registrationNo || undefined,
        eprocNo: form.eprocNo || undefined,
        validityDate: form.validityDate || undefined,
        tdsRate: Number(form.tdsRate),
        bankId: form.bankId ? Number(form.bankId) : undefined,
        bankBranch: form.bankBranch || undefined,
        bankAccountType: form.bankAccountType || undefined,
        remarks: form.remarks || undefined,
      }),
    onSuccess: () => {
      toast.success('Contractor updated', `${contractor.name} has been saved.`);
      onSaved();
      onClose();
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the changes.');
      }
    },
  });

  return (
    <Modal
      open
      title="Edit contractor"
      subtitle={contractor.name}
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
            Save changes
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Registration</legend>
          <div className="form-grid">
            <Select
              label="Class"
              value={form.registrationClass}
              onChange={set('registrationClass')}
              placeholder="Not classified"
              error={errors.registrationClass}
              options={CLASSES.map((value) => ({ value, label: value }))}
            />
            <Select
              label="Constitution"
              value={form.contractorType}
              onChange={set('contractorType')}
              placeholder="Not recorded"
              error={errors.contractorType}
              options={TYPES.map((value) => ({ value, label: value }))}
            />
            <TextInput
              label="Registration number"
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
            <TextInput
              label="TDS rate (%)"
              type="number"
              step="0.01"
              min="0"
              max="30"
              numeric
              value={form.tdsRate}
              onChange={set('tdsRate')}
              error={errors.tdsRate}
              hint="Applied to every running account bill of this firm."
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Contact</legend>
          <div className="form-grid">
            <TextInput label="Contact person" value={form.contactPerson} onChange={set('contactPerson')} error={errors.contactPerson} />
            <TextInput label="Email" type="email" required value={form.email} onChange={set('email')} error={errors.email} />
            <TextInput label="Phone" required value={form.phone} onChange={set('phone')} error={errors.phone} />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Banking</legend>
          <div className="form-grid">
            <Select
              label="Bank"
              value={form.bankId}
              onChange={set('bankId')}
              placeholder="Not recorded"
              error={errors.bankId}
              options={(banks.data ?? []).map((bank) => ({ value: bank.id, label: bank.name }))}
            />
            <TextInput label="Branch" value={form.bankBranch} onChange={set('bankBranch')} error={errors.bankBranch} />
            <Select
              label="Account type"
              value={form.bankAccountType}
              onChange={set('bankAccountType')}
              placeholder="Not recorded"
              error={errors.bankAccountType}
              options={['Savings', 'Current', 'Cash Credit', 'Overdraft'].map((value) => ({ value, label: value }))}
            />
          </div>
        </fieldset>

        <TextArea
          label="Office remarks"
          full
          rows={3}
          value={form.remarks}
          onChange={set('remarks')}
          error={errors.remarks}
          hint="Visible to departmental staff only."
        />
      </div>
    </Modal>
  );
}

function BlacklistDialog({
  contractor, onClose, onSaved,
}: {
  contractor: ContractorDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const lifting = contractor.isBlacklisted;

  const mutation = useMutation({
    mutationFn: () =>
      api.post(`/contractors/${contractor.id}/blacklist`, { blacklisted: !lifting, reason }),
    onSuccess: () => {
      toast.success(
        lifting ? 'Blacklisting removed' : 'Firm blacklisted',
        `${contractor.name} has been updated and the reason recorded in the audit trail.`,
      );
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not update the firm.'),
  });

  return (
    <Modal
      open
      title={lifting ? 'Remove from blacklist' : 'Blacklist this firm'}
      subtitle={contractor.name}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant={lifting ? 'success' : 'danger'}
            loading={mutation.isPending}
            disabled={reason.trim().length < 5}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            {lifting ? 'Remove blacklisting' : 'Blacklist firm'}
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not update">{message}</Alert>}
        <Alert variant={lifting ? 'info' : 'warn'} title={lifting ? 'The firm becomes eligible again' : 'The firm becomes ineligible'}>
          {lifting
            ? 'It will be able to bid for tenders and be awarded work once more.'
            : 'It will be barred from bidding and from being awarded new work. Existing bills are unaffected.'}
        </Alert>
        <TextArea
          label="Reason"
          required
          full
          rows={4}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Recorded permanently against the firm. At least five characters."
        />
      </div>
    </Modal>
  );
}
