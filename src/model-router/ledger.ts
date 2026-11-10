/**
 * Local spend ledger. Every live response's usage/cost is appended to one
 * JSON file that the CLI, the local endpoint and HomeBot chat all share, so
 * one monthly cap covers every caller on the machine.
 *
 * The file is re-read on every check, so two processes (CLI + app) see each
 * other's spend. A corrupt ledger is an error, never a silent reset: resetting
 * would quietly lift the cap.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RouterTier } from './pick-tier';

export interface LedgerEntry {
  at: string;
  /** UTC month, YYYY-MM. OpenRouter key limits also reset at midnight UTC. */
  month: string;
  source: string;
  tier: RouterTier;
  model: string;
  sessionId: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  costUsd: number;
  /** True when the response carried no usage.cost and the price was estimated. */
  estimated: boolean;
}

interface LedgerFile {
  version: 1;
  entries: LedgerEntry[];
}

export class SpendCapExceededError extends Error {
  readonly code = 'SPEND_CAP_EXCEEDED';
  constructor(
    readonly spentUsd: number,
    readonly capUsd: number,
    readonly month: string,
    readonly ledgerPath: string,
  ) {
    super(
      `Monthly spend cap reached: $${spentUsd.toFixed(4)} spent of the $${capUsd.toFixed(2)} cap for ${month} (UTC). ` +
      `No request was sent. Raise "monthlyCapUsd" in the router config (or MODEL_ROUTER_MONTHLY_CAP_USD), ` +
      `or wait for next month. Ledger: ${ledgerPath}`,
    );
    this.name = 'SpendCapExceededError';
  }
}

export class LedgerCorruptError extends Error {
  constructor(readonly ledgerPath: string, detail: string) {
    super(`Spend ledger ${ledgerPath} could not be read (${detail}). Fix or move the file; it is not reset automatically because that would lift the cap.`);
    this.name = 'LedgerCorruptError';
  }
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export class SpendLedger {
  constructor(
    readonly filePath: string,
    readonly capUsd: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(): LedgerEntry[] {
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new LedgerCorruptError(this.filePath, (e as Error).message);
    }
    if (!text.trim()) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw new LedgerCorruptError(this.filePath, (e as Error).message);
    }
    const file = parsed as Partial<LedgerFile>;
    if (!file || !Array.isArray(file.entries)) throw new LedgerCorruptError(this.filePath, 'missing "entries" array');
    return file.entries;
  }

  currentMonth(): string {
    return monthKey(this.now());
  }

  monthTotal(month: string = this.currentMonth()): number {
    return this.read()
      .filter(e => e.month === month)
      .reduce((sum, e) => sum + (Number.isFinite(e.costUsd) ? e.costUsd : 0), 0);
  }

  remainingUsd(): number {
    return Math.max(0, this.capUsd - this.monthTotal());
  }

  /** Throws SpendCapExceededError when this month's spend has reached the cap. */
  assertUnderCap(): void {
    const month = this.currentMonth();
    const spent = this.monthTotal(month);
    if (spent >= this.capUsd) throw new SpendCapExceededError(spent, this.capUsd, month, this.filePath);
  }

  record(entry: Omit<LedgerEntry, 'at' | 'month'>): LedgerEntry {
    const now = this.now();
    const full: LedgerEntry = { at: now.toISOString(), month: monthKey(now), ...entry };
    const entries = this.read();
    entries.push(full);
    const body: LedgerFile = { version: 1, entries };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(body, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, this.filePath);
    return full;
  }

  summary(): { month: string; spentUsd: number; capUsd: number; remainingUsd: number; calls: number; ledgerPath: string } {
    const month = this.currentMonth();
    const entries = this.read().filter(e => e.month === month);
    const spentUsd = entries.reduce((s, e) => s + (Number.isFinite(e.costUsd) ? e.costUsd : 0), 0);
    return { month, spentUsd, capUsd: this.capUsd, remainingUsd: Math.max(0, this.capUsd - spentUsd), calls: entries.length, ledgerPath: this.filePath };
  }
}
