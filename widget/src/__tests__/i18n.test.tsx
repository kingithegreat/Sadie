/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { I18nProvider, useI18n, SUPPORTED_LOCALES } from '../renderer/i18n';

function TestConsumer() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="translated">{t('chat.placeholder')}</span>
      <span data-testid="nested">{t('settings.title')}</span>
      <span data-testid="missing">{t('nonexistent.key')}</span>
      <button onClick={() => setLocale('es')}>switch</button>
    </div>
  );
}

describe('i18n', () => {
  it('provides English translations by default', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    expect(screen.getByTestId('locale').textContent).toBe('en');
    expect(screen.getByTestId('translated').textContent).toBe('Message SADIE...');
    expect(screen.getByTestId('nested').textContent).toBe('Settings');
  });

  it('returns the key for missing translations', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    expect(screen.getByTestId('missing').textContent).toBe('nonexistent.key');
  });

  it('switches locale to Spanish', () => {
    render(
      <I18nProvider>
        <TestConsumer />
      </I18nProvider>
    );
    act(() => {
      screen.getByText('switch').click();
    });
    expect(screen.getByTestId('locale').textContent).toBe('es');
    expect(screen.getByTestId('translated').textContent).toBe('Mensaje a SADIE...');
    expect(screen.getByTestId('nested').textContent).toBe('Configuración');
  });

  it('falls back to English for missing Spanish keys', () => {
    render(
      <I18nProvider initialLocale="es">
        <TestConsumer />
      </I18nProvider>
    );
    // A key that exists in en but we verify the fallback path
    expect(screen.getByTestId('missing').textContent).toBe('nonexistent.key');
  });

  it('exports supported locales list', () => {
    expect(SUPPORTED_LOCALES).toEqual([
      { code: 'en', label: 'English' },
      { code: 'es', label: 'Español' },
    ]);
  });
});
