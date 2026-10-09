import { windowsNativeWaitChainSource } from '../../renderer/e2e/helpers/windowsNativeWaitChain';

export type WaitChainControl = 'complete' | 'denied' | 'reused' | 'wrong-thread-owner' | 'root-exits' | 'more-data' | 'invalid-type' | 'invalid-status' | 'unknown-type';
export const controlIdentity = { pid: 1234, creation: '639269363416749710' };

/** Replace EVERY native import and real thread enumeration before execution.
 * This compiles the actual generated C#/PS pipeline without querying any OS PID.
 */
export function buildWaitChainControl(mode: WaitChainControl): string {
  let source = windowsNativeWaitChainSource(controlIdentity.pid, controlIdentity.creation);
  const methods: Record<string, string> = {
    OpenProcess: 'static IntPtr OpenProcess(uint rights,bool inherit,uint pid) { if(rights!=0x101000 || inherit || pid!=1234) throw new Exception("invalid process query"); return new IntPtr(1234); }',
    GetProcessTimes: `static bool GetProcessTimes(IntPtr h,out Time birth,out Time exit,out Time kernel,out Time user) { ulong value=${BigInt(controlIdentity.creation) - 504911232000000000n + (mode === 'reused' ? 10n : 0n)}UL; birth=new Time{Low=(uint)value,High=(uint)(value>>32)};exit=kernel=user=new Time(); return true; }`,
    WaitForSingleObject: 'static uint WaitForSingleObject(IntPtr h,uint ms) { if(ms!=0) throw new Exception("blocking wait"); return RootGone?0U:258U; }',
    CloseHandle: 'static bool CloseHandle(IntPtr h) { NativeClosed++; return true; }',
    OpenThread: 'static IntPtr OpenThread(uint rights,bool inherit,uint tid) { if(rights!=0x800 || inherit || tid<1001 || tid>1002) throw new Exception("invalid thread query"); return new IntPtr((int)tid); }',
    GetProcessIdOfThread: `static uint GetProcessIdOfThread(IntPtr h) { return ${mode === 'wrong-thread-owner' ? '9999U' : '1234U'}; }`,
    OpenThreadWaitChainSession: 'static IntPtr OpenThreadWaitChainSession(uint flags,IntPtr callback) { if(flags!=0 || callback!=IntPtr.Zero) throw new Exception("async callback"); return new IntPtr(44); }',
    CloseThreadWaitChainSession: 'static void CloseThreadWaitChainSession(IntPtr session) { SessionClosed++; }',
    GetThreadWaitChain: `static bool GetThreadWaitChain(IntPtr session,UIntPtr context,uint flags,uint tid,ref uint count,IntPtr nodes,out bool cycle) {
      if(session.ToInt32()!=44 || context!=UIntPtr.Zero || flags!=1 || count!=16) throw new Exception("WCT bounds/ABI");
      WctCalls++;cycle=false;for(int n=0;n<16;n++){var p=IntPtr.Add(nodes,n*280);Marshal.WriteInt32(p,0,${mode === 'invalid-type' ? 0 : mode === 'unknown-type' ? 10 : 8});Marshal.WriteInt32(p,4,${mode === 'invalid-status' ? 11 : 3});Marshal.WriteInt32(p,8,1234);Marshal.WriteInt32(p,12,(int)tid);Marshal.WriteInt32(p,16,7);Marshal.WriteInt32(p,20,11);}
      count=${mode === 'more-data' ? 17 : 2};${mode === 'root-exits' ? 'RootGone=true;' : ''} return ${mode === 'denied' || mode === 'more-data' ? 'false' : 'true'};
    }`,
  };
  let replaced = 0;
  source = source.replace(/\[DllImport\("(?:kernel32|advapi32)\.dll"(?:,SetLastError=true)?\)\] static extern ([^;]+);/g, (_match, declaration: string) => {
    const name = /\s(\w+)\(/.exec(declaration)?.[1];
    if (!name || !methods[name]) throw new Error('Uncontrolled native import');
    replaced++; return methods[name];
  });
  if (replaced !== 9 || source.includes('DllImport')) throw new Error('Native import positive control failed.');
  source = source.replace(/static List<Sample> ReadThreads\(uint pid,out int total\) \{[\s\S]*?\n  static Dictionary<string,object> Row\(\)/,
    'static List<Sample> ReadThreads(uint pid,out int total) { total=2; return new List<Sample>{new Sample{Id=1001,State="Wait",Reason="Executive"},new Sample{Id=1002,State="Wait",Reason="UserRequest"}}; }\n  static Dictionary<string,object> Row()');
  if (source.includes('Process.GetProcessById') || source.includes('process.Threads')) throw new Error('Real thread enumeration was not replaced.');
  source = source.replace('public static class HomeBotWaitChain {', 'public static class HomeBotWaitChain { public static int NativeClosed=0,SessionClosed=0,WctCalls=0; static bool RootGone=false;')
    .replace(/Marshal\.GetLastWin32Error\(\)/g, mode === 'more-data' ? '234' : '5');
  return source + '\n[Console]::Out.WriteLine("CONTROL:"+([ordered]@{nativeClosed=[HomeBotWaitChain]::NativeClosed;sessionClosed=[HomeBotWaitChain]::SessionClosed;wctCalls=[HomeBotWaitChain]::WctCalls}|ConvertTo-Json -Compress));';
}
