import axios from 'axios';
import {
  evaluateToolResults,
  parseReflectionVerdict,
  REFLECTION_CONFIDENCE_THRESHOLD,
  MAX_REFLECTION_DEPTH
} from '../reflection-validator';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('constants', () => {
  it('exposes the expected confidence threshold and depth budget', () => {
    expect(REFLECTION_CONFIDENCE_THRESHOLD).toBe(0.7);
    expect(MAX_REFLECTION_DEPTH).toBe(2);
  });
});

describe('parseReflectionVerdict', () => {
  it('parses a valid accept verdict', () => {
    const v = parseReflectionVerdict(JSON.stringify({
      outcome: 'accept',
      confidence: 0.92,
      final_message: 'The answer is 42.'
    }));
    expect(v).toEqual({ outcome: 'accept', confidence: 0.92, final_message: 'The answer is 42.' });
  });

  it('parses a valid request_tool verdict', () => {
    const v = parseReflectionVerdict(JSON.stringify({
      outcome: 'request_tool',
      confidence: 0.4,
      tool_request: { name: 'web_search', arguments: { query: 'more info' } }
    }));
    expect(v).toEqual({
      outcome: 'request_tool',
      confidence: 0.4,
      tool_request: { name: 'web_search', arguments: { query: 'more info' } }
    });
  });

  it('parses a valid explain verdict', () => {
    const v = parseReflectionVerdict(JSON.stringify({
      outcome: 'explain',
      confidence: null,
      explanation: "couldn't validate the tool output"
    }));
    expect(v).toEqual({ outcome: 'explain', confidence: null, explanation: "couldn't validate the tool output" });
  });

  it('rejects non-JSON', () => {
    expect(parseReflectionVerdict('not json at all')).toBeNull();
  });

  it('rejects JSON with markdown fences', () => {
    expect(parseReflectionVerdict('```json\n{"outcome":"accept","confidence":0.9,"final_message":"hi"}\n```')).toBeNull();
  });

  it('rejects an unknown outcome', () => {
    expect(parseReflectionVerdict(JSON.stringify({ outcome: 'maybe', confidence: 0.5 }))).toBeNull();
  });

  it('rejects accept without final_message', () => {
    expect(parseReflectionVerdict(JSON.stringify({ outcome: 'accept', confidence: 0.9 }))).toBeNull();
  });

  it('rejects request_tool without a tool name', () => {
    expect(parseReflectionVerdict(JSON.stringify({ outcome: 'request_tool', tool_request: {} }))).toBeNull();
  });

  it('rejects explain without an explanation', () => {
    expect(parseReflectionVerdict(JSON.stringify({ outcome: 'explain' }))).toBeNull();
  });

  it('rejects arrays and non-objects', () => {
    expect(parseReflectionVerdict('[1,2,3]')).toBeNull();
    expect(parseReflectionVerdict('"just a string"')).toBeNull();
  });

  it('rejects empty input', () => {
    expect(parseReflectionVerdict('')).toBeNull();
    // @ts-expect-error intentional bad input
    expect(parseReflectionVerdict(undefined)).toBeNull();
  });
});

describe('evaluateToolResults', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  const baseArgs = {
    ollamaBaseUrl: 'http://127.0.0.1:11434',
    model: 'qwen2.5:7b',
    userMessage: 'what is the weather in Tauranga',
    toolSummary: '{"temperature":18,"condition":"cloudy"}',
    depth: 0
  };

  it('accepts high-confidence verdicts', async () => {
    const res = await evaluateToolResults({
      ...baseArgs,
      __testOverride: { outcome: 'accept', confidence: 0.92, final_message: "It's 18°C and cloudy in Tauranga." }
    });
    expect(res.accepted).toBe(true);
    expect(res.confidence).toBe(0.92);
    expect(res.message).toBe("It's 18°C and cloudy in Tauranga.");
    expect(res.fallback).toBe(false);
  });

  it('flags low-confidence accepts as unaccepted with a caution note', async () => {
    const res = await evaluateToolResults({
      ...baseArgs,
      __testOverride: { outcome: 'accept', confidence: 0.4, final_message: 'Probably 18°C.' }
    });
    expect(res.accepted).toBe(false);
    expect(res.message).toMatch(/low confidence/i);
  });

  it('treats accept with null confidence as below threshold', async () => {
    const res = await evaluateToolResults({
      ...baseArgs,
      __testOverride: { outcome: 'accept', confidence: null, final_message: 'Hard to say.' }
    });
    expect(res.accepted).toBe(false);
  });

  it('surfaces a tool_request so the caller can run another round', async () => {
    const res = await evaluateToolResults({
      ...baseArgs,
      __testOverride: {
        outcome: 'request_tool',
        confidence: 0.3,
        tool_request: { name: 'web_search', arguments: { query: 'Tauranga weather today' } }
      }
    });
    expect(res.accepted).toBe(false);
    expect(res.toolRequest).toEqual({ name: 'web_search', arguments: { query: 'Tauranga weather today' } });
    expect(res.fallback).toBe(false);
  });

  it('surfaces an explanation on explain outcome', async () => {
    const res = await evaluateToolResults({
      ...baseArgs,
      __testOverride: { outcome: 'explain', confidence: null, explanation: "couldn't validate the tool output" }
    });
    expect(res.accepted).toBe(false);
    expect(res.message).toMatch(/couldn't validate the tool output/i);
    expect(res.fallback).toBe(false);
  });

  it('force-accepts once the reflection depth budget is exhausted', async () => {
    const res = await evaluateToolResults({ ...baseArgs, depth: MAX_REFLECTION_DEPTH });
    expect(res.accepted).toBe(true);
    expect(res.fallback).toBe(true);
    expect(res.message).toMatch(/depth limit/i);
  });

  it('falls back to accept when the model returns invalid JSON', async () => {
    mockedAxios.post.mockResolvedValueOnce({ data: { response: 'not valid json' } });
    const res = await evaluateToolResults(baseArgs);
    expect(res.accepted).toBe(true);
    expect(res.fallback).toBe(true);
  });

  it('falls back to accept when the request errors out (network down, etc.)', async () => {
    mockedAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const res = await evaluateToolResults(baseArgs);
    expect(res.accepted).toBe(true);
    expect(res.fallback).toBe(true);
  });

  it('calls Ollama /api/generate with a strict-JSON request when no override is given', async () => {
    mockedAxios.post.mockResolvedValueOnce({
      data: { response: JSON.stringify({ outcome: 'accept', confidence: 0.8, final_message: 'ok' }) }
    });
    await evaluateToolResults(baseArgs);
    expect(mockedAxios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:11434/api/generate',
      expect.objectContaining({ model: 'qwen2.5:7b', format: 'json', stream: false })
    );
  });

  it('never throws even on unexpected axios rejection shapes', async () => {
    mockedAxios.post.mockRejectedValueOnce('a raw string rejection, not an Error');
    await expect(evaluateToolResults(baseArgs)).resolves.toMatchObject({ accepted: true, fallback: true });
  });
});
