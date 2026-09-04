/**
 * Turning fetched search results and tool output into the prompt a model is
 * asked to answer from, and into the text the user reads.
 *
 * Split out of message-router.ts. Pure string work: no streaming, no IPC, no
 * network. `synthesisStream` stayed behind, because it drives the router's own
 * streaming machinery and is not a formatting concern.
 *
 * Moved verbatim. Note that three of these builders open with the same four
 * lines — read settings, resolve cloud, pick the model name, ask whether it is
 * small. That repetition came along with the move rather than being introduced
 * by it; collapsing it is worth doing separately, where the change is visible
 * on its own.
 */

import { getSettings } from '../config-manager';
import { resolveCloudLLM } from '../../shared/cloud-llm';
import { isSmallModel, OLLAMA_CHAT_MODEL } from './model-size';

export function takeSentences(text: string, maxChars = 400, maxSentences = 3): string {
  const cleaned = (text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  let out = '';
  let count = 0;
  for (const part of cleaned.split(/(?<=[.!?])\s+/)) {
    if (!part) continue;
    const candidate = out ? `${out} ${part}` : part;
    if (candidate.length > maxChars || count >= maxSentences) break;
    out = candidate;
    count++;
  }
  return out || cleaned.slice(0, maxChars);
}

export function formatWebSearchResult(payload: any): string {
  const res = payload?.result ?? payload;
  if (!res) return '';
  // Delegate to buildSearchContext for unified formatting — both paths now share
  // the same source-extraction, budget, and numbered-source layout.
  // buildSearchContext is a function declaration so hoisting makes it safe to call here.
  const context = buildSearchContext(res, 4000);
  const parts: string[] = [];
  if (context) parts.push(context);
  if (res.note) parts.push(res.note);
  return parts.filter(Boolean).join('\n');
}

/**
 * Build a rich search context string from a web_search result payload.
 * Prefers the multi-source `sources[]` array (parallel-fetched page content),
 * falls back to legacy topResultContent + results[].snippet.
 * Returns the context string and an inline source attribution block.
 */
export function buildSearchContext(sr: any, charBudget = 3000): string {
  const parts: string[] = [];

  // Prefer Tavily AI answer — already synthesised
  if (sr.aiAnswer) parts.push(`Summary: ${sr.aiAnswer}`);

  // Best path: use sources[] with full fetched page content
  if (Array.isArray(sr.sources) && sr.sources.length > 0) {
    const perSrc = Math.floor(charBudget / sr.sources.length);
    sr.sources.forEach((src: any, i: number) => {
      const raw = (src.content || '').replace(/\s+/g, ' ').trim();
      const condensed = takeSentences(raw, perSrc, 6);
      if (!condensed && !src.title) return;
      const header = src.title ? `[${i + 1}] ${src.title}` : `[${i + 1}]`;
      const url = src.url ? ` — ${src.url}` : '';
      parts.push(`${header}${url}\n${condensed || '(no content)'}`);
    });
    return parts.filter(Boolean).join('\n\n');
  }

  // Legacy path: topResultContent + snippets
  if (sr.topResultContent?.content || sr.topResultContent?.contentText) {
    const raw = (sr.topResultContent.content || sr.topResultContent.contentText || '')
      .replace(/\s+/g, ' ').trim();
    const cleaned = raw.split(/\n/).filter((l: string) =>
      !/(\[&>|]:h-|]:w-|]:mb-|]:rounded|]:overflow|]:max-h-)/.test(l)
    ).join(' ').trim();
    const condensed = takeSentences(cleaned, charBudget, 8);
    if (condensed) parts.push(condensed);
    if (sr.topResultContent.url) parts.push(`Source: ${sr.topResultContent.url}`);
  }

  if (Array.isArray(sr.results) && sr.results.length > 0) {
    const snippets = sr.results.slice(0, 5).map((r: any, i: number) =>
      `${i + 1}. ${r.title || ''}: ${r.snippet || ''}${r.url ? ` (${r.url})` : ''}`
    ).join('\n');
    if (snippets) parts.push(snippets);
  }

  return parts.filter(Boolean).join('\n\n');
}

/**
 * Build a compact source-cards token from web search results.
 * The renderer detects __HOMEBOT_SOURCES__: and renders clickable cards.
 */
export function buildSourceCardsToken(sr: any): string {
  if (!sr || !Array.isArray(sr.results) || sr.results.length === 0) return '';
  const cards = sr.results.slice(0, 6).map((r: any) => ({
    t: (r.title || '').slice(0, 120),
    u: r.url || '',
    s: (r.snippet || '').slice(0, 200),
  })).filter((c: any) => c.u);
  if (cards.length === 0) return '';
  return `\n\n__HOMEBOT_SOURCES__:${JSON.stringify(cards)}`;
}

/**
 * Wrap search context in a synthesis prompt that forces the model to answer
 * directly from evidence — suppressing the "check YouTube/CFR" padding pattern
 * and prohibiting the "I'm unable to fetch" false disclaimer.
 *
 * Exported so it can be unit-tested without spinning up Electron.
 */
