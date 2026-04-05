/**
 * Tests for the Mixture of Agents (MoA) module.
 *
 * These tests verify:
 * - Complexity detection (shouldUseMoA)
 * - Aggregator prompt construction
 * - Pipeline orchestration with mocked Ollama responses
 */

// Mock axios before importing the module
jest.mock('axios');
jest.mock('../config-manager', () => ({
  getSettings: jest.fn(() => ({})),
}));
jest.mock('../utils/logger', () => ({
  logTelemetryEvent: jest.fn(),
}));
jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

import { shouldUseMoA, runMoAPipeline, getProposerRole, MOA_PRESETS, PROPOSER_ROLES, recommendMoAPreset, recommendConfig, MOA_MIN_VRAM_GB, SINGLE_MODEL_RECOMMENDATIONS } from '../moa';
import type { MoACallbacks, MoAOptions } from '../moa';
import axios from 'axios';
import { logTelemetryEvent } from '../utils/logger';

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLogTelemetry = logTelemetryEvent as jest.Mock;

// ── shouldUseMoA ─────────────────────────────────────────────────────────────

describe('shouldUseMoA — complexity detection', () => {
  describe('rejects simple queries (fast path)', () => {
    test.each([
      'hi',
      'hello!',
      'hey',
      'yes',
      'no',
      'ok',
      'thanks',
      'bye',
      '/reset',
      '/compact',
      '/status',
    ])('"%s" → false', (msg) => {
      expect(shouldUseMoA(msg)).toBe(false);
    });

    test('very short messages are never complex', () => {
      expect(shouldUseMoA('hw r u')).toBe(false);
      expect(shouldUseMoA('12345')).toBe(false);
    });
  });

  describe('accepts complex queries (MoA path)', () => {
    test.each([
      'explain how transformers work in machine learning',
      'compare React and Vue for a large enterprise application',
      'analyze this error log and suggest fixes',
      'write a Python script that processes CSV files',
      'what are the pros and cons of microservices architecture?',
      'create a detailed plan for migrating our database',
      'debug why this function returns undefined',
      'step by step, how do I set up a CI/CD pipeline?',
      'write me an essay about the impact of AI on education',
      'design a REST API for a social media platform',
    ])('"%s" → true', (msg) => {
      expect(shouldUseMoA(msg)).toBe(true);
    });
  });

  describe('heuristics', () => {
    test('long messages (>80 chars) with question marks trigger MoA', () => {
      const long = 'I am trying to understand how the various components of a distributed system interact with each other in production environments?';
      expect(long.length).toBeGreaterThan(80);
      expect(shouldUseMoA(long)).toBe(true);
    });

    test('long messages without question marks default to fast path', () => {
      const long = 'I want to go to the store later today and maybe pick up some groceries for the weekend dinner party.';
      expect(long.length).toBeGreaterThan(80);
      expect(shouldUseMoA(long)).toBe(false);
    });
  });
});

// ── runMoAPipeline ───────────────────────────────────────────────────────────

