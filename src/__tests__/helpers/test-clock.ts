/**
 * TestClock — deterministic Clock for supervisor/soak tests.
 *
 * advance(ms) moves virtual time forward, firing due timers in order and
 * flushing microtasks after each fire so async chains (probe awaits, recovery
 * awaits) settle and can schedule their follow-up timers within the same
 * advance() call. Hours of supervisor behaviour run in milliseconds.
 */

import { Clock } from '../../supervisor/types';

interface PendingTimer {
  at: number;
  fn: () => void;
}

export class TestClock implements Clock {
  private t = 0;
  private seq = 0;
  private timers = new Map<number, PendingTimer>();

  now(): number {
    return this.t;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  /** Number of timers currently scheduled. */
  pending(): number {
    return this.timers.size;
  }

  /** Advance virtual time by ms, firing due timers in chronological order. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    for (;;) {
      let nextId: number | null = null;
      let nextTimer: PendingTimer | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && (nextTimer === null || timer.at < nextTimer.at)) {
          nextId = id;
          nextTimer = timer;
        }
      }
      if (nextId === null || nextTimer === null) break;
      this.timers.delete(nextId);
      this.t = Math.max(this.t, nextTimer.at);
      nextTimer.fn();
      // Flush microtasks so promise chains settle before the next timer fires.
      for (let i = 0; i < 25; i++) await Promise.resolve();
    }
    this.t = target;
  }
}
