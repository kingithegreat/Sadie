import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { OverlayPortal, useDismissOnOutside } from './anchoredOverlay';

/**
 * One confirmation dialog for actions that destroy something.
 *
 * An audit of the app found seven controls that delete or discard user data on
 * a single click with no confirmation at all: removing a saved automation,
 * clearing the on-disk permission log, resetting every granted permission,
 * closing a workspace tab or a document with unsaved edits, compacting a
 * conversation, and rejecting a video. Several are one click away from a Run
 * button.
 *
 * ActionConfirmation already exists but is the agent's tool-approval flow —
 * it speaks in terms of "HomeBot wants to perform an action" and carries
 * warnings arrays. Wrong shape for "are you sure you want to delete this".
 *
 * The rules this encodes, because they are what make a confirmation useful to
 * someone who is not technical:
 *
 *   - the BUTTON says the consequence, not "OK". "Delete 12 notifications",
 *     never "Confirm" — people click the primary button without reading the
 *     body text, so the button has to carry the meaning on its own.
 *   - it states WHAT is lost and WHETHER it can be undone, in the body.
 *   - Cancel is the default: Escape cancels, clicking outside cancels, and the
 *     focus starts on Cancel so a stray Enter is safe.
 *
 * Portalled to document.body for the same reason as every other overlay here —
 * see anchoredOverlay.tsx.
 */

export interface ConfirmDestructiveRequest {
  /** What is about to happen, in the user's words. Becomes the heading. */
  title: string;
  /** What will be lost, and whether it can be undone. */
  body: ReactNode;
  /** The action itself: "Delete it", "Clear the log". Never "OK" or "Confirm". */
  confirmLabel: string;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  onConfirm: () => void;
}

/**
 * Returns `[dialog, confirm]`. Render `dialog`; call `confirm(request)` from the
 * destructive handler.
 */
export function useConfirmDestructive(): [ReactNode, (req: ConfirmDestructiveRequest) => void] {
  const [req, setReq] = useState<ConfirmDestructiveRequest | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => setReq(null), []);
  useDismissOnOutside(!!req, close, [panelRef]);

  const dialog = req ? (
    <OverlayPortal>
      <div className="confirm-destructive-overlay" style={{ position: 'fixed', inset: 0 }}>
        <div
          className="confirm-destructive"
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-label={req.title}
        >
          <h2 className="confirm-destructive-title">{req.title}</h2>
          <div className="confirm-destructive-body">{req.body}</div>
          <div className="confirm-destructive-actions">
            {/* Cancel first and focused, so the safe option is the one a
                keyboard user lands on and Enter cannot destroy anything. */}
            <button
              type="button"
              ref={cancelRef}
              autoFocus
              className="confirm-destructive-cancel"
              onClick={close}
            >
              {req.cancelLabel ?? 'Cancel'}
            </button>
            <button
              type="button"
              className="confirm-destructive-confirm"
              onClick={() => { const fn = req.onConfirm; setReq(null); fn(); }}
            >
              {req.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  ) : null;

  return [dialog, setReq as (r: ConfirmDestructiveRequest) => void];
}
