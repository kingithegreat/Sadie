/**
 * types.ts — the vocabulary for free-first, provider-independent movie production.
 *
 * Three decisions are baked into these types, each from something measured:
 *
 * 1. COST IS AN INTEGER. `costMicroUsd`, not a float. FREE ONLY has to be a
 *    hard gate, and `0.0000001 > 0` is true while `0.1 + 0.2 === 0.3` is false.
 *    A budget guard built on floats is a budget guard that eventually leaks.
 *
 * 2. RESULTS CAN BE DEFERRED. Colab cannot be triggered by API on free or Pro —
 *    it needs a browser session and `drive.mount()` fires an OAuth consent. So
 *    the only GPU here big enough for SDXL (T4, 16 GB) can never answer
 *    synchronously. `GenerationResult` therefore has a `deferred` arm, and a
 *    shot has an `AWAITING_WORKER` state. Modelling that away would mean either
 *    excluding Colab or pretending a trigger exists.
 *
 * 3. FREE IS NOT ONE THING. Pollinations is free and rate-limited; Imagen 3's
 *    free tier is 15 RPM; a local card is free and slow. `costMicroUsd === 0`
 *    is necessary but not sufficient to choose well, so capability also carries
 *    throughput, availability and watermark policy.
 */

/** Integer micro-dollars. 1_000_000 === $1. Zero means genuinely free. */
export type CostMicroUsd = number;

export type MediaKind = 'image' | 'video';

/** What a provider can do about a request *right now*, not in principle. */
export type Availability =
  | 'ready'         // will start immediately
  | 'rate_limited'  // will work, but not yet
  | 'queued'        // accepted, runs behind other work
  | 'needs_human'   // accepted, but a person must run something (Colab)
  | 'offline';      // unreachable or not installed

/** How well a provider can hold a character's face across shots. */
export type ReferenceSupport = 'none' | 'single' | 'multi';

export type WatermarkPolicy = 'none' | 'provider' | 'unknown';

/**
 * A provider's honest answer about one specific request.
 *
 * Every field is per-request, not static: the same adapter returns
 * `ready` at 10:00 and `rate_limited` at 10:01.
 */
export interface GenerationCapability {
  canGenerate: boolean;
  /** Why not. Required when canGenerate is false — a silent no is unusable. */
  reason?: string;
  costMicroUsd: CostMicroUsd;
  /** 0 for stills. */
  maxDurationSec: number;
  maxWidth: number;
  maxHeight: number;
  imageToVideo: boolean;
  referenceImages: ReferenceSupport;
  watermark: WatermarkPolicy;
  availability: Availability;
  /** True when generate() returns a ticket rather than files. */
  deferred: boolean;
  /** Rough completions per minute. Used to break ties between free options. */
  throughputPerMin?: number;
  /** For deferred/queued work, how long until a result is plausible. */
  etaSec?: number;
}

export interface GenerationRequest {
  kind: MediaKind;
  prompt: string;
  width: number;
  height: number;
  /** Required for kind === 'video'. */
  durationSec?: number;
  /** Absolute paths to character reference images, newest first. */
  characterRefs?: string[];
  /** Still to animate from, for image→video. */
  initImage?: string;
  shotId: string;
  /** Absolute path to the shot folder; adapters write their output inside it. */
  shotDir: string;
  /** Hard gate. When true the router refuses any provider with cost > 0. */
  freeOnly: boolean;
  /** When false, a watermarking provider is rejected outright. */
  allowWatermark: boolean;
  /** When false, Colab-style deferred providers are not eligible. */
  allowDeferred: boolean;
}

export type GenerationResult =
  | { status: 'done'; provider: string; files: string[]; costMicroUsd: CostMicroUsd }
  /** Accepted but not finished. `ticket` resumes it; `where` tells a human what to do. */
  | { status: 'deferred'; provider: string; ticket: string; where: string; etaSec?: number }
  | { status: 'failed'; provider: string; error: string };

export interface GenerationProvider {
  readonly id: string;
  readonly kind: MediaKind | 'both';
  /** Cheap, side-effect free, and called on every routing decision. */
  probe(req: GenerationRequest): Promise<GenerationCapability>;
  generate(req: GenerationRequest): Promise<GenerationResult>;
}

// --- character bible ---------------------------------------------------------

export interface CharacterBibleEntry {
  id: string;
  name: string;
  age: string;
  face: string;
  hair: string;
  clothing: string;
  body: string;
  voice: string;
  personality: string;
  /** Paths relative to the project root. Newest first — the router sends the
   *  first N a provider supports, so ordering is the consistency lever. */
  visualReferences: string[];
  /** Free text the generator must honour, e.g. "glasses are violet, never blue". */
  consistencyNotes: string[];
  /** Bumped on every edit so a shot can record which version it was made from. */
  revision: number;
  updatedAt: string;
}

// --- shot bible --------------------------------------------------------------

/**
 * PLANNED → PROMPTED → IMAGE_GENERATED → VIDEO_GENERATED → QA → APPROVED
 *
 * AWAITING_WORKER exists because of Colab: the shot is neither working nor
 * failed, it is parked until a human runs a cell. Without it, a resumed queue
 * cannot tell "never started" from "waiting on the T4".
 */
export enum ShotStatus {
  PLANNED = 'PLANNED',
  PROMPTED = 'PROMPTED',
  AWAITING_WORKER = 'AWAITING_WORKER',
  IMAGE_GENERATED = 'IMAGE_GENERATED',
  VIDEO_GENERATED = 'VIDEO_GENERATED',
  QA = 'QA',
  APPROVED = 'APPROVED',
  FAILED = 'FAILED',
}

export type GenerationMethod =
  | 'image_to_animation'   // the default: still, then light motion
  | 'generative_video'     // hero shots only
  | 'still';               // no motion at all

export interface ShotCamera {
  framing: string;   // 'wide' | 'medium' | 'close' | free text
  lens: string;      // '24mm' etc.
  movement: string;  // 'static' | 'slow push in' | 'pan right'
}

export interface ShotBibleEntry {
  shotId: string;
  scene: string;
  characters: string[];      // CharacterBibleEntry ids
  action: string;
  camera: ShotCamera;
  lighting: string;
  durationSec: number;
  visualReferences: string[];
  generationMethod: GenerationMethod;
  /** A hint, not a command. The router may overrule it under FREE ONLY. */
  preferredProvider?: string;
  status: ShotStatus;
}

/** Written to status.json. The whole point is that this survives a crash. */
export interface ShotJobState {
  shotId: string;
  status: ShotStatus;
  attempts: number;
  lastError?: string;
  /** Which character bible revisions this shot was generated against, so a
   *  bible edit can invalidate exactly the shots it affects. */
  characterRevisions: Record<string, number>;
  /** Set while status is AWAITING_WORKER. */
  deferredTicket?: string;
  deferredProvider?: string;
  updatedAt: string;
}

// --- routing decision --------------------------------------------------------

export interface ProviderScore {
  providerId: string;
  eligible: boolean;
  /** Why it was rejected, or why it scored as it did. Always populated. */
  reason: string;
  score: number;
  capability: GenerationCapability;
}

export interface RoutingDecision {
  /** null when nothing is eligible — the caller must handle it, not assume. */
  chosen: ProviderScore | null;
  /** Eligible runners-up, best first. The queue retries down this list. */
  fallbacks: ProviderScore[];
  rejected: ProviderScore[];
  freeOnly: boolean;
  /** One line fit for a log row or the Media Studio UI. */
  summary: string;
}
