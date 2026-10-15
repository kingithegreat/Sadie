/**
 * Image ("scanner") path on cloud providers:
 *  - Gemini Native carries attachments as inlineData (they were dropped)
 *  - image-only messages are sent with a default prompt (they were dropped)
 *  - generateFromCustomLLM forwards imageData
 */
jest.mock('axios');
jest.mock('../config-manager', () => ({ getSettings: jest.fn(() => ({})) }));

import { EventEmitter } from 'events';
import axios from 'axios';
import { streamFromCustomLLM, toGeminiContents, DEFAULT_IMAGE_PROMPT, generateFromCustomLLM } from '../custom-llm-client';
import { migrateRetiredModel } from '../model-lifecycle';

const PNG = 'iVBORw0KGgo=';
const gemini = { apiUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'k', model: 'gemini-2.5-flash', provider: 'google-gemini', name: 'g', enabled: true } as any;
const openai = { apiUrl: 'https://api.openai.com/v1', apiKey: 'sk', model: 'gpt-4o', provider: 'openai', name: 'o', enabled: true } as any;

const tick = () => new Promise(r => setTimeout(r, 0));
beforeEach(() => {
  jest.clearAllMocks();
  (axios.post as jest.Mock).mockResolvedValue({ data: new EventEmitter() });
});

describe('toGeminiContents', () => {
  test('turns image_url data URLs into inlineData parts', () => {
    const out = toGeminiContents([
      { role: 'system', content: 'sys' },
      { role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${PNG}` } }] },
    ] as any);
    expect(out).toEqual([{ role: 'user', parts: [{ text: 'what is this?' }, { inlineData: { mimeType: 'image/jpeg', data: PNG } }] }]);
  });

  test('keeps an image-only message', () => {
    const out = toGeminiContents([{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }] }] as any);
    expect(out[0].parts).toEqual([{ inlineData: { mimeType: 'image/png', data: PNG } }]);
  });
});

describe('streamFromCustomLLM with images', () => {
  test('Gemini Native request body carries inlineData', async () => {
    streamFromCustomLLM('describe', [], gemini, 'sys', jest.fn(), jest.fn(), jest.fn(), undefined, undefined, undefined, [{ base64: PNG, mimeType: 'image/png' }]);
    await tick(); await tick();
    const [url, body] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toContain(':streamGenerateContent');
    expect(body.contents.at(-1).parts).toEqual([{ text: 'describe' }, { inlineData: { mimeType: 'image/png', data: PNG } }]);
  });

  test('image-only message is sent with the default prompt (OpenAI shape)', async () => {
    streamFromCustomLLM('', [], openai, 'sys', jest.fn(), jest.fn(), jest.fn(), undefined, undefined, undefined, [{ base64: PNG, mimeType: 'image/png' }]);
    await tick(); await tick();
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    const user = body.messages.at(-1);
    expect(user.role).toBe('user');
    expect(user.content).toEqual([
      { type: 'text', text: DEFAULT_IMAGE_PROMPT },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } },
    ]);
  });

  test('image-only message on Gemini Native is not dropped', async () => {
    streamFromCustomLLM('', [], gemini, 'sys', jest.fn(), jest.fn(), jest.fn(), undefined, undefined, undefined, [{ base64: PNG }]);
    await tick(); await tick();
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(body.contents.at(-1).parts).toEqual([{ text: DEFAULT_IMAGE_PROMPT }, { inlineData: { mimeType: 'image/png', data: PNG } }]);
  });

  test('generateFromCustomLLM forwards imageData', async () => {
    const stream = new EventEmitter();
    (axios.post as jest.Mock).mockResolvedValue({ data: stream });
    const p = generateFromCustomLLM(gemini, 'sys', 'q', { imageData: [{ base64: PNG, mimeType: 'image/png' }], timeoutMs: 2000 });
    await tick(); await tick();
    const body = (axios.post as jest.Mock).mock.calls[0][1];
    expect(body.contents.at(-1).parts[1]).toEqual({ inlineData: { mimeType: 'image/png', data: PNG } });
    stream.emit('end');
    await p.catch(() => undefined);
  });
});

describe('retired Gemini 1.5 IDs', () => {
  test('saved selections migrate to a current model', () => {
    expect(migrateRetiredModel('gemini-1.5-flash')).toEqual({ model: 'gemini-2.5-flash', renamedFrom: 'gemini-1.5-flash' });
    expect(migrateRetiredModel('gemini-1.5-pro')).toEqual({ model: 'gemini-2.5-pro', renamedFrom: 'gemini-1.5-pro' });
  });
});
