/**
 * media-generate.ts — the research and script stages of the Media Studio.
 *
 * Phase 2's first half, and the part that needs no new credentials: it runs on
 * whichever LLM the user already has configured, cloud or local. TTS, visuals
 * and rendering come later and do need provider decisions.
 *
 * Two deliberate constraints from the plan's guardrails:
 *
 *  - "Never fabricate biblical quotations, citations or historical claims."
 *    The research prompt asks for what is actually known and requires the model
 *    to mark anything it is unsure of, rather than producing confident filler.
 *    A script that quotes scripture it invented is worse than no script.
 *
 *  - "Do not make every video a clone." The script prompt is given the working
 *    title and brief and asked for a specific angle, not a template fill.
 *
 * Generation never advances the job itself. It returns text; the caller
 * transitions through the state machine, so the approval gate and the
 * transition rules stay the single authority on what state a job is in.
 */

import axios from 'axios';
import { getSettings } from './config-manager';
import { resolveCloudLLM } from '../shared/cloud-llm';
import { generateFromCustomLLM } from './custom-llm-client';
import { MEDIA_RESEARCH_PATH } from './n8n-media-workflows';
import type { MediaJob } from './media-studio';

/** Where the text came from, so a caller can say so rather than guess. */
export interface GeneratedText {
  text: string;
  via: string;
}

function ollamaBase(): string {
  const s: any = getSettings();
  const raw = (s?.ollamaUrl || 'http://127.0.0.1:11434').trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api(\/generate)?$/, '');
}

/**
 * Generate text on whichever model is configured.
 *
 * Cloud when the user has one set up, local Ollama otherwise — the same
 * decision the chat path makes, taken from the same resolver rather than
 * re-derived here, because a second copy of that rule is how "I switched
 * models and nothing happened" bugs start.
 */
export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  opts?: { timeoutMs?: number },
): Promise<GeneratedText> {
  const settings: any = getSettings();
  const resolved = resolveCloudLLM(settings);

  // resolveCloudLLM's contract: misconfiguration must be SURFACED, not logged.
  // A user who set up a cloud model and left the key blank should be told
  // that, not quietly given local output and left wondering why the writing
  // changed.
  if (resolved.intended && !resolved.active && resolved.misconfiguration) {
    throw new Error(resolved.misconfiguration);
  }

  if (resolved.active && resolved.config) {
    const text = await generateFromCustomLLM(resolved.config, systemPrompt, userPrompt, opts);
    return { text: text.trim(), via: resolved.config.model || resolved.config.provider || 'cloud' };
  }

  const model = settings?.ollamaModel || process.env.OLLAMA_MODEL || 'qwen2.5:7b';
  const res = await axios.post(
    `${ollamaBase()}/api/generate`,
    { model, system: systemPrompt, prompt: userPrompt, stream: false },
    { timeout: opts?.timeoutMs ?? 180_000 },
  );
  const text = String(res.data?.response ?? '').trim();
  if (!text) throw new Error(`${model} returned nothing.`);
  return { text, via: model };
}

// ---- Prompts ----

const RESEARCH_SYSTEM = [
  'You research a short video before it is written.',
  '',
  'Rules that matter more than completeness:',
  '- Never invent a quotation, citation, date, or historical claim. If you are',
  '  not certain of a detail, write "UNVERIFIED:" in front of it.',
  '- Prefer what is actually well established over what is interesting.',
  '- If the topic is a scripture passage, give the reference (book, chapter,',
  '  verse) rather than reciting wording you are unsure of.',
  '',
  'Return: 4-8 short factual points, then a line "Angle:" proposing one',
  'specific take that is not the obvious one.',
].join('\n');

const SCRIPT_SYSTEM = [
  'You write narration for a short video. It is read aloud, so write for the',
  'ear: plain sentences, no headings, no bullet points, no stage directions.',
  '',
  'Rules:',
  '- Use only the research given. Do not add facts, quotations or citations of',
  '  your own. If the research marks something UNVERIFIED, leave it out.',
  '- Open with a specific concrete image or question, never "Have you ever',
  '  wondered" or "In this video we will".',
  '- One idea per sentence. Short sentences beat clever ones when spoken.',
  '- End on the thought, not on a call to subscribe.',
  '',
  'Staying on topic (the most common failure):',
  '- Every sentence must serve the working title and brief. If a sentence',
  '  would survive deletion without the viewer noticing anything missing',
  '  about THE TOPIC, delete it — tangents, general background, and',
  '  "interesting related facts" are how scripts drift off subject.',
  '- Do not widen the topic. A video about Jonah staying in the storm is not',
  '  a video about all of Jonah, and a video about tide pools is not a video',
  '  about the ocean.',
  '- Before finishing, check: does every sentence trace back to the title or',
  '  brief? Rewrite any that do not.',
].join('\n');

const TARGET_WORDS: Record<string, string> = {
  short: 'about 110-150 words, which is roughly 45-60 seconds read aloud',
  long: 'about 800-1200 words, which is roughly 6-9 minutes read aloud',
};

/**
 * Ask the n8n research workflow for real sources.
 *
 * Returns null when the workflow is not deployed, n8n is down, or it comes
 * back empty — every one of which is a reason to fall back, not to fail. A
 * video should never be blocked because an optional integration is missing.
 */
