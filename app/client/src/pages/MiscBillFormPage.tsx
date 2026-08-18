import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { useLookup } from '../hooks/useLookup';
import { money, rupees, today } from '../lib/format';
import type { Contractor, MiscBillDetail, Project } from '../types';
import {
  Alert, Button, Card, DetailItem, Loading, PageHeader, PlusIcon, Select, TextArea, TextInput,
  TrashIcon,
} from '../components/ui';

const CATEGORIES = [
  { value: 'PROJECT_EXPENSE', label: 'Project expense — charged to a work' },
  { value: 'REVENUE_EXPENSE', label: 'Revenue expense — office running cost' },
  { value: 'REFUND', label: 'Refund — money returned to the department' },
];

const PAYEE_TYPES = [
  { value: 'STAFF', label: 'Departmental staff' },
  { value: 'VENDOR', label: 'Vendor or supplier' },
  { value: 'CONTRACTOR', label: 'Registered contractor' },
  { value: 'OTHER', label: 'Other' },
];

/** Above this value the supplier's GST invoice — and its GSTIN — is mandatory. */
const GST_INVOICE_THRESHOLD = 500;

interface ItemDraft {
  key: number;
  expenseDate: string;
  description: string;
  categoryCode: string;
  invoiceNo: string;
  gstin: string;
  amount: string;
  remarks: string;
}

let nextKey = 1;

