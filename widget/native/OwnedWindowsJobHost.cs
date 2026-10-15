using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.RegularExpressions;

// The console entrypoint is built with fixed framework references only. It has
// no static reference to the Job DLL: the held, bounded, hash-verified bytes are
// loaded before any Job code can run. Protocol tests inject a native-free runtime.
public interface IHomeBotJobRuntime {
 object ParseFrame(string line); string EncodeFrame(object value);
 void Create(); void Listen(string name); void Attach(int pid,long birth,string capability);
 string AttachChild(int pid,int parent,string capability); string Go(string launch);
 int VerifyChild(int pid); string ReadCompletion(); bool CompletedTarget();
 void Accept(); void ReleaseGate(); bool Empty(); bool Stop(); void Close();
}
public sealed class HomeBotJobSetup {
 public string Assembly { get; private set; } public string Sha256 { get; private set; }
 public string PipeName { get; private set; } public string Capability { get; private set; }
 public HomeBotJobSetup(string assembly,string hash,string pipe,string capability) { Assembly=assembly;Sha256=hash;PipeName=pipe;Capability=capability; }
}
public static class OwnedWindowsJobHost {
 static readonly string[] AllowedKeys={"id","operation","pid","creation","parent","launch"};
 static readonly string[] ErrorCodes={"create","limits","pipe","open","identity","assign","root","peer-timeout","peer","capability","peer-read-timeout","peer-input","query","baseline","child","completion","membership","operation"};
 static bool Equal(object value,string expected) { return value is string && String.Equals((string)value,expected,StringComparison.OrdinalIgnoreCase); }
 static bool Contains(string[] values,string value) { foreach(string item in values) if(String.Equals(item,value,StringComparison.OrdinalIgnoreCase)) return true; return false; }
 static object Get(IDictionary<string,object> value,string key) { object result; return value!=null&&value.TryGetValue(key,out result)?result:null; }
 static IDictionary<string,object> Map(object value) { var result=value as IDictionary<string,object>; if(result==null) throw new Exception("input"); return result; }
 static Dictionary<string,object> Packet(params object[] fields) { var result=new Dictionary<string,object>(); for(int index=0;index<fields.Length;index+=2) result.Add((string)fields[index],fields[index+1]); return result; }
 static void Emit(TextWriter output,IHomeBotJobRuntime runtime,object value) { output.Write(runtime.EncodeFrame(value)); output.Write('\n'); output.Flush(); }
 static void Phase(TextWriter output,string value) { output.Write("{\"type\":\"phase\",\"phase\":\""+value+"\"}\n"); output.Flush(); }
 public static string ReadSetupLine(TextReader input,int maximum,bool allowCleanEof) {
  var text=new StringBuilder();
  for(;;) { int character=input.Read(); if(character<0) { if(allowCleanEof&&text.Length==0) return null; throw new Exception("input"); } if(character==10) return text.ToString(); if(character==13||text.Length>=maximum) throw new Exception("input"); text.Append((char)character); }
 }
 public static HomeBotJobSetup ReadSetup(TextReader input) {
  string encoded=ReadSetupLine(input,8192,false),hash=ReadSetupLine(input,64,false),pipe=ReadSetupLine(input,40,false),capability=ReadSetupLine(input,64,false);
  if(encoded.Length==0||!Regex.IsMatch(encoded,"^[A-Za-z0-9+/]+={0,2}$")||!Regex.IsMatch(hash,"^[a-f0-9]{64}$")) throw new Exception("input");
  byte[] bytes=Convert.FromBase64String(encoded); if(Convert.ToBase64String(bytes)!=encoded) throw new Exception("input");
  string assembly=new UTF8Encoding(false,true).GetString(bytes);
  if(!Path.IsPathRooted(assembly)||assembly.IndexOf('\0')>=0||assembly.IndexOf('\n')>=0||assembly.IndexOf('\r')>=0) throw new Exception("input");
  if(pipe.Length!=0||capability.Length!=0) { if(!Regex.IsMatch(pipe,"^hbi-[a-f0-9-]{36}$")||!Regex.IsMatch(capability,"^[a-f0-9]{64}$")) throw new Exception("input"); }
  return new HomeBotJobSetup(assembly,hash,pipe,capability);
 }
 public static IDictionary<string,object> ValidateRequest(object value) {
  var request=Map(value); object id=Get(request,"id"),operation=Get(request,"operation");
  if(!(id is int)||(int)id<=0||!(operation is string)) throw new Exception("request");
  foreach(string key in request.Keys) if(Array.IndexOf(AllowedKeys,key)<0) throw new Exception("request");
  return request;
 }
 public static byte[] ReadVerifiedAssembly(string file,string expected) {
  byte[] bytes;
  using(var stream=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.Read)) {
   if(stream.Length<512||stream.Length>1048576) throw new Exception("asset");
   bytes=new byte[(int)stream.Length]; int offset=0;
   while(offset<bytes.Length) { int count=stream.Read(bytes,offset,bytes.Length-offset); if(count<=0) throw new Exception("asset"); offset+=count; }
   if(stream.Length!=bytes.Length||stream.ReadByte()!=-1) throw new Exception("asset");
  }
  using(var hash=SHA256.Create()) { if(BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-","").ToLowerInvariant()!=expected) throw new Exception("asset"); }
  return bytes;
 }
 public static int Main(string[] args) {
  if(args.Length!=0) return 1;
  IHomeBotJobRuntime runtime=null; bool enteredRun=false;
  try {
   Phase(Console.Out,"entry"); Phase(Console.Out,"encoding");
   var encoding=new UTF8Encoding(false,true); Phase(Console.Out,"encoding-constructed");
   using(var input=new StreamReader(Console.OpenStandardInput(),encoding,false,4096))
   using(var output=new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false),4096)) {
    output.NewLine="\n"; output.AutoFlush=true; Phase(output,"encoding-set"); Phase(output,"setup");
    HomeBotJobSetup setup=ReadSetup(input); Phase(output,"setup-read"); Phase(output,"asset-load");
    byte[] bytes=ReadVerifiedAssembly(setup.Assembly,setup.Sha256);
    Type type=Assembly.Load(bytes).GetType("OwnedWindowsJob",true,false);
    runtime=new ReflectedRuntime(type); Phase(output,"asset-loaded");
    enteredRun=true; return Run(input,output,runtime,setup.PipeName,setup.Capability);
   }
  } catch { return 1; }
  finally { if(runtime!=null&&!enteredRun) runtime.Close(); }
 }
 public static int Run(TextReader input,TextWriter output,IHomeBotJobRuntime runtime,string pipeName,string capability) {
  bool attached=false,authorized=false;
  try {
   Phase(output,"create"); runtime.Create();
   if(pipeName.Length!=0) { Phase(output,"listen"); runtime.Listen(pipeName); }
   output.Write("{\"type\":\"listening\"}\n"); output.Flush();
   for(;;) {
    Phase(output,"command");
    string line=ReadSetupLine(input,131072,true); if(line==null) return runtime.Stop()?0:1;
    var request=ValidateRequest(runtime.ParseFrame(line));
    object idValue=Get(request,"id"),operationValue=Get(request,"operation");
    int id=(int)idValue; string operation=(string)operationValue,phase=Equal(operation,"attach-child")?"attach":operation;
    bool known=Contains(new string[]{"attach","attach-child","go","query","stop"},operation);
    try {
     if(known) Emit(output,runtime,Packet("type","phase","phase",phase));
     if(Equal(operation,"attach")&&!attached) {
      object pid=Get(request,"pid"),creation=Get(request,"creation"); long birth;
      if(!(pid is int)||(int)pid<=0||!(creation is string)||!Regex.IsMatch((string)creation,"^[0-9]{1,19}$")||!Int64.TryParse((string)creation,out birth)||birth<=0) throw new Exception("operation");
      attached=true; runtime.Attach((int)pid,birth,capability); Emit(output,runtime,Packet("type","result","id",id,"ok",true));
     } else if(Equal(operation,"attach-child")&&!attached&&pipeName.Length!=0) {
      object pid=Get(request,"pid"),parent=Get(request,"parent");
      if(request.Count!=4||!(pid is int)||(int)pid<=0||!(parent is int)||(int)parent<=0) throw new Exception("operation");
      attached=true; var identity=Map(runtime.ParseFrame(runtime.AttachChild((int)pid,(int)parent,capability)));
      Emit(output,runtime,Packet("type","result","id",id,"ok",true,"creation",Get(identity,"creation"),"parent",Get(identity,"parent")));
     } else if(Equal(operation,"go")&&attached&&pipeName.Length!=0&&!authorized) {
      authorized=true; var launch=Get(request,"launch"); var ack=Map(runtime.ParseFrame(runtime.Go(runtime.EncodeFrame(launch))));
      if(Equal(Get(ack,"type"),"launch-error")) {
       object stage=Get(ack,"stage"),code=Get(ack,"code");
       if(stage is string&&code is string&&Contains(new string[]{"console-input","console-output","console-close","spawn"},(string)stage)&&Contains(new string[]{"ENOENT","EACCES","EPERM","ENXIO","EINVAL","EBADF","EIO","ENOTSUP","UNKNOWN"},(string)code)) {
        Emit(output,runtime,Packet("type","phase","phase","go","code",stage,"nativeCode",code)); Emit(output,runtime,Packet("type","result","id",id,"ok",false)); continue;
       } throw new Exception("child");
      }
      object pid=Get(ack,"pid"); if(!Equal(Get(ack,"type"),"spawn")||!(pid is int)||(int)pid<=0) throw new Exception("child");
      int member=runtime.VerifyChild((int)pid); var launchMap=launch as IDictionary<string,object>;
      if(member==0&&Equal(Get(launchMap,"kind"),"task")) {
       var done=Map(runtime.ParseFrame(runtime.ReadCompletion()));
       object donePid=Get(done,"pid"),exitCode=Get(done,"exitCode");
       if(!Equal(Get(done,"type"),"completed")||!(donePid is int)||(int)donePid!=(int)pid||!(exitCode is int)||!runtime.CompletedTarget()) throw new Exception("completion");
      } else if(member!=1) throw new Exception("membership");
      runtime.Accept(); runtime.ReleaseGate(); Emit(output,runtime,Packet("type","result","id",id,"ok",true,"pid",pid));
     } else if(Equal(operation,"query")&&attached) { Emit(output,runtime,Packet("type","result","id",id,"ok",true,"empty",runtime.Empty()));
     } else if(Equal(operation,"stop")) {
      bool empty=runtime.Stop(); Emit(output,runtime,Packet("type","result","id",id,"ok",true,"empty",empty)); if(empty) return 0;
     } else { throw new Exception("operation"); }
    } catch(Exception error) {
     while(error.InnerException!=null) error=error.InnerException;
     string code=Contains(ErrorCodes,error.Message)?error.Message:"unknown";
     if(known) Emit(output,runtime,Packet("type","phase","phase",phase,"code",code));
     Emit(output,runtime,Packet("type","result","id",id,"ok",false));
    }
   }
  } finally { runtime.Close(); }
 }
 sealed class ReflectedRuntime:IHomeBotJobRuntime {
  readonly Type type;
  public ReflectedRuntime(Type value) { type=value; }
  object Call(string name,params object[] args) { var method=type.GetMethod(name,BindingFlags.Public|BindingFlags.Static); if(method==null) throw new Exception("asset"); return method.Invoke(null,args); }
  public object ParseFrame(string x) { return Call("ParseFrame",x); } public string EncodeFrame(object x) { return (string)Call("EncodeFrame",x); }
  public void Create() { Call("Create"); } public void Listen(string x) { Call("Listen",x); }
  public void Attach(int x,long y,string z) { Call("Attach",x,y,z); } public string AttachChild(int x,int y,string z) { return (string)Call("AttachChild",x,y,z); }
  public string Go(string x) { return (string)Call("Go",x); } public int VerifyChild(int x) { return (int)Call("VerifyChild",x); }
  public string ReadCompletion() { return (string)Call("ReadCompletion"); } public bool CompletedTarget() { return (bool)Call("CompletedTarget"); }
  public void Accept() { Call("Accept"); } public void ReleaseGate() { Call("ReleaseGate"); }
  public bool Empty() { return (bool)Call("Empty"); } public bool Stop() { return (bool)Call("Stop"); } public void Close() { Call("Close"); }
 }
}
