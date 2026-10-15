/** @jest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react';
import { StudioExportStatus } from '../components/StudioExportStatus';
import { createStudioOutputSpec, type StudioExportState } from '../../shared/media-output';

test('shows the saved actionable background paid-image denial in the real export status', () => {
  const message = 'Paid image generation needs interactive confirmation. Use Image mode to review the provider and approve one image, or choose a provider on this PC. No paid request was sent.';
  const state: StudioExportState = { sourceRevision: null, sourceSavedAt: null, outputs: [],
    latestAttempt: { id: 'paid-attempt', status: 'failed', sourceRevision: null, startedAt: '2026-09-27T00:00:00Z', error: message } };
  const props: any = { state, moviePath: null, unsaved: false, busy: false, onSelect: jest.fn(), onRetry: jest.fn() };
  render(<StudioExportStatus {...props} />);
  expect(screen.getByText('Why this attempt did not finish')).toBeInTheDocument();
  expect(screen.getByText(message)).toBeInTheDocument();
});

test('portrait failure does not label the selected current landscape as failed and only retries portrait', () => {
  const source = 'a'.repeat(64);
  const state: StudioExportState = {
    sourceRevision: 'batch-source', sourceSavedAt: '2026-09-13T00:00:00Z',
    variantRevisions: { landscape: source, portrait: 'b'.repeat(64) },
    latestAttempt: { id: 'batch', status: 'failed', sourceRevision: null, startedAt: '2026-09-13T00:00:00Z', error: 'Portrait stopped' },
    variantAttempts: {
      landscape: { id: 'landscape', variantId: 'landscape', status: 'succeeded', sourceRevision: source, startedAt: '2026-09-13T00:00:00Z' },
      portrait: { id: 'portrait', variantId: 'portrait', status: 'failed', sourceRevision: 'b'.repeat(64), startedAt: '2026-09-13T00:00:00Z', error: 'Portrait stopped' },
    },
    outputs: [{ exportId: 'landscape', filename: 'landscape.mp4', moviePath: 'C:/landscape.mp4',
      createdAt: '2026-09-13T00:00:00Z', sourceSavedAt: null, durationSeconds: 3, burnSubtitles: false,
      outputSpec: createStudioOutputSpec(), sourceRevision: source }],
  };
  const retry = jest.fn();
  const props: any = { state, moviePath: 'C:/landscape.mp4', unsaved: false, busy: false, onSelect: jest.fn(), onRetry: retry };
  render(<StudioExportStatus {...props} />);
  expect(screen.getByText('Preview matches the saved revision')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry portrait' }));
  expect(retry).toHaveBeenCalledTimes(1);
  expect(retry).toHaveBeenCalledWith('portrait', undefined);
});
