import * as path from 'path';
import { createWorkspaceProcessGate, type WorkspaceProcessGate } from './workspace-process-gate';

/** Terminal-only console-subsystem bootstrap. No approved program runs before GO. */
export function createWorkspaceTerminalGate(env: NodeJS.ProcessEnv): WorkspaceProcessGate {
  const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw new Error('The main Windows system directory is unavailable.');
  const mainTemp = process.env.TEMP || process.env.TMP;
  if (!mainTemp || !path.win32.isAbsolute(mainTemp)) throw new Error('The main isolated Windows temporary directory is unavailable.');
  const gate = createWorkspaceProcessGate(env);
  // Windows environment names are case insensitive. Clear every alias of
  // preload/bootstrap fields before supplying the one main-owned value.
  const bootstrapEnv: NodeJS.ProcessEnv = {};
  for (const key of Object.keys(gate.env).sort()) {
    if (/^(node_options|electron_run_as_node|homebot_ide_gate_pipe|homebot_ide_gate_cap|temp|tmp|tmpdir)$/i.test(key)) continue;
    if (!Object.keys(bootstrapEnv).some(existing => existing.toLowerCase() === key.toLowerCase())) bootstrapEnv[key] = gate.env[key];
  }
  Object.assign(bootstrapEnv, { TEMP: mainTemp, TMP: mainTemp, NODE_OPTIONS: '', HOMEBOT_IDE_GATE_PIPE: gate.pipeName, HOMEBOT_IDE_GATE_CAP: gate.capability });
  const executable = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(WORKSPACE_TERMINAL_GATE_SOURCE, 'utf16le').toString('base64')];
  // Fixed flags/base64 contain no whitespace or quotes. Account for the quoted
  // executable, separators and terminating NUL in CreateProcess' 32767 bound.
  if (executable.length + 2 + args.reduce((size, arg) => size + arg.length + 1, 0) + 1 > 32767) throw new Error('The fixed terminal bootstrap exceeds the Windows command-line limit.');
  return {
    ...gate, executable, args,
    env: bootstrapEnv,
  };
}