export function makeSynthesisPrompt(searchContext: string, question: string): string {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return `[SEARCH RESULTS — retrieved ${today}]\n${searchContext}\n[/SEARCH RESULTS]\n\n` +
    `IMPORTANT: You have already been given the search results above. ` +
    `DO NOT say you are unable to fetch, access, or retrieve information — you have the results. ` +
    `DO NOT start your response with any disclaimer such as "I'm unable to fetch", ` +
    `"I cannot access", "I don't have real-time access", or anything similar. ` +
    `Answer directly and immediately.\n\n` +
    `Today's date is ${today}.\n\n` +
    `Using ONLY the search results above, answer the following question concisely. ` +
    `Report the key facts and cite sources inline (e.g. "According to [title], ..."). ` +
    `If the results contain limited information, state what was found — do NOT suggest the user ` +
    `check YouTube, news websites, Wikipedia, or any other source.\n\n` +
    `CRITICAL: Do NOT fabricate, guess, or invent ANY facts, dates, statistics, odds, scores, ` +
    `or names not explicitly present in the search results above. If you cannot find a specific ` +
    `answer in the results, say "Based on the search results, I couldn't find specific information ` +
    `about [topic]" and summarize what IS in the results instead. ` +
    `NEVER make up betting odds, scores, dates, or rankings. ` +
    `For sports data: if games show as "Scheduled" or "Pre-game", say they haven't been played yet — ` +
    `do NOT guess final scores, stat lines, or outcomes. Only report what is explicitly in the results.\n\n` +
    `Question: ${question}`;
}

/**
 * Compact synthesis prompt for small models (~4096 token context).
 * Trims the search context harder and uses a single short instruction block
 * instead of 4 paragraphs the 3B model can't keep in attention.
 */
export function makeSynthesisPromptCompact(searchContext: string, question: string): string {
  const trimmed = searchContext.slice(0, 1500);
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `[SEARCH RESULTS — ${today}]\n${trimmed}\n[/SEARCH RESULTS]\n\n` +
    `Today is ${today}. Answer the question ONLY from the results above.\n` +
    `RULES: Do NOT say you cannot access data. Do NOT invent or guess ANY facts, ` +
    `odds, scores, dates, or statistics not in the results. If the answer is not in ` +
    `the results, say so honestly. For scheduled games, say they haven't been played.\n\n` +
    `Question: ${question}`;
}

/**
 * Build a synthesis prompt sized for the current model.
 * Small models get a trimmed context + compact instructions.
 * Large models get the full verbose version.
 */
export function buildSynthesisPrompt(searchContext: string, question: string): string {
  const settings = getSettings();
  const cloud = resolveCloudLLM(settings);
  // When using cloud LLM the model is the cloud one — check that.
  // When using local Ollama, check the chat model.
  const modelName = cloud.active
    ? (cloud.config?.model || '')
    : (settings.chatModel || OLLAMA_CHAT_MODEL);
  return isSmallModel(modelName)
    ? makeSynthesisPromptCompact(searchContext, question)
    : makeSynthesisPrompt(searchContext, question);
}

/**
 * Build a synthesis prompt for structured tool results (weather, NBA, etc.).
 * Feeds the formatted data + user question to the LLM for a natural summary.
 */
export function buildToolSynthesisPrompt(toolData: string, userQuestion: string, toolType: string): string {
  const settings = getSettings();
  const cloud = resolveCloudLLM(settings);
  const modelName = cloud.active
    ? (cloud.config?.model || '')
    : (settings.chatModel || OLLAMA_CHAT_MODEL);
  const small = isSmallModel(modelName);

  const hints: Record<string, string> = {
    weather: small
      ? 'Summarize in 2 sentences. Include practical advice (jacket, umbrella).'
      : 'Summarize naturally in 2-3 sentences. Be conversational — mention how it feels and give practical advice (e.g. bring a jacket, good day for a walk). Don\'t repeat every data point.',
    standings: small
      ? 'Summarize top 3-4 teams per conference and playoff picture in 3-4 sentences.'
      : 'Summarize the key takeaways in 3-5 sentences. Highlight the conference leaders, any surprising teams, and the playoff race. Don\'t repeat the full table — the user can see it.',
    games: small
      ? 'Summarize the notable games and scores in 2-3 sentences.'
      : 'Highlight the most notable matchups, key results, and any standout performances in 3-4 sentences. Don\'t list every game — pick the interesting ones.',
  };

  const instruction = hints[toolType] || 'Summarize the key information in 2-4 sentences. Be conversational.';
  const data = small ? toolData.slice(0, 2000) : toolData.slice(0, 4000);

  return `[TOOL DATA]\n${data}\n[/TOOL DATA]\n\nThe user asked: "${userQuestion}"\n\n${instruction}`;
}

/**
 * Build search context with a budget appropriate for the active model.
 * Small models get 1500 chars; large models get the default 3000.
 */
export function buildSearchContextForModel(sr: any): string {
  const settings = getSettings();
  const cloud = resolveCloudLLM(settings);
  const modelName = cloud.active
    ? (cloud.config?.model || '')
    : (settings.chatModel || OLLAMA_CHAT_MODEL);
  const budget = isSmallModel(modelName) ? 1500 : 3000;
  return buildSearchContext(sr, budget);
}

/**
 * Route a synthesis call to the best available model.
 * Uses the cloud LLM when one is configured; falls back to local Ollama otherwise.
 */
