import { execFile } from 'child_process';
import { queryWorkspacePtyIdentity, workspacePtyLifecycle } from '../workspace-pty-identity';
jest.mock('child_process', () => ({ execFile: jest.fn() }));
const query = execFile as unknown as jest.Mock;
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
const descendant = { creation: '639269439900818180', parent: process.pid + 1 };
beforeEach(() => { Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' }); query.mockReset(); });
afterEach(() => Object.defineProperty(process, 'platform', platform));

test('passive descendant observation retains birth and recorded parent without widening direct-child capture', async () => {
  query.mockImplementation((_file, _args, _options, callback) => callback(null, `${descendant.creation}:${descendant.parent}`));
  expect(await queryWorkspacePtyIdentity(991)).toEqual(descendant);
  expect(await workspacePtyLifecycle.capture(991)).toBeUndefined();
  expect(query.mock.calls.every(call => String(call[1].at(-1)).includes('ProcessId=991'))).toBe(true);
});
test('missing and unavailable passive observations remain distinct', async () => {
  query.mockImplementationOnce((_file, _args, _options, callback) => callback(null, 'missing'));
  expect(await queryWorkspacePtyIdentity(991)).toBeNull();
  query.mockImplementationOnce((_file, _args, _options, callback) => callback(Error('query unavailable'), ''));
  expect(await queryWorkspacePtyIdentity(991)).toBeUndefined();
});
test('birth-based absence observation cannot turn an unavailable query into stopped', async () => {
  query.mockImplementationOnce((_file, _args, _options, callback) => callback(null, `${descendant.creation}:${descendant.parent}`));
  expect(await workspacePtyLifecycle.stopped(991, descendant)).toBe(false);
  query.mockImplementationOnce((_file, _args, _options, callback) => callback(null, 'missing'));
  expect(await workspacePtyLifecycle.stopped(991, descendant)).toBe(true);
  query.mockImplementationOnce((_file, _args, _options, callback) => callback(Error('query unavailable'), ''));
  expect(await workspacePtyLifecycle.stopped(991, descendant)).toBe(false);
});
test('invalid observation PIDs never start a helper', async () => {
  expect(await queryWorkspacePtyIdentity(0)).toBeUndefined(); expect(query).not.toHaveBeenCalled();
});
