/**
 * model-download-fit.ts
 *
 * Pure, dependency-free helper that decides whether there is enough free disk
 * space to pull an Ollama model of a known size. It complements the VRAM check
 * already in ModelSelector: VRAM decides whether a model will RUN well, this
 * decides whether it can even be DOWNLOADED without filling the disk.
 *
 * The free-disk figure comes from the first-run diagnostics probe
 * (`runDiagnostics().disk.freeGB`, backed by fs.statfsSync in main/diagnostics.ts).
 * Keeping this module pure (no fs, no Electron, no I/O) means it is trivially
 * unit-testable and safe to import from the renderer.
 *
 * Severity ladder:
 *   - 'unknown'      — no reliable reading (free space or model size missing/invalid). NEVER blocks.
 *   - 'ok'           — comfortably enough space (free >= required + headroom).
 *   - 'tight'        — model fits but eats into the safety headroom. Warn, do not block.
 *   - 'insufficient' — model would not fit at all (free < required). Block the pull.
 *
 * Only 'insufficient' blocks. Unknown/missing readings never block — we fail open
 * so a detection gap can never stop a user who actually has room.
 */

export type DownloadFitSeverity = 'unknown' | 'ok' | 'tight' | 'insufficient';

/** Default safety margin (GB) kept free on top of the raw model size. */
export const DEFAULT_HEADROOM_GB = 2;

export interface ModelDownloadFitInput {
  /** Advertised on-disk size of the model in GB (from the model catalog). */
  sizeGB: number | null | undefined;
  /** Free disk space in GB on the volume models are pulled to, or null if unknown. */
  freeGB: number | null | undefined;
  /** Optional override for the safety headroom (GB). Defaults to DEFAULT_HEADROOM_GB. */
  headroomGB?: number | null;
}

export interface ModelDownloadFit {
  /** True unless the pull is known to be impossible (severity !== 'insufficient'). */
  fits: boolean;
  severity: DownloadFitSeverity;
  /** sizeGB + headroom — the space we want available before pulling. null when unknown. */
  requiredGB: number | null;
  /** Echo of the free space considered, rounded. null when unknown. */
  freeGB: number | null;
  /** The headroom actually applied. */
  headroomGB: number;
  /** Human-readable, UI-ready one-liner. */
  message: string | null;
}

/** Convert a raw byte count to GB (decimal, matching diagnostics.ts). */
export function bytesToGb(bytes: number | null | undefined): number | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  return bytes / 1e9;
}

/** Round a GB figure to one decimal place for display. */
export function roundGb(gb: number): number {
  return Math.round(gb * 10) / 10;
}

/** Format a GB figure for UI (e.g. "4.4 GB"). */
export function formatGb(gb: number | null | undefined): string {
  if (typeof gb !== 'number' || !Number.isFinite(gb)) return '— GB';
  return `${roundGb(gb).toFixed(1)} GB`;
}

function isValidPositive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Assess whether a model of `sizeGB` can be downloaded given `freeGB` of disk.
 * Never throws. Fails open (severity 'unknown', fits=true) on missing data.
 */
export function assessModelDownloadFit(input: ModelDownloadFitInput): ModelDownloadFit {
  const headroomGB =
    typeof input.headroomGB === 'number' && Number.isFinite(input.headroomGB) && input.headroomGB >= 0
      ? input.headroomGB
      : DEFAULT_HEADROOM_GB;

  // Unknown if we can't trust either reading.
  if (!isValidPositive(input.sizeGB) || typeof input.freeGB !== 'number' || !Number.isFinite(input.freeGB)) {
    return {
      fits: true,
      severity: 'unknown',
      requiredGB: null,
      freeGB: null,
      headroomGB,
      message: null,
    };
  }

  const sizeGB = input.sizeGB;
  const freeGB = Math.max(0, input.freeGB);
  const requiredGB = roundGb(sizeGB + headroomGB);
  const freeRounded = roundGb(freeGB);

  // Not enough room for the model itself → block.
  if (freeGB < sizeGB) {
    return {
      fits: false,
      severity: 'insufficient',
      requiredGB,
      freeGB: freeRounded,
      headroomGB,
      message: `Not enough disk space: needs ~${roundGb(sizeGB).toFixed(1)} GB but only ${freeRounded.toFixed(1)} GB free. Free up space before downloading.`,
    };
  }

  // Fits, but cuts into the safety headroom → warn.
  if (freeGB < sizeGB + headroomGB) {
    return {
      fits: true,
      severity: 'tight',
      requiredGB,
      freeGB: freeRounded,
      headroomGB,
      message: `Low disk space: this leaves under ${headroomGB} GB free after download (${freeRounded.toFixed(1)} GB free now).`,
    };
  }

  return {
    fits: true,
    severity: 'ok',
    requiredGB,
    freeGB: freeRounded,
    headroomGB,
    message: null,
  };
}

/** Convenience boolean: would this pull be allowed? (unknown/tight/ok all allow). */
export function canDownloadModel(input: ModelDownloadFitInput): boolean {
  return assessModelDownloadFit(input).fits;
}
