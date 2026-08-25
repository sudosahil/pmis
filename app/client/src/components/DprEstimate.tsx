import { useMemo, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Page } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from './Toast';
import { money, percent, quantity as formatQuantity, rupees, rupeesShort } from '../lib/format';
import type { DprEstimate, DprItem, ProjectDpr } from '../types';
import {
  Alert, Button, EmptyState, Loading, PlusIcon, Select, TextInput, TrashIcon,
} from './ui';
import { Modal } from './Modal';

/**
 * The item-wise estimate a Detailed Project Report is prepared from.
 *
 * This is where the report stops being a covering note and becomes a costing:
 * each line names an item of work, takes its rate from the Schedule of Rates
 * rather than from whoever is filling in the form, and quantity times rate is
 * the abstract of cost. Contingency and work-charged establishment are added on
 * top, and that total is what the administrative approval is granted against —
 * and, once the report is converted, what the tender is worth.
 */

interface SrOption {
  id: number;
  code: string;
  name: string;
  uom: string;
  rate: number;
  status: string;
}

function useScheduleOfRates() {
  return useQuery({
    queryKey: ['schedule-of-rates', 'all'],
    queryFn: async () => {
      const page = await api.get<Page<Record<string, unknown>>>('/masters/schedule-of-rates', {
        pageSize: 500,
      });
      return page.items
        .map((row) => ({
          id: Number(row.id),
          code: String(row.code ?? ''),
          name: String(row.name ?? ''),
          uom: String(row.uom ?? ''),
          rate: Number(row.rate ?? 0),
          status: String(row.status ?? 'ACTIVE'),
        }))
        .filter((item) => item.status === 'ACTIVE') as SrOption[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

// --- The abstract of cost ----------------------------------------------------

export function DprAbstractStrip({ dpr }: { dpr: ProjectDpr }) {
  const { abstract } = dpr;
  if (!abstract.isPriced) return null;

  return (
    <div className="grid grid--4" style={{ marginTop: 10 }}>
      <div className="stat">
        <div className="stat__label">Items</div>
        <div className="stat__value stat__value--currency">{rupeesShort(abstract.itemsTotal)}</div>
        <div className="stat__meta">
          <span>{abstract.itemCount} lines at SR {abstract.srEdition ?? 'rates'}</span>
        </div>
      </div>
      <div className="stat">
        <div className="stat__label">Contingency</div>
        <div className="stat__value stat__value--currency">
          {rupeesShort(abstract.contingencyAmount)}
        </div>
        <div className="stat__meta"><span>{percent(abstract.contingencyPercent)} of items</span></div>
      </div>
      <div className="stat">
        <div className="stat__label">Establishment</div>
        <div className="stat__value stat__value--currency">
          {rupeesShort(abstract.establishmentAmount)}
        </div>
        <div className="stat__meta"><span>{percent(abstract.establishmentPercent)} of items</span></div>
      </div>
      <div className="stat stat--accent">
        <div className="stat__label">Abstract of cost</div>
        <div className="stat__value stat__value--currency">{rupeesShort(abstract.total)}</div>
        <div className="stat__meta"><span>{rupees(abstract.total)}</span></div>
      </div>
    </div>
  );
}

// --- Reading the estimate ----------------------------------------------------

export function DprEstimateView({ projectId, dprId }: { projectId: number; dprId: number }) {
  const { data, isLoading } = useEstimate(projectId, dprId);

  if (isLoading) return <Loading label="Loading the estimate…" />;
  if (!data?.items.length) {
    return (
      <EmptyState
        title="No item-wise estimate yet"
        text="Price the report line by line against the Schedule of Rates. The total becomes the tender value when it is converted."
      />
    );
  }

  return <EstimateTable items={data.items} abstract={data.abstract} />;
}

function EstimateTable({
  items, abstract,
}: {
  items: DprItem[];
  abstract: DprEstimate['abstract'];
}) {
  return (
    <div className="table-wrap">
      <table className="table table--compact table--totals">
        <caption className="visually-hidden">Item-wise estimate</caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: 44 }}>Sl</th>
            <th scope="col" style={{ width: 90 }}>SR item</th>
            <th scope="col">Item of work</th>
            <th scope="col" style={{ width: 60 }}>Unit</th>
            <th scope="col" className="num" style={{ width: 100 }}>Quantity</th>
            <th scope="col" className="num" style={{ width: 100 }}>Rate</th>
            <th scope="col" className="num" style={{ width: 120 }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>{item.slNo}</td>
              <td className="code">{item.sr?.code ?? item.itemCode ?? '—'}</td>
              <td>
                <div>{item.description}</div>
                {item.sr?.hasMoved && (
                  <div className="cell-muted" style={{ color: 'var(--warn-fg)' }}>
                    The schedule now reads {money(item.sr.currentRate ?? 0)} for this item.
                  </div>
                )}
                {!item.sr && <div className="cell-muted">Non-schedule item, priced by hand.</div>}
              </td>
              <td>{item.uom}</td>
              <td className="num">{formatQuantity(item.quantity)}</td>
              <td className="num">{money(item.rate)}</td>
              <td className="num">{money(item.amount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right' }}>Items</td>
            <td className="num">{money(abstract.itemsTotal)}</td>
          </tr>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right' }}>
              Contingency at {percent(abstract.contingencyPercent)}
            </td>
            <td className="num">{money(abstract.contingencyAmount)}</td>
          </tr>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right' }}>
              Work-charged establishment at {percent(abstract.establishmentPercent)}
            </td>
            <td className="num">{money(abstract.establishmentAmount)}</td>
          </tr>
          <tr>
            <td colSpan={6} style={{ textAlign: 'right' }}><strong>Abstract of cost</strong></td>
            <td className="num"><strong>{money(abstract.total)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// --- Preparing the estimate --------------------------------------------------

interface DraftLine {
  key: string;
  srItemId: string;
  description: string;
  uom: string;
  quantity: string;
  /** Only used for a non-schedule item; an SR line is priced from the book. */
  rate: string;
  remarks: string;
}

let lineCounter = 0;
const newLine = (): DraftLine => ({
  key: `line-${(lineCounter += 1)}`,
  srItemId: '',
  description: '',
  uom: '',
  quantity: '',
  rate: '',
  remarks: '',
});

export function DprEstimateDialog({
  projectId, dpr, onClose, onSaved,
}: {
  projectId: number;
  dpr: ProjectDpr;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const rateBook = useScheduleOfRates();
  const { data, isLoading } = useEstimate(projectId, dpr.id);
  const [lines, setLines] = useState<DraftLine[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // The saved estimate is the starting point; after that the draft is the truth.
  const draft = lines ?? (data ? data.items.map(toDraftLine) : null);

  const byId = useMemo(
    () => new Map((rateBook.data ?? []).map((item) => [String(item.id), item])),
    [rateBook.data],
  );

  const update = (key: string, patch: Partial<DraftLine>) =>
    setLines((draft ?? []).map((line) => (line.key === key ? { ...line, ...patch } : line)));

  /** Choosing a schedule item fills the line from the rate book. */
  const chooseSrItem = (key: string, srItemId: string) => {
    const item = byId.get(srItemId);
    update(key, {
      srItemId,
      description: item ? item.name : '',
      uom: item ? item.uom : '',
      rate: item ? String(item.rate) : '',
    });
  };

  const lineAmount = (line: DraftLine): number => {
    const rate = line.srItemId ? (byId.get(line.srItemId)?.rate ?? 0) : Number(line.rate || 0);
    return (Number(line.quantity || 0) * rate) || 0;
  };

  const itemsTotal = (draft ?? []).reduce((sum, line) => sum + lineAmount(line), 0);
  const contingency = (itemsTotal * dpr.abstract.contingencyPercent) / 100;
  const establishment = (itemsTotal * dpr.abstract.establishmentPercent) / 100;

  const mutation = useMutation({
    mutationFn: () =>
      api.put<DprEstimate>(`/projects/${projectId}/dprs/${dpr.id}/items`, {
        items: (draft ?? []).map((line) => ({
          srItemId: line.srItemId ? Number(line.srItemId) : undefined,
          description: line.description,
          uom: line.uom,
          quantity: line.quantity,
          // A schedule line is priced by the server from the rate book.
          rate: line.srItemId ? undefined : line.rate,
          remarks: line.remarks || undefined,
        })),
      }),
    onSuccess: () => {
      toast.success('Estimate saved', 'The abstract of cost has been recomputed.');
      onSaved();
      onClose();
    },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not save the estimate.'),
  });

  const srOptions = [
    { value: '', label: 'Non-schedule item' },
    ...(rateBook.data ?? []).map((item) => ({
      value: String(item.id),
      label: `${item.code} — ${item.name.slice(0, 70)} (₹${item.rate}/${item.uom})`,
    })),
  ];

  return (
    <Modal
      open
      title="Prepare the estimate"
      subtitle={`${dpr.dprNo} version ${dpr.version} — priced against the Schedule of Rates`}
      size="xwide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            disabled={!draft?.length}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Save estimate
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not save">{message}</Alert>}

        <Alert variant="info" title="Rates come from the rate book, not from this form">
          Choose a Schedule of Rates item and the rate is read from the schedule as it stands today.
          A non-schedule item may be priced by hand, and is flagged as such on the estimate.
        </Alert>

        {isLoading || rateBook.isLoading ? (
          <Loading label="Loading the rate book…" />
        ) : (
          <>
            <div className="table-wrap">
              <table className="table table--compact">
                <caption className="visually-hidden">Estimate lines</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 40 }}>Sl</th>
                    <th scope="col" style={{ minWidth: 260 }}>Schedule of Rates item</th>
                    <th scope="col" style={{ minWidth: 200 }}>Item of work</th>
                    <th scope="col" style={{ width: 80 }}>Unit</th>
                    <th scope="col" className="num" style={{ width: 120 }}>Quantity</th>
                    <th scope="col" className="num" style={{ width: 120 }}>Rate</th>
                    <th scope="col" className="num" style={{ width: 130 }}>Amount</th>
                    <th scope="col" style={{ width: 44 }} />
                  </tr>
                </thead>
                <tbody>
                  {(draft ?? []).map((line, index) => {
                    const chosen = byId.get(line.srItemId);
                    return (
                      <tr key={line.key}>
                        <td>{index + 1}</td>
                        <td>
                          <select
                            className="select"
                            aria-label={`Schedule of Rates item for line ${index + 1}`}
                            value={line.srItemId}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                              chooseSrItem(line.key, event.target.value)
                            }
                          >
                            {srOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label={`Item of work for line ${index + 1}`}
                            value={line.description}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              update(line.key, { description: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input"
                            aria-label={`Unit for line ${index + 1}`}
                            value={line.uom}
                            disabled={Boolean(chosen)}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              update(line.key, { uom: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input input--number"
                            inputMode="decimal"
                            aria-label={`Quantity for line ${index + 1}`}
                            value={line.quantity}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              update(line.key, { quantity: event.target.value })
                            }
                          />
                        </td>
                        <td>
                          <input
                            className="input input--number"
                            inputMode="decimal"
                            aria-label={`Rate for line ${index + 1}`}
                            value={chosen ? String(chosen.rate) : line.rate}
                            disabled={Boolean(chosen)}
                            onChange={(event: ChangeEvent<HTMLInputElement>) =>
                              update(line.key, { rate: event.target.value })
                            }
                          />
                        </td>
                        <td className="num">{money(lineAmount(line))}</td>
                        <td className="actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<TrashIcon />}
                            aria-label={`Remove line ${index + 1}`}
                            onClick={() =>
                              setLines((draft ?? []).filter((other) => other.key !== line.key))
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {!draft?.length && (
                    <tr>
                      <td colSpan={8}>
                        <EmptyState
                          title="No lines yet"
                          text="Add the first item of work to start pricing the estimate."
                        />
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="row row--between">
              <Button
                icon={<PlusIcon />}
                onClick={() => setLines([...(draft ?? []), newLine()])}
              >
                Add an item
              </Button>
              <div style={{ textAlign: 'right' }}>
                <div>Items <strong>{rupees(itemsTotal)}</strong></div>
                <div className="cell-muted">
                  Contingency {percent(dpr.abstract.contingencyPercent)} {rupees(contingency)} ·
                  {' '}Establishment {percent(dpr.abstract.establishmentPercent)} {rupees(establishment)}
                </div>
                <div style={{ fontSize: 16, marginTop: 4 }}>
                  Abstract of cost{' '}
                  <strong>{rupees(itemsTotal + contingency + establishment)}</strong>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function toDraftLine(item: DprItem): DraftLine {
  return {
    key: `saved-${item.id}`,
    srItemId: item.sr?.id ? String(item.sr.id) : '',
    description: item.description,
    uom: item.uom,
    quantity: String(item.quantity),
    rate: String(item.rate),
    remarks: item.remarks ?? '',
  };
}

// --- Shared plumbing ---------------------------------------------------------

function useEstimate(projectId: number, dprId: number) {
  return useQuery({
    queryKey: ['dpr-estimate', dprId],
    queryFn: () => api.get<DprEstimate>(`/projects/${projectId}/dprs/${dprId}/items`),
    enabled: projectId > 0,
  });
}

/** Reprices the estimate against the rate book as it stands today. */
export function useReprice(projectId: number, dprId: number) {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation({
    mutationFn: () =>
      api.post<DprEstimate>(`/projects/${projectId}/dprs/${dprId}/reprice`, {}),
    onSuccess: (result) => {
      toast.success(
        'Estimate repriced',
        `Now ${rupees(result.abstract.total)} at today’s Schedule of Rates.`,
      );
      void queryClient.invalidateQueries({ queryKey: ['dpr-estimate', dprId] });
      void queryClient.invalidateQueries({ queryKey: ['project-dprs', projectId] });
    },
    onError: (error: unknown) =>
      toast.error(
        'Could not reprice',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });
}

/** The staleness warning: lines the rate book has moved under. */
export function DprStaleNotice({
  projectId, dpr, canEdit,
}: {
  projectId: number;
  dpr: ProjectDpr;
  canEdit: boolean;
}) {
  const { data } = useEstimate(projectId, dpr.id);
  const reprice = useReprice(projectId, dpr.id);
  const stale = data?.staleLineCount ?? 0;

  if (!stale) return null;

  return (
    <Alert variant="warn" title={`${stale} line(s) priced at a rate the schedule has since revised`}>
      The estimate holds the rates it was prepared at, which is correct until someone decides
      otherwise — a sanctioned estimate is not rewritten because the rate book moved.
      {canEdit && dpr.status !== 'APPROVED' && !dpr.tender && (
        <div style={{ marginTop: 8 }}>
          <Button size="sm" loading={reprice.isPending} onClick={() => reprice.mutate()}>
            Reprice at today’s rates
          </Button>
        </div>
      )}
    </Alert>
  );
}

// --- Converting the report into a tender document -----------------------------

export function ConvertToTenderDialog({
  dpr, onClose, onConverted,
}: {
  dpr: ProjectDpr;
  onClose: () => void;
  onConverted: (tenderId: number) => void;
}) {
  const { can } = useAuth();
  const [form, setForm] = useState({
    title: dpr.title,
    tenderType: 'OPEN',
    bidType: 'ITEM_RATE',
    emdPercent: '2',
    tenderFee: '11800',
    completionPeriodDays: '540',
    minRegistrationClass: '',
  });
  const [message, setMessage] = useState<string | null>(null);

  const set = (key: keyof typeof form) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [key]: event.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ id: number }>(`/projects/${dpr.projectId}/dprs/${dpr.id}/convert-to-tender`, {
        title: form.title,
        tenderType: form.tenderType,
        bidType: form.bidType,
        emdPercent: form.emdPercent || undefined,
        tenderFee: form.tenderFee || undefined,
        completionPeriodDays: form.completionPeriodDays,
        minRegistrationClass: form.minRegistrationClass || undefined,
      }),
    onSuccess: (tender) => { onConverted(tender.id); onClose(); },
    onError: (error: unknown) =>
      setMessage(error instanceof ApiError ? error.message : 'Could not convert the report.'),
  });

  if (!can('tenders.manage')) return null;

  return (
    <Modal
      open
      title="Convert to a tender document"
      subtitle={`${dpr.dprNo} version ${dpr.version}`}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={mutation.isPending}>Cancel</Button>
          <Button
            variant="primary"
            loading={mutation.isPending}
            onClick={() => { setMessage(null); mutation.mutate(); }}
          >
            Create the tender
          </Button>
        </>
      }
    >
      <div className="stack">
        {message && <Alert variant="danger" title="Could not convert">{message}</Alert>}

        <Alert variant="info" title="What carries across">
          The {dpr.abstract.itemCount} priced items become the bill of quantities, the abstract of
          cost of {rupees(dpr.abstract.total)} becomes the estimated value, and the Schedule of
          Rates lines behind them become the bidding ceiling. What you add afterwards is the
          pre-qualification and technical criteria — that is the difference between a report and a
          tender document.
        </Alert>

        <div className="form-grid">
          <TextInput label="Tender title" full required value={form.title} onChange={set('title')} />
          <Select
            label="Tender type"
            options={[
              { value: 'OPEN', label: 'Open' },
              { value: 'LIMITED', label: 'Limited' },
              { value: 'EOI', label: 'Expression of interest' },
              { value: 'GEM', label: 'GeM' },
              { value: 'SINGLE', label: 'Single tender' },
            ]}
            value={form.tenderType}
            onChange={set('tenderType')}
          />
          <Select
            label="Bid type"
            options={[
              { value: 'ITEM_RATE', label: 'Item rate' },
              { value: 'PERCENTAGE', label: 'Percentage' },
              { value: 'LUMPSUM', label: 'Lump sum' },
            ]}
            value={form.bidType}
            onChange={set('bidType')}
            hint="An item-rate tender is priced line by line against the ceiling."
          />
          <TextInput
            label="EMD"
            numeric
            value={form.emdPercent}
            onChange={set('emdPercent')}
            hint="Percentage of the estimated value."
          />
          <TextInput label="Tender fee" numeric prefix="₹" value={form.tenderFee} onChange={set('tenderFee')} />
          <TextInput
            label="Completion period"
            numeric
            value={form.completionPeriodDays}
            onChange={set('completionPeriodDays')}
            hint="Days from the work order."
          />
          <Select
            label="Minimum registration class"
            placeholder="Any class"
            options={[
              { value: 'Class A', label: 'Class A' },
              { value: 'Class B', label: 'Class B' },
              { value: 'Class C', label: 'Class C' },
              { value: 'Class D', label: 'Class D' },
            ]}
            value={form.minRegistrationClass}
            onChange={set('minRegistrationClass')}
          />
        </div>
      </div>
    </Modal>
  );
}
