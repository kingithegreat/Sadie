jest.mock('child_process', () => ({ execFile: jest.fn() }));
import { execFile } from 'child_process';
import { stopWorkspacePtyTree } from '../workspace-pty-force-stop';
const identity = { creation: '638953000000000000', parent: 77 };
const receipt = [{ pid: 1234, ...identity }, { pid: 2345, creation: '638953000000000100', parent: 1234 }];
const run = execFile as unknown as jest.Mock;
beforeEach(() => run.mockReset());

test('owned cleanup helper uses the supplied isolated stores without mutating the runner environment', async () => {
  const previousHome = process.env.HOME;
  const env = { ...process.env, HOME: 'owned-home', TEMP: 'owned-temp', APPDATA: 'owned-appdata' };
  run.mockImplementation((_file, _args, options, callback) => { expect(options.env).toBe(env); callback(null, `receipt:${JSON.stringify(receipt)}\r\nattempted\r\nstopped\r\n`); });
  expect((await stopWorkspacePtyTree(1234, identity, receipt, env)).stopped).toBe(true);
  expect(process.env.HOME).toBe(previousHome);
});

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

test('uncertain confirmation reports the exact captured identity and held-handle wait without claiming Stop', async () => {
  const diagnostics = [{ ...receipt[1], stage: 'confirm', request: -1, requestError: 5, wait: 258 }];
  run.mockImplementation((_file, _args, _options, callback) => callback(null, `receipt:${JSON.stringify(receipt)}\nattempted\ndiagnostic:${JSON.stringify(diagnostics)}\nuncertain\n`));
  expect(await stopWorkspacePtyTree(1234, identity)).toEqual({ stopped: false, attempted: true, receipt, diagnostics });
});

test('diagnostics cannot grant ownership to another birth/PID or turn uncertainty into success', async () => {
  const foreign = [{ ...receipt[1], creation: '638953000000000200', stage: 'confirm', wait: 0 }];
  run.mockImplementation((_file, _args, _options, callback) => callback(null, `receipt:${JSON.stringify(receipt)}\nattempted\ndiagnostic:${JSON.stringify(foreign)}\nuncertain\n`));
  expect(await stopWorkspacePtyTree(1234, identity)).toEqual({ stopped: false, attempted: true, receipt });
});

test('diagnostic metadata is bounded to allowed fields and missing-root details remain effect-free', async () => {
  run.mockImplementation((_file, _args, _options, callback) => callback(null, `diagnostic:${JSON.stringify([{ ...receipt[0], stage: 'open-root', openStatus: -1, openError: 5, command: 'never expose arbitrary text' }])}\nuncertain\n`));
  expect(await stopWorkspacePtyTree(1234, identity)).toEqual({ stopped: false, attempted: false, diagnostics: [{ ...receipt[0], stage: 'open-root', openStatus: -1, openError: 5 }] });
});

const windowsControl = process.platform === 'win32' ? test : test.skip;
windowsControl.each(['race', 'alive', 'failed-wait'])('actual generated helper %s control confirms only held-handle exit with every native API mocked', async mode => {
  let generated = '';
  run.mockImplementation((_file, args, _options, callback) => { generated = Buffer.from(args[args.length - 1], 'base64').toString('utf16le'); callback(null, 'uncertain\n'); });
  await stopWorkspacePtyTree(1234, identity);
  const methods: Record<string, string> = {
    OpenProcess: 'static IntPtr OpenProcess(uint rights,bool inherit,int pid) { return new IntPtr(pid); }',
    GetProcessTimes: `static bool GetProcessTimes(IntPtr h,out long created,out long exited,out long kernel,out long user) { created=(h.ToInt32()==1234 ? ${identity.creation}L : ${receipt[1].creation}L)-504911232000000000L; exited=kernel=user=0; return true; }`,
    TerminateProcess: `static bool TerminateProcess(IntPtr h,uint code) { ended=${mode === 'race' ? 'true' : 'false'}; return false; }`,
    CloseHandle: 'public static bool CloseHandle(IntPtr h) { return true; }',
    WaitForSingleObject: `static uint WaitForSingleObject(IntPtr h,uint ms) { return ${mode === 'failed-wait' ? 'ended ? 0xffffffffU : 0xffffffffU' : 'ended ? 0U : 258U'}; }`,
  };
  let replacements = 0;
  generated = generated.replace(/ \[DllImport\("kernel32\.dll"(?:,SetLastError=true)?\)\] (?:public )?static extern ([^;]+);/g, (_match, declaration: string) => {
    const name = /\s(\w+)\(/.exec(declaration)![1]; replacements++; return methods[name];
  }).replace('public static class OwnedPtyStop {', 'public static class OwnedPtyStop { static bool ended=false;').replace(/Marshal\.GetLastWin32Error\(\)/g, '5');
  generated = generated.replace('Get-CimInstance Win32_Process -ErrorAction Stop', `@([pscustomobject]@{ProcessId=1234;ParentProcessId=77;CreationDate=[DateTime]::new(${identity.creation},[DateTimeKind]::Utc)},[pscustomobject]@{ProcessId=2345;ParentProcessId=1234;CreationDate=[DateTime]::new(${receipt[1].creation},[DateTimeKind]::Utc)})`);
  expect(replacements).toBe(5); expect(generated).not.toContain('DllImport'); expect(generated).not.toContain('Get-CimInstance');
  const output = jest.requireActual('child_process').execFileSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(generated, 'utf16le').toString('base64')], { windowsHide: true, timeout: 8000, maxBuffer: 65536, encoding: 'utf8' }) as string;
  const lines = output.trim().split(/\r?\n/);
  expect(lines).toContain('attempted');
  const diagnostics = JSON.parse(lines.find(line => line.startsWith('diagnostic:'))!.slice(11));
  if (mode === 'race') { expect(lines).toContain('stopped'); expect(diagnostics.every((row: { wait: number }) => row.wait === 0)).toBe(true); expect(diagnostics).toContainEqual(expect.objectContaining({ request: -1, requestError: 5, wait: 0 })); }
  else { expect(lines).toContain('uncertain'); expect(lines).not.toContain('stopped'); expect(diagnostics.every((row: { wait: number }) => row.wait === (mode === 'failed-wait' ? 0xffffffff : 258))).toBe(true); }
}, 12_000);
