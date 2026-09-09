import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const handlers: Record<string, Function> = {};
const mockRunProject = jest.fn();
jest.mock('electron', () => ({
  ipcMain: { handle: (channel: string, handler: Function) => { handlers[channel] = handler; } },
}));
jest.mock('../movie/project-runner', () => ({
  MovieProjectRunner: { runProject: (...args: unknown[]) => mockRunProject(...args) },
}));
import { registerStudioIpc } from '../modules/bundled/studio-ipc';

// Exercise the registered handler and actual home/path checks; module/sender
// authorization is covered by media-mark-published-ipc.test.ts.
let projectDir: string;
beforeAll(() => {
  projectDir = fs.mkdtempSync(path.join(os.homedir(), 'homebot-movie-ipc-test-'));
  fs.writeFileSync(path.join(projectDir, 'project.json'), '{}');
  registerStudioIpc((_channel, handler) => handler, jest.fn(), jest.fn());
});
afterAll(() => { if (projectDir) fs.rmSync(projectDir, { recursive: true, force: true }); });

test.each([0, 1])('failed shots are an error even with %i completed shots', async completedShots => {
  const report = {
    totalShots: completedShots + 1, completedShots, failedShots: 1,
    deferredShots: 0, skippedShots: 0,
    results: [{ shotId: 'shot_01', status: 'FAILED', error: 'Pollinations needs Online access.' }],
  };
  mockRunProject.mockResolvedValue(report);
  expect(await handlers['homebot:media:movie:run']({}, { projectDir })).toEqual({
    ok: false, report, error: '1 shot failed. Online access is off. Turn on Online in Settings, or use a provider on this PC.',
  });
});

test('a successful or deferred report remains successful', async () => {
  const report = { totalShots: 2, completedShots: 1, failedShots: 0, deferredShots: 1, skippedShots: 0, results: [] };
  mockRunProject.mockResolvedValue(report);
  expect(await handlers['homebot:media:movie:run']({}, { projectDir })).toEqual({ ok: true, report });
});

test('a failed report without a provider message still returns an actionable failure', async () => {
  const report = { totalShots: 1, completedShots: 0, failedShots: 1, deferredShots: 0, skippedShots: 0, results: [] };
  mockRunProject.mockResolvedValue(report);
  expect(await handlers['homebot:media:movie:run']({}, { projectDir })).toMatchObject({
    ok: false, error: expect.stringMatching(/1 shot.*failed/i), report,
  });
});
