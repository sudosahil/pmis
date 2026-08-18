import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { date, dateTime, relativeTime, rupees, rupeesShort } from '../lib/format';
import type { Project, Tender } from '../types';
import {
  Alert, Button, Card, PageHeader, PlusIcon, Select, TextArea, TextInput,
} from '../components/ui';
import { DataTable, Pagination } from '../components/DataTable';
import { StatusBadge } from '../components/StatusBadge';
import { Modal } from '../components/Modal';
import { useToast } from '../components/Toast';

const TENDER_STATUSES = [
  'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'BIDDING_CLOSED',
  'TECHNICAL_EVALUATION', 'FINANCIAL_EVALUATION', 'AWARDED', 'CANCELLED', 'REJECTED',
];

export function TendersPage() {
  const navigate = useNavigate();
  const { hasRole, isContractor } = useAuth();
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);

  const search = params.get('search') ?? '';
  const status = params.get('status') ?? '';
  const page = Number(params.get('page') ?? 1);

  const canCreate = hasRole('ADMIN', 'CE', 'SE', 'EE');

  const { data, isLoading } = useQuery({
    queryKey: ['tenders', search, status, page],
    queryFn: () =>
      api.get<Page<Tender>>('/tenders', {
        search: search || undefined,
        status: status || undefined,
        page,
        pageSize: 20,
      }),
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <>
      <PageHeader
        title={isContractor ? 'Tender notices' : 'Tenders'}
        subtitle={
          isContractor
            ? 'Published tenders you are eligible to bid for.'
            : 'From tender notice through evaluation to award of the work.'
        }
        actions={
          canCreate ? (
            <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>
              New tender
            </Button>
          ) : undefined
        }
      />

      {isContractor && (
        <Alert variant="info" title="How bidding works">
          Submit your rates before the closing time. Technical envelopes are opened first; financial
          bids stay sealed until every bid has been technically evaluated.
        </Alert>
      )}

      <Card flush>
        <div className="filter-bar">
          <div className="field field--search">
            <label className="field__label" htmlFor="tender-search">Search</label>
            <input
              id="tender-search"
              type="search"
              className="input"
              placeholder="Tender title, number or project"
              defaultValue={search}
              onChange={(event) => setParam('search', event.target.value)}
            />
          </div>
          <Select
            label="Status"
            value={status}
            onChange={(event) => setParam('status', event.target.value)}
            placeholder="All statuses"
            options={TENDER_STATUSES.map((value) => ({
              value,
              label: value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()),
            }))}
          />
        </div>

        <DataTable
          rows={data?.items ?? []}
          rowKey={(row) => row.id}
          loading={isLoading}
          onRowClick={(row) => navigate(`/tenders/${row.id}`)}
          caption="Tenders"
          columns={[
            {
              key: 'tender',
              header: 'Tender',
              render: (row) => (
                <>
                  <div className="cell-primary">{row.title}</div>
                  <div className="cell-muted code">{row.tenderNo}</div>
                </>
              ),
            },
            {
              key: 'project',
              header: 'Project',
              render: (row) => (
                <>
                  <div>{row.project.name}</div>
                  <div className="cell-muted">{row.division.name}</div>
                </>
              ),
            },
            {
              key: 'value',
              header: 'Estimate',
              numeric: true,
              render: (row) => (
                <>
                  <div>{rupeesShort(row.estimatedValue)}</div>
                  <div className="cell-muted">EMD {rupeesShort(row.emdAmount)}</div>
                </>
              ),
            },
            {
              key: 'closing',
              header: 'Bids close',
              render: (row) =>
                row.bidEndAt ? (
                  <>
                    <div>{date(row.bidEndAt)}</div>
                    <div className="cell-muted">
                      {row.isBiddingOpen ? relativeTime(row.bidEndAt) : 'Closed'}
                    </div>
                  </>
                ) : (
                  <span className="cell-muted">Not scheduled</span>
                ),
            },
            {
              key: 'bids',
              header: 'Bids',
              numeric: true,
              render: (row) => (isContractor ? '—' : row.submittedBidCount),
            },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          ]}
          empty={{
            title: isContractor ? 'No tenders open right now' : 'No tenders found',
            text: isContractor
              ? 'Published tenders will appear here. You will also be notified by email.'
              : 'Create a tender against a sanctioned project package.',
            action: canCreate
              ? <Button variant="primary" icon={<PlusIcon />} onClick={() => setCreating(true)}>New tender</Button>
              : undefined,
          }}
        />

        {data && (
          <Pagination
            page={data.page}
            pageSize={data.pageSize}
            total={data.total}
            onPageChange={(next) => setParam('page', String(next))}
          />
        )}
      </Card>

      {creating && (
        <TenderFormModal onClose={() => setCreating(false)} onCreated={(id) => navigate(`/tenders/${id}`)} />
      )}
    </>
  );
}

