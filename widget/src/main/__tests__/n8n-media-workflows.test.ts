/**
 * The research workflow's node code, run as code.
 *
 * n8n Code nodes are strings inside a JSON document, so nothing type-checks
 * them and nothing runs them until they are deployed into a live n8n. That
 * makes them the easiest place in this repo to ship something broken with a
 * green suite — the defect shape that keeps recurring here.
 *
 * So these tests pull the jsCode out of the builder and execute it, rather
 * than asserting on the shape of the JSON. The fixtures are trimmed from real
 * Wikipedia API responses, because a fixture invented to match the parser
 * proves only that the parser matches itself.
 *
 * The source is Wikipedia rather than a search-engine scrape for a reason
 * worth keeping: the first version scraped html.duckduckgo.com, passed a
 * host-side test, and returned nothing in production — DuckDuckGo serves
 * datacenter addresses an "anomaly" page instead of results. Verified by
 * running the same fetch inside the n8n container.
 */

import { buildMediaResearchWorkflowJson, MEDIA_RESEARCH_PATH } from '../n8n-media-workflows';

const wf: any = buildMediaResearchWorkflowJson();
const node = (name: string) => wf.nodes.find((n: any) => n.name === name);
const code = (name: string) => node(name).parameters.jsCode as string;

const runQuery = (body: any) => new Function('$json', code('Build query'))({ body });

/** $() lets a node reach an earlier node's output; stub just what each uses. */
const priorNodes = (map: Record<string, any>) => (name: string) => ({
  first: () => ({ json: map[name] ?? {} }),
});

const runPick = (searchResponse: any, topic = 'Book of Jonah') =>
  new Function('$json', '$', code('Pick articles'))(
    searchResponse, priorNodes({ 'Build query': { topic } }),
  )[0].json;

const runExtract = (extractsResponse: any, picked: any) =>
  new Function('$json', '$', code('Extract'))(
    extractsResponse, priorNodes({ 'Pick articles': picked }),
  )[0].json;

// Trimmed from a real response to the search endpoint.
const SEARCH_RESPONSE = {
  query: {
    search: [
      { ns: 0, title: 'Book of Jonah', pageid: 4451 },
      { ns: 0, title: 'Jonah', pageid: 16305 },
    ],
  },
};

// Trimmed from a real response to the extracts endpoint. Note the keys are
// page ids, not an array.
const EXTRACTS_RESPONSE = {
  query: {
    pages: {
      '4451': { pageid: 4451, title: 'Book of Jonah', extract: 'The Book of Jonah is one of the twelve minor prophets.' },
      '16305': { pageid: 16305, title: 'Jonah', extract: 'Jonah is a prophet in the Hebrew Bible.' },
    },
  },
};

describe('building the search query', () => {
  it('encodes a topic rather than pasting it into a URL', () => {
    const out = runQuery({ topic: 'Jonah & the whale' });
    expect(out[0].json.url).toContain('srsearch=Jonah%20%26%20the%20whale');
    expect(out[0].json.url).toContain('en.wikipedia.org/w/api.php');
  });

  it('short-circuits a ping so the deployment check costs no search', () => {
    expect(runQuery({ action: 'ping' })[0].json.ping).toBe(true);
    expect(runQuery({})[0].json.ping).toBe(true);
  });
});

describe('picking articles from the search result', () => {
  it('collects page ids for a single batched extracts call', () => {
    // One request for every article, rather than one request each.
    const picked = runPick(SEARCH_RESPONSE);
    expect(picked.pageids).toBe('4451|16305');
    expect(picked.url).toContain('pageids=4451%7C16305');
    expect(picked.titles).toEqual(['Book of Jonah', 'Jonah']);
  });

  it('survives a search that returned nothing', () => {
    const picked = runPick({ query: { search: [] } });
    expect(picked.pageids).toBe('');
    expect(picked.titles).toEqual([]);
  });

  it('survives the search node erroring, which continueOnFail allows', () => {
    // continueOnFail means this node can be handed an error object.
    const picked = runPick({ error: { message: '403 forbidden' } });
    expect(picked.pageids).toBe('');
  });
});

describe('turning extracts into a brief', () => {
  it('returns citable article URLs, not opaque redirects', () => {
    // The whole reason to collect sources is that a person approving a script
    // can follow one and check the claim.
    const out = runExtract(EXTRACTS_RESPONSE, { topic: 'Book of Jonah' });
    expect(out.sources).toContainEqual({
      title: 'Book of Jonah', url: 'https://en.wikipedia.org/wiki/Book_of_Jonah',
    });
    expect(out.sources.every((s: any) => /^https:\/\/en\.wikipedia\.org\/wiki\//.test(s.url))).toBe(true);
  });

  it('names each source in the text, so a claim can be traced to one', () => {
    const out = runExtract(EXTRACTS_RESPONSE, { topic: 'Book of Jonah' });
    expect(out.text).toContain('Book of Jonah: The Book of Jonah is one of the twelve minor prophets.');
    expect(out.text).toContain('Jonah: Jonah is a prophet in the Hebrew Bible.');
  });

  it('encodes a title with spaces into a working URL', () => {
    const out = runExtract(
      { query: { pages: { '1': { title: 'Hebrew Bible', extract: 'x' } } } },
      { topic: 't' },
    );
    expect(out.sources[0].url).toBe('https://en.wikipedia.org/wiki/Hebrew_Bible');
  });

  it('keeps a source whose extract is empty, and omits it from the text', () => {
    // The citation is still real even when the intro is blank.
    const out = runExtract(
      { query: { pages: { '1': { title: 'Stub Article', extract: '' } } } },
      { topic: 't' },
    );
    expect(out.sources).toHaveLength(1);
    expect(out.text).toBe('');
  });

  it('returns empty rather than throwing when the fetch failed', () => {
    const out = runExtract({ error: 'boom' }, { topic: 'Book of Jonah' });
    expect(out).toMatchObject({ sources: [], text: '' });
    expect(out.topic).toBe('Book of Jonah');
  });
});

describe('the deployed shape', () => {
  it('responds through the Respond node, so the caller gets the JSON', () => {
    const hook = node('Webhook');
    expect(hook.parameters.responseMode).toBe('responseNode');
    expect(hook.parameters.path).toBe(MEDIA_RESEARCH_PATH);
    expect(wf.connections.Extract.main[0][0].node).toBe('Respond');
  });

  it('keeps going when a fetch fails, rather than failing the video', () => {
    for (const name of ['Search', 'Fetch extracts']) {
      expect(node(name).continueOnFail).toBe(true);
    }
  });

  it('identifies itself to Wikipedia on every request', () => {
    // Wikipedia answers an anonymous client with 403 and a pointer to its
    // robot policy — read out of a failed execution, not guessed. Both HTTP
    // nodes need it, and the one that was missed is the one that breaks.
    for (const name of ['Search', 'Fetch extracts']) {
      const headers = node(name).parameters.headerParameters?.parameters ?? [];
      const ua = headers.find((h: any) => h.name.toLowerCase() === 'user-agent');
      expect(ua).toBeTruthy();
      expect(ua.value).toMatch(/HomeBot/);
      expect(node(name).parameters.sendHeaders).toBe(true);
    }
  });
});
