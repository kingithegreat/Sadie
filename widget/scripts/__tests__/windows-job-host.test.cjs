'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto');
const sourceFile=path.resolve(__dirname,'../../native/OwnedWindowsJobHost.cs');
const control=`
using System;
using System.IO;
public sealed class HostFake:IHomeBotJobRuntime {
 public System.Collections.Generic.List<string> Calls=new System.Collections.Generic.List<string>();
 public System.Web.Script.Serialization.JavaScriptSerializer Codec=new System.Web.Script.Serialization.JavaScriptSerializer();
 public int Member=1,StopCalls,Closed;public bool Completion=true,FailAttach,FailCreate,RetryStop;public string Ack="{\\"type\\":\\"spawn\\",\\"pid\\":44}";
 public object ParseFrame(string s){return Codec.DeserializeObject(s);}public string EncodeFrame(object x){Calls.Add("encode");return Codec.Serialize(x);}
 public void Create(){Calls.Add("create");if(FailCreate)throw new Exception("create");}public void Listen(string s){Calls.Add("listen");}
 public void Attach(int p,long b,string c){Calls.Add("attach");if(FailAttach)throw new Exception("identity");}
 public string AttachChild(int p,int parent,string c){Calls.Add("attach-child");return "{\\"creation\\":\\"1234\\",\\"parent\\":77}";}
 public string Go(string l){Calls.Add("go");return Ack;}public int VerifyChild(int p){Calls.Add("member");return Member;}
 public string ReadCompletion(){Calls.Add("completed");return "{\\"type\\":\\"completed\\",\\"pid\\":44,\\"exitCode\\":0}";}public bool CompletedTarget(){return Completion;}
 public void Accept(){Calls.Add("accept");}public void ReleaseGate(){Calls.Add("release");}public bool Empty(){return false;}
 public bool Stop(){Calls.Add("stop");StopCalls++;return !RetryStop||StopCalls>1;}public void Close(){Closed++;}
}
public static class HostProtocolControls {
 static string stage="initial";
 static int passed;static string Attach="{\\"id\\":1,\\"operation\\":\\"attach-child\\",\\"pid\\":12,\\"parent\\":77}",Go="{\\"id\\":2,\\"operation\\":\\"go\\",\\"launch\\":{}}",Stop="{\\"id\\":3,\\"operation\\":\\"stop\\"}";
 static void Check(bool ok,string name){stage=name;if(!ok)throw new Exception("control");passed++;}
 static string Run(HostFake f,string commands,out int status){stage="managed Run";var output=new StringWriter();status=OwnedWindowsJobHost.Run(new StringReader(commands),output,f,"hbi-control","cap");return output.ToString();}
 static string Lines(params string[] lines){return String.Join("\\n",lines)+"\\n";}
 static void RefuseEnvelope(string command){var f=new HostFake();bool refused=false;try{int s;Run(f,command,out s);}catch{refused=true;}Check(refused&&f.Closed==1,"invalid envelope closes once");}
 public static int Main(){try{
  int status;var f=new HostFake();string output=Run(f,Lines(Attach,Go,"{\\"id\\":4,\\"operation\\":\\"query\\"}",Stop),out status);
  Check(status==0&&f.Closed==1&&f.Calls.Contains("accept")&&f.Calls.Contains("release")&&output.Contains("\\"pid\\":44"),"positive owned service");
  Check(f.Calls[0]=="create"&&f.Calls[1]=="listen"&&!f.Calls.GetRange(0,2).Contains("encode")&&output.IndexOf("\\"listening\\"")<output.IndexOf("\\"result\\""),"ready before serializer");
  f=new HostFake();output=Run(f,Lines(Go,Stop),out status);Check(!f.Calls.Contains("go")&&output.Contains("\\"ok\\":false"),"no GO before attach");
  f=new HostFake();output=Run(f,Lines(Attach,Attach,Go,Go,Stop),out status);Check(f.Calls.FindAll(x=>x=="attach-child").Count==1&&f.Calls.FindAll(x=>x=="go").Count==1,"single-use attach and GO");
  f=new HostFake();f.RetryStop=true;output=Run(f,Lines(Stop,Stop),out status);Check(status==0&&f.StopCalls==2&&output.Contains("\\"empty\\":false")&&output.Contains("\\"empty\\":true"),"retry stop retains state");
  f=new HostFake();output=Run(f,"",out status);Check(status==0&&f.StopCalls==1&&f.Closed==1,"clean EOF joins stop");
  RefuseEnvelope("{\\"id\\":1,\\"operation\\":\\"stop\\"}");
  RefuseEnvelope(Lines("{\\"id\\":1,\\"operation\\":\\"stop\\",\\"foreign\\":true}"));
  RefuseEnvelope(Lines("{\\"id\\":1.5,\\"operation\\":\\"stop\\"}"));
  f=new HostFake();f.Member=0;output=Run(f,Lines(Attach,Go,Stop),out status);Check(!f.Calls.Contains("accept")&&output.Contains("membership"),"live service requires member");
  f=new HostFake();f.Member=0;output=Run(f,Lines(Attach,"{\\"id\\":2,\\"operation\\":\\"go\\",\\"launch\\":{\\"kind\\":\\"task\\"}}",Stop),out status);Check(f.Calls.Contains("completed")&&f.Calls.Contains("accept"),"finite task exact completion");
  f=new HostFake();f.Member=0;f.Completion=false;output=Run(f,Lines(Attach,"{\\"id\\":2,\\"operation\\":\\"go\\",\\"launch\\":{\\"kind\\":\\"task\\"}}",Stop),out status);Check(!f.Calls.Contains("accept")&&output.Contains("completion"),"unknown completed accounting refuses");
  f=new HostFake();f.Ack="{\\"type\\":\\"launch-error\\",\\"stage\\":\\"console-input\\",\\"code\\":\\"EBADF\\"}";output=Run(f,Lines(Attach,Go,Stop),out status);Check(!f.Calls.Contains("accept")&&output.Contains("EBADF")&&output.Contains("\\"ok\\":false"),"finite launch errors");
  f=new HostFake();f.FailCreate=true;bool refused=false;try{Run(f,Lines(Stop),out status);}catch{refused=true;}Check(refused&&f.Closed==1,"create failure closes once");
  f=new HostFake();f.FailAttach=true;output=Run(f,Lines("{\\"id\\":1,\\"operation\\":\\"attach\\",\\"pid\\":12,\\"creation\\":\\"1234\\"}","{\\"id\\":2,\\"operation\\":\\"attach\\",\\"pid\\":12,\\"creation\\":\\"1234\\"}",Stop),out status);Check(f.Calls.FindAll(x=>x=="attach").Count==1,"failed attach cannot reassign");
  Check(OwnedWindowsJobHost.Main(new string[]{"forbidden"})==1,"zero argv required");
  Console.WriteLine("HOST-PURE-PASS:"+passed);return 0;
 }catch(Exception error){Console.Error.WriteLine("HOST-PURE-FAIL:"+stage+";type="+error.GetType().Name);return 1;}}
}
`;
test('console host has no Job reference before same-byte asset verification and fixed readiness skips serializer',()=>{
 const source=fs.readFileSync(sourceFile,'utf8');assert(!source.includes('DllImport')&&!source.includes('OwnedWindowsJob.Create('));
 assert(source.indexOf('ReadVerifiedAssembly(setup.Assembly,setup.Sha256)')<source.indexOf('Assembly.Load(bytes)'));
 const run=source.slice(source.indexOf('public static int Run('),source.indexOf('sealed class ReflectedRuntime'));
 assert(run.includes('Phase(output,"create"); runtime.Create()'));assert(run.includes('Phase(output,"listen"); runtime.Listen'));
 assert(run.includes('ValidateRequest(runtime.ParseFrame(line))'));assert(run.includes('finally { runtime.Close(); }'));
 assert(!run.slice(0,run.indexOf('var request=')).includes('Emit(output,runtime'));
});
test('actual host loop executes native-free managed runtime controls',{skip:process.platform!=='win32',timeout:15000},()=>{
 const system=process.env.SystemRoot||process.env.SYSTEMROOT;assert(system&&path.win32.isAbsolute(system));
 const framework=path.win32.join(system,'Microsoft.NET','Framework64','v4.0.30319'),compiler=path.win32.join(framework,'csc.exe');
 const artifactRoot=path.resolve(__dirname,'../../../artifacts/ide-native-zero-retry');fs.mkdirSync(artifactRoot,{recursive:true});
 assert(fs.lstatSync(artifactRoot).isDirectory()&&!fs.lstatSync(artifactRoot).isSymbolicLink());assert.equal(fs.realpathSync.native(artifactRoot).toLowerCase(),artifactRoot.toLowerCase());
 const dir=fs.mkdtempSync(path.join(artifactRoot,'host-protocol-')),file=path.join(dir,'control.cs'),exe=path.join(dir,'control.exe');
 let first;try{
  const hostBytes=fs.readFileSync(sourceFile);fs.writeFileSync(path.join(dir,'OwnedWindowsJobHost.cs'),hostBytes);fs.writeFileSync(file,control);const compile=cp.spawnSync(compiler,['/nologo','/noconfig','/nostdlib+','/target:exe','/main:HostProtocolControls','/out:'+exe,...['mscorlib.dll','System.dll','System.Core.dll','System.Web.Extensions.dll'].map(n=>'/reference:'+path.win32.join(framework,n)),path.join(dir,'OwnedWindowsJobHost.cs'),file],{windowsHide:true,timeout:5000,maxBuffer:128*1024,encoding:'utf8',cwd:framework,env:{SystemRoot:system,TEMP:dir,TMP:dir}});
  fs.writeFileSync(path.join(dir,'compile.json'),JSON.stringify({status:compile.status,signal:compile.signal,error:compile.error?.code,stdout:compile.stdout,stderr:compile.stderr}));assert(!compile.error);assert.equal(compile.signal,null);assert.equal(compile.status,0,compile.stdout);
  const run=cp.spawnSync(exe,[],{windowsHide:true,timeout:8000,maxBuffer:64*1024,encoding:'utf8',cwd:dir,env:{SystemRoot:system,TEMP:dir,TMP:dir}});
  fs.writeFileSync(path.join(dir,'run.json'),JSON.stringify({status:run.status,signal:run.signal,error:run.error?.code,stdout:run.stdout,stderr:run.stderr}));assert(!run.error);assert.equal(run.signal,null);assert.equal(run.status,0,run.stderr);assert.match(run.stdout,/HOST-PURE-PASS:16/);
  fs.writeFileSync(path.join(dir,'proof.json'),JSON.stringify({hostSha256:crypto.createHash('sha256').update(hostBytes).digest('hex'),controlSha256:crypto.createHash('sha256').update(Buffer.from(control)).digest('hex'),controls:16,scope:'Actual managed host Run with supplied fake runtime; no DLL load, Job, pipe, target or PInvoke execution.'}));
 }catch(error){first=error;throw error;}finally{console.log(JSON.stringify({hostPureArtifact:dir,firstFailure:first?.message||null}));}
});