// Fixed code only: neither source nor argv contains the bearer capability,
// requested executable, environment, cwd, or profile arguments.
export const WORKSPACE_TERMINAL_GATE_CSHARP = String.raw`
using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

public static class HomebotTerminalGate {
  private delegate bool CtrlHandler(uint kind);
  private static readonly CtrlHandler ctrlHandler = HandleCtrl;
  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetConsoleCtrlHandler(CtrlHandler handler, bool add);
  private static bool HandleCtrl(uint kind) { return kind == 0 || kind == 1; }

  public static bool ValidCapability(string pipeName, string capability) {
    return System.Text.RegularExpressions.Regex.IsMatch(pipeName ?? "", @"^hbi-[a-f0-9-]{36}$")
      && System.Text.RegularExpressions.Regex.IsMatch(capability ?? "", @"^[a-f0-9]{64}$");
  }

  private static string ReadLine(StreamReader reader, int limit, Stopwatch clock) {
    var text = new StringBuilder(); var one = new char[1];
    while (true) {
      int remaining = 10000 - (int)clock.ElapsedMilliseconds;
      if (remaining <= 0) throw new TimeoutException();
      var read = reader.ReadAsync(one, 0, 1);
      if (!read.Wait(remaining)) throw new TimeoutException();
      if (read.Result != 1) throw new EndOfStreamException();
      if (one[0] == '\n') {
        if (text.Length > 0 && text[text.Length - 1] == '\r') text.Length--;
        return text.ToString();
      }
      if (text.Length >= limit) throw new InvalidDataException();
      text.Append(one[0]);
    }
  }

  // CommandLineToArgv/CRT quoting, including empty arguments and trailing
  // backslashes. Never pass JSON through PowerShell's native-command pipeline.
  public static string QuoteArg(string arg) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in arg) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append('"'); }
      else { result.Append('\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }

  private static bool PrivateEnv(string name) {
    return String.Equals(name, "HOMEBOT_IDE_GATE_PIPE", StringComparison.OrdinalIgnoreCase)
      || String.Equals(name, "HOMEBOT_IDE_GATE_CAP", StringComparison.OrdinalIgnoreCase);
  }
  private static bool AbsolutePath(string value) {
    return !String.IsNullOrEmpty(value) && value.IndexOf('\0') < 0
      && (value.StartsWith(@"\\", StringComparison.Ordinal)
        || (value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':' && (value[2] == '\\' || value[2] == '/')));
  }

  // Pure parsing/snapshot conversion: no process, console or pipe is opened.
  public static ProcessStartInfo BuildStartInfo(string line) {
    if (line == null || line.Length > 131072) throw new InvalidDataException();
    var serializer = new JavaScriptSerializer { MaxJsonLength = 131072, RecursionLimit = 16 };
    var launch = serializer.DeserializeObject(line) as Dictionary<string, object>;
    object executable, rawArgs, rawEnv, cwd, console;
    if (launch == null || !launch.TryGetValue("executable", out executable) || !(executable is string) || !AbsolutePath((string)executable)
      || !launch.TryGetValue("args", out rawArgs) || !(rawArgs is object[])
      || !launch.TryGetValue("env", out rawEnv) || !(rawEnv is Dictionary<string, object>)
      || !launch.TryGetValue("cwd", out cwd) || !(cwd is string) || !AbsolutePath((string)cwd)
      || !launch.TryGetValue("console", out console) || !String.Equals(console as string, "attached", StringComparison.Ordinal)
      || launch.ContainsKey("kind") || launch.ContainsKey("adapter")) throw new InvalidDataException();
    var arguments = new List<string>();
    foreach (object arg in (object[])rawArgs) {
      if (!(arg is string) || ((string)arg).IndexOf('\0') >= 0) throw new InvalidDataException();
      arguments.Add(QuoteArg((string)arg));
    }
    var info = new ProcessStartInfo {
      FileName = (string)executable, Arguments = String.Join(" ", arguments.ToArray()), WorkingDirectory = (string)cwd,
      UseShellExecute = false, CreateNoWindow = false,
      RedirectStandardInput = false, RedirectStandardOutput = false, RedirectStandardError = false
    };
    info.EnvironmentVariables.Clear();
    var env = (Dictionary<string, object>)rawEnv;
    var names = new List<string>(env.Keys); names.Sort(StringComparer.Ordinal);
    var selected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    foreach (string name in names) {
      if (PrivateEnv(name) || !selected.Add(name)) continue;
      if (name.Length == 0 || name.IndexOf('=') >= 0 || name.IndexOf('\0') >= 0) throw new InvalidDataException();
      object value = env[name]; if (value == null) continue;
      if (!(value is string) || ((string)value).IndexOf('\0') >= 0) throw new InvalidDataException();
      info.EnvironmentVariables[name] = (string)value;
    }
    return info;
  }
  private static string ErrorCode(Exception error) {
    var native = error as Win32Exception;
    if (native == null) return "UNKNOWN";
    switch (native.NativeErrorCode) {
      case 2: case 3: return "ENOENT";
      case 5: return "EACCES";
      case 6: return "EBADF";
      case 87: return "EINVAL";
      default: return "UNKNOWN";
    }
  }

  public static int Run(string pipeName, string capability) {
    if (!ValidCapability(pipeName, capability)) return 125;
    var clock = Stopwatch.StartNew();
    // Only this fixed bootstrap exits on its existing admission deadline.
    using (var deadline = new Timer(_ => Environment.Exit(125), null, 10000, Timeout.Infinite))
    using (var pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous,
      System.Security.Principal.TokenImpersonationLevel.None, HandleInheritability.None)) {
      Process child = null; StreamWriter writer = null; bool accepted = false;
      try {
        pipe.Connect(10000);
        var encoding = new UTF8Encoding(false, true);
        using (var reader = new StreamReader(pipe, encoding, false, 1024, true))
        using (writer = new StreamWriter(pipe, encoding, 1024, true)) {
          writer.NewLine = "\n"; writer.AutoFlush = true; writer.WriteLine(capability);
          var info = BuildStartInfo(ReadLine(reader, 131072, clock));
          // Non-null handler is local to this bootstrap. Do not use the
          // inheritable NULL/TRUE ignore flag or CREATE_NEW_PROCESS_GROUP.
          if (!SetConsoleCtrlHandler(ctrlHandler, true)) {
            writer.WriteLine("{\"type\":\"launch-error\",\"stage\":\"console-input\",\"code\":\"UNKNOWN\"}"); return 126;
          }
          try { child = Process.Start(info); }
          catch (Exception error) {
            writer.WriteLine("{\"type\":\"launch-error\",\"stage\":\"spawn\",\"code\":\"" + ErrorCode(error) + "\"}"); return 126;
          }
          if (child == null || child.Id <= 0) return 126;
          writer.WriteLine("{\"type\":\"spawn\",\"pid\":" + child.Id.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}");
          if (!String.Equals(ReadLine(reader, 4096, clock), "accepted", StringComparison.Ordinal)) return 125;
          accepted = true; deadline.Change(Timeout.Infinite, Timeout.Infinite);
        }
        pipe.Dispose(); child.WaitForExit(); return child.ExitCode;
      } catch (Exception error) {
        if (!accepted && writer != null) {
          try { writer.WriteLine("{\"type\":\"launch-error\",\"stage\":\"spawn\",\"code\":\"" + ErrorCode(error) + "\"}"); } catch { }
        }
        return accepted ? 1 : 126;
      } finally { if (child != null) child.Dispose(); }
    }
  }
}
`;

export const WORKSPACE_TERMINAL_GATE_SOURCE = String.raw`
$ErrorActionPreference = 'Stop'
$PSModuleAutoLoadingPreference = 'None'
$pipeName = [Environment]::GetEnvironmentVariable('HOMEBOT_IDE_GATE_PIPE')
$capability = [Environment]::GetEnvironmentVariable('HOMEBOT_IDE_GATE_CAP')
[Environment]::SetEnvironmentVariable('HOMEBOT_IDE_GATE_PIPE', $null)
[Environment]::SetEnvironmentVariable('HOMEBOT_IDE_GATE_CAP', $null)
if ($pipeName -cnotmatch '^hbi-[a-f0-9-]{36}$' -or $capability -cnotmatch '^[a-f0-9]{64}$') { exit 125 }
$manifest = [IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Utility', 'Microsoft.PowerShell.Utility.psd1')
if (-not [IO.File]::Exists($manifest)) { exit 125 }
Microsoft.PowerShell.Core\Import-Module -Name $manifest -ErrorAction Stop
$framework = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
if (-not [IO.Path]::IsPathRooted($framework)) { exit 125 }
$references = @([IO.Path]::Combine($framework, 'System.dll'), [IO.Path]::Combine($framework, 'System.Core.dll'), [IO.Path]::Combine($framework, 'System.Web.Extensions.dll'))
foreach ($reference in $references) { if (-not [IO.File]::Exists($reference)) { exit 125 } }
$source = @'
${WORKSPACE_TERMINAL_GATE_CSHARP}
'@
try {
  Microsoft.PowerShell.Utility\Add-Type -TypeDefinition $source -ReferencedAssemblies $references -ErrorAction Stop
  $result = [HomebotTerminalGate]::Run($pipeName, $capability)
  exit $result
} catch { exit 125 }
`;
