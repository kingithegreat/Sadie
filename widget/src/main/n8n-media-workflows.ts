/**
 * n8n-media-workflows.ts — the Media Studio's research stage, run in n8n.
 *
 * The plan specifies five n8n workflows for this pipeline. This is Workflow B's
 * research half, chosen first because it is the one where n8n genuinely beats
 * doing the work in-process — not because it demonstrates the integration.
 *
 * The reason is the plan's own first content guardrail: "never fabricate
 * biblical quotations, citations or historical claims." The research stage
 * otherwise asks the model to recall facts, which is precisely the operation
 * that invents them. Fetching real pages and handing the model actual text
 * changes the job from recall to summarising a source — and the sources are
 * kept for attribution, which the plan also requires.
 *
 * SOURCE: Wikipedia's API, not a search-engine scrape.
 *
 * The first version scraped html.duckduckgo.com. It worked when tested from
 * the host and returned nothing at all in production, because DuckDuckGo
 * serves datacenter addresses an "anomaly" bot-check page instead of results —
 * verified by running the same fetch inside the n8n container and counting
 * zero result links. A source that only works from a developer's laptop is not
 * a source.
 *
 * Wikipedia's API answers the container happily, needs no key, returns real
 * article titles and stable canonical URLs, and for a scripture or history
 * channel it is the more defensible citation anyway.
 *
 * Deployment is optional by design. If the workflow is absent the research
 * stage falls back to the model, and n8n-webhook-check reports it as
 * "not deployed" rather than as a failure.
 */

import { randomUUID } from 'crypto';

export const MEDIA_RESEARCH_PATH = 'homebot/media-research';

/**
 * Wikipedia asks every API client to identify itself, and enforces it: an
 * anonymous request is answered with 403 and a pointer to the robot policy.
 */
const WIKI_USER_AGENT = 'HomeBot/1.0 (https://github.com/kingithegreat/Sadie) n8n-media-research';

/** How many articles to gather. Enough for corroboration, few enough to stay short. */
const ARTICLE_COUNT = 4;

/**
 * Webhook → Wikipedia search → fetch intros → respond with text + sources.
 *
 * Two HTTP calls rather than one per article: the extracts endpoint takes
 * several page ids at once, so a four-source brief costs two requests.
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
const q = encodeURIComponent(topic);
return [{ json: {
  topic,
  url: 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=${ARTICLE_COUNT}&srsearch=' + q,
} }];`,
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
          // Wikipedia's API returns 403 without a descriptive User-Agent —
          // "Please set a user-agent and respect our robot policy". n8n's HTTP
          // node does not send one, so the first version of this got a 403 and
          // an empty brief. Read out of the failed execution, not guessed.
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'User-Agent', value: WIKI_USER_AGENT }] },
          options: { timeout: 15000 },
        },
        id: randomUUID(),
        name: 'Search',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [650, 300],
        // A search that fails must not fail the video: the stage falls back to
        // the model, so this continues and returns whatever it has.
        continueOnFail: true,
      },
      {
        parameters: {
          jsCode: `const topic = $('Build query').first().json.topic || '';
if (!topic) return [{ json: { ping: true } }];

const hits = $json?.query?.search || [];
if (!hits.length) return [{ json: { topic, pageids: '', titles: [] } }];

// Titles are kept alongside the ids so a citation can name the article even
// if the extract for it comes back empty.
return [{ json: {
  topic,
  pageids: hits.map(h => h.pageid).join('|'),
  titles: hits.map(h => h.title),
  url: 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=1&explaintext=1&format=json&pageids='
    + hits.map(h => h.pageid).join('%7C'),
} }];`,
        },
        id: randomUUID(),
        name: 'Pick articles',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [850, 300],
      },
      {
        parameters: {
          url: '={{ $json.url }}',
          // Wikipedia's API returns 403 without a descriptive User-Agent —
          // "Please set a user-agent and respect our robot policy". n8n's HTTP
          // node does not send one, so the first version of this got a 403 and
          // an empty brief. Read out of the failed execution, not guessed.
          sendHeaders: true,
          headerParameters: { parameters: [{ name: 'User-Agent', value: WIKI_USER_AGENT }] },
          options: { timeout: 15000 },
        },
        id: randomUUID(),
        name: 'Fetch extracts',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        position: [1050, 300],
        continueOnFail: true,
      },
      {
        parameters: {
          jsCode: `const picked = $('Pick articles').first().json;
const topic = picked.topic || '';
if (!topic) return [{ json: { ping: true, topic: '', sources: [], text: '' } }];

const pages = $json?.query?.pages || {};
const sources = [];
const parts = [];

for (const key of Object.keys(pages)) {
  const p = pages[key];
  if (!p || !p.title) continue;
  // Canonical article URL: stable, and a person can open it and check the claim.
  const url = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(String(p.title).replace(/ /g, '_'));
  sources.push({ title: p.title, url });
  const extract = String(p.extract || '').replace(/\\s+/g, ' ').trim();
  if (extract) parts.push(p.title + ': ' + extract);
}

return [{ json: { topic, sources, text: parts.join('\\n\\n') } }];`,
        },
        id: randomUUID(),
        name: 'Extract',
        type: 'n8n-nodes-base.code',
        typeVersion: 2,
        position: [1250, 300],
      },
      {
        parameters: { options: {} },
        id: randomUUID(),
        name: 'Respond',
        type: 'n8n-nodes-base.respondToWebhook',
        typeVersion: 1,
        position: [1450, 300],
      },
    ],
    connections: {
      Webhook: { main: [[{ node: 'Build query', type: 'main', index: 0 }]] },
      'Build query': { main: [[{ node: 'Search', type: 'main', index: 0 }]] },
      Search: { main: [[{ node: 'Pick articles', type: 'main', index: 0 }]] },
      'Pick articles': { main: [[{ node: 'Fetch extracts', type: 'main', index: 0 }]] },
      'Fetch extracts': { main: [[{ node: 'Extract', type: 'main', index: 0 }]] },
      Extract: { main: [[{ node: 'Respond', type: 'main', index: 0 }]] },
    },
    settings: { executionOrder: 'v1' },
  };
}
