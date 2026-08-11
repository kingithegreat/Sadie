/**
 * browser-control.ts — letting HomeBot drive the docked browser.
 *
 * The panel could already be looked at (look_at_browser screenshots it). This
 * adds acting on it: read, list what is clickable, click, type, navigate.
 *
 * Two design decisions worth stating, because they are what make this workable
 * on the 7B models Aden actually runs:
 *
 * 1. NO PIXEL COORDINATES. The model picks a numbered target from a list it can
 *    read, rather than guessing an (x, y) from a screenshot. Coordinate
 *    guessing is where small-model browser agents fall apart, and a misplaced
 *    click on a real page is not a harmless mistake.
 *
 * 2. TEXT FIRST, VISION SECOND. read_browser_page returns rendered text, which
 *    every model can use. The screenshot path stays for questions genuinely
 *    about layout, because moondream — the only local vision model here — is
 *    weak at reading interfaces.
 *
 * Every action runs through executeTool, so it inherits assertPermission and
 * requestConfirmation. Clicking and typing default to permission-OFF: this
 * browser holds real logged-in sessions, and a click can spend money or send a
 * message. Reading is safe and defaults on.
 */

import type { ToolDefinition, ToolHandler, ToolResult } from './types';

const ok = (result: any): ToolResult => ({ success: true, result } as ToolResult);
const err = (error: string): ToolResult => ({ success: false, error } as ToolResult);

/** Lazy import: browser-panel pulls in Electron's BrowserView. */
const panel = () => import('../browser-panel');

export const readBrowserPageDef: ToolDefinition = {
  name: 'read_browser_page',
  description:
    'Read the text of the page currently open in the browser panel. Use this to answer ' +
    '"what does this page say", summarise an article, or find information on screen. ' +
    'Prefer this over a screenshot — it is more accurate and works on any model.',
  category: 'web',
  parameters: {
    type: 'object',
    properties: {
      max_chars: { type: 'number', description: 'Maximum characters to return (default 8000)' },
    },
    required: [],
  },
};

export const listBrowserTargetsDef: ToolDefinition = {
  name: 'list_browser_targets',
  description:
    'List the links, buttons and fields currently visible on the page, each with a number. ' +
    'Call this before clicking or typing so you can choose a target by number rather than ' +
    'guessing where it is.',
  category: 'web',
  parameters: { type: 'object', properties: {}, required: [] },
};

export const clickBrowserTargetDef: ToolDefinition = {
  name: 'click_browser_target',
  description:
    'Click a numbered element from list_browser_targets. Always call list_browser_targets ' +
    'first — the numbers come from that list and change when the page changes.',
  category: 'web',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'number', description: 'The number shown by list_browser_targets' },
    },
    required: ['target'],
  },
};

export const typeInBrowserDef: ToolDefinition = {
  name: 'type_in_browser',
  description:
    'Type text into a numbered field on the page. Call list_browser_targets first to find ' +
    'the field number.',
  category: 'web',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      target: { type: 'number', description: 'The field number from list_browser_targets' },
      text: { type: 'string', description: 'The text to type' },
    },
    required: ['target', 'text'],
  },
};

export const navigateBrowserDef: ToolDefinition = {
  name: 'navigate_browser',
  description:
    'Open a web address in the browser panel. Use this to start a task on a specific site.',
  category: 'web',
  requiresConfirmation: true,
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The address to open, e.g. https://example.com' },
    },
    required: ['url'],
  },
};

const readBrowserPageHandler: ToolHandler = async (args) => {
  const { readBrowserPage } = await panel();
  const max = typeof args.max_chars === 'number' ? args.max_chars : 8000;
  const res = await readBrowserPage(max);
  if (!res.success) return err(res.error);
  return ok([
    `${res.title || '(untitled)'} — ${res.url}`,
    '',
    res.text || '(the page has no readable text)',
    res.truncated ? '\n[truncated]' : '',
  ].join('\n'));
};

const listBrowserTargetsHandler: ToolHandler = async () => {
  const { listBrowserTargets } = await panel();
  const res = await listBrowserTargets();
  if (!res.success) return err(res.error);
  if (!res.targets.length) return ok('Nothing clickable is visible on this page right now.');
  return ok([
    `Visible on ${res.url}:`,
    ...res.targets.map(t => `  ${t.i}. [${t.kind}] ${t.label}`),
  ].join('\n'));
};

const clickBrowserTargetHandler: ToolHandler = async (args) => {
  const { clickBrowserTarget } = await panel();
  const target = Number(args.target);
  if (!Number.isFinite(target)) return err('Which numbered target? Call list_browser_targets first.');
  const res = await clickBrowserTarget(target);
  return res.success ? ok(`Clicked "${res.clicked}".`) : err(res.error || 'Click failed.');
};

const typeInBrowserHandler: ToolHandler = async (args) => {
  const { typeIntoBrowserTarget } = await panel();
  const target = Number(args.target);
  const text = String(args.text ?? '');
  if (!Number.isFinite(target)) return err('Which numbered field? Call list_browser_targets first.');
  if (!text) return err('Nothing to type.');
  const res = await typeIntoBrowserTarget(target, text);
  return res.success ? ok(`Typed into ${res.into}.`) : err(res.error || 'Typing failed.');
};

const navigateBrowserHandler: ToolHandler = async (args) => {
  const raw = String(args.url ?? '').trim();
  if (!raw) return err('No address given.');
  // Reject a non-web scheme BEFORE adding one. Prepending https:// to
  // "file:///C:/Windows" produces a string that parses as https and sails past
  // a protocol check — the guard has to look at what was actually asked for.
  const explicitScheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== 'http' && explicitScheme !== 'https') {
    return err('Only http and https addresses can be opened.');
  }

  const url = explicitScheme ? raw : `https://${raw}`;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return err('Only http and https addresses can be opened.');
    }
    if (!parsed.hostname || !parsed.hostname.includes('.')) {
      return err(`"${raw}" is not a valid web address.`);
    }
  } catch {
    return err(`"${raw}" is not a valid web address.`);
  }

  const { navigateBrowserPanel } = await panel() as any;
  if (typeof navigateBrowserPanel !== 'function') {
    return err('The browser panel is not open. Open it with the Browser button first.');
  }
  const res = await navigateBrowserPanel(url);
  return res?.success ? ok(`Opened ${url}`) : err(res?.error || 'Could not open that page.');
};

export const browserControlToolDefs: ToolDefinition[] = [
  readBrowserPageDef,
  listBrowserTargetsDef,
  clickBrowserTargetDef,
  typeInBrowserDef,
  navigateBrowserDef,
];

export const browserControlToolHandlers: Record<string, ToolHandler> = {
  read_browser_page: readBrowserPageHandler,
  list_browser_targets: listBrowserTargetsHandler,
  click_browser_target: clickBrowserTargetHandler,
  type_in_browser: typeInBrowserHandler,
  navigate_browser: navigateBrowserHandler,
};
