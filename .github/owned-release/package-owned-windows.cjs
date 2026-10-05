'use strict';
// Preparation only until the coordinator publishes the named audit branch.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict'),os=require('node:os'),{createRequire}=require('node:module');
const workspace=path.resolve(process.env.GITHUB_WORKSPACE||'.'),app=path.join(workspace,'application'),controls=path.join(workspace,'controls'),stage=path.join(workspace,'owned-package'),evidence=path.join(stage,'evidence'),widget=path.join(app,'widget');
const head='794c41e8ece0247f24aab59da2e6025fb5b43875',tree='57c4de68c13f18dc829268b1829348d664bc6d6f';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function fileHash(f){const h=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024),fd=fs.openSync(f,'r');try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));}finally{fs.closeSync(fd);}return h.digest('hex');}
function real(f){const s=fs.lstatSync(f);assert(!s.isSymbolicLink(),'No reparse: '+f);assert.equal(fs.realpathSync(f).toLowerCase(),path.resolve(f).toLowerCase());return s;}
function inventory(dir){const out=[];function walk(d){real(d);for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);const s=real(f);if(s.isDirectory())walk(f);else{assert(s.isFile());out.push({file:path.relative(dir,f).replaceAll('\\','/'),bytes:s.size,sha256:fileHash(f)});}}}walk(dir);return out.sort((a,b)=>a.file.localeCompare(b.file));}
function git(args){const r=cp.spawnSync('git',args,{cwd:app,encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);return r.stdout.trim();}
function source(){assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['rev-parse','HEAD^{tree}']),tree);assert.equal(git(['status','--porcelain=v1','--untracked-files=no']),'');}
function save(name,value){fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});}
function capacity(label,need=5*1024**3){const s=fs.statfsSync(stage),available=s.bavail*s.bsize,ram=os.freemem(),required=Math.max(5*1024**3,need);assert(available>=required,label+' disk capacity hold');assert(ram>=2*1024**3,label+' RAM capacity hold');return{label,availableBytes:available,requiredBytes:required,freeRamBytes:ram,requiredRamBytes:2*1024**3};}
const env={...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false',HOMEBOT_ENABLE_AUTO_UPDATE:'0'};
for(const key of ['CSC_LINK','CSC_KEY_PASSWORD','CSC_NAME','WIN_CSC_LINK','WIN_CSC_KEY_PASSWORD','WIN_CSC_NAME','GH_TOKEN','GITHUB_TOKEN','HOMEBOT_E2E','HOMEBOT_DIRECT_OLLAMA','SKIP_PREFLIGHT','ELECTRON_RUN_AS_NODE','NODE_ENV'])delete env[key];
 let receipt,baseline,compiled,frozen,installer,installerRecord,controlIdentity;
const phases=[];
function run(name,bin,args,cwd,extra={}){source();save('capacity-'+name+'.json',capacity('before '+name));const log=path.join(evidence,name+'.log'),fd=fs.openSync(log,'wx'),startedUTC=new Date().toISOString();let r;try{r=cp.spawnSync(bin,args,{cwd,env:{...env,...extra},stdio:['ignore',fd,fd],windowsHide:true,shell:false});}finally{fs.closeSync(fd);}
 const endedUTC=new Date().toISOString(),p={name,bin,args,cwd,startedUTC,endedUTC,elapsedMilliseconds:Date.parse(endedUTC)-Date.parse(startedUTC),exitCode:r.status,signal:r.signal,error:r.error?.message||null,log:path.relative(stage,log),logSha256:fileHash(log)};phases.push(p);fs.writeFileSync(path.join(evidence,'phase-exits.json'),JSON.stringify(phases,null,2));assert(!r.error,r.error?.message);assert.equal(r.signal,null);assert.equal(r.status,0,name+' failed; evidence retained');}
async function main(){
 assert.equal(process.platform,'win32');assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.GITHUB_EVENT_NAME,'push');assert.equal(process.env.GITHUB_REF,'refs/heads/audit/release-package-20261005');
 assert.equal(process.env.APPLICATION_SHA,head);assert.equal(process.env.APPLICATION_TREE,tree);assert.match(process.env.GITHUB_SHA,/^[a-f0-9]{40}$/);assert.notEqual(process.env.GITHUB_SHA,head);assert(!fs.existsSync(stage));
 real(workspace);real(app);real(controls);source();fs.mkdirSync(stage);fs.mkdirSync(evidence);
 receipt={status:'running',applicationSHA:head,applicationTree:tree,workflowSHA:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,runAttempt:process.env.GITHUB_RUN_ATTEMPT,startedUTC:new Date().toISOString(),scope:'Unsigned unpublished Windows artifact; packaged startup/SQLite/Sharp/normal shutdown only. Offline voice/media/install/owner acceptance remain pending.'};
 fs.writeFileSync(path.join(evidence,'source.json'),JSON.stringify(receipt,null,2),{flag:'wx'});
 try{
  const tracked=git(['ls-files']).split('\n');assert.equal(tracked.length,1097);for(const p of ['widget/src/main/index.ts','widget/src/renderer/components/MediaStudioPanel.tsx','widget/src/renderer/components/FirstRunModal.tsx','widget/package.json','widget/package-lock.json','scripts/scan-package-integrity.js'])assert(tracked.includes(p));
  baseline=tracked.map(file=>({file,bytes:real(path.join(app,file)).size,sha256:fileHash(path.join(app,file))}));
  const controlFiles=['.github/workflows/owned-release-package.yml','.github/owned-release/package-owned-windows.cjs','.github/owned-release/probe-owned-package.cjs','.github/owned-release/scan-package-integrity.js'];
  const controlHead=cp.spawnSync('git',['rev-parse','HEAD'],{cwd:controls,encoding:'utf8'});assert.equal(controlHead.status,0);assert.equal(controlHead.stdout.trim(),process.env.GITHUB_SHA);
  controlIdentity=controlFiles.map(file=>({file,sha256:fileHash(path.join(controls,file))}));
  save('application-source-identity.json',{...receipt,trackedFiles:baseline,controls:controlIdentity,manifests:baseline.filter(x=>['package.json','package-lock.json','widget/package.json','widget/package-lock.json'].includes(x.file))});
  save('capacity-entry.json',capacity('before own runner install/build',8*1024**3));
  const npm=path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');real(npm);
  run('install-root',process.execPath,[npm,'ci'],app);
  run('install-widget',process.execPath,[npm,'ci'],widget);
  const req=createRequire(path.join(widget,'package.json')),asar=req('@electron/asar'),metadata=JSON.parse(fs.readFileSync(path.join(widget,'package.json'),'utf8'));
  assert.equal(req('electron/package.json').version,'42.8.1');
  save('tool-versions.json',{node:process.version,platform:process.platform,arch:process.arch,electron:req('electron/package.json').version,electronBuilder:req('electron-builder/package.json').version,asar:req('@electron/asar/package.json').version});
  const production={NODE_ENV:'production',HOMEBOT_RELEASE_BUILD:'1'};
  run('preflight',process.execPath,['scripts/preflight-env-check.js','--require-production'],app,production);
  assert(!fs.existsSync(path.join(widget,'out')),'Fresh checkout must not contain stale compilation');
  run('build-release',process.execPath,[npm,'run','build:release'],widget,production);
  run('artifact-scan',process.execPath,['scripts/preflight-env-check.js','--require-production','--scan-artifacts'],app,production);
  compiled=inventory(path.join(widget,'out'));assert(compiled.length>0);for(const file of ['main/index.js','preload/index.js','preload/webview.js','renderer/index.html'])assert(compiled.some(x=>x.file===file&&x.bytes>0),'Required compilation missing: '+file);assert(compiled.some(x=>/^renderer\/assets\/.+\.js$/.test(x.file)&&x.bytes>0));save('compiled-inventory.json',{head,files:compiled});
  const dist=path.join(stage,'widget/dist-electron');fs.mkdirSync(path.join(stage,'widget'));fs.mkdirSync(path.join(stage,'scripts'));
  const scannerSource=path.join(controls,'.github/owned-release/scan-package-integrity.js'),reviewedScannerNormalizedSha256='adf0e90a65c90c0d29b3be1a862104f81511a1806f51c4befb8a72078a12183d';
  assert.equal(hash(Buffer.from(fs.readFileSync(scannerSource,'utf8').replace(/\r\n/g,'\n'))),reviewedScannerNormalizedSha256,'Scanner body differs from exact independently reviewed LF reference');
  const scanner=path.join(stage,'scripts/scan-package-integrity.js');fs.copyFileSync(scannerSource,scanner,fs.constants.COPYFILE_EXCL);
  // Scanner resolves its unchanged relative widget path and installed asar CLI.
  fs.symlinkSync(path.join(widget,'node_modules'),path.join(stage,'widget/node_modules'),'junction');
  assert(!metadata.build.win.certificateFile&&!metadata.build.win.sign&&!metadata.build.win.signtoolOptions,'No signing configuration permitted');
  const config={...metadata.build,publish:null,forceCodeSigning:false,directories:{...metadata.build.directories,output:dist,buildResources:path.join(widget,'build')},extraResources:metadata.build.extraResources.map(x=>({...x,from:path.resolve(widget,x.from)})),win:{...metadata.build.win,icon:path.join(widget,metadata.build.win.icon),signExecutable:false}};
  save('builder-config.json',config);save('scanner-identity.json',{file:path.relative(stage,scanner),sha256:fileHash(scanner),reviewedScannerNormalizedSha256,controlSourceSHA:process.env.GITHUB_SHA,baselineApplicationScannerSHA:fileHash(path.join(app,'scripts/scan-package-integrity.js')),semantics:'Exact reviewed LF-normalized scanner body; actual working/copied bytes independently SHA-bound and preserved. No bypass or package patch. Scanner revision differs from fixed application and is separately bound.'});
  run('package-nsis',process.execPath,[path.join(widget,'node_modules/electron-builder/out/cli/cli.js'),'--projectDir',widget,'--config',path.join(evidence,'builder-config.json'),'--win','nsis','--x64','--publish','never'],widget,production);
  const runtime=path.join(dist,'win-unpacked'),archive=path.join(runtime,'resources/app.asar');frozen=inventory(runtime);assert(frozen.length>0);for(const file of ['HomeBot.exe','resources/app.asar'])assert(frozen.some(x=>x.file===file&&x.bytes>0));
  function headerFiles(t,p=''){return Object.entries(t.files||{}).flatMap(([n,v])=>v.files?headerFiles(v,p+n+'/'):[p+n]);}
  const headers=headerFiles(asar.getRawHeader(archive).header),nativePath=p=>path.join(...p.split('/'));
  assert.deepEqual(headers.filter(p=>p.startsWith('out/')).sort(),compiled.map(x=>'out/'+x.file).sort());
  for(const c of compiled){const b=asar.extractFile(archive,nativePath('out/'+c.file));assert.equal(b.length,c.bytes);assert.equal(hash(b),c.sha256);}
  const packageBy=new Map(headers.filter(p=>p.startsWith('node_modules/')&&p.endsWith('/package.json')).map(file=>[file,JSON.parse(asar.extractFile(archive,nativePath(file)))]));assert(packageBy.size>0);
  const dependencies=[...packageBy].map(([file,p])=>({file,name:p.name,version:p.version}));
  // Compare the complete reachable production graph, not a guessed manifest count.
  // Resolve each edge through normal ancestor node_modules directories on both
  // sides; layout/deduplication may differ but name+version+every edge must match.
  function installedResolve(name,from){let d=from;while(true){const f=path.join(d,'node_modules',...name.split('/'),'package.json');if(fs.existsSync(f)){assert(f.startsWith(app+path.sep),'Dependency escaped own checkout');real(f);return f;}const parent=path.dirname(d);if(parent===d)return null;d=parent;}}
  function packagedResolve(name,from){let d=from;while(true){const f=path.posix.join(d,'node_modules',name,'package.json');if(packageBy.has(f))return f;if(d==='')return null;const parent=path.posix.dirname(d);d=parent==='.'?'':parent;}}
  const graph=[],missingOptional=[],visited=new Set();
  function edge(name,installedParent,packagedParent,optional,kind){const input=installedResolve(name,installedParent),packed=packagedResolve(name,packagedParent);if(!input){assert(optional,'Required installed dependency missing: '+name);assert(!packed,'Unexpected packaged-only optional edge');missingOptional.push({name,from:installedParent,kind,reason:'Declared optional dependency absent in exact successful win32 npm-ci tree; never treated as a present runtime package'});return;}assert(packed,'Packaged transitive dependency missing: '+name+' from '+packagedParent);const p=JSON.parse(fs.readFileSync(input,'utf8')),q=packageBy.get(packed);assert.equal(q.name,p.name);assert.equal(q.version,p.version);graph.push({name,kind,installed:path.relative(app,input).replaceAll('\\','/'),packaged:packed,packageName:p.name,version:p.version});const key=input+'|'+packed;if(visited.has(key))return;visited.add(key);const next=path.dirname(input),target=path.posix.dirname(packed),optionalDeps=p.optionalDependencies||{};for(const name of Object.keys({...p.dependencies,...optionalDeps}))edge(name,next,target,Object.hasOwn(optionalDeps,name),'dependency');for(const name of Object.keys(p.peerDependencies||{}))if(installedResolve(name,next))edge(name,next,target,true,'installed-peer');const bundled=p.bundleDependencies||p.bundledDependencies||[];if(Array.isArray(bundled))for(const name of bundled)edge(name,next,target,false,'bundled');}
  for(const name of Object.keys(metadata.dependencies))edge(name,widget,'',false,'direct');
  const natives=['node_modules/better-sqlite3/build/Release/better_sqlite3.node','node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node'];
  const nativeIdentity=natives.map(file=>{const packaged=path.join(runtime,'resources/app.asar.unpacked',nativePath(file)),input=path.join(widget,nativePath(file));assert.equal(fileHash(packaged),fileHash(input));return{file,bytes:real(packaged).size,sha256:fileHash(packaged)};});
  save('production-dependency-inventory.json',{head,packages:dependencies,reachableEdges:graph,visitedPackageResolutions:visited.size,missingInstalledOptional:missingOptional,nativeIdentity});
  const installers=fs.readdirSync(dist).filter(x=>/^HomeBot Setup .+\.exe$/.test(x));assert.equal(installers.length,1);installer=path.join(dist,installers[0]);installerRecord={file:path.relative(stage,installer),bytes:real(installer).size,sha256:fileHash(installer)};
  save('frozen-runtime-inventory.json',{head,files:frozen});save('package-identity-before-scan.json',{...receipt,compiledFiles:compiled,runtimeFiles:frozen.length,executableSha256:fileHash(path.join(runtime,'HomeBot.exe')),asarSha256:fileHash(archive),installer:installerRecord,signing:'explicitly disabled',publishing:'never',integrityStatus:'pending'});
  function headerBytes(t){return Object.values(t.files||{}).reduce((s,v)=>s+(v.files?headerBytes(v):v.size||0),0);}
  save('capacity-before-integrity.json',capacity('before scanner',headerBytes(asar.getRawHeader(archive).header)+128*1024**2));
  assert(!fs.existsSync(path.join(dist,'asar-extract')));run('integrity',process.execPath,[scanner],path.join(stage,'widget'),production);assert(!fs.existsSync(path.join(dist,'asar-extract')));
  assert.deepEqual(inventory(runtime),frozen);assert.deepEqual({file:installerRecord.file,bytes:real(installer).size,sha256:fileHash(installer)},installerRecord);
  run('packaged-native-proof',process.execPath,[path.join(controls,'.github/owned-release/probe-owned-package.cjs'),app,stage],workspace,production);
  const proof=JSON.parse(fs.readFileSync(path.join(evidence,'packaged-native-proof.json'),'utf8'));assert.equal(proof.status,'passed-bounded-packaged-native');assert.equal(proof.applicationSHA,head);assert.equal(proof.workflowSHA,process.env.GITHUB_SHA);
  receipt.integrityStatus='passed';receipt.packagedNativeStatus='passed';receipt.status='passed-bounded-package';save('package-identity.json',{...receipt,authority:'Requires final source.json and artifact-files.json matching passed-bounded-package; earlier identity-before-scan never authorizes delivery.',compiledFiles:compiled,runtimeFiles:frozen.length,executableSha256:fileHash(path.join(runtime,'HomeBot.exe')),asarSha256:fileHash(archive),installer:installerRecord,proofRefs:['application-source-identity.json','phase-exits.json','scanner-identity.json','compiled-inventory.json','frozen-runtime-inventory.json','production-dependency-inventory.json','packaged-native-proof.json','packaged-main-exit.json','packaged-main-milestones.jsonl'].map(file=>({file:'evidence/'+file,sha256:fileHash(path.join(evidence,file))})),signing:'explicitly disabled',publishing:'never'});
 }catch(error){receipt.status='failed';receipt.error=String(error.stack||error);process.exitCode=1;}
 finally{
  try{source();if(baseline)for(const x of baseline)assert.equal(fileHash(path.join(app,x.file)),x.sha256,'Tracked source bytes changed: '+x.file);if(controlIdentity)for(const x of controlIdentity)assert.equal(fileHash(path.join(controls,x.file)),x.sha256);if(compiled)assert.deepEqual(inventory(path.join(widget,'out')),compiled);if(frozen)assert.deepEqual(inventory(path.join(stage,'widget/dist-electron/win-unpacked')),frozen);if(installerRecord){assert.equal(fileHash(installer),installerRecord.sha256);assert.equal(real(installer).size,installerRecord.bytes);}receipt.sourceAndArtifactsUnchanged=true;}
  catch(error){receipt.status='failed';receipt.preservationError=String(error.stack||error);process.exitCode=1;}
  receipt.completedUTC=new Date().toISOString();fs.writeFileSync(path.join(evidence,'source.json'),JSON.stringify(receipt,null,2)+'\n');
  // Final upload inventory excludes node_modules/fixture stores and failed scanner
  // extraction. Every uploaded file is pinned; upload-artifact supplies ZIP digest.
  try{const files=inventory(evidence).map(x=>({...x,file:'evidence/'+x.file}));const dist=path.join(stage,'widget/dist-electron');if(fs.existsSync(path.join(dist,'win-unpacked')))files.push(...inventory(path.join(dist,'win-unpacked')).map(x=>({...x,file:'widget/dist-electron/win-unpacked/'+x.file})));if(fs.existsSync(dist))for(const name of fs.readdirSync(dist))if(/\.exe(?:\.blockmap)?$/.test(name)||name==='latest.yml'){const f=path.join(dist,name);files.push({file:'widget/dist-electron/'+name,bytes:real(f).size,sha256:fileHash(f)});}assert(files.length<15000);assert(files.reduce((sum,x)=>sum+x.bytes,0)<4*1024**3);save('artifact-files.json',{...receipt,files,limits:'Bounded 4GiB logical/15000 file inventory; artifact digest must be captured from actual upload metadata. This manifest excludes itself.'});}
  catch(error){receipt.status='failed';receipt.artifactInventoryError=String(error.stack||error);process.exitCode=1;fs.writeFileSync(path.join(evidence,'source.json'),JSON.stringify(receipt,null,2)+'\n');}
  console.log(JSON.stringify(receipt));
 }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
