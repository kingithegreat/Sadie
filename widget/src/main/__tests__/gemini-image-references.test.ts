let mockOnline = true;
let mockKey = 'AIza-test-key';
jest.mock('../config-manager', () => ({ getSettings: () => ({ useCustomLLM: mockOnline }) }));
jest.mock('../../shared/cloud-llm', () => ({
  resolveCloudLLM: (s: { useCustomLLM: boolean }) => ({ intended: s.useCustomLLM }),
  apiKeyForProvider: (_s: unknown, provider: string) => (provider === 'google-ai-studio' ? mockKey : ''),
}));
jest.mock('../movie/image-output', () => ({ saveMovieShotImage: jest.fn() }));

import { generateGeminiImageFromImages, lastInteractionImage } from '../movie/gemini-image-adapter';

const IMG = 'A'.repeat(200);
const realFetch = global.fetch;

afterEach(() => {
  global.fetch = realFetch;
  mockOnline = true;
  mockKey = 'AIza-test-key';
});

test('reference images go to the Interactions API as typed blocks, the key in a header, and Google is told not to store them', async () => {
  const fetchMock = jest.fn(async () => new Response(JSON.stringify({
    status: 'completed',
    steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Here' }, { type: 'image', mime_type: 'image/png', data: IMG }] }],
  }), { status: 200 }));
  global.fetch = fetchMock as unknown as typeof fetch;

  const out = await generateGeminiImageFromImages('draw it', [{ mimeType: 'image/png', base64: 'R1VJREU=' }, { mimeType: 'image/jpeg', base64: 'UkVG' }], '2:3');
  expect(out).toEqual({ base64: IMG, mimeType: 'image/png' });

  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions');
  expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-test-key');
  expect(url).not.toContain('AIza');
  expect(JSON.parse(String(init.body))).toEqual({
    model: 'gemini-3.1-flash-image',
    input: [
      { type: 'text', text: 'draw it' },
      { type: 'image', mime_type: 'image/png', data: 'R1VJREU=' },
      { type: 'image', mime_type: 'image/jpeg', data: 'UkVG' },
    ],
    response_format: { type: 'image', aspect_ratio: '2:3', image_size: '1K' },
    store: false,
  });
});

test('nothing is sent with Online off or without a key, and Google errors read plainly', async () => {
  const fetchMock = jest.fn();
  global.fetch = fetchMock as unknown as typeof fetch;
  mockOnline = false;
  await expect(generateGeminiImageFromImages('p', [], '1:1')).rejects.toThrow(/needs Online access/);
  mockOnline = true;
  mockKey = '';
  await expect(generateGeminiImageFromImages('p', [], '1:1')).rejects.toThrow(/No Gemini API key/);
  expect(fetchMock).not.toHaveBeenCalled();

  mockKey = 'AIza-test-key';
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded for metric: free_tier limit: 0', status: 'RESOURCE_EXHAUSTED' } }), { status: 429 })) as unknown as typeof fetch;
  await expect(generateGeminiImageFromImages('p', [], '1:1')).rejects.toThrow(/no free tier: turn on billing/);
  global.fetch = jest.fn(async () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'I cannot' }] }] }), { status: 200 })) as unknown as typeof fetch;
  await expect(generateGeminiImageFromImages('p', [], '1:1')).rejects.toThrow('Gemini returned no image (status completed). Try again.');
});

test('the last image block wins, wherever the response nests it', () => {
  expect(lastInteractionImage({ outputs: [{ type: 'image', data: 'B'.repeat(150) }, { type: 'image', mime_type: 'image/jpeg', data: IMG }] }))
    .toEqual({ base64: IMG, mimeType: 'image/jpeg' });
  expect(lastInteractionImage({ steps: [{ content: [{ type: 'image', data: 'tiny' }] }] })).toBeNull();
});