function blankItem(): ItemDraft {
  return {
    key: nextKey++,
    expenseDate: today(),
    description: '',
    categoryCode: '',
    invoiceNo: '',
    gstin: '',
    amount: '',
    remarks: '',
  };
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function MiscBillFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [form, setForm] = useState({
    billCategory: 'REVENUE_EXPENSE',
    projectId: '',
    billDate: today(),
    periodFrom: '',
    periodTo: '',
    siteId: '',
    payeeName: '',
    payeeType: 'STAFF',
    contractorId: '',
    submittedByDesignation: user?.designation ?? '',
    refundReference: '',
    deductionPercent: '',
    remarks: '',
  });
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  const categories = useLookup('expense-categories');

  const projects = useQuery({
    queryKey: ['projects', 'for-misc-bill'],
    queryFn: () => api.get<Page<Project>>('/projects', { pageSize: 200 }),
    staleTime: 60_000,
  });

  const contractors = useQuery({
    queryKey: ['contractors', 'for-misc-bill'],
    queryFn: () => api.get<Page<Contractor>>('/contractors', { pageSize: 200 }),
    enabled: form.payeeType === 'CONTRACTOR',
    staleTime: 60_000,
  });

  const billQuery = useQuery({
    queryKey: ['misc-bill', id],
    queryFn: () => api.get<MiscBillDetail>(`/misc-bills/${id}`),
    enabled: isEdit,
  });

  const bill = billQuery.data;
  useEffect(() => {
    if (!bill) return;
    setForm({
      billCategory: bill.billCategory,
      projectId: bill.project?.id ? String(bill.project.id) : '',
      billDate: bill.billDate,
      periodFrom: bill.periodFrom ?? '',
      periodTo: bill.periodTo ?? '',
      siteId: bill.siteId ?? '',
      payeeName: bill.payeeName,
      payeeType: bill.payeeType,
      contractorId: bill.contractor?.id ? String(bill.contractor.id) : '',
      submittedByDesignation: bill.submittedByDesignation ?? '',
      refundReference: bill.refundReference ?? '',
      deductionPercent: '',
      remarks: bill.remarks ?? '',
    });
    setItems(
      bill.items.map((item) => ({
        key: nextKey++,
        expenseDate: item.expenseDate,
        description: item.description,
        categoryCode: item.categoryCode,
        invoiceNo: item.invoiceNo ?? '',
        gstin: item.gstin ?? '',
        amount: String(item.amount),
        remarks: item.remarks ?? '',
      })),
    );
  }, [bill]);

  const set = (key: keyof typeof form) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
  }

  const gross = items.reduce((sum, item) => sum + num(item.amount), 0);
  const deduction = Math.round(gross * (num(form.deductionPercent) / 100) * 100) / 100;
  const net = gross - deduction;

  const payload = () => ({
    projectId: form.projectId ? Number(form.projectId) : undefined,
    billDate: form.billDate,
    periodFrom: form.periodFrom || undefined,
    periodTo: form.periodTo || undefined,
    siteId: form.siteId || undefined,
    payeeName: form.payeeName.trim(),
    payeeType: form.payeeType,
    contractorId: form.payeeType === 'CONTRACTOR' && form.contractorId ? Number(form.contractorId) : undefined,
    submittedByDesignation: form.submittedByDesignation || undefined,
    refundReference: form.refundReference || undefined,
    deductionPercent: form.deductionPercent ? Number(form.deductionPercent) : undefined,
    remarks: form.remarks || undefined,
    items: items.map((item, index) => ({
      slNo: index + 1,
      expenseDate: item.expenseDate,
      description: item.description.trim(),
      categoryCode: item.categoryCode,
      invoiceNo: item.invoiceNo || undefined,
      gstin: item.gstin || undefined,
      amount: num(item.amount),
      remarks: item.remarks || undefined,
    })),
  });

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<MiscBillDetail>(`/misc-bills/${id}`, payload())
        : api.post<MiscBillDetail>('/misc-bills', { billCategory: form.billCategory, ...payload() }),
    onSuccess: (saved) => {
      toast.success(
        isEdit ? 'Bill updated' : 'Bill created',
        `${saved.billNo} is saved as a draft. Submit it when the vouchers are attached.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['misc-bills'] });
      void queryClient.invalidateQueries({ queryKey: ['misc-bill', String(saved.id)] });
      navigate(`/misc-bills/${saved.id}`);
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors);
        setMessage(error.message);
      } else {
        setMessage('Could not save the bill. Please try again.');
      }
    },
  });

  function validate(): string | null {
    if (!form.payeeName.trim()) return 'Enter who the money is payable to.';
    if (form.billCategory === 'PROJECT_EXPENSE' && !form.projectId) {
      return 'A project expense must be charged to a project.';
    }
    for (const [index, item] of items.entries()) {
      const line = index + 1;
      if (item.description.trim().length < 5) {
        return `Line ${line}: describe the expense specifically — "Misc" or "Sundry" is not accepted.`;
      }
      if (!item.categoryCode) return `Line ${line}: choose an expense category.`;
      if (num(item.amount) <= 0) return `Line ${line}: enter the amount.`;
      if (num(item.amount) > GST_INVOICE_THRESHOLD) {
        if (!item.invoiceNo.trim()) {
          return `Line ${line}: an invoice number is required above ${rupees(GST_INVOICE_THRESHOLD)}.`;
        }
        if (!item.gstin.trim()) {
          return `Line ${line}: a GST invoice is mandatory above ${rupees(GST_INVOICE_THRESHOLD)} — enter the supplier GSTIN.`;
        }
      }
    }
    if (gross <= 0) return 'The bill amount must be greater than zero.';
    return null;
  }

  function save() {
    setErrors({});
    const problem = validate();
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage(null);
    mutation.mutate();
  }

  if (isEdit && billQuery.isLoading) return <Loading label="Loading the bill…" />;
  if (isEdit && billQuery.isError) {
    return (
      <Alert variant="danger" title="Bill not found">
        This bill does not exist, or you do not have access to it.
      </Alert>
    );
  }
  if (isEdit && bill && bill.status !== 'DRAFT' && bill.status !== 'RETURNED') {
    return (
      <>
        <PageHeader title={bill.billNo} subtitle="This bill can no longer be edited." />
        <Alert variant="warn" title="Locked for editing">
          A bill can only be changed while it is a draft or after it has been returned for correction.{' '}
          <Link to={`/misc-bills/${bill.id}`}>Open the bill</Link>.
        </Alert>
      </>
    );
  }

  const cancelTo = isEdit ? `/misc-bills/${id}` : '/misc-bills';
  const categoryOptions = (categories.data ?? []).map((row) => ({
    value: row.code,
    label: `${row.name} (${row.code})`,
  }));

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/misc-bills">Miscellaneous bills</Link>
            <span className="breadcrumb__sep">/</span>
            {isEdit ? <Link to={`/misc-bills/${id}`}>{bill?.billNo}</Link> : <span>New bill</span>}
          </>
        }
        title={isEdit ? `Edit ${bill?.billNo ?? 'bill'}` : 'Raise a miscellaneous bill'}
        subtitle="Each expense line is booked to a government object head through its category. Attach the invoices to the e-Office file."
        actions={
          <>
            <Button onClick={() => navigate(cancelTo)}>Cancel</Button>
            <Button variant="primary" loading={mutation.isPending} onClick={save}>
              {isEdit ? 'Save changes' : 'Create draft bill'}
            </Button>
          </>
        }
      />

      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <Card title="Bill details" subtitle="The bill number is allotted automatically on saving.">
          <div className="form-grid">
            {isEdit ? (
              <DetailItem
                label="Category"
                value={CATEGORIES.find((c) => c.value === form.billCategory)?.label ?? form.billCategory}
              />
            ) : (
              <Select
                label="Bill category"
                required
                full
                value={form.billCategory}
                onChange={set('billCategory')}
                error={errors.billCategory}
                hint="Decides which object heads the expense may be booked to. Cannot be changed later."
                options={CATEGORIES}
              />
            )}

            <Select
              label="Project"
              required={form.billCategory === 'PROJECT_EXPENSE'}
              value={form.projectId}
              onChange={set('projectId')}
              placeholder={projects.isLoading ? 'Loading projects…' : 'Not tied to a project'}
              error={errors.projectId}
              options={(projects.data?.items ?? []).map((project) => ({
                value: project.id,
                label: `${project.projectCode} — ${project.name}`,
              }))}
            />
            <TextInput
              label="Bill date"
              type="date"
              required
              value={form.billDate}
              onChange={set('billDate')}
              error={errors.billDate}
            />
            <TextInput
              label="Site identifier"
              value={form.siteId}
              onChange={set('siteId')}
              error={errors.siteId}
              hint="Where the expenditure was incurred, if applicable."
            />
            <TextInput
              label="Expenditure period from"
              type="date"
              value={form.periodFrom}
              onChange={set('periodFrom')}
              error={errors.periodFrom}
            />
            <TextInput
              label="Expenditure period to"
              type="date"
              value={form.periodTo}
              onChange={set('periodTo')}
              error={errors.periodTo}
            />
          </div>
        </Card>

        <Card title="Payee">
          <div className="form-grid">
            <TextInput
              label="Payable to"
              required
              value={form.payeeName}
              onChange={set('payeeName')}
              error={errors.payeeName}
              hint="The person or firm the money is released to."
            />
            <Select
              label="Payee type"
              required
              value={form.payeeType}
              onChange={set('payeeType')}
              error={errors.payeeType}
              options={PAYEE_TYPES}
            />
            {form.payeeType === 'CONTRACTOR' && (
              <Select
                label="Contractor"
                value={form.contractorId}
                onChange={set('contractorId')}
                placeholder={contractors.isLoading ? 'Loading firms…' : 'Select the firm'}
                error={errors.contractorId}
                options={(contractors.data?.items ?? []).map((row) => ({
                  value: row.id,
                  label: `${row.name} (${row.code})`,
                }))}
              />
            )}
            <TextInput
              label="Designation of the claimant"
              value={form.submittedByDesignation}
              onChange={set('submittedByDesignation')}
              error={errors.submittedByDesignation}
            />
            {form.billCategory === 'REFUND' && (
              <TextInput
                label="Refund reference"
                value={form.refundReference}
                onChange={set('refundReference')}
                error={errors.refundReference}
                hint="The original receipt or bill the money is being returned against."
              />
            )}
            <TextInput
              label="Deduction (%)"
              type="number"
              step="0.01"
              min="0"
              numeric
              value={form.deductionPercent}
              onChange={set('deductionPercent')}
              error={errors.deductionPercent}
              hint="Leave blank if nothing is to be recovered from this claim."
            />
          </div>
        </Card>

        <Card
          title="Expense lines"
          subtitle={`Describe each expense specifically — generic entries such as “Misc” or “Sundry” are rejected. Above ${rupees(GST_INVOICE_THRESHOLD)} a GST invoice number and the supplier GSTIN are mandatory.`}
          flush
          actions={
            <Button size="sm" icon={<PlusIcon />} onClick={() => setItems((current) => [...current, blankItem()])}>
              Add line
            </Button>
          }
          footer={
            <div className="row row--between" style={{ width: '100%' }}>
              <span>{items.length} line{items.length === 1 ? '' : 's'}</span>
              <strong>Net payable: {rupees(net)}</strong>
            </div>
          }
        >
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Expense lines</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 40 }}>Sl</th>
                  <th scope="col" style={{ width: 150 }}>Date</th>
                  <th scope="col">Particulars</th>
                  <th scope="col" style={{ width: 210 }}>Category</th>
                  <th scope="col" style={{ width: 140 }}>Invoice no.</th>
                  <th scope="col" style={{ width: 170 }}>Supplier GSTIN</th>
                  <th scope="col" style={{ width: 140 }} className="num">Amount</th>
                  <th scope="col" style={{ width: 48 }}>
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => (
                  <tr key={item.key}>
                    <td>{index + 1}</td>
                    <td>
                      <label className="visually-hidden" htmlFor={`date-${item.key}`}>Date of line {index + 1}</label>
                      <input
                        id={`date-${item.key}`}
                        type="date"
                        className="input"
                        value={item.expenseDate}
                        onChange={(event) => updateItem(index, { expenseDate: event.target.value })}
                      />
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`desc-${item.key}`}>Particulars of line {index + 1}</label>
                      <input
                        id={`desc-${item.key}`}
                        className="input"
                        value={item.description}
                        onChange={(event) => updateItem(index, { description: event.target.value })}
                        placeholder="e.g. A4 paper, 20 reams, for the division office"
                        maxLength={300}
                      />
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`cat-${item.key}`}>Category of line {index + 1}</label>
                      <select
                        id={`cat-${item.key}`}
                        className="select"
                        value={item.categoryCode}
                        onChange={(event) => updateItem(index, { categoryCode: event.target.value })}
                      >
                        <option value="">Select</option>
                        {categoryOptions.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`inv-${item.key}`}>Invoice number of line {index + 1}</label>
                      <input
                        id={`inv-${item.key}`}
                        className="input"
                        value={item.invoiceNo}
                        onChange={(event) => updateItem(index, { invoiceNo: event.target.value })}
                        maxLength={60}
                      />
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`gst-${item.key}`}>Supplier GSTIN of line {index + 1}</label>
                      <input
                        id={`gst-${item.key}`}
                        className="input"
                        value={item.gstin}
                        onChange={(event) => updateItem(index, { gstin: event.target.value.toUpperCase() })}
                        maxLength={15}
                        placeholder={num(item.amount) > GST_INVOICE_THRESHOLD ? 'Required' : 'Optional'}
                      />
                    </td>
                    <td>
                      <label className="visually-hidden" htmlFor={`amt-${item.key}`}>Amount of line {index + 1}</label>
                      <input
                        id={`amt-${item.key}`}
                        type="number"
                        step="0.01"
                        min="0"
                        className="input input--number"
                        value={item.amount}
                        onChange={(event) => updateItem(index, { amount: event.target.value })}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                        aria-label={`Remove line ${index + 1}`}
                      >
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="table--totals">
                  <td colSpan={6} style={{ textAlign: 'right', fontWeight: 700 }}>Gross amount</td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(gross)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card title="Summary">
          <div className="totals">
            <div className="totals__row">
              <span className="totals__label">Gross amount claimed</span>
              <span className="totals__value">{money(gross)}</span>
            </div>
            <div className="totals__row totals__row--sub">
              <span className="totals__label">
                Less deductions{form.deductionPercent ? ` at ${form.deductionPercent}%` : ''}
              </span>
              <span className="totals__value">−{money(deduction)}</span>
            </div>
            <div className="totals__row totals__row--grand">
              <span className="totals__label">Net amount payable</span>
              <span className="totals__value">{money(net)}</span>
            </div>
          </div>
          <TextArea
            label="Remarks"
            full
            rows={3}
            value={form.remarks}
            onChange={set('remarks')}
            error={errors.remarks}
            hint="Anything the approving officers should know about this claim."
          />
        </Card>

        <div className="row row--between">
          <Button onClick={() => navigate(cancelTo)}>Cancel</Button>
          <Button variant="primary" loading={mutation.isPending} onClick={save}>
            {isEdit ? 'Save changes' : 'Create draft bill'}
          </Button>
        </div>
      </div>
    </>
  );
}
