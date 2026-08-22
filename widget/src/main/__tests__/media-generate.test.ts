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
  generateResearch,
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
    // Mentions the subject — a real script would; pure filler would now trip
    // the drift check below, which is the point of it. ~48s spoken.
    const clean = new Array(40).fill('word Jonah storm').join(' ');
    expect(checkScript(short, clean)).toEqual([]);
  });

  it('reports an empty script rather than treating it as fine', () => {
    expect(checkScript(short, '').join(' ')).toMatch(/empty/i);
  });

  // Off-topic drift was the most-reported script failure: fluent output that
  // barely touches the subject. Detected mechanically — the title's key words
  // are the contract, and a script that mentions none of them has wandered no
  // matter how well it reads. The bar is "mentions at least one key word":
  // strict enough to catch drift, loose enough to never fail honest scripts.
  describe('off-topic drift', () => {
    it('flags a script that never mentions the title subject', () => {
      // ~16s spoken — inside the length band, so ONLY the drift check fires.
      const drifted = 'completely unrelated filler text here '.repeat(8);
      const problems = checkScript(short, drifted).join(' ');
      expect(problems).toMatch(/drifted off topic/i);
    });

    it('passes a script that engages the title subject', () => {
      // 40 words ≈ 16s — inside the length band, so only drift is under test.
      const onTopic = 'Jonah storm ship sailors sea '.repeat(8);
      expect(checkScript(short, onTopic)).toEqual([]);
    });

    it('ignores stop-words when judging the title', () => {
      // "One-Minute Bible: Jonah" — "bible" and "jonah" carry the topic;
      // "one" and "minute" are framing. A script saying "Jonah" is on topic.
      const script = 'the a an of Jonah '.repeat(8); // ~40 words
      expect(checkScript(short, script)).toEqual([]);
    });
  });
});

/**
 * Research through n8n.
 *
 * The plan's first content guardrail is "never fabricate quotations or
 * citations", and asking a model to recall facts is the operation that invents
 * them. Fetching real pages turns the job into summarising a source. But the
 * workflow is optional — a video must never be blocked because an integration
 * nobody installed is missing — so the fallback matters as much as the feature.
 */
describe('research prefers n8n, and survives without it', () => {
  const job = createJob({ title: 'One-Minute Bible: Jonah', brief: 'the storm' });

  it('uses fetched sources when the workflow answers', async () => {
    post.mockImplementation(async (url: string) => {
      if (String(url).includes('/webhook/homebot/media-research')) {
        return {
          status: 200,
          data: {
            text: 'Jonah is a book of the Hebrew Bible, four chapters long.',
            sources: [{ title: 'Book of Jonah', url: 'https://example.org/jonah' }],
          },
        };
      }
      return { data: { response: 'A summary drawn from the source material.' } };
    });

    const res = await generateResearch(job);
    expect(res.via).toMatch(/n8n research/);
    // Attribution travels with the brief — a claim is only checkable if its
    // origin does.
    expect(res.text).toMatch(/Sources:/);
    expect(res.text).toMatch(/example\.org\/jonah/);
  });

  it('falls back to the model when the workflow is not deployed', async () => {
    post.mockImplementation(async (url: string) => {
      if (String(url).includes('/webhook/')) return { status: 404, data: '' };
      return { data: { response: 'Model-only research.' } };
    });

    const res = await generateResearch(job);
    expect(res.text).toBe('Model-only research.');
    expect(res.via).not.toMatch(/n8n/);
  });

  it('falls back when n8n is unreachable rather than failing the video', async () => {
    post.mockImplementation(async (url: string) => {
      if (String(url).includes('/webhook/')) throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
      return { data: { response: 'Model-only research.' } };
    });

    await expect(generateResearch(job)).resolves.toMatchObject({ text: 'Model-only research.' });
  });

  it('falls back when the workflow answers with nothing useful', async () => {
    // A deployed-but-empty result is worse than none: it would produce a script
    // grounded in silence.
    post.mockImplementation(async (url: string) => {
      if (String(url).includes('/webhook/')) return { status: 200, data: { text: '   ', sources: [] } };
      return { data: { response: 'Model-only research.' } };
    });

    const res = await generateResearch(job);
    expect(res.via).not.toMatch(/n8n/);
  });
});
