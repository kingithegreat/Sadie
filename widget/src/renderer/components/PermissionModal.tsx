import { useEffect, useRef, useState } from 'react';
import {
  describePermission,
  resolveHumanReason,
  formatTimeoutNotice,
} from '../../../../src/trust/permission-copy';

const TITLE_ID = 'hb-permission-modal-title';
const INTRO_ID = 'hb-permission-modal-intro';
const REASON_ID = 'hb-permission-modal-reason';

export default function PermissionModal({ open, missingPermissions, reason, requestId, timeoutMs, onClose }: {
  open: boolean;
  missingPermissions: string[];
  reason?: string;
  requestId?: string;
  /** How long the main process waits before auto-declining (informational copy only). */
  timeoutMs?: number;
  onClose: () => void;
}) {
  const active = open && !!requestId;

  const cardRef = useRef<HTMLDivElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // Which permissions to persist on "Always allow". A permission is remembered
  // unless explicitly unticked (empty map = remember everything), so the default
  // matches the previous behaviour of persisting all requested permissions.
  const [remember, setRemember] = useState<Record<string, boolean>>({});

  // Reset the selection whenever a new request opens.
  useEffect(() => { setRemember({}); }, [requestId]);

  // Accessibility: focus management, focus trap, and Escape-to-decline.
  // Hooks must run unconditionally (rules-of-hooks) — the effect no-ops when
  // the modal is not active, so nothing happens until it is actually shown.
  useEffect(() => {
    if (!active) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    // Focus the safest default action (Don't allow) so keyboard users start on
    // the least-destructive choice rather than "Always allow".
    cancelBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Escape is treated as an explicit decline — same as "Don't allow".
        e.preventDefault();
        (window as any).electron.sendPermissionResponse(requestId!, 'cancel');
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const card = cardRef.current;
        if (!card) return;
        const focusables = Array.from(
          card.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((el) => !el.hasAttribute('disabled'));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      // Restore focus to whatever was focused before the modal opened.
      const prev = previouslyFocused.current;
      if (prev && typeof prev.focus === 'function') prev.focus();
    };
  }, [active, requestId, onClose]);

  if (!active) return null;

  const allowOnce = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'allow_once', missingPermissions);
    onClose();
  };

  const alwaysAllow = async () => {
    try {
      const settings = await (window as any).electron.getSettings();
      const perms = settings.permissions || {};
      // Persist the ticked permissions; unticked ones are granted for this
      // action only (not remembered).
      for (const p of missingPermissions) perms[p] = remember[p] !== false;
      await (window as any).electron.saveSettings({ permissions: perms });
    } catch (e) { /* ignore */ }
    (window as any).electron.sendPermissionResponse(requestId!, 'always_allow', missingPermissions);
    onClose();
  };

  const cancel = () => {
    (window as any).electron.sendPermissionResponse(requestId!, 'cancel');
    onClose();
  };

  // Copy pass (issue #6): plain-English label + one-line detail per
  // permission instead of raw slugs; the machine-generated
  // "Requires permissions: …" reason duplicates the list, so only reasons a
  // human wrote survive to the screen.
  const described = missingPermissions.map(describePermission);
  const humanReason = resolveHumanReason(reason);

  return (
    <div data-role="permission-modal" className="hb-modal-overlay">
      <div
        ref={cardRef}
        className="hb-modal-card hb-modal-card-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={`${INTRO_ID} ${REASON_ID}`}
      >
        <h2 id={TITLE_ID} className="hb-modal-title">Permission Required</h2>
        <p id={INTRO_ID} className="hb-modal-text">
          {described.length === 1
            ? 'SADIE is asking for your permission to:'
            : `SADIE is asking for ${described.length} permissions:`}
        </p>
        <div className="hb-modal-consent-detail" role="list" aria-label="Requested permissions">
          {described.map((d) => (
            <label key={d.name} className="hb-modal-perm-item" role="listitem">
              <input
                type="checkbox"
                className="hb-modal-perm-check"
                checked={remember[d.name] !== false}
                onChange={(e) => setRemember((r) => ({ ...r, [d.name]: e.target.checked }))}
                aria-label={`Remember ${d.label}`}
              />
              <span>
                <strong>{d.label}</strong>
                <span className="hb-modal-muted hb-modal-perm-detail"> — {d.detail}</span>
              </span>
            </label>
          ))}
        </div>
        <div id={REASON_ID} className="hb-modal-muted">
          {humanReason || 'Nothing has run yet — SADIE is waiting for your decision.'}
        </div>
        <p className="hb-modal-muted hb-modal-perm-hint">
          <strong>Allow once</strong> applies only to this action. <strong>Always allow</strong> saves these permissions for future actions until you change them in Settings. Untick a permission above to allow it just this once without remembering it.
        </p>
        <p className="hb-modal-muted hb-modal-perm-hint">
          {formatTimeoutNotice(timeoutMs)}
        </p>

        <div className="hb-modal-actions">
          <button ref={cancelBtnRef} type="button" className="hb-modal-btn hb-modal-btn-secondary" onClick={cancel}>Don&rsquo;t allow</button>
          <button type="button" className="hb-modal-btn hb-modal-btn-warning" onClick={allowOnce}>Allow once</button>
          <button type="button" className="hb-modal-btn hb-modal-btn-primary" onClick={alwaysAllow}>Always allow</button>
        </div>
      </div>
    </div>
  );
}
