/**
 * "Answer on this PC" vs "allowed to use the online AI" — the highest-stakes
 * setting in the panel, and previously the hardest to find.
 *
 * The only control bound to `useCustomLLM` used to sit inside the cloud-provider
 * block behind `{isConnected && …}`, where `isConnected` means "a model list was
 * fetched during THIS session". That list is emptied on mount and again whenever
 * the settings prop changes, so the switch was never on screen when Settings
 * opened. Someone who had turned cloud chat on could not turn it back off here
 * without first re-fetching a model list they had no reason to want.
 *
 * So it lives at the top of the panel now, in both views, always rendered.
 *
 * Whether cloud CAN be turned on is answered by resolveCloudLLM — the same
 * function the router uses to decide where a message actually goes. Asking it
 * rather than re-checking "is there a key?" here is deliberate: a second copy of
 * that decision in the renderer is what previously shipped a header claiming one
 * model while another answered.
 */

import { useSettingsCtx } from './SettingsContext';
import { resolveCloudLLM } from '../../../shared/cloud-llm';

export default function PrivacySwitch() {
  const { localSettings, setLocalSettings } = useSettingsCtx();

  const cloudAllowed = !!localSettings.useCustomLLM;
  // Would turning this on actually produce answers? Offering a switch that
  // silently routes to an unusable provider is worse than disabling it.
  const ready = resolveCloudLLM({ ...(localSettings as any), useCustomLLM: true });
  const canEnable = ready.active;

  // Uncensored mode makes resolveCloudLLM report inactive by design — the
  // toggle promises the local uncensored model answers. Without separating that
  // case, someone who HAS set up a provider gets told to go and set one up.
  const blockedByUncensored = !canEnable && !!localSettings.uncensoredMode;

  // Name what is waiting, and what is answering instead.
  //
  // Reported from real use: "selected sonet but still showing quen". Choosing a
  // cloud model saves `customLLM.model` and sets `enabled: true`, but routing is
  // decided by `useCustomLLM`, which stays off — deliberately, so connecting a
  // provider never silently starts sending chats off the machine. The switch
  // said only "the online AI you set up", which does not read as "the Sonnet you
  // just picked is sitting here unused".
  const readyModel = ready.config?.model?.trim();
  const readyLabel = readyModel
    ? (ready.config?.provider === 'claude-code' ? `Claude ${readyModel}` : readyModel)
    : null;
  const localLabel = localSettings.uncensoredMode
    ? (localSettings.uncensoredModel || 'the uncensored model on this PC')
    : (localSettings.chatModel || 'the model on this PC');

  return (
    <div className="setting-group sp-privacy-switch">
      <label className="setting-label">Where your chats are answered</label>
      <label className="setting-label">
        <input
          type="checkbox"
          data-testid="privacy-switch"
          checked={cloudAllowed}
          disabled={!canEnable && !cloudAllowed}
          onChange={(e) =>
            setLocalSettings({
              ...localSettings,
              useCustomLLM: e.target.checked,
            })
          }
        />
        <span>{cloudAllowed ? 'Allowed to use the online AI' : 'Answer on this PC only'}</span>
      </label>
      <small className="setting-hint">
        {cloudAllowed
          ? 'Your messages are sent to the online AI service you set up. Turn this off to keep every chat on this PC.'
          : canEnable
            ? readyLabel
              // Names both sides, because the confusing case is having picked a
              // cloud model and still seeing the local one answer.
              ? `${readyLabel} is set up but NOT in use — ${localLabel} is answering. Turn this on to switch to it. Nothing you type leaves this PC until you do.`
              : 'Nothing you type leaves this PC. Turn this on to let HomeBot use the online AI you set up instead.'
            : blockedByUncensored
              ? 'Nothing you type leaves this PC. Uncensored mode answers with the model on this PC, so the online AI stays unused while it is on.'
              : 'Nothing you type leaves this PC. Set up an online AI under Advanced if you want the option to use one.'}
      </small>

      {/*
        The other question of the same kind — "does anything about my browsing
        leave this PC?" — and it was answerable only under Advanced, a view that
        is hidden by default.

        That cost real capability. Measured against live sites, a plain request
        and HomeBot's own browser both came back with nothing where the reading
        service returned ~90,000 characters. People who would happily turn this
        on could not find out it existed. Off remains the default; it is the
        finding that had to move, not the decision.
      */}
      <label className="setting-label" style={{ marginTop: 14 }}>
        <input
          type="checkbox"
          data-testid="web-reader-fallback"
          checked={!!localSettings.webReaderFallbackEnabled}
          onChange={(e) =>
            setLocalSettings({ ...localSettings, webReaderFallbackEnabled: e.target.checked })
          }
        />
        <span>Use a reading service when a page will not open</span>
      </label>
      <small className="setting-hint">
        Some sites refuse to open for anything but a person at a keyboard. HomeBot tries twice on
        its own first — a direct request, then its own browser — and only then, with this on, asks
        the free Jina Reader service to fetch the page instead. That sends <strong>the page
        address</strong> to that service; the page itself is read for you and nothing you typed is
        sent. Off by default.
      </small>
    </div>
  );
}
