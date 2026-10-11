// Ollama is simulated at the HTTP client boundary; no model is downloaded or run.
jest.mock('os', () => ({ ...jest.requireActual('os'), freemem: () => 8 * 1024 ** 3 }));
jest.mock('axios', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => ({ ollamaUrl: 'http://127.0.0.1:11434' })) }));
jest.mock('../moa', () => ({ detectGpuVram: jest.fn(async () => ({ vramGB: 8 })) }));
jest.mock('../workspace-context', () => ({ validateWorkspaceRoot: jest.fn() }));
jest.mock('../../shared/cloud-llm', () => ({ resolveCloudLLM: jest.fn(() => ({ intended: false })) }));
import axios from 'axios';
import { resolveCloudLLM } from '../../shared/cloud-llm';
import { completeWorkspaceCode, chooseCompletionModel, installCompletionModel, resetCompletionStateForTests, completionLatencyStats, PINNED_COMPLETION_MODEL, COLD_TIMEOUT_MS, WARM_TIMEOUT_MS } from '../workspace-completion';

const get = axios.get as jest.Mock, post = axios.post as jest.Mock;
const GB = 1024 ** 3;
function ollama({ models, running = [] as any[], response = 'return a + b;' }: { models: any[]; running?: any[]; response?: string }) {
  get.mockImplementation(async (url: string) => url.endsWith('/api/tags') ? { data: { models } } : { data: { models: running } });
  post.mockImplementation(async () => ({ data: { response } }));
}
beforeEach(() => { resetCompletionStateForTests(); get.mockReset(); post.mockReset(); jest.spyOn(console, 'info').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

test('the pinned small base model wins over other compatible models; large coders are never used', () => {
  expect(chooseCompletionModel([{ name: 'qwen2.5-coder:0.5b', size: 0.4 * GB }, { name: PINNED_COMPLETION_MODEL, size: 0.98 * GB }, { name: 'qwen2.5-coder:7b', size: 4.4 * GB }])?.name).toBe(PINNED_COMPLETION_MODEL);
  expect(chooseCompletionModel([{ name: 'qwen2.5-coder:7b', size: 4.4 * GB }, { name: 'llama3:8b', size: 4.7 * GB }])).toBeUndefined();
  expect(chooseCompletionModel([{ name: 'qwen2.5-coder:0.5b', size: 0.4 * GB }])?.name).toBe('qwen2.5-coder:0.5b');
});

test('a missing model returns a clear install prompt and never starts a download', async () => {
  ollama({ models: [{ name: 'qwen2.5-coder:7b', size: 4.4 * GB }] });
  const result = await completeWorkspaceCode('/p', 'const x = ', '') as any;
  expect(result.text).toBe('');
  expect(result.reason).toMatch(/qwen2\.5-coder:1\.5b-base .* is not installed.*No download was started/);
  expect(result.setup).toEqual({ model: PINNED_COMPLETION_MODEL, sizeGB: 1, command: `ollama pull ${PINNED_COMPLETION_MODEL}` });
  expect(post).not.toHaveBeenCalled();
});

test('Ollama not running is explained', async () => {
  get.mockRejectedValue(new Error('connect ECONNREFUSED'));
  const result = await completeWorkspaceCode('/p', 'a', '') as any;
  expect(result.reason).toMatch(/Ollama is not running/);
});

test('the model is kept loaded; the first (cold) call gets the longer budget, later calls the warm one', async () => {
  ollama({ models: [{ name: PINNED_COMPLETION_MODEL, size: 0.98 * GB }] });
  const first = await completeWorkspaceCode('/p', 'function add(a, b) {\n  ', '\n}') as any;
  expect(first.text).toBe('return a + b;');
  expect(first.cold).toBe(true);
  const [, body, options] = post.mock.calls[0];
  expect(body.keep_alive).not.toBe(0);
  expect(body.prompt).toBe('<|fim_prefix|>function add(a, b) {\n  <|fim_suffix|>\n}<|fim_middle|>');
  expect(options.timeout).toBe(COLD_TIMEOUT_MS);
  const second = await completeWorkspaceCode('/p', 'x', '') as any;
  expect(second.cold).toBe(false);
  expect(post.mock.calls[1][2].timeout).toBe(WARM_TIMEOUT_MS);
});

test('every request logs its latency and p50/p95 are reported', async () => {
  ollama({ models: [{ name: PINNED_COMPLETION_MODEL, size: 0.98 * GB }] });
  const now = jest.spyOn(Date, 'now');
  let clock = 1_000_000; now.mockImplementation(() => clock);
  for (const ms of [100, 300, 200]) { post.mockImplementationOnce(async () => { clock += ms; return { data: { response: 'y' } }; }); await completeWorkspaceCode('/p', 'x', ''); }
  expect(completionLatencyStats()).toEqual({ count: 3, p50Ms: 200, p95Ms: 300, lastMs: 200 });
  expect((console.info as jest.Mock).mock.calls.map(call => call[0]).join('\n')).toMatch(/\[ide-completion\] model=qwen2\.5-coder:1\.5b-base latency=200ms cold=false outcome=ok p50=200ms/);
});

test('a timeout is reported in plain language and still logged', async () => {
  ollama({ models: [{ name: PINNED_COMPLETION_MODEL, size: 0.98 * GB }] });
  post.mockRejectedValueOnce(new Error('timeout of 8000ms exceeded'));
  const result = await completeWorkspaceCode('/p', 'x', '') as any;
  expect(result.reason).toMatch(/took longer than 8000 ms while loading/);
  expect(completionLatencyStats().count).toBe(1);
});

test('installing the pinned model needs Online and pulls only that model', async () => {
  expect((await installCompletionModel()).reason).toMatch(/Turn on Online/);
  expect(post).not.toHaveBeenCalled();
  (resolveCloudLLM as jest.Mock).mockReturnValue({ intended: true });
  post.mockResolvedValue({ data: { status: 'success' } });
  expect(await installCompletionModel()).toEqual({ installed: true, model: PINNED_COMPLETION_MODEL });
  expect(post).toHaveBeenCalledWith('http://127.0.0.1:11434/api/pull', { name: PINNED_COMPLETION_MODEL, stream: false }, expect.any(Object));
});
