import { createContext, useContext } from 'react';

/**
 * How a control inside a dialog asks that dialog to close.
 *
 * This lives in its own module because both `Modal` (which provides it) and
 * `ui` (whose `Button` consumes it) would otherwise have to import each other.
 *
 * `onClose` is the caller's own handler, carried alongside `requestClose` so
 * that a control can tell whether its click handler *is* this dialog's
 * dismissal. A footer Cancel is written as `onClick={onClose}` with the same
 * function the dialog was given, so comparing the two identifies it exactly.
 */
export interface ModalDismiss {
  /** The handler the caller passed to `Modal`; unmounts the dialog at once. */
  onClose: () => void;
  /** Plays the dialog's exit animation, then calls `onClose`. */
  requestClose: () => void;
}

export const ModalDismissContext = createContext<ModalDismiss | null>(null);

/** Null outside a dialog, so a control can fall back to its own behaviour. */
export function useModalDismiss(): ModalDismiss | null {
  return useContext(ModalDismissContext);
}
