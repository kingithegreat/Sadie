using System; using System.Runtime.InteropServices; using System.Diagnostics; using System.Threading; using System.IO; using System.IO.Pipes; using System.Text; using Microsoft.Win32.SafeHandles;
public static class OwnedWindowsJob {
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
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static IntPtr job=IntPtr.Zero,root=IntPtr.Zero; static int rootPid; static NamedPipeServerStream pipe;
 static StreamReader reader; static StreamWriter writer;
 public static void Create() { job=CreateJobObject(IntPtr.Zero,null); if(job==IntPtr.Zero) throw new Exception("create"); var limits=new ExtendedLimit(); limits.Basic.Flags=0x2000; if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(ExtendedLimit)))) throw new Exception("limits"); }
 public static void Listen(string name) { var handle=CreateNamedPipe(@"\\.\pipe\"+name,0x40080003,8,1,4096,4096,0,IntPtr.Zero); if(handle.IsInvalid) { handle.Dispose(); throw new Exception("pipe"); } pipe=new NamedPipeServerStream(PipeDirection.InOut,true,false,handle); }
 static void RequireRoot() { bool member; if(root==IntPtr.Zero||WaitForSingleObject(root,0)!=258||!IsProcessInJob(root,job,out member)||!member) throw new Exception("root"); }
 public static void Attach(int pid,long expected,string capability) { root=OpenProcess(0x101101,false,pid); if(root==IntPtr.Zero) throw new Exception("open"); long born,exited,kernel,user; if(!GetProcessTimes(root,out born,out exited,out kernel,out user) || DateTime.FromFileTimeUtc(born).Ticks/10!=expected/10 || WaitForSingleObject(root,0)!=258) throw new Exception("identity"); if(!AssignProcessToJobObject(job,root)) throw new Exception("assign"); rootPid=pid; RequireRoot(); if(pipe!=null) { var connection=pipe.BeginWaitForConnection(null,null); if(!connection.AsyncWaitHandle.WaitOne(3500)) throw new Exception("peer-timeout"); pipe.EndWaitForConnection(connection); connection.AsyncWaitHandle.Close(); uint peer; if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out peer)||peer!=(uint)pid) throw new Exception("peer"); reader=new StreamReader(pipe,new UTF8Encoding(false),false,4096,true); writer=new StreamWriter(pipe,new UTF8Encoding(false),4096,true); writer.NewLine="\n"; writer.AutoFlush=true; var hello=ReadPeerLine(); if(hello!=capability) throw new Exception("capability"); RequireRoot(); } else { CloseHandle(root); root=IntPtr.Zero; } }
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
