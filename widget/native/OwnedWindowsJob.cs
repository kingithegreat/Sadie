using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Threading; using System.IO; using System.IO.Pipes; using System.Text; using Microsoft.Win32.SafeHandles;
// Independent read-only observer. Loading/calling it never creates a Job or pipe.
public static class HomeBotOpenedFiles {
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr GetStdHandle(int kind);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern uint GetFinalPathNameByHandleW(IntPtr handle,StringBuilder result,uint length,uint flags);
 static string Query(int kind) {
  IntPtr handle=GetStdHandle(kind);
  if(handle==IntPtr.Zero || handle==new IntPtr(-1)) throw new Exception("handle");
  var result=new StringBuilder(32768);
  uint length=GetFinalPathNameByHandleW(handle,result,32768,0);
  if(length==0 || length>=32768) throw new Exception("path");
  return Convert.ToBase64String(Encoding.UTF8.GetBytes(result.ToString()));
 }
 public static void Emit() {
  string first=Query(-10),second=Query(-11);
  Console.Error.Write("HBI_OPENED_1\n"+first+"\n"+second+"\n");
 }
}
public static class OwnedWindowsJob {
 // Fixed framework serializer only; no type resolver or request-selected assembly.
 static System.Web.Script.Serialization.JavaScriptSerializer Json() { return new System.Web.Script.Serialization.JavaScriptSerializer { MaxJsonLength=131072,RecursionLimit=16 }; }
 public static object ParseFrame(string line) {
  if(line==null||line.Length>131072) throw new Exception("input");
  var value=Json().DeserializeObject(line); if(!(value is System.Collections.Generic.IDictionary<string,object>)) throw new Exception("input"); ValidateFrame(value,0); return value;
 }
 static void ValidateFrame(object value,int depth) {
  if(depth>16) throw new Exception("input");
  var map=value as System.Collections.Generic.IDictionary<string,object>;
  if(map!=null) { foreach(var pair in map) { if(pair.Key=="__type"||pair.Key=="__proto__"||pair.Key=="constructor"||pair.Key=="prototype") throw new Exception("input"); ValidateFrame(pair.Value,depth+1); } return; }
  var array=value as object[]; if(array!=null) foreach(var item in array) ValidateFrame(item,depth+1);
 }
 public static string EncodeFrame(object value) { return Json().Serialize(value); }
 [StructLayout(LayoutKind.Sequential)] struct BasicLimit { public long PerProcess,PerJob; public uint Flags; public UIntPtr MinWorking,MaxWorking; public uint ActiveLimit; public UIntPtr Affinity; public uint Priority,Scheduling; }
 [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
 [StructLayout(LayoutKind.Sequential)] struct ExtendedLimit { public BasicLimit Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob; }
 [StructLayout(LayoutKind.Sequential)] struct Accounting { public long User,Kernel,PeriodUser,PeriodKernel; public uint Faults,Total,Active,Terminated; }
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref ExtendedLimit info,uint length);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job,int type,out Accounting info,uint length,IntPtr returned);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool IsProcessInJob(IntPtr process,IntPtr job,out bool member);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint rights,bool inherit,int pid);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint ms);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode)] static extern SafePipeHandle CreateNamedPipe(string name,uint access,uint mode,uint instances,uint output,uint input,uint timeout,IntPtr security);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct ProcessEntry { public uint size,usage,pid; public UIntPtr heap; public uint module,threads,parent; public int priority; public uint flags; [MarshalAs(UnmanagedType.ByValTStr,SizeConst=260)] public string executable; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags,uint pid);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] static extern bool Process32FirstW(IntPtr snapshot,ref ProcessEntry entry);
 [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] static extern bool Process32NextW(IntPtr snapshot,ref ProcessEntry entry);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job=IntPtr.Zero,root=IntPtr.Zero; static int rootPid; static NamedPipeServerStream pipe;
 static StreamReader reader; static StreamWriter writer;
 public static void Create() { job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Exception("create"); var limits=new ExtendedLimit(); limits.Basic.Flags=0x2000; if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("limits"); }
 public static void Listen(string name) { var handle=CreateNamedPipe(@"\\.\pipe\"+name,0x40080003,8,1,4096,4096,0,IntPtr.Zero); if(handle.IsInvalid) { handle.Dispose(); throw new Exception("pipe"); } pipe=new NamedPipeServerStream(PipeDirection.InOut,true,false,handle); }
 static void RequireRoot() { bool member; if(root==IntPtr.Zero||WaitForSingleObject(root,0)!=258||!IsProcessInJob(root,job,out member)||!member) throw new Exception("root"); }
 public static void Attach(int pid,long expected,string capability) { root=OpenProcess(0x101101,false,pid); if(root==IntPtr.Zero) throw new Exception("open"); long born,exited,kernel,user; if(!GetProcessTimes(root,out born,out exited,out kernel,out user) || DateTime.FromFileTimeUtc(born).Ticks/10!=expected/10 || WaitForSingleObject(root,0)!=258) throw new Exception("identity"); if(!AssignProcessToJobObject(job,root)) throw new Exception("assign"); rootPid=pid; RequireRoot(); if(pipe!=null) { var connection=pipe.BeginWaitForConnection(null,null); if(!connection.AsyncWaitHandle.WaitOne(3500)) throw new Exception("peer-timeout"); pipe.EndWaitForConnection(connection); connection.AsyncWaitHandle.Close(); uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)pid) throw new Exception("peer"); reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true); writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true); writer.NewLine="\n"; writer.AutoFlush=true; var hello=ReadPeerLine(); if(hello!=capability) throw new Exception("capability"); RequireRoot(); } else { CloseHandle(root); root=IntPtr.Zero; } }
 // This is ONLY for a main-owned fixed core bootstrap waiting before GO.
 // A PID/old buffered hello alone cannot establish the held handle's birth.
 static int DirectParent(int pid) {
  var snapshot=CreateToolhelp32Snapshot(2,0); if(snapshot==new IntPtr(-1)||snapshot==IntPtr.Zero) throw new Exception("identity");
  try { var row=new ProcessEntry();row.size=(uint)Marshal.SizeOf(typeof(ProcessEntry));
   if(!Process32FirstW(snapshot,ref row)) throw new Exception("identity");
   int count=0; do { if(++count>65536) throw new Exception("identity"); if(row.pid==(uint)pid) { if(row.parent==0||row.parent>Int32.MaxValue) throw new Exception("identity"); return (int)row.parent; } } while(Process32NextW(snapshot,ref row));
   throw new Exception("identity");
  } finally { CloseHandle(snapshot); }
 }
 static long HeldBirth() { long born,exited,kernel,user; if(root==IntPtr.Zero||!GetProcessTimes(root,out born,out exited,out kernel,out user)||born<=0||WaitForSingleObject(root,0)!=258) throw new Exception("identity");return born; }
 static void SamePeer(int pid) { uint peer;if(pipe==null||!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)pid) throw new Exception("peer"); }
 public static string AttachChild(int pid,int parent,string capability) {
  if(pipe==null||parent<=0||DirectParent(Process.GetCurrentProcess().Id)!=parent) throw new Exception("identity");
  root=OpenProcess(0x101101,false,pid);if(root==IntPtr.Zero) throw new Exception("open");
  long born=HeldBirth();if(DirectParent(pid)!=parent) throw new Exception("identity");
  var connection=pipe.BeginWaitForConnection(null,null);
  try { if(!connection.AsyncWaitHandle.WaitOne(3500)) throw new Exception("peer-timeout");pipe.EndWaitForConnection(connection); }
  finally { connection.AsyncWaitHandle.Close(); }
  SamePeer(pid);
  reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true);
  writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true);writer.NewLine="\n";writer.AutoFlush=true;
  if(ReadPeerLine()!=capability) throw new Exception("capability");
  SamePeer(pid);if(HeldBirth()!=born||DirectParent(pid)!=parent) throw new Exception("identity");
  // Generate AFTER opening the held candidate. Only the still-live ORIGINAL
  // pipe client can answer this new challenge; an old hello is insufficient.
  var bytes=new byte[32];using(var random=System.Security.Cryptography.RandomNumberGenerator.Create()) random.GetBytes(bytes);
  string challenge=BitConverter.ToString(bytes).Replace("-","").ToLowerInvariant();
  writer.WriteLine(EncodeFrame(new {type="identity-challenge",challenge=challenge}));
  var response=ParseFrame(ReadPeerLine()) as System.Collections.Generic.IDictionary<string,object>;
  if(response==null||response.Count!=3||!response.ContainsKey("type")||!response.ContainsKey("challenge")||!response.ContainsKey("capability")||!(response["type"] is string)||!(response["challenge"] is string)||!(response["capability"] is string)||(string)response["type"]!="identity-response"||(string)response["challenge"]!=challenge||(string)response["capability"]!=capability) throw new Exception("peer");
  SamePeer(pid);if(HeldBirth()!=born||DirectParent(pid)!=parent||DirectParent(Process.GetCurrentProcess().Id)!=parent) throw new Exception("identity");
  if(!AssignProcessToJobObject(job,root)) throw new Exception("assign");rootPid=pid;RequireRoot();
  if(HeldBirth()!=born) throw new Exception("identity");
  return EncodeFrame(new {creation=DateTime.FromFileTimeUtc(born).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture),parent=parent});
 }
 static string ReadPeerLine() { var result=reader.ReadLineAsync(); if(!result.Wait(3500)) throw new Exception("peer-read-timeout"); string value=result.Result; if(value==null||value.Length>4096) throw new Exception("peer-input"); return value; }
 static Accounting Account() { Accounting info; if(job==IntPtr.Zero||!QueryInformationJobObject(job,1,out info,(uint)Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)) throw new Exception("query"); return info; }
 public static string Go(string launch) { RequireRoot(); uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)rootPid) throw new Exception("peer"); if(Account().Total!=1) throw new Exception("baseline"); writer.WriteLine(launch); return ReadPeerLine(); }
 // 0 positively absent; 1 same Job member; -1 unknown/live nonmember.
 public static int VerifyChild(int pid) { IntPtr child=OpenProcess(0x1000,false,pid); if(child==IntPtr.Zero) { int error=Marshal.GetLastWin32Error(); return error==87||error==1168?0:-1; } try { bool member; return IsProcessInJob(child,job,out member)&&member?1:-1; } finally { CloseHandle(child); } }
 public static string ReadCompletion() { RequireRoot(); return ReadPeerLine(); }
 public static bool CompletedTarget() { RequireRoot(); return Account().Total>=2; }
 public static void Accept() { RequireRoot(); writer.WriteLine("accepted"); }
 public static void ReleaseGate() { if(pipe!=null) { pipe.Dispose();pipe=null; } if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } }
 public static bool Empty() { return Account().Active==0; }
 public static bool Stop() { if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } if(!Empty() && !TerminateJobObject(job,1)) { if(!Empty()) return false; } var elapsed=Stopwatch.StartNew(); while(!Empty()&&elapsed.ElapsedMilliseconds<1200) Thread.Sleep(20); return Empty(); }
 public static void Close() { if(pipe!=null) pipe.Dispose(); if(root!=IntPtr.Zero) { CloseHandle(root);root=IntPtr.Zero; } if(job!=IntPtr.Zero) { CloseHandle(job);job=IntPtr.Zero; } }
}
