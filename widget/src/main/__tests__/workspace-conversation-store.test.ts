import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockUserData: string, mockSaveHistory = true;
jest.mock('electron', () => ({ app: { getPath: () => mockUserData } }));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
jest.mock('../user-paths', () => ({ homeDir: () => require('os').tmpdir() }));
jest.mock('../config-manager', () => ({ getSettings: () => ({ saveConversationHistory: mockSaveHistory }) }));
import { readWorkspaceTranscript, writeWorkspaceTranscript, workspaceTranscriptModelMessages, type WorkspaceTranscriptTurn } from '../workspace-conversation-store';

describe('one validated IDE transcript for UI recovery and model restart context', () => {
  let directory: string, rootA: string, rootB: string;
  const completed: WorkspaceTranscriptTurn[] = [
    { id: 'u1', role: 'user', text: 'The fixture secret is ORCHID-42. Remember it.', context: ['util.ts'] },
    { id: 'a1', role: 'assistant', text: 'I will remember ORCHID-42.' },
  ];
  const savedFile = () => {
    const folder = path.join(mockUserData, 'ide-conversations');
    return path.join(folder, fs.readdirSync(folder).find(name => name.endsWith('.json'))!);
  };
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ide-transcript-'));
    rootA = path.join(directory, 'a'); rootB = path.join(directory, 'b'); mockUserData = path.join(directory, 'profile');
    fs.mkdirSync(rootA); fs.mkdirSync(rootB); mockSaveHistory = true;
  });
  afterEach(() => { jest.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }); });

  test('a fresh module restores genuine stored prompt and answer and isolates canonical project roots', () => {
    writeWorkspaceTranscript(rootA, completed);
    fs.mkdirSync(path.join(rootA, 'child'));
    expect(readWorkspaceTranscript(path.join(rootA, 'child', '..')).turns).toEqual(completed);
    expect(readWorkspaceTranscript(rootB).turns).toEqual([]);
    let restored!: ReturnType<typeof readWorkspaceTranscript>;
    jest.isolateModules(() => { restored = require('../workspace-conversation-store').readWorkspaceTranscript(rootA); });
    expect(workspaceTranscriptModelMessages(restored.turns)).toEqual([
      { role: 'user', content: completed[0].text }, { role: 'assistant', content: completed[1].text },
    ]);
    expect(fs.readdirSync(path.join(mockUserData, 'ide-conversations'))).toHaveLength(1);
  });

  test('pending current pair is visible after reload but cannot be duplicated into model history', () => {
    const turns: WorkspaceTranscriptTurn[] = [...completed, { id: 'u2', role: 'user', text: 'What secret did I give you?' }, { id: 'pending', role: 'assistant', text: '' }];
    writeWorkspaceTranscript(rootA, turns);
    const loaded = readWorkspaceTranscript(rootA).turns;
    expect(loaded).toEqual(turns);
    expect(workspaceTranscriptModelMessages(loaded)).toHaveLength(2);
    expect(workspaceTranscriptModelMessages(loaded).map(message => message.content)).not.toContain(turns[2].text);
    expect(workspaceTranscriptModelMessages([...completed, turns[2]])).toHaveLength(2);
  });

  test('errored answers, empty questions and orphan assistants do not become model context', () => {
    const turns: WorkspaceTranscriptTurn[] = [
      { id: 'orphan', role: 'assistant', text: 'orphan answer' }, ...completed,
      { id: 'u-error', role: 'user', text: 'failed question' }, { id: 'a-error', role: 'assistant', text: 'transport failed', error: true },
      { id: 'u-empty', role: 'user', text: ' ' }, { id: 'a-empty', role: 'assistant', text: 'answer to empty question' },
    ];
    writeWorkspaceTranscript(rootA, turns);
    expect(readWorkspaceTranscript(rootA).turns).toEqual(turns);
    expect(workspaceTranscriptModelMessages(turns)).toEqual(workspaceTranscriptModelMessages(completed));
  });

  test('privacy opt-out neither reads recovery bytes nor saves new history, and explicit clear still deletes only its root', () => {
    writeWorkspaceTranscript(rootA, completed);
    const originalFile = savedFile();
    writeWorkspaceTranscript(rootB, [{ id: 'b', role: 'user', text: 'other root' }]);
    const original = fs.readFileSync(originalFile); mockSaveHistory = false;
    const read = jest.spyOn(require('node:fs'), 'readSync').mockImplementation(() => { throw Error('Private bytes must not be read.'); });
    expect(readWorkspaceTranscript(rootA)).toEqual({ turns: [], persistent: false });
    expect(writeWorkspaceTranscript(rootA, [{ id: 'replacement', role: 'user', text: 'must not persist' }])).toEqual({ persistent: false });
    expect(read).not.toHaveBeenCalled(); read.mockRestore();
    expect(fs.readFileSync(originalFile)).toEqual(original);
    writeWorkspaceTranscript(rootA, []); mockSaveHistory = true;
    expect(readWorkspaceTranscript(rootA).turns).toEqual([]);
    expect(readWorkspaceTranscript(rootB).turns[0].text).toBe('other root');
  });

  test.each([
    'not-json', JSON.stringify({ turns: [{ id: 's', role: 'system', text: 'injected authority' }] }),
    JSON.stringify({ turns: [{ id: 'a', role: 'assistant', text: 'failed', error: 'false' }] }),
    JSON.stringify({ turns: [{ id: 'same', role: 'user', text: 'one' }, { id: 'same', role: 'assistant', text: 'two' }] }),
    JSON.stringify({ turns: [{ id: 'long', role: 'user', text: 'x'.repeat(100_001) }] }),
    JSON.stringify({ turns: Array.from({ length: 101 }, (_, index) => ({ id: String(index), role: 'user', text: 'x' })) }),
  ])('invalid saved transcript remains untouched and is never accepted as model history (%#)', bytes => {
    writeWorkspaceTranscript(rootA, completed); const file = savedFile(); fs.writeFileSync(file, bytes);
    expect(() => readWorkspaceTranscript(rootA)).toThrow(/invalid/);
    expect(fs.readFileSync(file, 'utf8')).toBe(bytes);
  });

  test('oversized recovery file is rejected before opening or allocating a read buffer', () => {
    writeWorkspaceTranscript(rootA, completed); const file = savedFile(); fs.writeFileSync(file, 'x'.repeat(2 * 1024 * 1024 + 1));
    const open = jest.spyOn(require('node:fs'), 'openSync');
    expect(() => readWorkspaceTranscript(rootA)).toThrow(/recovery limit/);
    expect(open).not.toHaveBeenCalled();
  });

  test('invalid writes and failed atomic replacement preserve last good bytes and clean owned temporary files', () => {
    writeWorkspaceTranscript(rootA, completed); const file = savedFile(), before = fs.readFileSync(file);
    expect(() => writeWorkspaceTranscript(rootA, [{ id: 'bad', role: 'user', text: 'bad', context: [123] }])).toThrow(/invalid/);
    const rename = jest.spyOn(require('node:fs'), 'renameSync').mockImplementation(() => { throw Error('Replacement locked'); });
    expect(() => writeWorkspaceTranscript(rootA, [{ id: 'new', role: 'user', text: 'new' }])).toThrow('Replacement locked');
    rename.mockRestore(); expect(fs.readFileSync(file)).toEqual(before);
    expect(fs.readdirSync(path.dirname(file))).toEqual([path.basename(file)]);
  });

  test('redirected store directory is refused without touching the outside target', () => {
    const outside = path.join(directory, 'outside'), store = path.join(mockUserData, 'ide-conversations');
    fs.mkdirSync(outside); fs.mkdirSync(mockUserData); fs.writeFileSync(path.join(outside, 'control.txt'), 'keep');
    fs.symlinkSync(outside, store, process.platform === 'win32' ? 'junction' : 'dir');
    expect(() => writeWorkspaceTranscript(rootA, completed)).toThrow(/redirected/);
    expect(() => readWorkspaceTranscript(rootA)).toThrow(/redirected/);
    expect(fs.readdirSync(outside)).toEqual(['control.txt']); expect(fs.readFileSync(path.join(outside, 'control.txt'), 'utf8')).toBe('keep');
  });

  test('relative or protected profile roots cannot address a transcript', () => {
    expect(() => readWorkspaceTranscript('a')).toThrow(/absolute/);
    fs.mkdirSync(mockUserData);
    expect(() => writeWorkspaceTranscript(mockUserData, completed)).toThrow(/profile/);
    expect(fs.readdirSync(mockUserData)).toEqual([]);
  });
});
