/**
 * What this app can actually do right now, and what to do about the rest.
 *
 * HomeBot fails quietly. Web search returned nothing once DuckDuckGo started
 * answering HTTP 202 with a challenge page — a *success* status — and the app
 * advised the user to try different search terms. Ollama not running, ffmpeg
 * absent, n8n unreachable and no model selected each fail their own separate
 * quiet way, and none of them is visible anywhere.
 *
 * The idea is borrowed openly from `agent-reach doctor`, which does three
 * things this does too:
 *
 *   1. Reports **capabilities**, in the user's words, not services in ours.
 *      "Search the web" rather than "Tavily".
 *   2. Distinguishes **not set up** from **broken**. Only the first is the
 *      user's to fix, and it is fixed by different actions.
 *   3. Prints **the literal fix**. A status with no remedy is a shrug.
 *
 * And one thing it does that matters more than the rest: it refuses to report
 * something as working when it declined to run the check that would prove it.
 * That is what `unverified` is for here — see below.
 *
 * This is a PURE function on purpose. Every probe happens in main and is passed
 * in, so the judgement about what those results mean is testable without a
 * network, a GPU, or an Electron window.
 */

export type CapabilityState =
  /** Checked, and it works. */
  | 'ready'
  /** Present but not configured — the user can fix this, and `fix` says how. */
  | 'needs_setup'
  /** Not installed or not reachable at all. */
  | 'missing'
  /**
   * Could not be determined. NOT a synonym for broken, and never rendered as
   * working. Used when a probe was skipped or was itself inconclusive — the
   * honest answer is "don't know", and claiming otherwise is how a green tick
   * ends up meaning nothing.
   */
  | 'unknown';

export interface Capability {
  id: string;
  /** What it lets the user do, in their words. Never a product name. */
  label: string;
  state: CapabilityState;
  /** Why it is in that state, in one sentence. */
  detail: string;
  /** The literal thing that fixes it. Omitted only when nothing is wrong. */
  fix?: string;
  /**
   * True when the state is a judgement rather than a measurement — the probe
   * was skipped, or could not run. Always paired with `unknown`.
   */
  unverified?: boolean;
}

/** Everything the report needs, all of it measured elsewhere. */
export interface CapabilityInput {
  /** Ollama answered its /api/tags endpoint. */
  ollamaReachable: boolean;
  /** Number of models actually installed locally. */
  localModelCount: number;
  /** A local chat model is selected in settings. */
  localModelSelected: boolean;

  /** Cloud routing is switched ON (`useCustomLLM`). */
  cloudAllowed: boolean;
  /** A cloud provider is configured well enough to answer. */
  cloudConfigured: boolean;

  /**
   * Search providers that are configured, best first, e.g. ['SearXNG','Tavily'].
   * Empty means the app falls back to scraping DuckDuckGo.
   */
  configuredSearchProviders: string[];
  /**
   * The free scraped fallback was seen returning a rate-limit page recently.
   * `null` means it has not been tried, which is NOT the same as fine.
   */
  freeSearchBlocked: boolean | null;

  /** The reading service for pages that will not open locally. */
  readerFallbackEnabled: boolean;

  /** ffmpeg is on PATH or bundled — everything in Media Studio needs it. */
  ffmpegAvailable: boolean;
  /** n8n answered its health endpoint. */
  n8nReachable: boolean;
  /** Qdrant answered — long-term memory search. */
  qdrantReachable: boolean;

  /** Free disk in GB, or null when it could not be read. */
  freeDiskGB: number | null;
}

/** Below this, a model pull will fail or leave the machine unusable. */
export const LOW_DISK_GB = 10;

