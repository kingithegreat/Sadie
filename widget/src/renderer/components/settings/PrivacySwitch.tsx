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
            ? 'Nothing you type leaves this PC. Turn this on to let HomeBot use the online AI you set up instead.'
            : 'Nothing you type leaves this PC. Set up an online AI under Advanced if you want the option to use one.'}
      </small>
    </div>
  );
}
