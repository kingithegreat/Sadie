import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performWorkspaceDebug, stopWorkspaceDebuggers } from '../workspace-debug';
jest.setTimeout(30_000);
let root: string; let file: string;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.homedir(), 'hb-debug-')); file = path.join(root, 'main.js'); fs.writeFileSync(file, 'let count = 1;\ncount += 2;\nconsole.log("RESULT", count);\n'); });
afterEach(async () => { await stopWorkspaceDebuggers(); fs.rmSync(root, { recursive: true, force: true }); });
const call = (action: Parameters<typeof performWorkspaceDebug>[0]['action'], extra = {}) => performWorkspaceDebug({ root, action, ...extra });
async function waitForPaused() { for (let attempts = 0; attempts < 50; attempts++) { const state = await call('state'); if (state.paused) return state; await new Promise(resolve => setTimeout(resolve, 30)); } throw new Error('The actual program never paused.'); }
test('real Node inspector pauses, steps, watches, shows variables and executes output', async () => {
  const started = await call('start', { file }); expect(started.success).toBe(true);
  const childPid = started.pid!; expect(Number.isInteger(childPid)).toBe(true); expect(childPid).not.toBe(process.pid);
  let state = await waitForPaused(); expect(state.frames?.some(frame => frame.path === file)).toBe(true);
  expect((await call('breakpoint', { file, line: 3 })).success).toBe(true);
  expect((await call('resume')).success).toBe(true);
  state = await waitForPaused(); expect(state.frames?.[0].line).toBe(3);
  expect((await call('evaluate', { expression: 'count' })).value).toBe('3');
  expect((await call('scopes')).variables?.some(variable => variable.name.endsWith('.count') && variable.value === '3')).toBe(true);
  expect((await call('step-over')).success).toBe(true);
  for (let index = 0; index < 50; index++) { state = await call('state'); if (state.output?.includes('RESULT 3')) break; await new Promise(resolve => setTimeout(resolve, 30)); }
  expect(state.output).toContain('RESULT 3');
  expect((await call('stop')).running).toBe(false);
  expect(() => process.kill(childPid, 0)).toThrow();
  console.info(JSON.stringify({ debuggerProof: { childPid, pausedAt: 3, watchValue: 3, output: 'RESULT 3', stopProcessGone: true } }));
});
test('refuses unrelated scripts, unsupported runtimes, invalid breakpoints, and evaluation while running', async () => {
  expect((await call('start', { file: path.join(root, '..', 'other.js') })).success).toBe(false);
  const python = path.join(root, 'test.py'); fs.writeFileSync(python, 'print(1)');
  expect((await call('start', { file: python })).error).toMatch(/supports JavaScript Node/);
  expect((await call('breakpoint', { file, line: -1 })).success).toBe(false);
  expect((await call('evaluate', { expression: '1 + 1' })).error).toMatch(/Start|Pause/);
});
jest.mock('electron', () => ({ app: { getPath: () => '/mock' } }));
