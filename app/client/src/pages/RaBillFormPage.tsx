import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import { money, rupees, today } from '../lib/format';
import type { Package, PackageBoq, RaBillDetail } from '../types';
import {
  Alert, Button, Card, DetailItem, Loading, PageHeader, PlusIcon, Select, TextInput, TrashIcon,
} from '../components/ui';

/** Statuses a package must be in before work can be billed against it. */
const BILLABLE = ['AWARDED', 'IN_PROGRESS', 'COMPLETED'];

interface ItemDraft {
  key: number;
  /** The agreement BOQ line being measured, when the package carries a BOQ. */
  boqItemId: string;
  description: string;
  uom: string;
  quantityUptoDate: string;
  quantityPrevious: string;
  rate: string;
}

let nextKey = 1;

function blankItem(): ItemDraft {
  return {
    key: nextKey++,
    boqItemId: '',
    description: '',
    uom: '',
    quantityUptoDate: '',
    quantityPrevious: '',
    rate: '',
  };
}

function quantityText(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 3 });
}

function num(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Present quantity is always the cumulative measurement less what was billed before. */
function presentQuantity(item: ItemDraft): number {
  return num(item.quantityUptoDate) - num(item.quantityPrevious);
}

function lineAmount(item: ItemDraft, agreedRate?: number): number {
  const rate = agreedRate ?? num(item.rate);
  return Math.round(presentQuantity(item) * rate * 100) / 100;
}

export function RaBillFormPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isContractor } = useAuth();
  const [searchParams] = useSearchParams();

  const [packageId, setPackageId] = useState(searchParams.get('packageId') ?? '');
  const [billType, setBillType] = useState('RA');
  const [periodFrom, setPeriodFrom] = useState('');
  const [periodTo, setPeriodTo] = useState(today());
  const [measurementBookNo, setMeasurementBookNo] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  // Packages the signed-in user may bill against.
  const packagesQuery = useQuery({
    queryKey: ['packages', 'billable'],
    queryFn: () => api.get<Page<Package>>('/packages', { pageSize: 200 }),
    enabled: !isEdit,
    staleTime: 60_000,
  });

  const billQuery = useQuery({
    queryKey: ['ra-bill', id],
    queryFn: () => api.get<RaBillDetail>(`/ra-bills/${id}`),
    enabled: isEdit,
  });

  // Load the saved draft into the form once it arrives.
  const bill = billQuery.data;
  useEffect(() => {
    if (!bill) return;
    setBillType(bill.billType);
    setPeriodFrom(bill.periodFrom ?? '');
    setPeriodTo(bill.periodTo ?? '');
    setMeasurementBookNo(bill.measurementBookNo ?? '');
    setItems(
      bill.items.map((item) => ({
        key: nextKey++,
        boqItemId: item.boqItemId ? String(item.boqItemId) : '',
        description: item.description,
        uom: item.uom,
        quantityUptoDate: String(item.quantityUptoDate),
        quantityPrevious: String(item.quantityPrevious),
        rate: String(item.rate),
      })),
    );
  }, [bill]);

  // The agreement BOQ for whichever package this bill is against. When the
  // package carries one, items are chosen from it rather than typed.
  const activePackageId = isEdit ? bill?.package.id ?? null : packageId ? Number(packageId) : null;

  const boq = useQuery({
    queryKey: ['package-boq', activePackageId],
    queryFn: () => api.get<PackageBoq>(`/packages/${activePackageId}/boq`),
    enabled: activePackageId !== null,
  });

  const boqItems = boq.data?.items ?? [];
  const hasBoq = boqItems.length > 0;
  const boqById = useMemo(
    () => new Map(boqItems.map((item) => [String(item.id), item])),
    [boqItems],
  );

  const billablePackages = useMemo(
    () => (packagesQuery.data?.items ?? []).filter((p) => BILLABLE.includes(p.status) && p.contractor?.id),
    [packagesQuery.data],
  );

  const selectedPackage = useMemo(
    () => billablePackages.find((p) => String(p.id) === packageId) ?? null,
    [billablePackages, packageId],
  );

  const rateFor = (item: ItemDraft) => boqById.get(item.boqItemId)?.agreedRate;
  const total = items.reduce((sum, item) => sum + lineAmount(item, rateFor(item)), 0);

  // Contract value and what has already been claimed, from whichever source we have.
  const contractValue = isEdit ? bill?.package.awardedValue ?? 0 : selectedPackage?.awardedValue ?? 0;
  const previouslyBilled = isEdit
    ? bill?.amounts.previousPaidAmount ?? 0
    : selectedPackage?.billedToDate ?? 0;
  const overrun = contractValue > 0 && previouslyBilled + total > contractValue;

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    setItems((current) => (current.length === 1 ? current : current.filter((_, i) => i !== index)));
  }

  function itemError(index: number, field: string): string | undefined {
    return errors[`items.${index}.${field}`];
  }

  const payload = () => ({
    billType,
    periodFrom: periodFrom || undefined,
    periodTo: periodTo || undefined,
    measurementBookNo: measurementBookNo || undefined,
    items: items.map((item, index) =>
      hasBoq
        ? {
            slNo: index + 1,
            boqItemId: Number(item.boqItemId),
            quantityUptoDate: num(item.quantityUptoDate),
            quantityPrevious: num(item.quantityPrevious),
          }
        : {
            slNo: index + 1,
            description: item.description.trim(),
            uom: item.uom.trim(),
            quantityUptoDate: num(item.quantityUptoDate),
            quantityPrevious: num(item.quantityPrevious),
            rate: num(item.rate),
          },
    ),
  });

  const mutation = useMutation({
    mutationFn: () =>
      isEdit
        ? api.patch<RaBillDetail>(`/ra-bills/${id}`, payload())
        : api.post<RaBillDetail>('/ra-bills', { packageId: Number(packageId), ...payload() }),
    onSuccess: (saved) => {
      toast.success(
        isEdit ? 'Bill updated' : 'Bill created',
        `${saved.billNo} is saved as a draft. Submit it when the measurements are final.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['ra-bills'] });
      void queryClient.invalidateQueries({ queryKey: ['ra-bill', String(saved.id)] });
      navigate(`/ra-bills/${saved.id}`);
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
    if (!isEdit && !packageId) return 'Choose the package this bill is raised against.';
    if (items.length === 0) return 'Add at least one work item.';
    for (const [index, item] of items.entries()) {
      const line = index + 1;
      if (hasBoq) {
        if (!item.boqItemId) return `Item ${line}: choose the agreement BOQ item being measured.`;
      } else {
        if (!item.description.trim()) return `Item ${line}: enter a description.`;
        if (!item.uom.trim()) return `Item ${line}: enter the unit of measurement.`;
        if (num(item.rate) <= 0) return `Item ${line}: enter the agreement rate.`;
      }
      if (num(item.quantityUptoDate) <= 0) return `Item ${line}: enter the quantity measured up to date.`;
      if (presentQuantity(item) < 0) {
        return `Item ${line}: the quantity up to date cannot be less than the quantity already billed.`;
      }
      const boqLine = boqById.get(item.boqItemId);
      if (boqLine && presentQuantity(item) > boqLine.balanceQuantity) {
        return (
          `Item ${line}: only ${boqLine.balanceQuantity} ${boqLine.uom} remain against ` +
          `BOQ item ${boqLine.slNo}. Reduce the quantity.`
        );
      }
    }
    if (total <= 0) return 'The bill amount must be greater than zero.';
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
          <Link to={`/ra-bills/${bill.id}`}>Open the bill</Link>.
        </Alert>
      </>
    );
  }

  const cancelTo = isEdit ? `/ra-bills/${id}` : '/ra-bills';

  return (
    <>
      <PageHeader
        breadcrumb={
          <>
            <Link to="/ra-bills">RA bills</Link>
            <span className="breadcrumb__sep">/</span>
            {isEdit ? <Link to={`/ra-bills/${id}`}>{bill?.billNo}</Link> : <span>New bill</span>}
            {isEdit && (
              <>
                <span className="breadcrumb__sep">/</span>
                <span>Edit</span>
              </>
            )}
          </>
        }
        title={isEdit ? `Edit ${bill?.billNo ?? 'bill'}` : 'Raise a running account bill'}
        subtitle="Record the measurements taken since the last bill. Deductions and ETP charges are computed by the system."
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

        <Card title="Bill details" subtitle="The bill number and DBR number are allotted automatically on saving.">
          <div className="form-grid">
            {isEdit ? (
              <>
                <DetailItem label="Package" value={`${bill?.package.code} · ${bill?.package.name}`} />
                <DetailItem label="Contractor" value={bill?.contractor.name} />
              </>
            ) : (
              <Select
                label="Work package"
                required
                full
                value={packageId}
                onChange={(event) => setPackageId(event.target.value)}
                placeholder={packagesQuery.isLoading ? 'Loading packages…' : 'Select an awarded package'}
                error={errors.packageId}
                hint={
                  isContractor
                    ? 'Only packages awarded to you are listed.'
                    : 'Only awarded packages in your jurisdiction are listed.'
                }
                options={billablePackages.map((p) => ({
                  value: p.id,
                  label: `${p.packageCode} — ${p.name} (${p.contractor?.name ?? 'Unawarded'})`,
                }))}
              />
            )}

            <Select
              label="Bill type"
              required
              value={billType}
              onChange={(event) => setBillType(event.target.value)}
              error={errors.billType}
              hint="Mark the last bill of a work as a final bill."
              options={[
                { value: 'RA', label: 'Running account bill' },
                { value: 'FINAL', label: 'Final bill' },
              ]}
            />
            <TextInput
              label="Measurement book number"
              value={measurementBookNo}
              onChange={(event) => setMeasurementBookNo(event.target.value)}
              error={errors.measurementBookNo}
              placeholder="e.g. MB 214/2026"
              maxLength={60}
            />
            <TextInput
              label="Measurement period from"
              type="date"
              value={periodFrom}
              onChange={(event) => setPeriodFrom(event.target.value)}
              error={errors.periodFrom}
            />
            <TextInput
              label="Measurement period to"
              type="date"
              value={periodTo}
              onChange={(event) => setPeriodTo(event.target.value)}
              error={errors.periodTo}
            />
          </div>

          {!isEdit && selectedPackage && (
            <div className="detail-grid" style={{ marginTop: 18 }}>
              <DetailItem label="Project" value={selectedPackage.project.name} />
              <DetailItem label="Division" value={selectedPackage.project.divisionName} />
              <DetailItem label="Contract value" value={rupees(selectedPackage.awardedValue)} />
              <DetailItem label="Billed so far" value={rupees(selectedPackage.billedToDate)} />
              <DetailItem label="Balance in contract" value={rupees(selectedPackage.balanceValue)} />
              <DetailItem label="Agreement number" value={selectedPackage.agreementNo} />
            </div>
          )}
        </Card>

        <Card
          title="Measurements"
          subtitle="Enter the cumulative quantity measured up to date. The present quantity is the difference from the previous bill."
          flush
          actions={
            <Button size="sm" icon={<PlusIcon />} onClick={() => setItems((current) => [...current, blankItem()])}>
              Add item
            </Button>
          }
          footer={
            <div className="row row--between" style={{ width: '100%' }}>
              <span>
                {items.length} item{items.length === 1 ? '' : 's'}
              </span>
              <strong>Present bill amount: {rupees(total)}</strong>
            </div>
          }
        >
          <div className="table-wrap">
            <table className="table table--compact">
              <caption className="visually-hidden">Measurement line items</caption>
              <thead>
                <tr>
                  <th scope="col" style={{ width: 44 }}>Sl</th>
                  <th scope="col">{hasBoq ? 'Agreement BOQ item' : 'Description of work'}</th>
                  <th scope="col" style={{ width: 90 }}>Unit</th>
                  <th scope="col" style={{ width: 120 }} className="num">Qty upto date</th>
                  <th scope="col" style={{ width: 120 }} className="num">Qty previous</th>
                  <th scope="col" style={{ width: 110 }} className="num">Qty present</th>
                  <th scope="col" style={{ width: 130 }} className="num">Rate</th>
                  <th scope="col" style={{ width: 140 }} className="num">Amount</th>
                  <th scope="col" style={{ width: 48 }}>
                    <span className="visually-hidden">Remove</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => {
                  const present = presentQuantity(item);
                  const boqLine = boqById.get(item.boqItemId);
                  return (
                    <tr key={item.key}>
                      <td>{index + 1}</td>
                      <td>
                        <label className="visually-hidden" htmlFor={`desc-${item.key}`}>
                          {hasBoq ? 'Agreement item' : 'Description'} for line {index + 1}
                        </label>
                        {hasBoq ? (
                          <>
                            <select
                              id={`desc-${item.key}`}
                              className="select"
                              value={item.boqItemId}
                              onChange={(event) => updateItem(index, { boqItemId: event.target.value })}
                            >
                              <option value="">Choose the item being measured</option>
                              {boqItems.map((line) => (
                                <option
                                  key={line.id}
                                  value={line.id}
                                  disabled={line.isFullyBilled && String(line.id) !== item.boqItemId}
                                >
                                  {line.slNo}. {line.description.slice(0, 60)}
                                  {line.isFullyBilled ? ' — fully billed' : ''}
                                </option>
                              ))}
                            </select>
                            {boqLine && (
                              <div className="cell-muted">
                                {boqLine.itemCode ? `SR ${boqLine.itemCode} · ` : ''}
                                {quantityText(boqLine.balanceQuantity)} {boqLine.uom} remaining of{' '}
                                {quantityText(boqLine.quantity)}
                              </div>
                            )}
                          </>
                        ) : (
                          <input
                            id={`desc-${item.key}`}
                            className={`input${itemError(index, 'description') ? ' has-error' : ''}`}
                            value={item.description}
                            onChange={(event) => updateItem(index, { description: event.target.value })}
                            placeholder="e.g. Earthwork excavation in ordinary soil"
                            maxLength={500}
                          />
                        )}
                      </td>
                      <td>
                        <label className="visually-hidden" htmlFor={`uom-${item.key}`}>
                          Unit for item {index + 1}
                        </label>
                        {hasBoq ? (
                          <span>{boqLine?.uom ?? '—'}</span>
                        ) : (
                          <input
                            id={`uom-${item.key}`}
                            className={`input${itemError(index, 'uom') ? ' has-error' : ''}`}
                            value={item.uom}
                            onChange={(event) => updateItem(index, { uom: event.target.value })}
                            placeholder="cum"
                            maxLength={20}
                          />
                        )}
                      </td>
                      <td>
                        <label className="visually-hidden" htmlFor={`upto-${item.key}`}>
                          Quantity up to date for item {index + 1}
                        </label>
                        <input
                          id={`upto-${item.key}`}
                          type="number"
                          step="0.001"
                          min="0"
                          className="input input--number"
                          value={item.quantityUptoDate}
                          onChange={(event) => updateItem(index, { quantityUptoDate: event.target.value })}
                        />
                      </td>
                      <td>
                        <label className="visually-hidden" htmlFor={`prev-${item.key}`}>
                          Quantity already billed for item {index + 1}
                        </label>
                        <input
                          id={`prev-${item.key}`}
                          type="number"
                          step="0.001"
                          min="0"
                          className="input input--number"
                          value={item.quantityPrevious}
                          onChange={(event) => updateItem(index, { quantityPrevious: event.target.value })}
                        />
                      </td>
                      <td
                        className="num"
                        style={present < 0 ? { color: 'var(--danger-fg)', fontWeight: 700 } : undefined}
                      >
                        {present.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                      </td>
                      <td>
                        <label className="visually-hidden" htmlFor={`rate-${item.key}`}>
                          Rate for item {index + 1}
                        </label>
                        {hasBoq ? (
                          <span className="num" style={{ display: 'block', textAlign: 'right' }}>
                            {boqLine ? money(boqLine.agreedRate) : '—'}
                          </span>
                        ) : (
                          <input
                            id={`rate-${item.key}`}
                            type="number"
                            step="0.01"
                            min="0"
                            className="input input--number"
                            value={item.rate}
                            onChange={(event) => updateItem(index, { rate: event.target.value })}
                          />
                        )}
                      </td>
                      <td className="num">
                        <strong>{money(lineAmount(item, boqLine?.agreedRate))}</strong>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          onClick={() => removeItem(index)}
                          disabled={items.length === 1}
                          aria-label={`Remove item ${index + 1}`}
                          title={items.length === 1 ? 'A bill needs at least one item' : 'Remove this item'}
                        >
                          <TrashIcon />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="table--totals">
                  <td colSpan={7} style={{ textAlign: 'right', fontWeight: 700 }}>
                    Total of this bill
                  </td>
                  <td className="num" style={{ fontWeight: 700 }}>{money(total)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        {overrun && (
          <Alert variant="warn" title="This bill exceeds the contract value">
            Including this bill, the total billed would be {rupees(previouslyBilled + total)} against a contract
            value of {rupees(contractValue)}. Revise the quantities, or have the agreement value revised first.
          </Alert>
        )}

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
