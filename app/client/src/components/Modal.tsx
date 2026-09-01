import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, CloseIcon } from './ui';
import { exitDuration } from '../lib/motion';
import { ModalDismissContext } from './modal-dismiss';

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  size?: 'default' | 'wide' | 'xwide';
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}

export function Modal({ open, title, subtitle, size = 'default', onClose, footer, children }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  /**
   * Plays the exit, then tells the caller.
   *
   * Callers unmount the dialog in their `onClose`, so calling it straight away
   * would tear the panel out of the DOM before it could animate. Holding the
   * call back for the length of the exit is what lets a dialog leave by the
   * path it arrived on. Every route out — Escape, the backdrop, the close
   * button and the footer's Cancel — goes through here, so they all behave the
   * same way.
   */
  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    timer.current = window.setTimeout(() => {
      setClosing(false);
      onClose();
    }, exitDuration());
  }, [closing, onClose]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Escape closes, and the body underneath must not scroll while open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, requestClose]);

  if (!open) return null;

  return createPortal(
    <ModalDismissContext.Provider value={{ onClose, requestClose }}>
    <div
      className={`modal-backdrop${closing ? ' is-closing' : ''}`}
      onMouseDown={(event) => {
        // A dialog already on its way out must not take another dismissal, or
        // the second click lands on the page behind the fading scrim.
        if (!closing && event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        className={`modal${size === 'wide' ? ' modal--wide' : ''}${size === 'xwide' ? ' modal--xwide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={panelRef}
      >
        <header className="modal__header">
          <div>
            <h2 className="modal__title">{title}</h2>
            {subtitle && <p className="modal__subtitle">{subtitle}</p>}
          </div>
          <button type="button" className="modal__close" onClick={requestClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
    </ModalDismissContext.Provider>,
    document.body,
  );
}

/** Confirmation prompt for destructive or one-way actions. */
export function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', danger, loading, onConfirm, onClose,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            loading={loading}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message}
    </Modal>
  );
}
