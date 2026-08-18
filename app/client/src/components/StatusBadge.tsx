import { humanise } from '../lib/format';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral';

/**
 * Status colours are advisory only — the badge always carries the status word,
 * so the meaning survives greyscale printing and colour-blind viewing.
 */
const TONES: Record<string, Tone> = {
  // Shared lifecycle
  DRAFT: 'neutral',
  IN_APPROVAL: 'warn',
  PENDING: 'warn',
  PENDING_APPROVAL: 'warn',
  PENDING_SANCTION: 'warn',
  RETURNED: 'warn',
  APPROVED: 'ok',
  SANCTIONED: 'ok',
  VERIFIED: 'ok',
  COMPLETED: 'ok',
  PAID: 'ok',
  SENT_TO_TALLY: 'info',
  IN_PROGRESS: 'info',
  ACTIVE: 'ok',
  INACTIVE: 'neutral',
  LOCKED: 'danger',
  CLOSED: 'neutral',
  REJECTED: 'danger',
  CANCELLED: 'danger',
  DISQUALIFIED: 'danger',

  // Procurement
  PUBLISHED: 'info',
  BIDDING_CLOSED: 'warn',
  TECHNICAL_EVALUATION: 'warn',
  FINANCIAL_EVALUATION: 'warn',
  AWARDED: 'ok',
  SUBMITTED: 'info',
  TECHNICALLY_QUALIFIED: 'ok',
  QUALIFIED: 'ok',
  NOT_AWARDED: 'neutral',
  EVALUATED: 'info',

  // Workflow actions
  APPROVE: 'ok',
  REJECT: 'danger',
  RETURN: 'warn',
  ASSIGN: 'info',
  SUBMIT: 'info',
  CANCEL: 'neutral',

  // Milestones
  DELAYED: 'danger',
  RELEASED: 'ok',
};

const LABELS: Record<string, string> = {
  IN_APPROVAL: 'In approval',
  SENT_TO_TALLY: 'Sent to Tally',
  PENDING_SANCTION: 'Pending sanction',
  PENDING_APPROVAL: 'Pending approval',
  BIDDING_CLOSED: 'Bidding closed',
  TECHNICAL_EVALUATION: 'Technical evaluation',
  FINANCIAL_EVALUATION: 'Financial evaluation',
  TECHNICALLY_QUALIFIED: 'Technically qualified',
  NOT_AWARDED: 'Not awarded',
  IN_PROGRESS: 'In progress',
};

export function StatusBadge({
  status,
  tone,
}: {
  status: string | null | undefined;
  tone?: Tone;
}) {
  if (!status) return <span className="badge badge--neutral">Unknown</span>;
  const resolved = tone ?? TONES[status] ?? 'neutral';
  const label = LABELS[status] ?? humanise(status);
  return <span className={`badge badge--${resolved}`}>{label}</span>;
}