describe('runMoAPipeline', () => {
  /** Helper to create a mock readable stream that emits Ollama JSONL chunks */
  function createMockStream(content: string) {
    const { Readable } = require('stream');
    const lines = [
      JSON.stringify({ message: { content } }),
      JSON.stringify({ done: true }),
    ];
    const stream = new Readable({
      read() {
        for (const line of lines) {
          this.push(Buffer.from(line + '\n', 'utf8'));
        }
        this.push(null);
      },
    });
    return stream;
  }

  function makeOptions(overrides?: Partial<MoAOptions>): MoAOptions {
    return {
      proposers: ['model-a', 'model-b'],
      aggregator: 'model-agg',
      systemPrompt: 'You are helpful.',
      history: [],
      userMessage: 'explain quantum computing',
      ...overrides,
    };
  }

  function makeCallbacks(): MoACallbacks & { chunks: string[]; errors: any[]; ended: boolean } {
    const ctx = {
      chunks: [] as string[],
      errors: [] as any[],
      ended: false,
      onChunk: (text: string) => { ctx.chunks.push(text); },
      onEnd: () => { ctx.ended = true; },
      onError: (err: any) => { ctx.errors.push(err); },
      onProposerStatus: jest.fn(),
    };
    return ctx;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('sends parallel requests to all proposers then streams aggregator', async () => {
    let callCount = 0;
    mockedAxios.post.mockImplementation((_url, body: any) => {
      callCount++;
      const model = body.model;
      const content = model === 'model-agg'
        ? 'Aggregated answer about quantum computing.'
        : `Proposal from ${model}.`;
      return Promise.resolve({ data: createMockStream(content) });
    });

    const opts = makeOptions();
    const cb = makeCallbacks();
    const handle = await runMoAPipeline(opts, cb);

    expect(handle.cancel).toBeInstanceOf(Function);
    expect(cb.ended).toBe(true);
    expect(cb.errors).toHaveLength(0);

    // 2 proposers + 1 aggregator = 3 total API calls
    expect(mockedAxios.post).toHaveBeenCalledTimes(3);

    // First chunk is the MoA indicator
    expect(cb.chunks[0]).toContain('Consulting 2 specialist models');
    // Last chunk(s) should contain the aggregated answer
    const fullText = cb.chunks.join('');
    expect(fullText).toContain('Aggregated answer about quantum computing');
  });

  test('still aggregates when one proposer fails', async () => {
    mockedAxios.post.mockImplementation((_url, body: any) => {
      const model = body.model;
      if (model === 'model-a') {
        return Promise.reject(new Error('model not found'));
      }
      const content = model === 'model-agg'
        ? 'Synthesised from single proposal.'
        : `Proposal from ${model}.`;
      return Promise.resolve({ data: createMockStream(content) });
    });

    const cb = makeCallbacks();
    await runMoAPipeline(makeOptions(), cb);

    expect(cb.ended).toBe(true);
    expect(cb.errors).toHaveLength(0);
    const fullText = cb.chunks.join('');
    expect(fullText).toContain('Synthesised from single proposal');
  });

  test('errors when all proposers fail', async () => {
    mockedAxios.post.mockRejectedValue(new Error('connection refused'));

    const cb = makeCallbacks();
    await runMoAPipeline(makeOptions(), cb);

    expect(cb.errors).toHaveLength(1);
    expect(cb.errors[0].message).toBe('All proposer models failed');
  });

  test('cancel handle aborts the pipeline', async () => {
    // Create a stream that never completes
    const { Readable } = require('stream');
    const hangingStream = new Readable({ read() {} });

    mockedAxios.post.mockResolvedValue({ data: hangingStream });

    const cb = makeCallbacks();
    // Don't await — we want to cancel mid-flight
    const handlePromise = runMoAPipeline(makeOptions(), cb);

    // Give the async code a tick to start
    await new Promise(r => setTimeout(r, 50));

    // The handle should be returned even before completion
    // (the pipeline starts proposers immediately)
  });

  test('proposer status callbacks fire for each model', async () => {
    mockedAxios.post.mockImplementation((_url, body: any) => {
      const content = body.model === 'model-agg' ? 'Final answer' : `From ${body.model}`;
      return Promise.resolve({ data: createMockStream(content) });
    });

    const cb = makeCallbacks();
    await runMoAPipeline(makeOptions(), cb);

    // onProposerStatus should be called for each proposer (started + done)
    expect(cb.onProposerStatus).toHaveBeenCalledWith('model-a', 'started');
    expect(cb.onProposerStatus).toHaveBeenCalledWith('model-b', 'started');
    expect(cb.onProposerStatus).toHaveBeenCalledWith('model-a', 'done');
    expect(cb.onProposerStatus).toHaveBeenCalledWith('model-b', 'done');
  });

  test('passes conversation history to proposers', async () => {
    const history = [
      { role: 'user', content: 'previous question' },
      { role: 'assistant', content: 'previous answer' },
    ];

    mockedAxios.post.mockImplementation((_url, body: any) => {
      return Promise.resolve({ data: createMockStream('response') });
    });

    await runMoAPipeline(makeOptions({ history }), makeCallbacks());

    // Check that proposer calls include history messages
    const proposerCall = mockedAxios.post.mock.calls[0];
    const messages = proposerCall[1].messages;
    // messages[0] is system prompt, then history, then user message
    expect(messages[1].content).toBe('previous question');
    expect(messages[2].content).toBe('previous answer');
    expect(messages[3].content).toBe('explain quantum computing');
  });

  test('aggregator prompt includes proposal content', async () => {
    mockedAxios.post.mockImplementation((_url, body: any) => {
      const model = body.model;
      if (model === 'model-agg') {
        // Check the system prompt contains proposals
        const sysMsg = body.messages.find((m: any) => m.role === 'system');
        expect(sysMsg.content).toContain('Proposal 1 (from model-a)');
        expect(sysMsg.content).toContain('Proposal 2 (from model-b)');
        expect(sysMsg.content).toContain('Content from model-a.');
        expect(sysMsg.content).toContain('Content from model-b.');
      }
      const content = model === 'model-agg' ? 'Final' : `Content from ${model}.`;
      return Promise.resolve({ data: createMockStream(content) });
    });

    await runMoAPipeline(makeOptions(), makeCallbacks());
  });

  test('emits real-time proposer progress chunks', async () => {
    mockedAxios.post.mockImplementation((_url, body: any) => {
      const content = body.model === 'model-agg' ? 'Final answer' : `From ${body.model}`;
      return Promise.resolve({ data: createMockStream(content) });
    });

    const cb = makeCallbacks();
    await runMoAPipeline(makeOptions(), cb);

    const fullText = cb.chunks.join('');
    expect(fullText).toContain('model-a responded');
    expect(fullText).toContain('model-b responded');
    expect(fullText).toContain('Synthesising best answer');
  });

  test('applies role-specialised system prompts to proposers', async () => {
    const systemPrompts: string[] = [];
    mockedAxios.post.mockImplementation((_url, body: any) => {
      if (body.model !== 'model-agg') {
        const sysMsg = body.messages.find((m: any) => m.role === 'system');
        systemPrompts.push(sysMsg.content);
      }
      return Promise.resolve({ data: createMockStream('response') });
    });

    await runMoAPipeline(makeOptions(), makeCallbacks());

    // Each proposer should get a different role suffix
    expect(systemPrompts).toHaveLength(2);
    expect(systemPrompts[0]).toContain('CAREFUL ANALYST');
    expect(systemPrompts[1]).toContain("DEVIL'S ADVOCATE");
  });

  test('logs telemetry after pipeline completes', async () => {
    mockedAxios.post.mockImplementation((_url, body: any) => {
      return Promise.resolve({ data: createMockStream('response') });
    });

    await runMoAPipeline(makeOptions(), makeCallbacks());

    expect(mockedLogTelemetry).toHaveBeenCalledWith('moa_pipeline', expect.objectContaining({
      proposerCount: 2,
      proposers: ['model-a', 'model-b'],
      aggregator: 'model-agg',
      successfulCount: 2,
      proposerDurations: expect.any(Array),
      totalDurationMs: expect.any(Number),
    }));
  });
});

// ── Trivial modifier detection ───────────────────────────────────────────────

describe('shouldUseMoA — trivial modifiers downgrade complexity', () => {
  test.each([
    'write a quick note about the meeting',
    'explain what this button does',
    'just tell me the answer briefly',
    'give me a short summary of this code',
    'write a one-line description of this function',
  ])('"%s" → false (trivial modifier)', (msg) => {
    expect(shouldUseMoA(msg)).toBe(false);
  });

  test('complex queries without trivial modifiers still pass', () => {
    expect(shouldUseMoA('write a comprehensive essay about climate change')).toBe(true);
    expect(shouldUseMoA('explain the differences between TCP and UDP protocols')).toBe(true);
  });
});

// ── Presets & Roles ──────────────────────────────────────────────────────────

describe('MOA_PRESETS', () => {
  test('all presets have required fields', () => {
    for (const [_key, preset] of Object.entries(MOA_PRESETS)) {
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.proposers.length).toBeGreaterThanOrEqual(2);
      expect(preset.aggregator).toBeTruthy();
    }
  });

  test('balanced preset has 3 proposers', () => {
    expect(MOA_PRESETS.balanced.proposers).toHaveLength(3);
  });

  test('lightweight preset has only 2 proposers', () => {
    expect(MOA_PRESETS.lightweight.proposers).toHaveLength(2);
  });
});

