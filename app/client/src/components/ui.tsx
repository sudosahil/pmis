import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import { useModalDismiss } from './modal-dismiss';

/* ==========================================================================
   Shared primitives. Each extends its native element so callers can pass
   through any standard attribute without a bespoke prop.
   ========================================================================== */

type ButtonVariant = 'default' | 'primary' | 'success' | 'danger' | 'ghost';

type ButtonProps = {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  block?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
} & ComponentPropsWithoutRef<'button'>;

export function Button({
  variant = 'default',
  size = 'md',
  block,
  loading,
  icon,
  children,
  className = '',
  disabled,
  ...props
}: ButtonProps) {
  /**
   * A footer button whose handler *is* the surrounding dialog's `onClose` is
   * that dialog's Cancel, so it is routed through the dialog's exit animation
   * rather than unmounting it on the spot. The comparison is on the function
   * itself, not on the label, so it cannot be fooled by wording; a button with
   * any other handler is left exactly as it was written.
   */
  const dismiss = useModalDismiss();
  const onClick =
    dismiss && props.onClick && props.onClick === dismiss.onClose
      ? (dismiss.requestClose as typeof props.onClick)
      : props.onClick;

  const classes = [
    'btn',
    variant !== 'default' ? `btn--${variant}` : '',
    size === 'sm' ? 'btn--sm' : '',
    block ? 'btn--block' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} disabled={disabled || loading} {...props} onClick={onClick}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}

// --- Form fields -----------------------------------------------------------

interface FieldShellProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  full?: boolean;
  children: ReactNode;
}

export function Field({ label, htmlFor, required, hint, error, full, children }: FieldShellProps) {
  return (
    <div className={`field${full ? ' field--full' : ''}`}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="field__required" aria-hidden="true" title="Required">
            *
          </span>
        )}
      </label>
      {children}
      {hint && !error && <span className="field__hint">{hint}</span>}
      {error && (
        <span className="field__error" role="alert">
          <WarnIcon size={14} />
          {error}
        </span>
      )}
    </div>
  );
}

type TextInputProps = {
  label: string;
  hint?: string;
  error?: string;
  full?: boolean;
  /** Renders a fixed prefix such as the rupee sign. */
  prefix?: string;
  numeric?: boolean;
} & ComponentPropsWithoutRef<'input'>;

export function TextInput({
  label, hint, error, full, prefix, numeric, id, className = '', required, ...props
}: TextInputProps) {
  const inputId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  const input = (
    <input
      id={inputId}
      className={`input${numeric ? ' input--number' : ''}${error ? ' has-error' : ''} ${className}`}
      aria-invalid={error ? true : undefined}
      required={required}
      {...props}
    />
  );

  return (
    <Field label={label} htmlFor={inputId} required={required} hint={hint} error={error} full={full}>
      {prefix ? (
        <div className="input-prefix">
          <span className="input-prefix__label" aria-hidden="true">{prefix}</span>
          {input}
        </div>
      ) : (
        input
      )}
    </Field>
  );
}

type SelectProps = {
  label: string;
  hint?: string;
  error?: string;
  full?: boolean;
  placeholder?: string;
  options: { value: string | number; label: string }[];
} & ComponentPropsWithoutRef<'select'>;

export function Select({
  label, hint, error, full, placeholder, options, id, className = '', required, ...props
}: SelectProps) {
  const selectId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} htmlFor={selectId} required={required} hint={hint} error={error} full={full}>
      <select
        id={selectId}
        className={`select${error ? ' has-error' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

type TextAreaProps = {
  label: string;
  hint?: string;
  error?: string;
  full?: boolean;
} & ComponentPropsWithoutRef<'textarea'>;

export function TextArea({
  label, hint, error, full, id, className = '', required, ...props
}: TextAreaProps) {
  const areaId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <Field label={label} htmlFor={areaId} required={required} hint={hint} error={error} full={full}>
      <textarea
        id={areaId}
        className={`textarea${error ? ' has-error' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        required={required}
        {...props}
      />
    </Field>
  );
}

type CheckboxProps = { label: string } & ComponentPropsWithoutRef<'input'>;

