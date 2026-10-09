// Real filesystem fixtures use the repository's explicit I/O budget.
jest.setTimeout(15_000);

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
let mockHome: string;
jest.mock('electron', () => ({ app: { getPath: () => require('path').join(mockHome, 'profile') } }));
jest.mock('../user-paths', () => ({ homeDir: () => mockHome }));
jest.mock('../window-manager', () => ({ getMainWindow: jest.fn() }));
import { approveWorkspacePlan, currentWorkspace, prepareWorkspacePlan, runWorkspaceRequest } from '../workspace-context';

const TTL = 30 * 60_000;
let root: string, other: string, now: number;
beforeEach(() => {
  mockHome = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-ttl-'));
  root = path.join(mockHome, 'project'); other = path.join(mockHome, 'other'); fs.mkdirSync(root); fs.mkdirSync(other);
  now = 1_700_000_000_000; jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => { jest.restoreAllMocks(); fs.rmSync(mockHome, { recursive: true, force: true }); });
const send = (id: string) => runWorkspaceRequest({ streamId: 'ttl-test', workspace: { root, planId: id } }, 1, () => currentWorkspace()!.approved);

test('approval near the review deadline renews its actual server authority for a full returned TTL', () => {
  const prepared = prepareWorkspacePlan(root, 'Review file changes.', 1);
  expect(prepared.expires).toBe(now + TTL);
  now = prepared.expires - 1;
  const approved = approveWorkspacePlan(root, prepared.id, 1);
  expect(approved).toMatchObject({ id: prepared.id, root: fs.realpathSync(root), expires: now + TTL });
  now = prepared.expires + 1; expect(send(approved.id)).toBe(true);
  now = approved.expires - 1; expect(send(approved.id)).toBe(true);
  now = approved.expires;
  expect(() => send(approved.id)).toThrow('Approve a current plan');
  expect(() => approveWorkspacePlan(root, approved.id, 1)).toThrow('expired');
  const fresh = prepareWorkspacePlan(root, 'Review the current file changes again.', 1);
  expect(fresh.id).not.toBe(approved.id); approveWorkspacePlan(root, fresh.id, 1); expect(send(fresh.id)).toBe(true);
});

test('a review expires exactly at its deadline and another root/window cannot renew a still-valid review', () => {
  const prepared = prepareWorkspacePlan(root, 'Review file changes.', 1);
  now += TTL - 100;
  expect(() => approveWorkspacePlan(root, prepared.id, 2)).toThrow('another project/window');
  expect(() => approveWorkspacePlan(other, prepared.id, 1)).toThrow('another project/window');
  now = prepared.expires;
  expect(() => approveWorkspacePlan(root, prepared.id, 1)).toThrow('expired');
  expect(() => send(prepared.id)).toThrow('Approve a current plan');
});
