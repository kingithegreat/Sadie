/** @jest-environment jsdom */

/**
 * Proving the capability report is actually on screen.
 *
 * `shared/capability-report.ts` is separately unit-tested. A tested pure
 * function nothing reaches is this codebase's characteristic defect — and the
 * report exists precisely to expose that defect, so shipping it unreachable
 * would be its own punchline.
 *
 * These drive the real component through the real preload surface.
 */

import { render, waitFor, fireEvent } from '@testing-library/react';
import CapabilityReport from '../components/CapabilityReport';
import type { Capability } from '../../shared/capability-report';

const BROKEN: Capability[] = [
  {
    id: 'web-search',
    label: 'Search the web',
    state: 'unknown',
    unverified: true,
    detail: 'No search source is set up, so HomeBot falls back to a free one that often refuses requests.',
    fix: 'Run your own SearXNG (free, unlimited, no account), or add a free key.',
  },
  {
    id: 'media-studio',
    label: 'Make videos',
    state: 'missing',
    detail: 'The video engine (ffmpeg) is not installed.',
    fix: 'Media Studio → "Set it up for me".',
  },
  { id: 'local-chat', label: 'Answer on this PC', state: 'ready', detail: 'Running locally with 3 model(s).' },
];

function mockReport(capabilities: Capability[], success = true) {
  (window as any).electron = {
    getCapabilityReport: jest.fn().mockResolvedValue({
      success,
      capabilities,
      summary: {
        ready: capabilities.filter(c => c.state === 'ready').length,
        total: capabilities.length,
        needsAttention: capabilities.filter(c => c.state !== 'ready'),
      },
    }),
  };
}

afterEach(() => { delete (window as any).electron; });

test('it renders, and leads with what is NOT working', async () => {
  mockReport(BROKEN);
  const { container, getByTestId } = render(<CapabilityReport />);

  await waitFor(() => expect(getByTestId('cap-web-search')).toBeTruthy());

  // The two broken ones are visible without any interaction; the working one
  // is behind the toggle. A screen that opens on green ticks buries the thing
  // that needs attention.
  expect(getByTestId('cap-media-studio')).toBeTruthy();
  expect(container.querySelector('[data-testid="cap-local-chat"]')).toBeNull();
});

test('every broken capability shows its fix, not just its status', async () => {
  // A status with no remedy is a shrug, and the app already had plenty.
  mockReport(BROKEN);
  const { getByTestId } = render(<CapabilityReport />);

  await waitFor(() => expect(getByTestId('cap-web-search')).toBeTruthy());
  expect(getByTestId('cap-web-search').textContent).toContain('SearXNG');
  expect(getByTestId('cap-media-studio').textContent).toContain('Set it up for me');
});

test('"not checked" is shown as not checked, never as working', async () => {
  // The assertion the whole design turns on. Web search with no provider is
  // genuinely unknown — nothing ran a search — and rounding that up to a green
  // tick is exactly the lie this screen exists to stop.
  mockReport(BROKEN);
  const { getByTestId } = render(<CapabilityReport />);

  await waitFor(() => expect(getByTestId('cap-web-search')).toBeTruthy());
  const el = getByTestId('cap-web-search');
  expect(el.className).toContain('cap-unknown');
  expect(el.textContent).toContain('Not checked');
  expect(el.textContent).not.toContain('Working');
});

test('the summary counts only what genuinely works', async () => {
  mockReport(BROKEN);
  const { getByTestId } = render(<CapabilityReport />);
  await waitFor(() => expect(getByTestId('capability-summary')).toBeTruthy());
  expect(getByTestId('capability-summary').textContent).toContain('1 of 3');
});

test('the working ones are reachable behind the toggle', async () => {
  mockReport(BROKEN);
  const { getByTestId, getByText } = render(<CapabilityReport />);

  await waitFor(() => expect(getByTestId('cap-web-search')).toBeTruthy());
  fireEvent.click(getByText(/Show the 1 that are working/));
  expect(getByTestId('cap-local-chat')).toBeTruthy();
});

test('all-clear says so instead of showing an empty list', async () => {
  mockReport([{ id: 'local-chat', label: 'Answer on this PC', state: 'ready', detail: 'Fine.' }]);
  const { getByText } = render(<CapabilityReport />);
  await waitFor(() => expect(getByText('Everything is working.')).toBeTruthy());
});

test('a failed check reports the failure rather than an empty all-clear', async () => {
  // Reporting "everything is working" because the check itself broke would be
  // the worst possible outcome for this particular screen.
  (window as any).electron = {
    getCapabilityReport: jest.fn().mockResolvedValue({ success: false, error: 'Could not check.' }),
  };
  const { getByText, queryByText } = render(<CapabilityReport />);
  await waitFor(() => expect(getByText('Could not check.')).toBeTruthy());
  expect(queryByText('Everything is working.')).toBeNull();
});
