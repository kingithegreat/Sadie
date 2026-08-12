/**
 * The research workflow's node code, run as code.
 *
 * n8n Code nodes are strings inside a JSON document, so nothing type-checks
 * them and nothing runs them until they are deployed into a live n8n. That
 * makes them the easiest place in this repo to ship something broken with a
 * green suite — the defect shape that keeps recurring here.
 *
 * So these tests pull the jsCode out of the builder and execute it, rather
 * than asserting on the shape of the JSON. The HTML fixture is trimmed from a
 * real response captured from html.duckduckgo.com, including its redirect
 * wrappers, because a fixture invented to match the parser proves only that
 * the parser matches itself.
 */

import { buildMediaResearchWorkflowJson, MEDIA_RESEARCH_PATH } from '../n8n-media-workflows';

const wf: any = buildMediaResearchWorkflowJson();
const code = (name: string) =>
  wf.nodes.find((n: any) => n.name === name).parameters.jsCode as string;

const runQuery = (body: any) => new Function('$json', code('Build query'))({ body });
const runExtract = (json: any, topic = 'Jonah') =>
  new Function('$json', '$', code('Extract'))(json, () => ({ first: () => ({ json: { topic } }) }))[0].json;

// Trimmed from a live response. The href really is a protocol-relative
// redirect through duckduckgo.com/l/ with the destination in `uddg`.
const LIVE_HTML = `
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FBook_of_Jonah&amp;rut=abc123">Book of Jonah - <b>Wikipedia</b></a>
  </h2>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FBook_of_Jonah">The <b>Book of Jonah</b> is one of the twelve minor prophets.</a>
</div>
<div class="result results_links">
  <h2 class="result__title">
    <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chabad.org%2Flibrary%2Fbible">Yonah &#x27;s account &quot;in full&quot;</a>
  </h2>
  <a class="result__snippet" href="#">And Jonah rose up to flee unto Tarshish.</a>
</div>`;

describe('building the search query', () => {
  it('encodes a topic rather than pasting it into a URL', () => {
    const out = runQuery({ topic: 'Jonah & the whale' });
    expect(out[0].json.url).toBe('https://html.duckduckgo.com/html/?q=Jonah%20%26%20the%20whale');
  });

  it('short-circuits a ping so the deployment check costs no search', () => {
    expect(runQuery({ action: 'ping' })[0].json.ping).toBe(true);
    expect(runQuery({})[0].json.ping).toBe(true);
  });
});

describe('extracting sources from a real response', () => {
  it('returns the destination URL, not the DuckDuckGo redirect', () => {
    // The whole reason to collect sources is that a person approving a script
    // can check a claim against where it came from. A redirect wrapper is not
    // checkable, and does not even open — it has no scheme.
    const r = runExtract({ data: LIVE_HTML });
    expect(r.sources[0].url).toBe('https://en.wikipedia.org/wiki/Book_of_Jonah');
    expect(r.sources.every((s: any) => /^https?:\/\//.test(s.url))).toBe(true);
    expect(r.sources.some((s: any) => s.url.includes('duckduckgo.com/l/'))).toBe(false);
  });

  it('strips markup and decodes entities out of titles', () => {
    const r = runExtract({ data: LIVE_HTML });
    expect(r.sources[0].title).toBe('Book of Jonah - Wikipedia');
    expect(r.sources[1].title).toBe('Yonah \'s account "in full"');
  });

  it('collects snippet text for the model to summarise', () => {
    const r = runExtract({ data: LIVE_HTML });
    expect(r.text).toContain('twelve minor prophets');
    expect(r.text).toContain('flee unto Tarshish');
    expect(r.text).not.toMatch(/<b>/);
  });

  it('does not count one site twice as corroboration', () => {
    const doubled = LIVE_HTML + LIVE_HTML;
    const r = runExtract({ data: doubled });
    const urls = r.sources.map((s: any) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('returns empty rather than throwing when the fetch failed', () => {
    // continueOnFail means this node can be handed nothing at all. Throwing
    // here would fail the video over a failed search.
    const r = runExtract({});
    expect(r).toMatchObject({ sources: [], text: '' });
    expect(r.topic).toBe('Jonah');
  });

  it('survives markup it does not recognise', () => {
    const r = runExtract({ data: '<html><body>nothing familiar</body></html>' });
    expect(r.sources).toEqual([]);
    expect(r.text).toBe('');
  });
});

describe('the deployed shape', () => {
  it('responds through the Respond node, so the caller gets the JSON', () => {
    const hook = wf.nodes.find((n: any) => n.name === 'Webhook');
    expect(hook.parameters.responseMode).toBe('responseNode');
    expect(hook.parameters.path).toBe(MEDIA_RESEARCH_PATH);
    expect(wf.connections.Extract.main[0][0].node).toBe('Respond');
  });

  it('keeps going when the search itself fails', () => {
    const fetchNode = wf.nodes.find((n: any) => n.name === 'Fetch results');
    expect(fetchNode.continueOnFail).toBe(true);
  });
});
