/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MediaCapabilitiesSection from '../components/settings/MediaCapabilitiesSection';

afterEach(() => { delete (window as any).electron; });

test('Settings shows account-specific cost/watermark metadata and labels text-only accounts', async () => {
  const listMediaCapabilities = jest.fn().mockResolvedValue({
    success: true,
    registry: {
      accounts: [
        {
          id: 'account:google-ai-studio', provider: 'google-ai-studio', label: 'Google AI Studio', connection: 'api-key',
          source: 'live', status: 'ready', statusLabel: '1 media model listed for this key.',
          models: [{
            ref: 'google-ai-studio:image:gemini-3.1-flash-image', provider: 'google-ai-studio', accountId: 'account:google-ai-studio',
            accountLabel: 'Google AI Studio', modelId: 'gemini-3.1-flash-image', displayName: 'Gemini 3.1 Flash Image',
            kind: 'image', costClass: 'paid', costLabel: 'Paid through your Google API project.', watermark: 'invisible',
            watermarkLabel: 'Google adds an invisible SynthID watermark.', source: 'live', usableIn: ['storyboard-frame'], methods: ['generateContent'],
          }],
        },
        {
          id: 'account:anthropic', provider: 'anthropic', label: 'Anthropic API', connection: 'api-key',
          source: 'declared', status: 'text-only', statusLabel: 'Text only — this account has no image or video generation models.', models: [],
        },
      ],
      imageModels: [], videoModels: [], refreshedAt: new Date(0).toISOString(),
    },
  });
  (window as any).electron = { listMediaCapabilities };

  render(<MediaCapabilitiesSection />);

  expect(await screen.findByTestId('media-account-google-ai-studio')).toHaveTextContent(/Gemini 3.1 Flash Image.*image.*Paid/);
  expect(screen.getByTestId('media-account-google-ai-studio')).toHaveTextContent(/Google API project.*SynthID/);
  expect(screen.getByTestId('media-account-anthropic')).toHaveTextContent(/Text only.*no image or video generation models/);
  expect(listMediaCapabilities).toHaveBeenCalledWith({ refresh: false });

  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(listMediaCapabilities).toHaveBeenLastCalledWith({ refresh: true }));
});

test('Settings has an honest empty state when no media account is connected', async () => {
  (window as any).electron = { listMediaCapabilities: jest.fn().mockResolvedValue({
    success: true,
    registry: { accounts: [], imageModels: [], videoModels: [], refreshedAt: new Date(0).toISOString() },
  }) };

  render(<MediaCapabilitiesSection />);
  expect(await screen.findByText(/No cloud account is connected/)).toBeInTheDocument();
});
