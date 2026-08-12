/**
 * n8n-media-workflows.ts — the Media Studio's research stage, run in n8n.
 *
 * The plan specifies five n8n workflows for this pipeline. This is Workflow B's
 * research half, chosen first because it is the one where n8n genuinely beats
 * doing the work in-process — not because it demonstrates the integration.
 *
 * The reason is the plan's own first content guardrail: "never fabricate
 * biblical quotations, citations or historical claims." The research stage
 * currently asks the model to recall facts, which is precisely the operation
 * that invents them. Fetching real pages and handing the model actual text
 * changes the job from recall to summarising a source — and the sources are
 * kept for attribution, which the plan also requires.
 *
 * n8n is the right home for it: it already owns outbound HTTP with an SSRF
 * guard (see buildWebFetchWorkflowJson), it retries, and the user can open the
 * workflow and see exactly where a claim came from.
 *
 * Deployment is optional by design. If the workflow is absent the research
 * stage falls back to the model, and n8n-webhook-check reports it as
 * "not deployed" rather than as a failure.
 */

import { randomUUID } from 'crypto';

export const MEDIA_RESEARCH_PATH = 'homebot/media-research';

/**
 * Webhook → DuckDuckGo HTML search → strip to text → respond.
 *
 * Deliberately a plain HTML endpoint with no API key: the plan asks for a
 * free/local option wherever practical, and a research stage that needs a paid
 * search key would simply go unused.
 */
export function buildMediaResearchWorkflowJson(): object {
  const versionId = randomUUID();
  return {
    name: 'HomeBot: Media Research',
    active: true,
    versionId,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path: MEDIA_RESEARCH_PATH,
          responseMode: 'responseNode',
          options: {},
        },
        id: randomUUID(),
        name: 'Webhook',
        type: 'n8n-nodes-base.webhook',
        typeVersion: 1.1,
        position: [250, 300],
        webhookId: 'homebot-media-research',
      },
      {
        parameters: {
          // The topic is user-supplied text, so it is encoded before it ever
          // reaches a URL. A ping (no topic) short-circuits so the deployment
          // check can probe this endpoint without running a search.
          jsCode: `const topic = String($json.body?.topic || '').trim();
if (!topic || $json.body?.action === 'ping') {
  return [{ json: { ping: true, topic: '' } }];
}
return [{ json: { topic, url: 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(topic) } }];`,
        },
        id: randomUUID(),
        name: 'Build query',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [450, 300],
      },
      {
        parameters: {
          url: '={{ $json.url }}',
          options: { timeout: 15000, redirect: { redirect: {} } },
        },
        id: randomUUID(),
        name: 'Fetch results',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [650, 300],
        // A search that fails must not fail the video: the stage falls back to
        // the model, so this continues and returns whatever it has.
        continueOnFail: true,
      },
      {
        parameters: {
          jsCode: `const html = typeof $json.data === 'string' ? $json.data : (typeof $json.body === 'string' ? $json.body : '');
if (!html) return [{ json: { topic: $('Build query').first().json.topic || '', sources: [], text: '' } }];

// Result titles and their snippets, in DuckDuckGo's HTML layout.
const strip = (s) => s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\s+/g, ' ').trim();

// DuckDuckGo hands back its own redirect wrapper, not the destination:
//   //duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FJonah
// Citing that would defeat the point of collecting sources at all — the
// person approving a script needs to see it came from Wikipedia, and needs a
// link they can actually open. So unwrap it back to the real destination.
const unwrap = (u) => {
  let s = String(u).replace(/&amp;/g, '&');
  const m = /[?&]uddg=([^&]+)/.exec(s);
  if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { /* keep as-is */ } }
  if (s.slice(0, 2) === '//') s = 'https:' + s;
  return s;
};

const sources = [];
const seen = {};
const linkRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/g;
let m;
while ((m = linkRe.exec(html)) && sources.length < 8) {
  const url = unwrap(m[1]);
  // Two results from one site add no corroboration.
  if (seen[url]) continue;
  seen[url] = true;
  sources.push({ url, title: strip(m[2]) });
}
const snippets = [];
const snipRe = /<a[^>]+class="result__snippet"[^>]*>([\\s\\S]*?)<\\/a>/g;
while ((m = snipRe.exec(html)) && snippets.length < 8) {
  const t = strip(m[1]);
  if (t) snippets.push(t);
}
const text = snippets.join('\\n');
return [{ json: { topic: $('Build query').first().json.topic || '', sources, text } }];`,
        },
        id: randomUUID(),
        name: 'Extract',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [850, 300],
      },
      {
        parameters: { options: {} },
        id: randomUUID(),
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [1050, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Build query', type: 'main', index: 0 }]] },
      'Build query': { main: [[{ node: 'Fetch results', type: 'main', index: 0 }]] },
      'Fetch results': { main: [[{ node: 'Extract', type: 'main', index: 0 }]] },
      Extract: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}
