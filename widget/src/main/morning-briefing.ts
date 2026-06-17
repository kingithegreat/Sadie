/**
 * HomeBot Morning Briefing
 *
 * On the first user interaction each day, proactively offers a brief
 * summary of weather, upcoming calendar events, and pending reminders.
 *
 * Design:
 *   • Tracks the last briefing date in memory so it only triggers once/day
 *   • Runs tool calls in parallel (weather + calendar + reminders)
 *   • Returns formatted markdown — the caller decides how to deliver it
 *   • Non-blocking: if any tool fails, that section is silently omitted
 *   • Respects user opt-out via settings.morningBriefing === false
 */

import { executeToolBatch, ToolCall, ToolContext } from './tools';
import { getSettings } from './config-manager';
import * as fs from 'fs';
import * as path from 'path';

// ── State: track last briefing date ──────────────────────────────────────

let lastBriefingDate: string | null = null;

function getBriefingStatePath(): string {
  try {
    const { app } = require('electron');
    const base = app.isPackaged
      ? app.getPath('userData')
      : path.resolve(__dirname, '../../../');
    return path.join(base, 'memory', 'json-store', 'briefing-state.json');
  } catch {
    return path.resolve(__dirname, '../../../memory/json-store/briefing-state.json');
  }
}

function loadBriefingState(): void {
  try {
    const data = JSON.parse(fs.readFileSync(getBriefingStatePath(), 'utf-8'));
    lastBriefingDate = data.lastDate || null;
  } catch {
    lastBriefingDate = null;
  }
}

function saveBriefingState(dateStr: string): void {
  try {
    const p = getBriefingStatePath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ lastDate: dateStr }), 'utf-8');
  } catch (e) {
    console.error('[Briefing] Failed to save state:', (e as any)?.message);
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Check whether a morning briefing should be offered.
 * Returns true at most once per calendar day.
 */
export function shouldOfferBriefing(): boolean {
  const settings = getSettings() as any;
  // Respect explicit opt-out
  if (settings.morningBriefing === false) return false;

  if (lastBriefingDate === null) loadBriefingState();

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
  return lastBriefingDate !== today;
}

/**
 * Mark today's briefing as delivered so it won't trigger again.
 */
export function markBriefingDelivered(): void {
  const today = new Date().toLocaleDateString('en-CA');
  lastBriefingDate = today;
  saveBriefingState(today);
}

/**
 * Generate the morning briefing content by calling weather, calendar,
 * and reminder tools in parallel.
 *
 * Returns formatted markdown string, or null if nothing to show.
 */
export async function generateBriefing(
  requestConfirmation?: (msg: string) => Promise<boolean>
): Promise<string | null> {
  const context: ToolContext = {
    executionId: `briefing-${Date.now()}`,
    requestConfirmation,
  };

  // Fire all three tool calls in parallel
  const calls: ToolCall[] = [
    { name: 'get_weather', arguments: { location: 'auto' } },
    { name: 'list_calendar_events', arguments: { days_ahead: 1, limit: 5 } },
    { name: 'list_reminders', arguments: {} },
  ];

  let results: any[];
  try {
    results = await executeToolBatch(calls, context);
  } catch (e) {
    console.error('[Briefing] Tool batch failed:', (e as any)?.message);
    return null;
  }

  const sections: string[] = [];
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const dayName = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  sections.push(`## ${greeting}! Here's your briefing for ${dayName}\n`);

  // ── Weather ──
  const weather = results[0];
  if (weather?.success !== false && weather?.result) {
    const w = weather.result;
    let weatherLine = '### 🌤️ Weather\n';
    if (w.temperature) {
      weatherLine += `**${w.temperature.celsius || w.temperature.fahrenheit || ''}**`;
      if (w.temperature.feelsLike) weatherLine += ` (feels like ${w.temperature.feelsLike})`;
    }
    if (w.condition) weatherLine += ` — ${w.condition}`;
    weatherLine += '\n';
    if (w.wind) weatherLine += `Wind: ${w.wind.speed || ''} ${w.wind.direction || ''} · `;
    if (w.humidity) weatherLine += `Humidity: ${w.humidity}`;
    weatherLine += '\n';
    sections.push(weatherLine);
  }

  // ── Calendar ──
  const calendar = results[1];
  if (calendar?.success !== false && calendar?.result?.events?.length > 0) {
    const events = calendar.result.events;
    let calLine = `### 📅 Today's Events (${events.length})\n`;
    for (const ev of events) {
      const start = ev.start
        ? new Date(ev.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        : '';
      calLine += `- **${ev.title}** ${start ? `at ${start}` : ''}${ev.location ? ` 📍 ${ev.location}` : ''}\n`;
    }
    sections.push(calLine);
  }

  // ── Reminders ──
  const reminders = results[2];
  if (reminders?.success !== false && reminders?.result?.reminders?.length > 0) {
    const rems = reminders.result.reminders;
    let remLine = `### ⏰ Pending Reminders (${rems.length})\n`;
    for (const r of rems.slice(0, 5)) {
      const fireAt = r.fireAt
        ? new Date(r.fireAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : '';
      remLine += `- ${r.message}${fireAt ? ` — ${fireAt}` : ''}\n`;
    }
    sections.push(remLine);
  }

  // If only the greeting section exists, nothing useful to show
  if (sections.length <= 1) return null;

  sections.push('\n---\n_Ask me anything to get started!_');

  return sections.join('\n');
}