async function researchViaN8n(topic: string): Promise<{ text: string; sources: string[] } | null> {
  try {
    const settings: any = getSettings();
    const base = (settings?.n8nUrl || 'http://localhost:5678').replace(/\/$/, '');
    const res = await axios.post(
      `${base}/webhook/${MEDIA_RESEARCH_PATH}`,
      { topic },
      { timeout: 25_000, validateStatus: () => true },
    );
    if (res.status !== 200) return null;

    const data: any = Array.isArray(res.data) ? res.data[0] : res.data;
    const text = String(data?.text || '').trim();
    const sources: string[] = Array.isArray(data?.sources)
      ? data.sources.map((s: any) => `${s.title || ''} — ${s.url || ''}`.trim()).filter(Boolean)
      : [];
    if (!text) return null;
    return { text, sources };
  } catch {
    return null;
  }
}

/**
 * Research brief for a job at the researching stage.
 *
 * Prefers the n8n workflow, because summarising fetched text is a different
 * and far safer job than asking a model to recall facts — the plan's first
 * content guardrail is "never fabricate quotations or citations", and recall
 * is the operation that invents them. Falls back to the model when the
 * workflow is not deployed.
 */
export async function generateResearch(job: MediaJob): Promise<GeneratedText> {
  const topic = [job.title, job.brief].filter(Boolean).join(' — ');

  const fetched = await researchViaN8n(topic);
  if (fetched) {
    const summarised = await generateText(
      RESEARCH_SYSTEM,
      [
        `Working title: ${job.title}`,
        job.brief ? `Brief: ${job.brief}` : '',
        '',
        'Source material gathered from the web:',
        fetched.text,
        '',
        'Summarise ONLY what the source material supports. Mark anything it does',
        'not clearly support with UNVERIFIED.',
      ].filter(Boolean).join('\n'),
    );
    return {
      // Keep the source list with the brief: the plan requires attribution, and
      // a claim is only checkable if its origin travels with it.
      text: [summarised.text, '', 'Sources:', ...fetched.sources].join('\n'),
      via: `${summarised.via} + n8n research`,
    };
  }

  const prompt = [
    `Working title: ${job.title}`,
    job.brief ? `Brief: ${job.brief}` : '',
    '',
    'Research this for a video.',
  ].filter(Boolean).join('\n');
  return generateText(RESEARCH_SYSTEM, prompt);
}

/** Narration script from a research brief. */
export async function generateScript(job: MediaJob, research: string): Promise<GeneratedText> {
  const prompt = [
    `Working title: ${job.title}`,
    job.brief ? `Brief: ${job.brief}` : '',
    '',
    'Research:',
    research,
    '',
    `Write the narration. Length: ${TARGET_WORDS[job.format] ?? TARGET_WORDS.short}.`,
    'Stay strictly on the title and brief — cut anything that wanders off them.',
  ].filter(Boolean).join('\n');
  return generateText(SCRIPT_SYSTEM, prompt);
}

/**
 * Rough spoken duration. Narration averages near 150 words per minute; used to
 * warn when a short is going to overrun before anyone renders it.
 */
export function estimateSpokenSeconds(script: string): number {
  const words = (script.trim().match(/\S+/g) || []).length;
  return Math.round((words / 150) * 60);
}

/** Checks worth running before a script costs anyone TTS time or money. */
export function checkScript(job: MediaJob, script: string): string[] {
  const problems: string[] = [];
  const seconds = estimateSpokenSeconds(script);

  if (!script.trim()) problems.push('The script is empty.');
  if (job.format === 'short' && seconds > 75) {
    problems.push(`About ${seconds}s spoken — too long for a short (aim under 60s).`);
  }
  if (job.format === 'long' && seconds < 180) {
    problems.push(`About ${seconds}s spoken — short for a long-form video (aim over 5 minutes).`);
  }
  // The model was told to drop these; catching it here is cheaper than
  // discovering it in a rendered video.
  if (/UNVERIFIED:/i.test(script)) {
    problems.push('The script contains an UNVERIFIED marker from the research — remove or confirm it.');
  }
  if (/\b(subscribe|like and share|smash that)\b/i.test(script)) {
    problems.push('The script ends on a call to subscribe, which the brief rules out.');
  }

  // Off-topic drift, detected mechanically rather than by hope. The title's
  // significant words are the contract; a script that barely mentions them
  // has wandered, however fluent it reads. Proper nouns and distinct nouns
  // carry the topic — "the", "and" and "video" do not. The bar is deliberately
  // low (ANY key word present): a script about Jonah will say "Jonah" often,
  // and one drift check that occasionally passes a drifter is better than one
  // that fails honest scripts.
  const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'in', 'on', 'to', 'for',
    'with', 'about', 'video', 'short', 'long', 'how', 'why', 'what', 'is', 'was',
    'your', 'you', 'it', 'that', 'this', 'from', 'one', 'minute']);
  const titleWords = (job.title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
  if (titleWords.length > 0) {
    const scriptLower = script.toLowerCase();
    const hits = titleWords.filter(w => scriptLower.includes(w)).length;
    if (hits === 0) {
      problems.push(
        `The script never mentions the title's subject (${titleWords.join(', ')}) — ` +
        'it has drifted off topic. Re-run the script stage or sharpen the brief.',
      );
    }
  }
  return problems;
}