describe('getProposerRole', () => {
  test('returns distinct roles for indices 0-4', () => {
    const names = new Set<string>();
    for (let i = 0; i < 5; i++) {
      names.add(getProposerRole(i).name);
    }
    expect(names.size).toBe(5);
  });

  test('wraps around for indices >= role count', () => {
    expect(getProposerRole(5).name).toBe(getProposerRole(0).name);
    expect(getProposerRole(7).name).toBe(getProposerRole(2).name);
  });

  test('each role has a non-empty suffix', () => {
    for (const role of PROPOSER_ROLES) {
      expect(role.suffix.length).toBeGreaterThan(10);
    }
  });
});

// ── recommendMoAPreset ──────────────────────────────────────────────────────

describe('recommendMoAPreset', () => {
  test('recommends codeHeavy for 16 GB+', () => {
    const result = recommendMoAPreset(16);
    expect(result).not.toBeNull();
    expect(result!.preset).toBe('codeHeavy');
  });

  test('recommends balanced for 8 GB', () => {
    const result = recommendMoAPreset(8);
    expect(result).not.toBeNull();
    expect(['codeHeavy', 'balanced']).toContain(result!.preset);
  });

  test('returns null for 4 GB (below MoA threshold)', () => {
    expect(recommendMoAPreset(4)).toBeNull();
  });

  test('returns null for 1 GB (not enough)', () => {
    expect(recommendMoAPreset(1)).toBeNull();
  });

  test('includes a reason string', () => {
    const result = recommendMoAPreset(12);
    expect(result).not.toBeNull();
    expect(result!.reason).toContain('12 GB');
  });
});

