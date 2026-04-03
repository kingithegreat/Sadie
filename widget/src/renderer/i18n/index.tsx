import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import en from './locales/en.json';
import es from './locales/es.json';

export type Locale = 'en' | 'es';

const locales: Record<Locale, Record<string, unknown>> = { en, es };

export const SUPPORTED_LOCALES: { code: Locale; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
];

/**
 * Resolve a dot-separated key (e.g. "chat.placeholder") from a nested object.
 */
function resolve(obj: Record<string, unknown>, key: string): string {
  const parts = key.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return key;
    cur = (cur as Record<string, unknown>)[p];
  }
  return typeof cur === 'string' ? cur : key;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (k) => k,
});

export function I18nProvider({ children, initialLocale = 'en' }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  const t = useCallback(
    (key: string): string => {
      const dict = locales[locale] ?? locales.en;
      const val = resolve(dict as Record<string, unknown>, key);
      // Fall back to English if the key wasn't found in the current locale
      if (val === key && locale !== 'en') {
        return resolve(locales.en as Record<string, unknown>, key);
      }
      return val;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}

export { I18nContext };