/* ==========================================================================
   Create tender, including the bill of quantities
   ========================================================================== */

interface BoqRow {
  itemCode: string;
  description: string;
  uom: string;
  quantity: string;
  estimatedRate: string;
}

const EMPTY_BOQ: BoqRow = { itemCode: '', description: '', uom: 'Cu.m', quantity: '', estimatedRate: '' };

function TenderFormModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: '', description: '', projectId: '', packageId: '',
    tenderType: 'OPEN', bidType: 'ITEM_RATE',
    estimatedValue: '', emdAmount: '', tenderFee: '',
    completionPeriodDays: '180', minRegistrationClass: '', eligibilityCriteria: '',
    bidStartAt: '', bidEndAt: '', technicalOpenAt: '', financialOpenAt: '',
  });
  const [boq, setBoq] = useState<BoqRow[]>([{ ...EMPTY_BOQ }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const projects = useQuery({
    queryKey: ['projects', 'for-tender'],
    queryFn: () => api.get<Page<Project>>('/projects', { pageSize: 200 }),
  });

  const packages = useQuery({
    queryKey: ['packages', 'for-tender', form.projectId],
    queryFn: () =>
      api.get<Page<{ id: number; packageCode: string; name: string; status: string }>>('/packages', {
        projectId: Number(form.projectId),
        pageSize: 100,
      }),
    enabled: Boolean(form.projectId),
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ id: number; tenderNo: string }>('/tenders', {
        title: form.title,
        description: form.description || undefined,
        projectId: Number(form.projectId),
        packageId: form.packageId ? Number(form.packageId) : undefined,
        tenderType: form.tenderType,
        bidType: form.bidType,
        estimatedValue: form.estimatedValue,
        emdAmount: form.emdAmount || undefined,
        tenderFee: form.tenderFee || undefined,
        completionPeriodDays: Number(form.completionPeriodDays),
        minRegistrationClass: form.minRegistrationClass || undefined,
        eligibilityCriteria: form.eligibilityCriteria || undefined,
        bidStartAt: form.bidStartAt ? form.bidStartAt.replace('T', ' ') : undefined,
        bidEndAt: form.bidEndAt ? form.bidEndAt.replace('T', ' ') : undefined,
        technicalOpenAt: form.technicalOpenAt ? form.technicalOpenAt.replace('T', ' ') : undefined,
        financialOpenAt: form.financialOpenAt ? form.financialOpenAt.replace('T', ' ') : undefined,
        boqItems:
          form.bidType === 'ITEM_RATE'
            ? boq
                .filter((row) => row.description.trim())
                .map((row, index) => ({
                  slNo: index + 1,
                  itemCode: row.itemCode || undefined,
                  description: row.description,
                  uom: row.uom,
                  quantity: row.quantity || '0',
                  estimatedRate: row.estimatedRate || '0',
                }))
            : undefined,
      }),
    onSuccess: (created) => {
      toast.success('Tender created', `${created.tenderNo} is saved as a draft.`);
      void queryClient.invalidateQueries({ queryKey: ['tenders'] });
      onCreated(created.id);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not create the tender.');
      }
    },
  });

  const set = (key: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const value = event.target.value;
    setForm((prev) => ({ ...prev, [key]: value, ...(key === 'projectId' ? { packageId: '' } : {}) }));
  };

  const updateBoq = (index: number, key: keyof BoqRow, value: string) =>
    setBoq((rows) => rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));

  const boqTotal = boq.reduce(
    (sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.estimatedRate) || 0),
    0,
  );

  return (
    <Modal
      open
      title="New tender"
      subtitle="Saved as a draft. Send it for approval before it can be published."
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setErrors({}); setMessage(null); mutation.mutate(); }}
          >
            Create tender
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Tender notice</legend>
          <div className="form-grid">
            <TextInput
              label="Title" required full value={form.title} onChange={set('title')} error={errors.title}
              placeholder="e.g. Ring road widening — Chainage 6.200 to 12.400 km"
            />
            <TextArea
              label="Description of work" full value={form.description} onChange={set('description')}
              rows={3} error={errors.description}
            />
            <Select
              label="Project" required value={form.projectId} onChange={set('projectId')}
              placeholder="Select the project" error={errors.projectId}
              options={(projects.data?.items ?? []).map((p) => ({
                value: p.id,
                label: `${p.name} (${p.projectCode})`,
              }))}
            />
            <Select
              label="Package" value={form.packageId} onChange={set('packageId')}
              placeholder={form.projectId ? 'Create one on award' : 'Select a project first'}
              disabled={!form.projectId} error={errors.packageId}
              hint="If left blank, a package is created automatically when the tender is awarded."
              options={(packages.data?.items ?? []).map((p) => ({
                value: p.id,
                label: `${p.name} (${p.packageCode})`,
              }))}
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Terms</legend>
          <div className="form-grid">
            <Select
              label="Tender type" required value={form.tenderType} onChange={set('tenderType')}
              options={[
                { value: 'OPEN', label: 'Open tender' },
                { value: 'LIMITED', label: 'Limited tender' },
                { value: 'EOI', label: 'Expression of interest' },
                { value: 'GEM', label: 'Through GeM' },
                { value: 'SINGLE', label: 'Single tender' },
              ]}
            />
            <Select
              label="Bid type" required value={form.bidType} onChange={set('bidType')}
              hint="Item rate bids are priced line by line against the bill of quantities."
              options={[
                { value: 'ITEM_RATE', label: 'Item rate' },
                { value: 'PERCENTAGE', label: 'Percentage above/below' },
                { value: 'LUMPSUM', label: 'Lump sum' },
              ]}
            />
            <TextInput
              label="Estimated value" required prefix="₹" numeric inputMode="decimal"
              value={form.estimatedValue} onChange={set('estimatedValue')} error={errors.estimatedValue}
            />
            <TextInput
              label="Earnest money deposit" prefix="₹" numeric inputMode="decimal"
              value={form.emdAmount} onChange={set('emdAmount')} error={errors.emdAmount}
            />
            <TextInput
              label="Tender fee" prefix="₹" numeric inputMode="decimal"
              value={form.tenderFee} onChange={set('tenderFee')} error={errors.tenderFee}
            />
            <TextInput
              label="Completion period (days)" required numeric inputMode="numeric"
              value={form.completionPeriodDays} onChange={set('completionPeriodDays')}
              error={errors.completionPeriodDays}
            />
            <Select
              label="Minimum registration class" value={form.minRegistrationClass}
              onChange={set('minRegistrationClass')} placeholder="Open to all classes"
              options={['Class A', 'Class B', 'Class C', 'Class D'].map((v) => ({ value: v, label: v }))}
            />
            <TextArea
              label="Eligibility criteria" full value={form.eligibilityCriteria}
              onChange={set('eligibilityCriteria')} rows={3}
              hint="Turnover, similar work experience, registration and any other qualifying condition."
            />
          </div>
        </fieldset>

        <fieldset className="fieldset">
          <legend className="fieldset__legend">Key dates</legend>
          <div className="form-grid">
            <TextInput
              label="Bidding opens" type="datetime-local" required value={form.bidStartAt}
              onChange={set('bidStartAt')} error={errors.bidStartAt}
            />
            <TextInput
              label="Bidding closes" type="datetime-local" required value={form.bidEndAt}
              onChange={set('bidEndAt')} error={errors.bidEndAt}
            />
            <TextInput
              label="Technical bid opening" type="datetime-local" value={form.technicalOpenAt}
              onChange={set('technicalOpenAt')} error={errors.technicalOpenAt}
            />
            <TextInput
              label="Financial bid opening" type="datetime-local" value={form.financialOpenAt}
              onChange={set('financialOpenAt')} error={errors.financialOpenAt}
            />
          </div>
        </fieldset>

        {form.bidType === 'ITEM_RATE' && (
          <fieldset className="fieldset">
            <legend className="fieldset__legend">Bill of quantities</legend>
            <p className="field__hint" style={{ marginBottom: 12 }}>
              Bidders quote a rate against every line. The estimate below is what the department expects to pay.
            </p>

            <div className="table-wrap">
              <table className="table table--compact table--totals">
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th style={{ width: 120 }}>Item code</th>
                    <th>Description</th>
                    <th style={{ width: 90 }}>Unit</th>
                    <th className="num" style={{ width: 120 }}>Quantity</th>
                    <th className="num" style={{ width: 130 }}>Rate (₹)</th>
                    <th className="num" style={{ width: 130 }}>Amount (₹)</th>
                    <th style={{ width: 48 }} />
                  </tr>
                </thead>
                <tbody>
                  {boq.map((row, index) => (
                    <tr key={index}>
                      <td>{index + 1}</td>
                      <td>
                        <input
                          className="input" value={row.itemCode}
                          onChange={(e) => updateBoq(index, 'itemCode', e.target.value)}
                          aria-label={`Item code for line ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="input" value={row.description}
                          onChange={(e) => updateBoq(index, 'description', e.target.value)}
                          placeholder="Description of the item of work"
                          aria-label={`Description for line ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="input" value={row.uom}
                          onChange={(e) => updateBoq(index, 'uom', e.target.value)}
                          aria-label={`Unit for line ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="input input--number" inputMode="decimal" value={row.quantity}
                          onChange={(e) => updateBoq(index, 'quantity', e.target.value)}
                          aria-label={`Quantity for line ${index + 1}`}
                        />
                      </td>
                      <td>
                        <input
                          className="input input--number" inputMode="decimal" value={row.estimatedRate}
                          onChange={(e) => updateBoq(index, 'estimatedRate', e.target.value)}
                          aria-label={`Rate for line ${index + 1}`}
                        />
                      </td>
                      <td className="num">
                        {rupees((Number(row.quantity) || 0) * (Number(row.estimatedRate) || 0))}
                      </td>
                      <td className="actions">
                        {boq.length > 1 && (
                          <Button
                            size="sm" variant="ghost"
                            onClick={() => setBoq((rows) => rows.filter((_, i) => i !== index))}
                            aria-label={`Remove line ${index + 1}`}
                          >
                            ✕
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={6}>Total estimated value from the bill of quantities</td>
                    <td className="num">{rupees(boqTotal)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{ marginTop: 12 }}>
              <Button icon={<PlusIcon />} onClick={() => setBoq((rows) => [...rows, { ...EMPTY_BOQ }])}>
                Add a line
              </Button>
            </div>
          </fieldset>
        )}
      </div>
    </Modal>
  );
}

/** Shown on the tender detail page while bidding is live. */
export function BiddingCountdown({ tender }: { tender: Tender }) {
  if (!tender.bidEndAt) return null;
  if (!tender.isBiddingOpen) {
    return (
      <Alert variant="info" title="Bidding is closed">
        Bidding closed on {dateTime(tender.bidEndAt)}.
      </Alert>
    );
  }
  return (
    <Alert variant="ok" title="Bidding is open">
      Bids close {relativeTime(tender.bidEndAt)} — {dateTime(tender.bidEndAt)}.
    </Alert>
  );
}
