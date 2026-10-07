'use strict';
// Execute the real managed attachment method with EVERY native API and pipe
// operation substituted. This never creates/assigns/stops a native Job or target.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
function managedControl(source) {
  const methods = {
    GetStdHandle: 'static IntPtr GetStdHandle(int kind) { throw new Exception("observer call forbidden"); }',
    GetFinalPathNameByHandleW: 'static uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder result,uint length,uint flags) { throw new Exception("observer call forbidden"); }',
    CreateJobObject: 'static IntPtr CreateJobObject(IntPtr attributes,string name) { return new IntPtr(201); }',
    SetInformationJobObject: 'static bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimit info,uint length) { return true; }',
    QueryInformationJobObject: 'static bool QueryInformationJobObject(IntPtr job,int type,out Accounting info,uint length,IntPtr returned) { info=new Accounting();return true; }',
    AssignProcessToJobObject: 'static bool AssignProcessToJobObject(IntPtr job,IntPtr process) { Fixture.Assign(process);return true; }',
    IsProcessInJob: 'static bool IsProcessInJob(IntPtr process,IntPtr job,out bool member) { member=Fixture.assignments==1;return true; }',
    TerminateJobObject: 'static bool TerminateJobObject(IntPtr job,uint code) { throw new Exception("real termination forbidden"); }',
    OpenProcess: 'static IntPtr OpenProcess(uint rights,bool inherit,int pid) { if(pid!=123||rights!=0x101101||inherit)throw new Exception("unexpected open");Fixture.opens++;return new IntPtr(501); }',
    GetProcessTimes: 'static bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user) { if(process!=new IntPtr(501))throw new Exception("changed held handle");Fixture.birthQueries++;created=Fixture.born+(Fixture.mode=="birth-changed"&&Fixture.challenged?1:0);exited=kernel=user=0;return Fixture.mode!="unknown-birth"; }',
    WaitForSingleObject: 'static uint WaitForSingleObject(IntPtr handle,uint ms) { if(handle!=new IntPtr(501)||ms!=0)throw new Exception("unexpected wait");return Fixture.mode=="dead"&&Fixture.challenged?0U:258U; }',
    CreateNamedPipe: 'static SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,uint output,uint input,uint timeout,IntPtr security) { return new SafePipeHandle(new IntPtr(1),false); }',
    GetNamedPipeClientProcessId: 'static bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid) { pid=Fixture.mode=="peer-changed"&&Fixture.challenged?999U:123U;return Fixture.mode!="missing-peer"; }',
    CreateToolhelp32Snapshot: 'static IntPtr CreateToolhelp32Snapshot(uint flags,uint pid) { if(flags!=2||pid!=0)throw new Exception("unexpected ancestry query");int handle=++Fixture.nextSnapshot;Fixture.snapshots.Add(handle);return new IntPtr(handle); }',
    Process32FirstW: 'static bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry) { entry.pid=(uint)Process.GetCurrentProcess().Id;entry.parent=Fixture.mode=="helper-parent"?88U:77U;return true; }',
    Process32NextW: 'static bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry) { if(entry.pid==123)return false;entry.pid=123;entry.parent=Fixture.mode=="wrong-parent"?88U:77U;return true; }',
    CloseHandle: 'static bool CloseHandle(IntPtr handle) { Fixture.Closed(handle.ToInt32());return true; }',
  };
  const replaced = [];
  source = source.replace(/\[DllImport\([^\r\n]+\)\] static extern ([^;]+);/g, (_text, declaration) => {
    const name = /\s(\w+)\(/.exec(declaration)?.[1];
    assert(methods[name], 'Every native method must have an explicit substitute'); replaced.push(name); return methods[name];
  });
  assert.deepEqual([...replaced].sort(), Object.keys(methods).sort());
  assert(!source.includes('DllImport') && !source.includes('static extern'));
  source = source.replace('static NamedPipeServerStream pipe;', 'static FakePipe pipe;').replace('new NamedPipeServerStream(', 'new FakePipe(');
  const peer = / static string ReadPeerLine\(\) \{[^\r\n]+\}\r?\n/;
  assert(peer.test(source)); source = source.replace(peer, ' static string ReadPeerLine() { return Fixture.Read(pipe); }\n');
  assert(!source.includes('reader.ReadLineAsync()') && !source.includes('new NamedPipeServerStream('));
  return source + `
public sealed class FakePipe : MemoryStream {
 public SafePipeHandle SafePipeHandle {get;private set;}
 public FakePipe(PipeDirection direction,bool async,bool connected,SafePipeHandle handle) {SafePipeHandle=handle;}
 public IAsyncResult BeginWaitForConnection(AsyncCallback callback,object state) {return System.Threading.Tasks.Task.FromResult(0);}
 public void EndWaitForConnection(IAsyncResult result) {}
}
public static class Fixture {
 public static string mode;public static int opens,assignments,birthQueries,nextSnapshot,reads;public static bool challenged;
 public const long born=132000000000000000L;
 public static System.Collections.Generic.List<int> snapshots=new System.Collections.Generic.List<int>();
 public static System.Collections.Generic.Dictionary<int,int> closed=new System.Collections.Generic.Dictionary<int,int>();
 public static void Closed(int handle) {int n;closed.TryGetValue(handle,out n);closed[handle]=n+1;}
 public static void Assign(IntPtr handle) {if(handle!=new IntPtr(501)||opens!=1||reads!=2||!challenged||birthQueries<3)throw new Exception("assignment before live challenge");assignments++;}
 public static string Read(FakePipe pipe) {
  reads++;if(reads==1)return mode=="capability"?"wrong":"synthetic-control-capability";
  if(reads!=2||opens!=1)throw new Exception("unexpected peer read");
  var packet=(System.Collections.Generic.IDictionary<string,object>)OwnedWindowsJob.ParseFrame(Encoding.UTF8.GetString(pipe.ToArray()).Trim());
  if((string)packet["type"]!="identity-challenge"||!System.Text.RegularExpressions.Regex.IsMatch((string)packet["challenge"],"^[a-f0-9]{64}$"))throw new Exception("bad fresh challenge");
  challenged=true;if(mode=="missing-response")return null;
  var response=new System.Collections.Generic.Dictionary<string,object>{{"type","identity-response"},{"challenge",mode=="stale-challenge"?new string('0',64):packet["challenge"]},{"capability","synthetic-control-capability"}};
  if(mode=="extra-response")response["extra"]=true;return OwnedWindowsJob.EncodeFrame(response);
 }
 public static string Run() {
  string[] cases={"valid","missing-peer","stale-challenge","wrong-parent","helper-parent","dead","birth-changed","peer-changed","unknown-birth","capability","extra-response","missing-response"};
  var passed=new System.Collections.Generic.List<string>();
  foreach(string current in cases) {
   mode=current;opens=assignments=birthQueries=reads=0;nextSnapshot=300;challenged=false;snapshots.Clear();closed.Clear();
   bool accepted=false;try {OwnedWindowsJob.Create();OwnedWindowsJob.Listen("synthetic");var response=(System.Collections.Generic.IDictionary<string,object>)OwnedWindowsJob.ParseFrame(OwnedWindowsJob.AttachChild(123,77,"synthetic-control-capability"));if((int)response["parent"]!=77||(string)response["creation"]!=DateTime.FromFileTimeUtc(born).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture))throw new Exception("result identity");accepted=true;}catch {if(current=="valid")throw;}finally{OwnedWindowsJob.Close();}
   if(accepted!=(current=="valid")||assignments!=(current=="valid"?1:0))throw new Exception("admission control "+current);
   if(opens==1&&(!closed.ContainsKey(501)||closed[501]!=1))throw new Exception("held handle not closed exactly once");
   foreach(int snapshot in snapshots)if(!closed.ContainsKey(snapshot)||closed[snapshot]!=1)throw new Exception("snapshot not closed exactly once");
   passed.Add(current);
  }
  return OwnedWindowsJob.EncodeFrame(passed);
 }
}
`;
}
test('task attachment controls replace all native APIs and every real peer read', () => {
  const source = fs.readFileSync(path.join(root, 'widget/native/OwnedWindowsJob.cs'), 'utf8');
  const controlled = managedControl(source);
  assert(!controlled.includes('DllImport') && !controlled.includes('reader.ReadLineAsync()'));
  assert(controlled.includes('OwnedWindowsJob.AttachChild(123,77,'));
  assert(controlled.includes('assignment before live challenge') && controlled.includes('held handle not closed exactly once'));
});
test('same-handle task attachment rejects stale, foreign, dead and malformed peers with native APIs mocked', { skip: process.platform !== 'win32', timeout: 25000 }, () => {
  const { compilerInputs } = require('../prepare-windows-job.cjs');
  const inputs = compilerInputs(process.env.SystemRoot || process.env.SYSTEMROOT);
  const proofRoot = path.join(root, 'artifacts/ide-native-zero-retry'); fs.mkdirSync(proofRoot, { recursive: true });
  const out = fs.mkdtempSync(path.join(proofRoot, 'task-attachment-controls-'));
  const sourcePath = path.join(root, 'widget/native/OwnedWindowsJob.cs'), original = fs.readFileSync(sourcePath, 'utf8'), control = managedControl(original);
  const source = path.join(out, 'controls.cs'), assembly = path.join(out, 'controls.dll'); fs.writeFileSync(source, control, { flag: 'wx' });
  const safe = (result, elapsedMs) => ({ elapsedMs, status: result.status, signal: result.signal || null,
    errorCode: result.error?.code || null, stdout: String(result.stdout || '').slice(-4096), stderr: String(result.stderr || '').slice(-4096) });
  let started = Date.now();
  const compiled = cp.spawnSync(inputs.compiler, ['/nologo', '/noconfig', '/nostdlib+', '/target:library', '/out:' + assembly,
    ...inputs.references.map(file => '/reference:' + file), source], { cwd: inputs.framework, env: { SystemRoot: process.env.SystemRoot, TEMP: out, TMP: out }, windowsHide: true, timeout: 5000, maxBuffer: 32768, encoding: 'utf8' });
  const compile = safe(compiled, Date.now() - started); fs.writeFileSync(path.join(out, 'compile.json'), JSON.stringify(compile));
  assert(!compiled.error && compiled.status === 0 && !compiled.signal, JSON.stringify(compile));
  const invocation = "[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes('" + assembly.replace(/'/g, "''") + "'));[Console]::Out.WriteLine([Fixture]::Run())";
  started = Date.now();
  const run = cp.spawnSync(path.win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', Buffer.from(invocation, 'utf16le').toString('base64')], { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 32768 });
  const result = safe(run, Date.now() - started); fs.writeFileSync(path.join(out, 'run.json'), JSON.stringify(result));
  assert(!run.error && run.status === 0 && !run.signal, JSON.stringify(result));
  const checks = JSON.parse(run.stdout.trim()); assert.equal(checks.length, 12); assert.equal(new Set(checks).size, 12);
  fs.writeFileSync(path.join(out, 'proof.json'), JSON.stringify({ sourceSha256: crypto.createHash('sha256').update(original).digest('hex'), controlSha256: crypto.createHash('sha256').update(control).digest('hex'), checks,
    scope: 'Actual managed AttachChild with every native API/peer read substituted, no real Job, target or process identity. Real Windows task/native acceptance remains separate.' }, null, 2));
});
module.exports = { managedControl };
