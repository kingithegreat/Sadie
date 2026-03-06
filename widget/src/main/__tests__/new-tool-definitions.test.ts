/**
 * New Tool Definition Shape Tests
 *
 * Validates that all new ToolDefinition objects satisfy the expected contract:
 * - Non-empty name, description, category
 * - parameters.type === 'object'
 * - required is an array
 * - All names are unique
 */

import { notificationToolDefs } from '../tools/notification';
import { codeRunnerToolDefs } from '../tools/code-runner';
import { reminderToolDefs } from '../tools/reminder';
import { processManagerToolDefs } from '../tools/process-manager';
import { contactsToolDefs } from '../tools/contacts';
import { newsToolDefs } from '../tools/news';
import { gitToolDefs } from '../tools/git';
import { diffToolDefs } from '../tools/diff';
import { imageGenerateDef } from '../tools/web';
import type { ToolDefinition } from '../tools/types';

const ALL_NEW_DEFS: ToolDefinition[] = [
  ...notificationToolDefs,
  ...codeRunnerToolDefs,
  ...reminderToolDefs,
  ...processManagerToolDefs,
  ...contactsToolDefs,
  ...newsToolDefs,
  ...gitToolDefs,
  ...diffToolDefs,
  imageGenerateDef
];

// -----------------------------------------------------------------------
// Shape contract
// -----------------------------------------------------------------------

describe('new tool definition shapes', () => {
  test.each(ALL_NEW_DEFS)(
    '$name — has non-empty name, description, category, and valid parameters',
    (def) => {
      expect(typeof def.name).toBe('string');
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.name).toMatch(/^[a-z][a-z0-9_]*$/); // snake_case

      expect(typeof def.description).toBe('string');
      expect(def.description.length).toBeGreaterThan(10);

      expect(typeof def.category).toBe('string');
      expect((def.category ?? '').length).toBeGreaterThan(0);

      expect(def.parameters).toBeDefined();
      expect(def.parameters.type).toBe('object');
      expect(typeof def.parameters.properties).toBe('object');
      expect(Array.isArray(def.parameters.required)).toBe(true);
    }
  );

  test('all new tool names are unique', () => {
    const names = ALL_NEW_DEFS.map((d) => d.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// -----------------------------------------------------------------------
// Specific required-param contracts
// -----------------------------------------------------------------------

describe('required parameter contracts for new tools', () => {
  test('show_notification requires title and body', () => {
    const d = notificationToolDefs.find((d) => d.name === 'show_notification')!;
    expect(d.parameters.required).toContain('title');
    expect(d.parameters.required).toContain('body');
  });

  test('run_code requires language and code', () => {
    const d = codeRunnerToolDefs.find((d) => d.name === 'run_code')!;
    expect(d.parameters.required).toContain('language');
    expect(d.parameters.required).toContain('code');
  });

  test('run_code requires confirmation', () => {
    const d = codeRunnerToolDefs.find((d) => d.name === 'run_code')!;
    expect(d.requiresConfirmation).toBe(true);
  });

  test('set_reminder requires message', () => {
    const d = reminderToolDefs.find((d) => d.name === 'set_reminder')!;
    expect(d.parameters.required).toContain('message');
  });

  test('cancel_reminder requires id', () => {
    const d = reminderToolDefs.find((d) => d.name === 'cancel_reminder')!;
    expect(d.parameters.required).toContain('id');
  });

  test('kill_process requires confirmation', () => {
    const d = processManagerToolDefs.find((d) => d.name === 'kill_process')!;
    expect(d.requiresConfirmation).toBe(true);
  });

  test('search_contacts requires query', () => {
    const d = contactsToolDefs.find((d) => d.name === 'search_contacts')!;
    expect(d.parameters.required).toContain('query');
  });

  test('add_contact requires name', () => {
    const d = contactsToolDefs.find((d) => d.name === 'add_contact')!;
    expect(d.parameters.required).toContain('name');
  });

  test('git_commit requires message', () => {
    const d = gitToolDefs.find((d) => d.name === 'git_commit')!;
    expect(d.parameters.required).toContain('message');
  });

  test('git_commit requires confirmation', () => {
    const d = gitToolDefs.find((d) => d.name === 'git_commit')!;
    expect(d.requiresConfirmation).toBe(true);
  });

  test('diff_text requires original and modified', () => {
    const d = diffToolDefs.find((d) => d.name === 'diff_text')!;
    expect(d.parameters.required).toContain('original');
    expect(d.parameters.required).toContain('modified');
  });

  test('diff_files requires file_a and file_b', () => {
    const d = diffToolDefs.find((d) => d.name === 'diff_files')!;
    expect(d.parameters.required).toContain('file_a');
    expect(d.parameters.required).toContain('file_b');
  });

  test('image_generate requires prompt', () => {
    expect(imageGenerateDef.parameters.required).toContain('prompt');
  });

  test('get_news has no required params (uses defaults)', () => {
    const d = newsToolDefs.find((d) => d.name === 'get_news')!;
    expect(d.parameters.required).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------
// Handler map completeness
// -----------------------------------------------------------------------

import { notificationToolHandlers } from '../tools/notification';
import { codeRunnerToolHandlers } from '../tools/code-runner';
import { reminderToolHandlers } from '../tools/reminder';
import { processManagerToolHandlers } from '../tools/process-manager';
import { contactsToolHandlers } from '../tools/contacts';
import { newsToolHandlers } from '../tools/news';
import { gitToolHandlers } from '../tools/git';
import { diffToolHandlers } from '../tools/diff';

const HANDLER_MAPS = [
  { defs: notificationToolDefs, handlers: notificationToolHandlers, label: 'notification' },
  { defs: codeRunnerToolDefs, handlers: codeRunnerToolHandlers, label: 'code-runner' },
  { defs: reminderToolDefs, handlers: reminderToolHandlers, label: 'reminder' },
  { defs: processManagerToolDefs, handlers: processManagerToolHandlers, label: 'process-manager' },
  { defs: contactsToolDefs, handlers: contactsToolHandlers, label: 'contacts' },
  { defs: newsToolDefs, handlers: newsToolHandlers, label: 'news' },
  { defs: gitToolDefs, handlers: gitToolHandlers, label: 'git' },
  { defs: diffToolDefs, handlers: diffToolHandlers, label: 'diff' }
];

describe('handler map completeness', () => {
  test.each(HANDLER_MAPS)(
    '$label — every definition has a corresponding handler',
    ({ defs, handlers }) => {
      for (const def of defs) {
        expect(typeof handlers[def.name]).toBe('function');
      }
    }
  );
});
