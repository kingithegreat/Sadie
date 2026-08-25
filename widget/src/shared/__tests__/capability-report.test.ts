/**
 * The report has one job: never tell someone a thing works when it doesn't,
 * and never leave someone stuck with a status and no remedy.
 *
 * The case that motivated it: web search returned nothing because DuckDuckGo
 * answered HTTP 202 with a challenge page. Every status check passed, so the
 * app said "no results found, try different search terms" — to a user whose
 * search terms were never the problem. A report that said "ready" there would
 * have been just as useless.
 */

import {
  buildCapabilityReport,
  summarise,
  LOW_DISK_GB,
  type CapabilityInput,
} from '../capability-report';

/** Everything working, so each test can break exactly one thing. */
const HEALTHY: CapabilityInput = {
  ollamaReachable: true,
  localModelCount: 3,
  localModelSelected: true,
  cloudAllowed: false,
  cloudConfigured: true,
  configuredSearchProviders: ['SearXNG'],
  freeSearchBlocked: null,
  readerFallbackEnabled: true,
  ffmpegAvailable: true,
  n8nReachable: true,
  qdrantReachable: true,
  freeDiskGB: 250,
};

const find = (input: CapabilityInput, id: string) =>
  buildCapabilityReport(input).find(c => c.id === id)!;

describe('the honesty rules', () => {
  test('nothing is ever "ready" without a fix when it is not ready', () => {
    // Every non-ready capability must carry a remedy. A status with no remedy
    // is a shrug, and shrugs are what the app already does.
    const broken = buildCapabilityReport({
      ...HEALTHY,
      ollamaReachable: false,
      cloudConfigured: false,
      configuredSearchProviders: [],
      freeSearchBlocked: true,
      readerFallbackEnabled: false,
      ffmpegAvailable: false,
      n8nReachable: false,
      qdrantReachable: false,
      freeDiskGB: 2,
    });

    for (const cap of broken.filter(c => c.state !== 'ready' && !c.unverified)) {
      expect(cap.fix && cap.fix.length > 0).toBe(true);
    }
  });

  test('a ready capability never carries a fix — there is nothing to fix', () => {
    for (const cap of buildCapabilityReport(HEALTHY).filter(c => c.state === 'ready')) {
      expect(cap.fix).toBeUndefined();
    }
  });

  test('"unverified" only ever appears with "unknown"', () => {
    // The whole point of the flag is that we did not measure it. Pairing it
    // with any confident state would defeat it.
    const inputs: CapabilityInput[] = [
      HEALTHY,
      { ...HEALTHY, configuredSearchProviders: [], freeSearchBlocked: null },
      { ...HEALTHY, freeDiskGB: null },
    ];
    for (const input of inputs) {
      for (const cap of buildCapabilityReport(input)) {
        if (cap.unverified) expect(cap.state).toBe('unknown');
      }
    }
  });

  test('every capability is labelled in user words, not product names', () => {
    // "Search the web", never "Tavily". Product names belong in the detail line
    // where they explain something, not in the label where they gatekeep it.
    const productNames = /ollama|tavily|serper|qdrant|ffmpeg|n8n|jina|searxng/i;
    for (const cap of buildCapabilityReport(HEALTHY)) {
      expect(cap.label).not.toMatch(productNames);
    }
  });
});

describe('answering on this PC', () => {
  test('service down is missing, not needs_setup', () => {
    const cap = find({ ...HEALTHY, ollamaReachable: false }, 'local-chat');
    expect(cap.state).toBe('missing');
    expect(cap.fix).toMatch(/start ollama/i);
  });

  test('running with no models is the user\'s to fix, so needs_setup', () => {
    const cap = find({ ...HEALTHY, localModelCount: 0 }, 'local-chat');
    expect(cap.state).toBe('needs_setup');
    expect(cap.fix).toMatch(/download/i);
  });

  test('models present but none selected is its own distinct state', () => {
    // Reported live as "selected sonnet but still showing qwen" — having models
    // and having a chosen model are different things and fail differently.
    const cap = find({ ...HEALTHY, localModelSelected: false }, 'local-chat');
    expect(cap.state).toBe('needs_setup');
    expect(cap.detail).toContain('3 model');
    expect(cap.fix).toMatch(/pick a chat model/i);
  });
});

describe('answering online', () => {
  test('configured but switched off is READY, not a problem to nag about', () => {
    // The switch being off is the local-first default working as intended.
    // Flagging it would train people to turn on cloud routing to clear a warning.
    const cap = find({ ...HEALTHY, cloudConfigured: true, cloudAllowed: false }, 'cloud-chat');
    expect(cap.state).toBe('ready');
    expect(cap.detail).toMatch(/switched OFF/i);
    expect(cap.fix).toBeUndefined();
  });

  test('not configured explains that everything stays on this PC', () => {
    const cap = find({ ...HEALTHY, cloudConfigured: false }, 'cloud-chat');
    expect(cap.state).toBe('needs_setup');
    expect(cap.detail).toMatch(/answered on this PC/i);
  });
});

describe('searching the web — the case this exists for', () => {
  test('a configured provider names the one actually in use', () => {
    const cap = find({ ...HEALTHY, configuredSearchProviders: ['Tavily', 'Brave'] }, 'web-search');
    expect(cap.state).toBe('ready');
    expect(cap.detail).toContain('Tavily');
  });

  test('no provider is UNKNOWN and unverified — never "ready"', () => {
    // The free path is an unkeyed scrape that is blocked most of the time, and
    // no search was run to find out. "Ready" here is the green tick that means
    // nothing; this is the single most important assertion in the file.
    const cap = find({ ...HEALTHY, configuredSearchProviders: [], freeSearchBlocked: null }, 'web-search');
    expect(cap.state).toBe('unknown');
    expect(cap.unverified).toBe(true);
    expect(cap.fix).toMatch(/searxng|brave|tavily/i);
  });

  test('known-blocked says it is not about the search terms', () => {
    const cap = find({ ...HEALTHY, configuredSearchProviders: [], freeSearchBlocked: true }, 'web-search');
    expect(cap.state).toBe('needs_setup');
    expect(cap.detail).toMatch(/refusing requests/i);
    // The free options come first, because free is the whole point.
    expect(cap.fix).toMatch(/free/i);
  });
});

describe('disk', () => {
  test('below the threshold warns and offers a way to reclaim space', () => {
    const cap = find({ ...HEALTHY, freeDiskGB: LOW_DISK_GB - 1 }, 'disk-space');
    expect(cap.state).toBe('needs_setup');
    expect(cap.fix).toMatch(/delete a model/i);
  });

  test('unreadable disk is unknown, not zero', () => {
    // Treating "could not read" as 0 GB would show a scary warning on systems
    // where statfs is simply unavailable.
    const cap = find({ ...HEALTHY, freeDiskGB: null }, 'disk-space');
    expect(cap.state).toBe('unknown');
    expect(cap.unverified).toBe(true);
  });
});

describe('summarise', () => {
  test('counts only genuinely-ready capabilities', () => {
    const s = summarise(buildCapabilityReport(HEALTHY));
    expect(s.ready).toBe(s.total);
    expect(s.needsAttention).toHaveLength(0);
  });

  test('unknown counts as needing attention, not as working', () => {
    // Burying "we do not know" beside the working ones is how it stops being
    // visible, which is the failure mode this whole screen exists to end.
    const s = summarise(
      buildCapabilityReport({ ...HEALTHY, configuredSearchProviders: [], freeSearchBlocked: null })
    );
    expect(s.ready).toBeLessThan(s.total);
    expect(s.needsAttention.map(c => c.id)).toContain('web-search');
  });
});