export function buildCapabilityReport(input: CapabilityInput): Capability[] {
  const caps: Capability[] = [];

  // ── Answering on this PC ────────────────────────────────────────────────
  if (!input.ollamaReachable) {
    caps.push({
      id: 'local-chat',
      label: 'Answer on this PC',
      state: 'missing',
      detail: 'The local AI service is not running, so nothing can be answered offline.',
      fix: 'Start Ollama, or install it from ollama.com if it is not on this PC yet.',
    });
  } else if (input.localModelCount === 0) {
    caps.push({
      id: 'local-chat',
      label: 'Answer on this PC',
      state: 'needs_setup',
      detail: 'The local AI service is running but no models are downloaded.',
      fix: 'Settings → Models → download a recommended model.',
    });
  } else if (!input.localModelSelected) {
    caps.push({
      id: 'local-chat',
      label: 'Answer on this PC',
      state: 'needs_setup',
      detail: `${input.localModelCount} model(s) are downloaded but none is selected for chat.`,
      fix: 'Settings → Models → pick a chat model.',
    });
  } else {
    caps.push({
      id: 'local-chat',
      label: 'Answer on this PC',
      state: 'ready',
      detail: `Running locally with ${input.localModelCount} model(s) available.`,
    });
  }

  // ── Answering online ────────────────────────────────────────────────────
  // Configured-but-off is deliberate, not broken: connecting a provider must
  // never silently start sending chats off the machine. So it reports ready
  // and says which way the switch is, rather than nagging.
  if (!input.cloudConfigured) {
    caps.push({
      id: 'cloud-chat',
      label: 'Answer using an online AI',
      state: 'needs_setup',
      detail: 'No online AI is set up, so everything is answered on this PC.',
      fix: 'Settings → Advanced → add a provider and key, then turn on the switch at the top of Settings.',
    });
  } else if (!input.cloudAllowed) {
    caps.push({
      id: 'cloud-chat',
      label: 'Answer using an online AI',
      state: 'ready',
      detail: 'Set up and deliberately switched OFF — nothing you type leaves this PC.',
    });
  } else {
    caps.push({
      id: 'cloud-chat',
      label: 'Answer using an online AI',
      state: 'ready',
      detail: 'Set up and in use.',
    });
  }

  // ── Searching the web ───────────────────────────────────────────────────
  if (input.configuredSearchProviders.length > 0) {
    caps.push({
      id: 'web-search',
      label: 'Search the web',
      state: 'ready',
      detail: `Using ${input.configuredSearchProviders[0]}.`,
    });
  } else if (input.freeSearchBlocked === true) {
    caps.push({
      id: 'web-search',
      label: 'Search the web',
      state: 'needs_setup',
      detail:
        'The free search engine is refusing requests — it does this after a few searches, ' +
        'and searching will keep returning nothing until it clears.',
      fix:
        'Set up a search source so this stops happening: run your own SearXNG (free and ' +
        'unlimited), or add a free key — Brave gives 2,000 searches a month, Tavily 1,000. ' +
        'Settings → Advanced → Search.',
    });
  } else {
    // Never claim this works. The free path is a scrape with no key and no
    // quota, it is blocked most of the time in practice, and we have not
    // actually run a search to find out. Saying "ready" here would be exactly
    // the green tick that means nothing.
    caps.push({
      id: 'web-search',
      label: 'Search the web',
      state: 'unknown',
      unverified: true,
      detail:
        'No search source is set up, so HomeBot falls back to a free one that often refuses ' +
        'requests. Not checked here, because checking costs a real search.',
      fix:
        'Run your own SearXNG (free, unlimited, no account), or add a free key — Brave 2,000 ' +
        'searches a month, Tavily 1,000. Settings → Advanced → Search.',
    });
  }

  // ── Reading pages that will not open ────────────────────────────────────
  caps.push({
    id: 'web-reader',
    label: 'Read pages that refuse to open',
    state: input.readerFallbackEnabled ? 'ready' : 'needs_setup',
    detail: input.readerFallbackEnabled
      ? 'A reading service is allowed as a last resort when a page will not open.'
      : 'Off, so some pages simply cannot be read. It is off by default because it is the ' +
        'only step that sends a page address off this PC.',
    fix: input.readerFallbackEnabled
      ? undefined
      : 'Settings → "Use a reading service when a page will not open", beside the privacy switch.',
  });

  // ── Making videos ───────────────────────────────────────────────────────
  caps.push({
    id: 'media-studio',
    label: 'Make videos',
    state: input.ffmpegAvailable ? 'ready' : 'missing',
    detail: input.ffmpegAvailable
      ? 'The video engine is installed.'
      : 'The video engine (ffmpeg) is not installed, so no video can be rendered.',
    fix: input.ffmpegAvailable ? undefined : 'Media Studio → "Set it up for me".',
  });

  // ── Automations ─────────────────────────────────────────────────────────
  // Only the n8n-backed half needs n8n; scheduled and manual automations run
  // in-app. So this is never "missing", it is a reduced capability.
  caps.push({
    id: 'automations',
    label: 'Run automations',
    state: input.n8nReachable ? 'ready' : 'needs_setup',
    detail: input.n8nReachable
      ? 'Automations can run on a schedule and through your workflow server.'
      : 'Scheduled and manual automations work. The workflow server is not reachable, so ' +
        'automations that depend on it will not run.',
    fix: input.n8nReachable ? undefined : 'Start n8n, or clear its address in Settings if you do not use it.',
  });

  // ── Long-term memory ────────────────────────────────────────────────────
  caps.push({
    id: 'memory-search',
    label: 'Remember things across conversations',
    state: input.qdrantReachable ? 'ready' : 'needs_setup',
    detail: input.qdrantReachable
      ? 'Long-term memory search is available.'
      : 'The memory database is not reachable, so older conversations cannot be searched.',
    fix: input.qdrantReachable ? undefined : 'Start Qdrant, or leave it — everything else works without it.',
  });

  // ── Disk ────────────────────────────────────────────────────────────────
  if (input.freeDiskGB === null) {
    caps.push({
      id: 'disk-space',
      label: 'Room for models and videos',
      state: 'unknown',
      unverified: true,
      detail: 'Free disk space could not be read on this system.',
    });
  } else if (input.freeDiskGB < LOW_DISK_GB) {
    caps.push({
      id: 'disk-space',
      label: 'Room for models and videos',
      state: 'needs_setup',
      detail: `${input.freeDiskGB.toFixed(1)} GB free. Models are several GB each and renders need working space.`,
      fix: 'Free up space, or Settings → Models → delete a model you are not using.',
    });
  } else {
    caps.push({
      id: 'disk-space',
      label: 'Room for models and videos',
      state: 'ready',
      detail: `${input.freeDiskGB.toFixed(1)} GB free.`,
    });
  }

  return caps;
}

/** One line for the top of the screen: "6 of 8 working". */
export function summarise(caps: Capability[]): { ready: number; total: number; needsAttention: Capability[] } {
  return {
    ready: caps.filter(c => c.state === 'ready').length,
    total: caps.length,
    // 'unknown' belongs here. Not knowing is a thing worth showing someone,
    // and burying it beside the working ones is how it stops being visible.
    needsAttention: caps.filter(c => c.state !== 'ready'),
  };
}
