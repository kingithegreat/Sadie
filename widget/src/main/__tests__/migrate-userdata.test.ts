/**
 * Tests for the SADIE -> HomeBot profile rescue.
 *
 * The rules under test are the safety story: copy never move, existing files
 * always win, settings never migrate, one shot only. Get any of those wrong
 * and an update either loses new state or resurrects stale state.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateLegacyUserData } from '../migrate-userdata';

let oldDir: string;
let newDir: string;

const write = (root: string, rel: string, content: string) => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
};
const read = (root: string, rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');
const exists = (root: string, rel: string) => fs.existsSync(path.join(root, rel));

beforeEach(() => {
  oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-old-'));
  newDir = fs.mkdtempSync(path.join(os.tmpdir(), 'homebot-new-'));
});

afterEach(() => {
  fs.rmSync(oldDir, { recursive: true, force: true });
  fs.rmSync(newDir, { recursive: true, force: true });
});

test('rescues conversations, memory, and root files', () => {
  write(oldDir, 'config/conversations.json', '{"convos":170}');
  write(oldDir, 'memory/rag-index.json', '{"docs":[]}');
  write(oldDir, 'automations.json', '[]');
  write(oldDir, 'quiz-progress.json', '{}');

  const r = migrateLegacyUserData(oldDir, newDir);

  expect(r.ran).toBe(true);
  expect(read(newDir, 'config/conversations.json')).toBe('{"convos":170}');
  expect(read(newDir, 'memory/rag-index.json')).toBe('{"docs":[]}');
  expect(exists(newDir, 'automations.json')).toBe(true);
  expect(exists(newDir, 'quiz-progress.json')).toBe(true);
});

test('never overwrites — the new profile always wins', () => {
  write(oldDir, 'config/conversations.json', 'OLD');
  write(newDir, 'config/conversations.json', 'NEW');

  migrateLegacyUserData(oldDir, newDir);

  expect(read(newDir, 'config/conversations.json')).toBe('NEW');
});

test('user-settings.json never migrates, even though config/ does', () => {
  // The new settings carry post-rename fixes; the stale file would undo them.
  write(oldDir, 'config/user-settings.json', '{"useCustomLLM":true,"stale":true}');
  write(oldDir, 'config/conversations.json', 'x');

  migrateLegacyUserData(oldDir, newDir);

  expect(exists(newDir, 'config/user-settings.json')).toBe(false);
  expect(exists(newDir, 'config/conversations.json')).toBe(true);
});

test('copies, never moves — the old profile is untouched', () => {
  write(oldDir, 'config/conversations.json', 'keep me');
  migrateLegacyUserData(oldDir, newDir);
  expect(read(oldDir, 'config/conversations.json')).toBe('keep me');
});

test('runs once — the marker gates reruns', () => {
  write(oldDir, 'config/conversations.json', 'first');
  const first = migrateLegacyUserData(oldDir, newDir);
  expect(first.ran).toBe(true);

  // Simulate the user deleting the migrated copy, then a restart: the rerun
  // must NOT resurrect it — one shot means one shot.
  fs.rmSync(path.join(newDir, 'config'), { recursive: true, force: true });
  const second = migrateLegacyUserData(oldDir, newDir);
  expect(second.ran).toBe(false);
  expect(exists(newDir, 'config/conversations.json')).toBe(false);
});

test('no old profile is a silent no-op, not an error', () => {
  fs.rmSync(oldDir, { recursive: true, force: true });
  const r = migrateLegacyUserData(oldDir, newDir);
  expect(r.ran).toBe(false);
  expect(r.errors).toEqual([]);
});

test('same directory for old and new is a no-op', () => {
  write(newDir, 'config/conversations.json', 'x');
  const r = migrateLegacyUserData(newDir, newDir);
  expect(r.ran).toBe(false);
});

test('Chromium engine state is not rescued', () => {
  write(oldDir, 'IndexedDB/db.sqlite', 'engine state');
  write(oldDir, 'Local Storage/leveldb/000.ldb', 'engine state');
  write(oldDir, 'config/conversations.json', 'x');

  migrateLegacyUserData(oldDir, newDir);

  expect(exists(newDir, 'IndexedDB/db.sqlite')).toBe(false);
  expect(exists(newDir, 'Local Storage/leveldb/000.ldb')).toBe(false);
});

test('the marker records what happened', () => {
  write(oldDir, 'config/conversations.json', 'x');
  migrateLegacyUserData(oldDir, newDir);
  const marker = JSON.parse(read(newDir, '.sadie-migration-v1.json'));
  expect(marker.migratedFrom).toBe(oldDir);
  expect(marker.copiedCount).toBe(1);
  expect(marker.errors).toEqual([]);
});
