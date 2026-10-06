/** @jest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MediaStudioPanel } from '../components/MediaStudioPanel';

const base = { format: 'short', createdAt: '2026-10-07', updatedAt: '2026-10-07', history: [] };
const job = (id: string, state: string) => ({ ...base, id, title: `Video ${id}`, state });
beforeEach(() => {
  jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  HTMLElement.prototype.scrollIntoView = jest.fn();
});
afterEach(() => { cleanup(); jest.restoreAllMocks(); delete (window as any).electron; });
async function mount(jobs: any[] = [], extra: Record<string, any> = {}) {
  const api = { mediaList: jest.fn().mockResolvedValue(jobs), ...extra };
  (window as any).electron = api;
  await act(async () => { render(<MediaStudioPanel />); });
  return api;
}

test('published videos are separated from work in progress and never suggested as the next task', async () => {
  await mount([job('finished', 'published'), job('draft', 'idea')]);
  const published = screen.getByRole('region', { name: 'Published videos' });
  expect(within(published).getByRole('listitem', { name: 'Video finished' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'In progress (1)' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open next step: Video draft' })).toBeInTheDocument();
});

test('rejected videos are closed and never proposed as the next task', async () => {
  await mount([job('closed', 'rejected')]);
  expect(screen.getByRole('region', { name: 'Rejected videos' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Open next step:/ })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Ready for your next video' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: /^Needs attention/ })).not.toBeInTheDocument();
});

test('failed jobs resume their recorded stage without running generation or approval', async () => {
  const failed = { ...job('retry', 'failed'), history: [{ from: 'media_production', to: 'failed', at: '2026-10-07', by: 'render stage' }] };
  const mediaAdvance = jest.fn().mockResolvedValue({ ok: true });
  const mediaRun = jest.fn(), mediaApprove = jest.fn();
  await mount([failed], { mediaAdvance, mediaRun, mediaApprove });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume at/ })); });
  expect(mediaAdvance).toHaveBeenCalledWith('retry', 'media_production');
  expect(mediaRun).not.toHaveBeenCalled();
  expect(mediaApprove).not.toHaveBeenCalled();
});

test('unknown recovery history cannot invent a stage or bypass approval', async () => {
  await mount([{ ...job('legacy', 'failed'), history: [] },
    { ...job('unsafe', 'blocked'), history: [{ from: 'approved', to: 'blocked', at: '2026-10-07', by: 'unknown' }] }]);
  expect(screen.queryByRole('button', { name: /Resume at/ })).not.toBeInTheDocument();
  expect(screen.getAllByText(/interrupted stage is unavailable/)).toHaveLength(2);
});

test('refused recovery leaves the failed project visible and explains the error', async () => {
  await mount([{ ...job('retry', 'blocked'), history: [{ from: 'script_draft', to: 'blocked', at: '2026-10-07', by: 'script stage' }] }],
    { mediaAdvance: jest.fn().mockResolvedValue({ ok: false, error: 'Saved project is read only.' }) });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Resume at/ })); });
  expect(screen.getByRole('alert')).toHaveTextContent('Saved project is read only.');
  expect(screen.getByRole('button', { name: /Resume at/ })).toBeInTheDocument();
});

test('next step focuses the review job before drafts without generating or approving anything', async () => {
  const mediaRun = jest.fn();
  const mediaApprove = jest.fn();
  await mount([job('draft', 'idea'), job('review', 'awaiting_approval')], { mediaRun, mediaApprove });
  fireEvent.click(screen.getByRole('button', { name: 'Open next step: Video review' }));
  expect(screen.getByRole('listitem', { name: 'Video review' })).toHaveFocus();
  expect(mediaRun).not.toHaveBeenCalled();
  expect(mediaApprove).not.toHaveBeenCalled();
});

test('new-video shortcut focuses the title and secondary tools remain discoverable', async () => {
  await mount();
  fireEvent.click(screen.getByRole('button', { name: 'Start a new video' }));
  expect(screen.getByRole('textbox', { name: 'New video title' })).toHaveFocus();
  expect(screen.getByText('Explore Studio tools').closest('details')).not.toHaveAttribute('open');
});

test('tool entry uses a native button and loads storyboard projects through the same action', async () => {
  const mediaStoryboardList = jest.fn().mockResolvedValue({ ok: true, storyboards: [] });
  await mount([], { mediaStoryboardList });
  const disclosure = screen.getByText('Explore Studio tools').closest('details')!;
  disclosure.open = true;
  const entry = within(screen.getByRole('region', { name: 'Studio Quick Launch' })).getByRole('button', { name: /^Storyboard/ });
  expect(entry.tagName).toBe('BUTTON');
  await act(async () => { fireEvent.click(entry); });
  expect(mediaStoryboardList).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('tab', { name: /Storyboard/ })).toHaveAttribute('aria-selected', 'true');
});

test('a refused creation preserves the working title for correction and retry', async () => {
  await mount([], { mediaCreate: jest.fn().mockResolvedValue({ ok: false, error: 'Could not save this project.' }) });
  const title = screen.getByRole('textbox', { name: 'New video title' });
  fireEvent.change(title, { target: { value: 'Keep this idea' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add video' })); });
  expect(title).toHaveValue('Keep this idea');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not save this project.');
});

test('unavailable creation explains recovery and keeps the title', async () => {
  await mount();
  const title = screen.getByRole('textbox', { name: 'New video title' });
  fireEvent.change(title, { target: { value: 'Keep this draft' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add video' })); });
  expect(title).toHaveValue('Keep this draft');
  expect(screen.getByRole('alert')).toHaveTextContent('Video creation is unavailable');
});

test('successful creation selects and focuses the new project so its next action is reachable', async () => {
  const created = job('created', 'idea');
  const mediaList = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([created]);
  await mount([], { mediaList, mediaCreate: jest.fn().mockResolvedValue({ ok: true, job: created }) });
  const title = screen.getByRole('textbox', { name: 'New video title' });
  fireEvent.change(title, { target: { value: 'Video created' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add video' })); });
  expect(title).toHaveValue('');
  expect(screen.getByRole('listitem', { name: 'Video created' })).toHaveFocus();
  expect(screen.getByRole('button', { name: 'Write script' })).toBeInTheDocument();
});

test('a successful save followed by a refused list reload clears the submitted title and reports the reload error', async () => {
  const mediaList = jest.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('Could not reload saved projects.'));
  const mediaCreate = jest.fn().mockResolvedValue({ ok: true, job: job('saved', 'idea') });
  await mount([], { mediaList, mediaCreate });
  const title = screen.getByRole('textbox', { name: 'New video title' });
  fireEvent.change(title, { target: { value: 'Saved idea' } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Add video' })); });
  expect(title).toHaveValue('');
  expect(screen.getByRole('alert')).toHaveTextContent('Could not reload saved projects.');
  await act(async () => { fireEvent.keyDown(title, { key: 'Enter' }); });
  expect(mediaCreate).toHaveBeenCalledTimes(1);
});

test('repeated Enter while creation is pending makes one job and preserves a newer draft', async () => {
  let resolve!: (value: any) => void;
  const mediaCreate = jest.fn(() => new Promise(done => { resolve = done; }));
  await mount([], { mediaCreate });
  const title = screen.getByRole('textbox', { name: 'New video title' });
  fireEvent.change(title, { target: { value: 'First idea' } });
  await act(async () => {
    fireEvent.keyDown(title, { key: 'Enter' });
    fireEvent.keyDown(title, { key: 'Enter' });
  });
  expect(mediaCreate).toHaveBeenCalledTimes(1);
  fireEvent.change(title, { target: { value: 'Next idea' } });
  await act(async () => { resolve({ ok: true, job: job('created', 'idea') }); });
  expect(title).toHaveValue('Next idea');
});
