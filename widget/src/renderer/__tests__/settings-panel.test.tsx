import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SettingsPanel from '../components/SettingsPanel';

describe('SettingsPanel model & API key fields', () => {
  it('allows selecting model and entering API keys and saves them', async () => {
    const initialSettings: any = {
      alwaysOnTop: true,
      n8nUrl: 'http://localhost:5678',
      widgetHotkey: 'Ctrl+Shift+S',
      permissions: {},
      telemetryEnabled: false,
      model: 'ollama',
      apiKeys: {}
    };

    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(<SettingsPanel settings={initialSettings} onSave={onSave} onClose={onClose} />);

    // Expect the model selector to be present and show default
    const select = screen.getByRole('combobox', { name: 'Model' });
    expect(select).toBeInTheDocument();
    expect((select as HTMLSelectElement).value).toBe('ollama');

    // Change to OpenAI
    fireEvent.change(select, { target: { value: 'openai' } });
    expect((select as HTMLSelectElement).value).toBe('openai');

    // Fill OpenAI API key
    const openaiInput = screen.getByPlaceholderText('sk-...') as HTMLInputElement;
    fireEvent.change(openaiInput, { target: { value: 'sk-test-123' } });
    expect(openaiInput.value).toBe('sk-test-123');

    // Click Save
    const saveBtn = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveBtn);

    expect(onSave).toHaveBeenCalled();
    const savedArg = (onSave as jest.Mock).mock.calls[0][0];
    expect(savedArg.model).toBe('openai');
    expect(savedArg.apiKeys).toBeDefined();
    expect(savedArg.apiKeys.openai).toBe('sk-test-123');
  });
});
