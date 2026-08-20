/**
 * Shared access to the Settings panel's state for its tab components.
 *
 * The tabs are presentation only: every value and setter they touch comes from
 * here, so there is exactly one copy of the state and no tab can drift from
 * another. Typed from the hook's return, so adding a field to the hook makes it
 * available here with no second declaration to update.
 */

import { createContext, useContext } from 'react';
import type { SettingsState } from './useSettingsState';

const SettingsContext = createContext<SettingsState | null>(null);

export const SettingsProvider = SettingsContext.Provider;

export function useSettingsCtx(): SettingsState {
  const ctx = useContext(SettingsContext);
  if (!ctx) {
    // A tab rendered outside the panel would otherwise fail later with an
    // unrelated "cannot read property of null" deep inside some control.
    throw new Error('Settings tabs must be rendered inside <SettingsProvider>.');
  }
  return ctx;
}