export function Checkbox({ label, className = '', ...props }: CheckboxProps) {
  return (
    <label className={`checkbox ${className}`}>
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

// --- Layout ----------------------------------------------------------------

export function Card({
  title, subtitle, actions, children, flush, footer,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <header className="card__header">
          {title && (
            <div>
              <h2 className="card__title">{title}</h2>
              {subtitle && <p className="card__subtitle">{subtitle}</p>}
            </div>
          )}
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className={`card__body${flush ? ' card__body--flush' : ''}`}>{children}</div>
      {footer && <footer className="card__footer">{footer}</footer>}
    </section>
  );
}

export function PageHeader({
  title, subtitle, actions, breadcrumb,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <>
      {breadcrumb && <nav className="breadcrumb" aria-label="Breadcrumb">{breadcrumb}</nav>}
      <div className="page-header">
        <div className="page-header__text">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-header__actions">{actions}</div>}
      </div>
    </>
  );
}

export function DetailItem({ label, value }: { label: string; value: ReactNode }) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div className="detail-item">
      <div className="detail-item__label">{label}</div>
      <div className={`detail-item__value${empty ? ' detail-item__value--empty' : ''}`}>
        {empty ? '—' : value}
      </div>
    </div>
  );
}

export function Alert({
  variant = 'info', title, children, icon,
}: {
  variant?: 'info' | 'ok' | 'warn' | 'danger';
  title?: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  const fallback =
    variant === 'danger' || variant === 'warn' ? <WarnIcon /> :
    variant === 'ok' ? <CheckIcon /> : <InfoIcon />;
  return (
    <div className={`alert alert--${variant}`} role={variant === 'danger' ? 'alert' : 'status'}>
      <span className="alert__icon">{icon ?? fallback}</span>
      <div className="alert__body">
        {title && <div className="alert__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({
  title, text, action, icon,
}: {
  title: string;
  text?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <InboxIcon size={40} />}</div>
      <p className="empty__title">{title}</p>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" style={{ width: 26, height: 26 }} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const tone = pct >= 75 ? 'ok' : pct >= 35 ? '' : 'warn';
  return (
    <div className="progress-label">
      <div
        className="progress"
        style={{ flex: 1 }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div className={`progress__fill${tone ? ` progress__fill--${tone}` : ''}`} style={{ width: `${pct}%` }} />
      </div>
      <span>{pct}%</span>
    </div>
  );
}

// --- Icons -----------------------------------------------------------------
// A small inline set keeps the bundle self-contained and the strokes uniform.

type IconProps = { size?: number; className?: string };

const svg = (size: number, className: string | undefined, children: ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    {children}
  </svg>
);

export const CheckIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <polyline points="20 6 9 17 4 12" />);

export const WarnIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>);

export const InfoIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></>);

export const SearchIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></>);

export const BellIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></>);

export const InboxIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><polyline points="22 12 16 12 14 15 10 15 8 12 2 12" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>);

export const HomeIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>);

export const FolderIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />);

export const LayersIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></>);

export const GavelIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="m14 13-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10" /><path d="m16 16 6-6" /><path d="m8 8 6-6" /><path d="m9 7 8 8" /><path d="m21 11-8-8" /></>);

export const FileTextIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></>);

export const ReceiptIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><path d="M8 8h8" /><path d="M8 12h8" /><path d="M8 16h5" /></>);

export const UsersIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>);

export const WalletIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5" /><path d="M17 12h.01" /></>);

export const SettingsIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></>);

export const ShieldIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />);

export const PlusIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>);

export const CloseIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>);

export const ChevronRightIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <polyline points="9 18 15 12 9 6" />);

export const ArrowLeftIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" /></>);

export const MenuIcon = ({ size = 20, className }: IconProps) =>
  svg(size, className, <><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></>);

export const LogOutIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>);

export const PrinterIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><rect x="6" y="14" width="12" height="8" /></>);

export const TrashIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></>);

export const EditIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" /></>);

export const SendIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></>);

export const ClockIcon = ({ size = 16, className }: IconProps) =>
  svg(size, className, <><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></>);

export const BuildingIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M9 22v-4h6v4" /><path d="M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01M12 6h.01M12 10h.01M12 14h.01" /></>);

export const ChartIcon = ({ size = 18, className }: IconProps) =>
  svg(size, className, <><line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" /></>);
