import * as path from 'path';
import { execFileSync } from 'child_process';
import { createWorkspaceTerminalGate, WORKSPACE_TERMINAL_GATE_CSHARP, WORKSPACE_TERMINAL_GATE_SOURCE } from '../workspace-terminal-gate';
import { createWorkspaceProcessGate } from '../workspace-process-gate';

test('terminal uses a fixed system console executable without request data in argv', () => {
  const previous = process.env.SystemRoot, previousTemp = process.env.TEMP;
  try {
    process.env.SystemRoot = 'C:\\Trusted Windows';
    process.env.TEMP = 'C:\\Owned Private Temp';
    const gate = createWorkspaceTerminalGate({ SystemRoot: 'D:\\project-impostor', TEMP: 'D:\\project-compiler-output', tmp: 'D:\\project-compiler-output', NODE_OPTIONS: '--require project', node_options: 'another preload', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', PATH: 'first', Path: 'second', HOMEBOT_IDE_GATE_CAP: 'old', homebot_ide_gate_cap: 'old-alias' });
    expect(gate.executable).toBe('C:\\Trusted Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(gate.args.slice(0, 6)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand']);
    expect(Buffer.from(gate.args[6], 'base64').toString('utf16le')).toBe(WORKSPACE_TERMINAL_GATE_SOURCE);
    expect(gate.executable.length + 3 + gate.args.reduce((size, arg) => size + arg.length + 1, 0)).toBeLessThanOrEqual(32767);
    expect(JSON.stringify(gate.args)).not.toContain(gate.capability);
    expect(gate.env).toMatchObject({ TEMP: process.env.TEMP, TMP: process.env.TEMP, NODE_OPTIONS: '', PATH: 'first', HOMEBOT_IDE_GATE_PIPE: gate.pipeName, HOMEBOT_IDE_GATE_CAP: gate.capability });
    for (const key of ['tmp', 'node_options', 'ELECTRON_RUN_AS_NODE', 'electron_run_as_node', 'homebot_ide_gate_cap', 'Path']) expect(gate.env).not.toHaveProperty(key);
    const next = createWorkspaceTerminalGate({});
    expect(next.capability).not.toBe(gate.capability); expect(next.pipeName).not.toBe(gate.pipeName);
    expect(createWorkspaceProcessGate({}).executable).toBe(process.execPath);
  } finally {
    if (previous === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = previous;
    if (previousTemp === undefined) delete process.env.TEMP; else process.env.TEMP = previousTemp;
  }
});

test('terminal factory refuses a relative main system directory rather than searching PATH', () => {
  const root = process.env.SystemRoot, upper = process.env.SYSTEMROOT, temp = process.env.TEMP;
  try {
    process.env.SystemRoot = 'relative'; delete process.env.SYSTEMROOT;
    expect(() => createWorkspaceTerminalGate({ SystemRoot: 'C:\\requested' })).toThrow(/main Windows system directory/);
    process.env.SystemRoot = 'C:\\' + 'a'.repeat(32768);
    process.env.TEMP = 'C:\\Owned Private Temp';
    expect(() => createWorkspaceTerminalGate({})).toThrow(/command-line limit/);
  } finally {
    if (root === undefined) delete process.env.SystemRoot; else process.env.SystemRoot = root;
    if (upper === undefined) delete process.env.SYSTEMROOT; else process.env.SYSTEMROOT = upper;
    if (temp === undefined) delete process.env.TEMP; else process.env.TEMP = temp;
  }
});

test('immutable bootstrap preserves core-only setup and positive admission ordering', () => {
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain("$PSModuleAutoLoadingPreference = 'None'");
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain("[IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')");
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain('Microsoft.PowerShell.Core\\Import-Module -Name $manifest');
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain('Microsoft.PowerShell.Utility\\Add-Type');
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain('[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()');
  expect(WORKSPACE_TERMINAL_GATE_SOURCE).toContain('-ReferencedAssemblies $references');
  expect(WORKSPACE_TERMINAL_GATE_CSHARP).toContain('writer.NewLine = "\\n"');
  expect(WORKSPACE_TERMINAL_GATE_CSHARP).toContain('SetConsoleCtrlHandler(ctrlHandler, true)');
  expect(WORKSPACE_TERMINAL_GATE_CSHARP).toContain('System.Security.Principal.TokenImpersonationLevel.None, HandleInheritability.None');
  expect(WORKSPACE_TERMINAL_GATE_CSHARP).not.toMatch(/SetConsoleCtrlHandler\(null|Console\.Read|AllocConsole|Start-Process|CreateNoWindow = true/);
  const source = WORKSPACE_TERMINAL_GATE_CSHARP;
  expect(source.indexOf('BuildStartInfo(ReadLine(reader, 131072, clock))')).toBeLessThan(source.indexOf('child = Process.Start(info)'));
  expect(source.indexOf('child = Process.Start(info)')).toBeLessThan(source.indexOf('ReadLine(reader, 4096, clock)'));
  expect(source.indexOf('ReadLine(reader, 4096, clock)')).toBeLessThan(source.indexOf('child.WaitForExit()'));
  expect(source).toContain('accepted = true; deadline.Change(Timeout.Infinite, Timeout.Infinite)');
});

// Compiles the exact immutable managed helper, then calls only pure methods.
// No Run, P/Invoke, Job, console, pipe, target or process launch is performed.
export const TERMINAL_GATE_PURE_CONTROL = String.raw`
public static class HomebotTerminalPureControl {
  private sealed class OneByteStream : System.IO.MemoryStream {
    public OneByteStream(byte[] bytes) : base(bytes) { }
    public override int Read(byte[] bytes, int offset, int count) { return base.Read(bytes, offset, System.Math.Min(count,1)); }
    public override System.Threading.Tasks.Task<int> ReadAsync(byte[] bytes, int offset, int count, System.Threading.CancellationToken cancellation) {
      return System.Threading.Tasks.Task.FromResult(Read(bytes,offset,count));
    }
  }
  private static int count;
  private static void Check(bool value) { if (!value) throw new System.Exception("pure control failed:" + count); count++; }
  private static bool Reject(string text) {
    try { HomebotTerminalGate.BuildStartInfo(text); return false; } catch { return true; }
  }
  private static string Frame(string text, int limit) {
    return FrameBytes(new System.Text.UTF8Encoding(false).GetBytes(text), limit);
  }
  private static string FrameBytes(byte[] bytes, int limit) {
    var method = typeof(HomebotTerminalGate).GetMethod("ReadLine", System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
    using (var memory = new OneByteStream(bytes))
    using (var reader = new System.IO.StreamReader(memory, new System.Text.UTF8Encoding(false, true), false, 1)) {
      return (string)method.Invoke(null, new object[] {reader, limit, System.Diagnostics.Stopwatch.StartNew()});
    }
  }
  public static string CheckAll() {
    count = 0;
    Check(HomebotTerminalGate.QuoteArg("") == "\"\"");
    Check(HomebotTerminalGate.QuoteArg("a b") == "\"a b\"");
    Check(HomebotTerminalGate.QuoteArg("a\"b") == "\"a\\\"b\"");
    Check(HomebotTerminalGate.QuoteArg("a\\") == "\"a\\\\\"");
    Check(HomebotTerminalGate.QuoteArg("a\\\"b") == "\"a\\\\\\\"b\"");
    Check(HomebotTerminalGate.QuoteArg("日本語 tū") == "\"日本語 tū\"");
    string capability = new string('a',64), pipe = "hbi-00000000-0000-0000-0000-000000000001";
    Check(HomebotTerminalGate.ValidCapability(pipe, capability));
    Check(!HomebotTerminalGate.ValidCapability(pipe, capability + "x"));
    Check(!HomebotTerminalGate.ValidCapability(pipe + "x", capability));
    Check(!HomebotTerminalGate.ValidCapability(pipe, capability.ToUpperInvariant()));
    Check(Frame("accepted\r\n",4096) == "accepted");
    Check(Frame("日本語 tū\n",4096) == "日本語 tū");
    Check(Frame("a\nb\n",4096) == "a");
    using (var memory = new System.IO.MemoryStream()) {
      using (var writer = new System.IO.StreamWriter(memory,new System.Text.UTF8Encoding(false),1024,true)) {
        writer.NewLine = "\n"; writer.WriteLine("accepted");
      }
      Check(System.BitConverter.ToString(memory.ToArray()) == "61-63-63-65-70-74-65-64-0A");
    }
    try { Frame(new string('x',4097) + "\n",4096); throw new System.Exception("oversize accepted"); }
    catch (System.Reflection.TargetInvocationException) { count++; }
    try { FrameBytes(new byte[]{255,10},4096); throw new System.Exception("invalid UTF8 accepted"); }
    catch (System.Reflection.TargetInvocationException) { count++; }
    try { Frame("unterminated",4096); throw new System.Exception("EOF accepted"); }
    catch (System.Reflection.TargetInvocationException) { count++; }
    var serializer = new System.Web.Script.Serialization.JavaScriptSerializer();
    var env = new System.Collections.Generic.Dictionary<string,object> {
      {"PATH","first"}, {"Path","second"}, {"CANARY","日本語 tū"},
      {"HOMEBOT_IDE_GATE_CAP","private"}, {"homebot_ide_gate_pipe","private"}, {"OMITTED",null}
    };
    var launch = new System.Collections.Generic.Dictionary<string,object> {
      {"executable",@"C:\Windows\System32\cmd.exe"}, {"args",new string[]{"/D","a b",""}},
      {"env",env}, {"cwd",@"C:\Private Project"}, {"console","attached"}
    };
    var info = HomebotTerminalGate.BuildStartInfo(serializer.Serialize(launch));
    Check(info.FileName == (string)launch["executable"] && info.WorkingDirectory == (string)launch["cwd"]);
    Check(info.Arguments == "\"/D\" \"a b\" \"\"");
    Check(!info.UseShellExecute && !info.CreateNoWindow && !info.RedirectStandardInput && !info.RedirectStandardOutput && !info.RedirectStandardError);
    Check(info.EnvironmentVariables.Count == 2 && info.EnvironmentVariables["PATH"] == "first" && info.EnvironmentVariables["CANARY"] == "日本語 tū");
    foreach (string bad in new string[]{"relative","C:relative"}) {
      launch["cwd"] = bad; Check(Reject(serializer.Serialize(launch)));
    }
    launch["cwd"] = @"C:\Private Project";
    launch["kind"] = "task"; Check(Reject(serializer.Serialize(launch))); launch.Remove("kind");
    launch["adapter"] = new object(); Check(Reject(serializer.Serialize(launch))); launch.Remove("adapter");
    launch["console"] = "unknown"; Check(Reject(serializer.Serialize(launch))); launch["console"] = "attached";
    launch["args"] = new object[]{1}; Check(Reject(serializer.Serialize(launch))); launch["args"] = new string[]{};
    env["CANARY"] = 1; Check(Reject(serializer.Serialize(launch))); env["CANARY"] = "okay";
    Check(Reject("broken-json")); Check(Reject(new string('x',131073)));
    var ctrl = typeof(HomebotTerminalGate).GetMethod("HandleCtrl",System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
    foreach (uint kind in new uint[]{0,1,2,5,6}) Check((bool)ctrl.Invoke(null,new object[]{kind}) == (kind == 0 || kind == 1));
    return "{\"checks\":" + count + ",\"targetLaunch\":false,\"nativeApi\":false}";
  }
}
`;

export function terminalGatePureControlScript(): string {
  const code = Buffer.from(WORKSPACE_TERMINAL_GATE_CSHARP + '\n' + TERMINAL_GATE_PURE_CONTROL, 'utf8').toString('base64');
  return String.raw`
$ErrorActionPreference='Stop'
$PSModuleAutoLoadingPreference='None'
$manifest=[IO.Path]::Combine($PSHOME,'Modules','Microsoft.PowerShell.Utility','Microsoft.PowerShell.Utility.psd1')
if (-not [IO.File]::Exists($manifest)) { throw 'system manifest unavailable' }
Microsoft.PowerShell.Core\Import-Module -Name $manifest -ErrorAction Stop
$framework=[Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
if (-not [IO.Path]::IsPathRooted($framework)) { throw 'fixed runtime path unavailable' }
$references=@([IO.Path]::Combine($framework,'System.dll'),[IO.Path]::Combine($framework,'System.Core.dll'),[IO.Path]::Combine($framework,'System.Web.Extensions.dll'))
foreach ($reference in $references) { if (-not [IO.File]::Exists($reference)) { throw 'fixed framework assembly unavailable' } }
$source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${code}'))
Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $source -ReferencedAssemblies $references -ErrorAction Stop
[Console]::Out.WriteLine([HomebotTerminalPureControl]::CheckAll())
`;
}

const windowsTest = process.platform === 'win32' ? test : test.skip;
windowsTest('exact managed helper qualifies pure quoting, env, framing and refusal controls without launching a target', () => {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('The main system path is missing.');
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  // Pure test code uses piped script input to avoid double-base64 exceeding
  // Windows' argv limit. The production terminal gate never reads stdin.
  const result = execFileSync(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { input: terminalGatePureControlScript(), encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 64 * 1024, env: { ...process.env, NODE_OPTIONS: '' } });
  expect(JSON.parse(result.trim())).toEqual({ checks: 35, targetLaunch: false, nativeApi: false });
}, 20_000);
