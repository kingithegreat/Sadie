jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';
import { stopWorkspacePtyTree } from '../workspace-pty-force-stop';
const identity = { creation: '638953000000000000', parent: 77 };
const receipt = [{ pid: 1234, ...identity }, { pid: 2345, creation: '638953000000000100', parent: 1234 }];
const run = execFile as unknown as jest.Mock;
beforeEach(() => run.mockReset());

test('a timed-out force helper preserves the flushed owned identities for retry', async () => {
  run.mockImplementation((_file, _args, options, callback) => { expect(options).toMatchObject({ timeout: 4500, maxBuffer: 65536 }); callback(Error('helper timeout'), `receipt:${JSON.stringify(receipt)}\r\nattempted\r\n`); });
  expect(await stopWorkspacePtyTree(1234, identity)).toEqual({ stopped: false, attempted: true, receipt });
});

test('retry keeps the original receipt if transport fails before printing again', async () => {
  run.mockImplementation((_file, _args, _options, callback) => callback(Error('transport failed'), ''));
  expect(await stopWorkspacePtyTree(1234, identity, receipt)).toEqual({ stopped: false, attempted: false, receipt });
});

test('successful retry requires a valid receipt and completion, even with root already gone', async () => {
  run.mockImplementation((_file, _args, _options, callback) => callback(null, `receipt:${JSON.stringify(receipt)}\r\nattempted\r\nstopped\r\n`));
  expect(await stopWorkspacePtyTree(1234, identity, receipt)).toEqual({ stopped: true, attempted: true, receipt });
});

test('missing root before effects has no uncertainty receipt; malformed success fails closed', async () => {
  run.mockImplementationOnce((_file, _args, _options, callback) => callback(null, 'uncertain\r\n'));
  expect(await stopWorkspacePtyTree(1234, identity)).toEqual({ stopped: false, attempted: false });
  run.mockImplementationOnce((_file, _args, _options, callback) => callback(null, 'receipt:{broken\r\nstopped\r\n'));
  expect((await stopWorkspacePtyTree(1234, identity)).stopped).toBe(false);
});

test('invalid or mismatched receipts never launch a termination helper', async () => {
  expect((await stopWorkspacePtyTree(1234, identity, [{ ...receipt[0], pid: 9999 }])).stopped).toBe(false);
  expect((await stopWorkspacePtyTree(1234, identity, [receipt[0], receipt[0]])).stopped).toBe(false);
  expect(run).not.toHaveBeenCalled();
});
