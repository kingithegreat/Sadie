/**
 * The research and script stages.
 *
 * These run on whichever model the user already has — no new credentials — so
 * the risk is not "does it call an API" but "does it enforce the plan's
 * guardrails". Two of them are non-negotiable:
 *
 *   "Never fabricate biblical quotations, citations or historical claims."
 *   "Do not make every video a clone."
 *
 * A model cannot be made to obey a prompt, so the checks below run on its
 * output. Catching an UNVERIFIED marker here costs nothing; catching it after
 * TTS and a render costs real time and money.
 */

jest.mock('axios');
jest.mock('../config-manager', () => ({
  ...jest.requireActual('../config-manager'),
  getSettings: jest.fn(() => ({ ollamaUrl: 'http://127.0.0.1:11434', ollamaModel: 'qwen2.5:7b' })),
}));

import axios from 'axios';
import {
  generateText,
  estimateSpokenSeconds,
  checkScript,
} from '../media-generate';
import { createJob } from '../media-studio';

const post = axios.post as jest.Mock;
beforeEach(() => post.mockReset());

describe('reaching whichever model is configured', () => {
  it('uses local Ollama when no cloud model is set up', async () => {
    post.mockResolvedValue({ data: { response: '  some narration  ' } });
    const res = await generateText('sys', 'user');
    expect(res.text).toBe('some narration');
    expect(res.via).toBe('qwen2.5:7b');
    // Non-streaming: this is a background stage, not a chat turn.
    expect(post.mock.calls[0][1]).toMatchObject({ stream: false, model: 'qwen2.5:7b' });
  });

  it('reports an empty response instead of writing an empty script', async () => {
    post.mockResolvedValue({ data: { response: '   ' } });
    await expect(generateText('sys', 'user')).rejects.toThrow(/returned nothing/i);
  });
});

describe('spoken length', () => {
  it('estimates from word count at roughly speaking pace', () => {
    const words = new Array(150).fill('word').join(' ');
    expect(estimateSpokenSeconds(words)).toBe(60);
  });

  it('treats whitespace-only as zero', () => {
    expect(estimateSpokenSeconds('   \n  ')).toBe(0);
  });
});

describe('checks that run before anything is rendered', () => {
  const short = createJob({ title: 'One-Minute Bible: Jonah', format: 'short' });
  const long = createJob({ title: 'The Bible Explained', format: 'long' });

  it('flags a short that will overrun', () => {
    const tooLong = new Array(400).fill('word').join(' '); // ~160s
    expect(checkScript(short, tooLong).join(' ')).toMatch(/too long for a short/i);
  });

  it('flags a long-form video that is really a short', () => {
    const tooShort = new Array(200).fill('word').join(' '); // ~80s
    expect(checkScript(long, tooShort).join(' ')).toMatch(/short for a long-form/i);
  });

  it('catches an UNVERIFIED marker that survived into the script', () => {
    // The research stage marks anything uncertain; the script prompt says to
    // drop it. This is the net for when it does not.
    const script = 'Jonah waited three days. UNVERIFIED: the city held 120,000 people.';
    expect(checkScript(short, script).join(' ')).toMatch(/unverified/i);
  });

  it('catches a subscribe outro the brief rules out', () => {
    const script = new Array(120).fill('word').join(' ') + ' Like and share to support us.';
    expect(checkScript(short, script).join(' ')).toMatch(/subscribe/i);
  });

  it('passes a clean script of the right length', () => {
    const clean = new Array(130).fill('word').join(' '); // ~52s
    expect(checkScript(short, clean)).toEqual([]);
  });

  it('reports an empty script rather than treating it as fine', () => {
    expect(checkScript(short, '').join(' ')).toMatch(/empty/i);
  });
});