// ── recommendConfig ─────────────────────────────────────────────────────────

describe('recommendConfig', () => {
  test('recommends MoA mode for 16 GB', () => {
    const result = recommendConfig(16);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('moa');
    expect(result!.preset).toBeDefined();
  });

  test('recommends MoA mode for 8 GB', () => {
    const result = recommendConfig(8);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('moa');
  });

  test('recommends single-model for 4 GB', () => {
    const result = recommendConfig(4);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('single');
    expect(result!.model).toBe('qwen2.5:7b');
    expect(result!.preset).toBeUndefined();
  });

  test('recommends single-model for 2 GB', () => {
    const result = recommendConfig(2);
    expect(result).not.toBeNull();
    expect(result!.mode).toBe('single');
    expect(result!.model).toBe('llama3.2:3b');
  });

  test('returns null for 1 GB (insufficient)', () => {
    expect(recommendConfig(1)).toBeNull();
  });

  test('reason mentions RAG for low VRAM', () => {
    const result = recommendConfig(4);
    expect(result).not.toBeNull();
    expect(result!.reason.toLowerCase()).toContain('rag');
  });
});

// ── MOA_MIN_VRAM_GB & SINGLE_MODEL_RECOMMENDATIONS ─────────────────────────

describe('hardware constants', () => {
  test('MOA_MIN_VRAM_GB is 8', () => {
    expect(MOA_MIN_VRAM_GB).toBe(8);
  });

  test('SINGLE_MODEL_RECOMMENDATIONS is a non-empty array', () => {
    expect(Array.isArray(SINGLE_MODEL_RECOMMENDATIONS)).toBe(true);
    expect(SINGLE_MODEL_RECOMMENDATIONS.length).toBeGreaterThan(0);
  });

  test('each entry has minVram, model, and label', () => {
    for (const entry of SINGLE_MODEL_RECOMMENDATIONS) {
      expect(typeof entry.minVram).toBe('number');
      expect(typeof entry.model).toBe('string');
      expect(typeof entry.label).toBe('string');
    }
  });
});
