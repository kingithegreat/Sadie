'use strict';
// Actual serialized source with substituted Electron/fs; no reporter or app starts.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const ts=createRequire(path.resolve(__dirname,'../../widget/package.json'))('typescript');
const source=fs.readFileSync(path.resolve(__dirname,'../../widget/src/renderer/e2e/helpers/localCrashReporter.ts'),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const gate=require('../run-ide-native-zero-retry.cjs');
function fixture(change=()=>{}) {
  const root='C:\\private',profile=root+'\\h\\profile',dump=profile+'\\CrashDumps';
  const state={started:[],parameters:{},upload:false,redirect:false,noOp:false};
  const env={HOMEBOT_NATIVE_LOCAL_CRASH_REPORTS:'1',HOMEBOT_NATIVE_LOCAL_CRASH_ROOT:root,HOMEBOT_E2E_USER_DATA_DIR:profile,GITHUB_ACTIONS:'true',RUNNER_OS:'Windows',HOMEBOT_E2E:'1',NODE_ENV:'test'};
  const proc={pid:42,platform:'win32',env,getBuiltinModule:name=>name==='path'?path.win32:{realpathSync:{native:value=>state.redirect&&value===dump?'C:\\outside':value}}};
  const identity={pid:42,nonce:'captured-nonce'};
  const electron={app:{getPath:name=>name==='crashDumps'?dump:profile},crashReporter:{start:options=>{state.started.push(options);if(!state.noOp)state.parameters=options.extra;},getUploadToServer:()=>state.upload,getParameters:()=>state.parameters}};
  change({state,proc,identity,electron,env});
  const exports={};vm.runInNewContext(compiled,{exports,process:proc});
  return {run:()=>exports.startLocalNativeCrashReporter(electron,identity),state};
}
test('exact captured main starts local-only collection in its canonical private dump path',()=>{
  const f=fixture(),r=f.run();assert.equal(r.status,'started');assert.equal(r.pid,42);assert.equal(r.uploadToServer,false);assert.equal(r.requestedSubmitURL,null);
  assert.equal(f.state.started.length,1);assert.equal(f.state.started[0].uploadToServer,false);assert.equal(Object.hasOwn(f.state.started[0],'submitURL'),false);
});
test('disabled collection does not touch the reporter',()=>{const f=fixture(({env})=>{delete env.HOMEBOT_NATIVE_LOCAL_CRASH_REPORTS;});assert.equal(f.run().status,'disabled');assert.equal(f.state.started.length,0);});
test('local, non-Windows, non-fixture, wrong-main, missing-root and redirected stores refuse before start',()=>{
  const changes=[({env})=>{env.GITHUB_ACTIONS='false';},({proc})=>{proc.platform='linux';},({env})=>{env.RUNNER_OS='Linux';},({env})=>{env.HOMEBOT_E2E='0';},({env})=>{env.NODE_ENV='production';},({identity})=>{identity.pid=99;},({env})=>{delete env.HOMEBOT_NATIVE_LOCAL_CRASH_ROOT;},({env})=>{env.HOMEBOT_NATIVE_LOCAL_CRASH_ROOT='C:\\elsewhere';},({state})=>{state.redirect=true;},({electron})=>{electron.app.getPath=()=> 'C:\\outside';}];
  for(const change of changes){const f=fixture(change);assert.throws(f.run);assert.equal(f.state.started.length,0);}
});
test('a pre-existing no-op reporter and actual uploads refuse configuration',()=>{
  for(const change of [({state})=>{state.noOp=true;},({state})=>{state.upload=true;}])assert.throws(fixture(change).run,/configuration was not established/);
});
test('receipt qualification binds reporter parameters and nonce to the held native main and actual quit marker',()=>{
  const record={receipt:{native:{pid:42},productionAtExit:{nonce:'captured-nonce'},localCrashReporter:JSON.parse(JSON.stringify(fixture().run()))}};
  gate.validateLocalCrashReporterReceipts([record]);
  for(const change of [r=>{r.receipt.localCrashReporter.status='failed';},r=>{r.receipt.localCrashReporter.uploadToServer=true;},r=>{r.receipt.localCrashReporter.pid=99;},r=>{r.receipt.localCrashReporter.requestedSubmitURL='https://example.invalid';},r=>{r.receipt.productionAtExit.nonce='other';},r=>{r.receipt.localCrashReporter.parameters.homebot_native_pid='99';}]){
    const r=JSON.parse(JSON.stringify(record));change(r);assert.throws(()=>gate.validateLocalCrashReporterReceipts([r]));
  }
});
