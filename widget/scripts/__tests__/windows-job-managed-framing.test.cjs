'use strict';
// Pure generated framing controls only; never call a Job/Win32/process method.
const {test}=require('node:test');
test('exact generated setup and managed JSON framing reject malformed authority without invoking kernel methods', {skip:process.platform!=='win32',timeout:15000},()=>{
const fs=require('fs'),path=require('path'),crypto=require('crypto'),cp=require('child_process'),vm=require('vm'),assert=require('assert');
const root=path.resolve(__dirname,'../../..'),ts=require(root+'/widget/node_modules/typescript');
// Both hosted lanes already own this artifact namespace; no environment-selected
// output, overwrite, or execution outside the fresh fixed product proof folder.
const proofRoot=path.join(root,'artifacts','ide-native-zero-retry');fs.mkdirSync(proofRoot,{recursive:true});
const out=fs.mkdtempSync(path.join(proofRoot,'managed-framing-'));
function phaseDiagnostic(phase,result,started){
 const value={phase,elapsedMs:Math.min(60000,Math.max(0,Date.now()-started)),status:result.status,signal:result.signal||null,
  error:result.error?{name:result.error.name,code:result.error.code||'UNKNOWN'}:null,
  stdout:String(result.stdout||'').slice(-4096),stderr:String(result.stderr||'').slice(-4096)};
 try{fs.writeFileSync(path.join(out,phase+'.json'),JSON.stringify(value,null,2),{flag:'wx'});}catch{value.diagnosticWriteFailed=true;}
 if(result.error||result.status!==0||result.signal)console.error('MANAGED-FRAMING-DIAGNOSTIC '+JSON.stringify(value));
 return value;
}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),sourceFile=root+'/widget/src/main/workspace-windows-job.ts',managed=root+'/widget/native/OwnedWindowsJob.cs',dll=path.join(out,'OwnedWindowsJob.dll');
const {compilerInputs}=require(root+'/widget/scripts/prepare-windows-job.cjs'),inputs=compilerInputs(process.env.SystemRoot||process.env.SYSTEMROOT);
const generated=ts.transpileModule(fs.readFileSync(sourceFile,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});let script;const {EventEmitter}=require('events');const mod={exports:{}};
vm.runInNewContext(generated.outputText,{module:mod,exports:mod.exports,process,Buffer,setTimeout:()=>1,clearTimeout(){},require:n=>n==='child_process'?{spawn(_exe,args){script=Buffer.from(args.at(-1),'base64').toString('utf16le');const child=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=()=>true;child.stdout=new EventEmitter();child.stderr=new EventEmitter();return child;}}:n==='./workspace-windows-job-asset'?{verifiedWorkspaceWindowsJobAsset:()=>({assembly:dll,sha256:'b'.repeat(64)})}:require(n)});mod.exports.createPendingWorkspaceWindowsJob();
fs.writeFileSync(out+'/generated.ps1',script);assert(!script.includes('Import-Module')&&!script.includes('ConvertFrom-Json')&&!script.includes('ConvertTo-Json'));
assert(!script.includes('[Console]::In.Peek()')); // A transient -1 cannot prove EOF.
const compileStarted=Date.now(),compiled=cp.spawnSync(inputs.compiler,['/nologo','/noconfig','/nostdlib+','/target:library','/optimize+','/platform:anycpu','/out:'+path.win32.normalize(dll),...inputs.references.map(f=>'/reference:'+f),path.win32.normalize(managed)],{cwd:inputs.framework,env:{SystemRoot:process.env.SystemRoot,TEMP:out,TMP:out},windowsHide:true,timeout:5000,encoding:'utf8',maxBuffer:32768});
const compileDiagnostic=phaseDiagnostic('compile',compiled,compileStarted);assert(!compiled.error&&compiled.status===0&&!compiled.signal,JSON.stringify(compileDiagnostic));
const setupReader=script.slice(script.indexOf('function ReadSetupLine'),script.indexOf('function Emit'));
const setupBody=script.slice(script.indexOf(' $encodedPath='),script.indexOf(' [Console]::Out.WriteLine(\'{"type":"phase","phase":"asset-load"}'));
assert(setupBody.length>100);const packet=(p,h='b'.repeat(64),pipe='',cap='')=>[Buffer.from(p).toString('base64'),h,pipe,cap].join('\n')+'\n';
const cases=[{name:'Unicode absolute path and empty gate',packet:packet('C:\\fixed é🌿 quoted apostrophe\\OwnedWindowsJob.dll'),ok:true},{name:'captured gate pair',packet:packet('C:\\fixed\\OwnedWindowsJob.dll','b'.repeat(64),'hbi-00000000-0000-0000-0000-000000000001','a'.repeat(64)),ok:true},{name:'invalid base64',packet:'!!!!\n'+ 'b'.repeat(64)+'\n\n\n',ok:false},{name:'invalid UTF8',packet:'/w==\n'+'b'.repeat(64)+'\n\n\n',ok:false},{name:'relative path',packet:packet('project.dll'),ok:false},{name:'NUL path',packet:packet('C:\\x\0.dll'),ok:false},{name:'wrong hash',packet:packet('C:\\x.dll','abc'),ok:false},{name:'missing setup line',packet:packet('C:\\x.dll').slice(0,-1),ok:false},{name:'oversized setup line',packet:'x'.repeat(8193)+'\n',ok:false},{name:'pipe without cap',packet:packet('C:\\x.dll','b'.repeat(64),'hbi-00000000-0000-0000-0000-000000000001'),ok:false},{name:'cap without pipe',packet:packet('C:\\x.dll','b'.repeat(64),'','a'.repeat(64)),ok:false}];
const encode=s=>Buffer.from(s).toString('base64');
const jsonPositive=JSON.stringify({id:1,operation:'go',launch:{executable:'C:\\fixed\\app.exe',args:['','spaces quote" trail\\','é🌿'],env:{PATH:'fixed',RULE:'é'},cwd:'C:\\fixed project'}});
const negatives=['[]','null','1','"text"','{"__proto__":{}}','{"nested":{"constructor":"x"}}','{"__type":"System.IO.FileInfo"}','{"a":'.repeat(20)+'0'+'}'.repeat(20),'x'.repeat(131073)];
const envelopeCheck=script.slice(script.indexOf('  if($request.id -isnot'),script.indexOf('  try {',script.indexOf('  if($request.id -isnot')));
assert(envelopeCheck.includes('foreach($key in $request.Keys)'));
const badEnvelopes=[{id:'1',operation:'query'},{id:1.5,operation:'query'},{id:true,operation:'query'},{id:0,operation:'query'},
 {id:-1,operation:'query'},{id:2147483648,operation:'query'},{id:1,operation:['query']},{id:1,operation:'query',extra:'ignored?'}];
let pure=`[Console]::Out.WriteLine('PHASE:fixture-entered');$ErrorActionPreference='Stop';$PSModuleAutoLoadingPreference='None';$errors=$null;$tokens=$null;[Management.Automation.Language.Parser]::ParseFile('${(out+'/generated.ps1').replace(/'/g,"''")}',[ref]$tokens,[ref]$errors)|Microsoft.PowerShell.Core\\Out-Null;if($errors.Count){throw 'parse'};[Console]::Out.WriteLine('PHASE:generated-parsed');[void][Reflection.Assembly]::Load([IO.File]::ReadAllBytes('${dll.replace(/'/g,"''")}'));[Console]::Out.WriteLine('PHASE:managed-loaded');\n${setupReader}\n`;
pure+=`[Console]::Out.WriteLine('PHASE:input-start');[void](ReadSetupLine 8192);[void](ReadSetupLine 64);[void](ReadSetupLine 40);[void](ReadSetupLine 64);$peek=[Console]::In.Peek();$realLine=ReadSetupLine 131072 $true;if($realLine -cne '{"id":1,"operation":"stop"}'){throw 'actual host reader'};[Console]::Out.WriteLine('PASS:actual host bounded Read obtains queued request');\n`;
for(const c of cases)pure+=`$packet=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(c.packet)}'));[Console]::SetIn([IO.StringReader]::new($packet));$accepted=$false;try{${setupBody};$accepted=$true}catch{[Console]::Out.WriteLine('CONTROL-ERROR:'+$_.Exception.Message)};if($accepted -ne $${c.ok}){throw 'setup control ${c.name}'};[Console]::Out.WriteLine('PASS:setup ${c.name}');\n`;
pure+=`$json=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(jsonPositive)}'));$value=[OwnedWindowsJob]::ParseFrame($json);if($value.id -isnot [int] -or $value.id -ne 1 -or $value.launch.args[2] -cne 'é🌿'){throw 'types'};$again=[OwnedWindowsJob]::ParseFrame([OwnedWindowsJob]::EncodeFrame($value));if($again.launch.args[0] -cne '' -or $again.launch.env.RULE -cne 'é'){throw 'roundtrip'};[Console]::Out.WriteLine('PASS:managed typed nested launch roundtrip');\n`;
for(let i=0;i<negatives.length;i++)pure+=`$line=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(negatives[i])}'));$accepted=$false;try{[void][OwnedWindowsJob]::ParseFrame($line);$accepted=$true}catch{};if($accepted){throw 'negative ${i}'};[Console]::Out.WriteLine('PASS:managed invalid frame ${i}');\n`;
for(let i=0;i<badEnvelopes.length;i++)pure+=`$request=[OwnedWindowsJob]::ParseFrame([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encode(JSON.stringify(badEnvelopes[i]))}')));$accepted=$false;try{${envelopeCheck};$accepted=$true}catch{};if($accepted){throw 'envelope ${i}'};[Console]::Out.WriteLine('PASS:managed invalid request ${i}');\n`;
pure+=`[Console]::SetIn([IO.StringReader]::new(''));if($null -ne (ReadSetupLine 8 $true)){throw 'clean EOF'};[Console]::Out.WriteLine('PASS:clean actual read EOF is distinct from missing setup');$refused=$false;try{[void](ReadSetupLine 8)}catch{$refused=$true};if(!$refused){throw 'missing setup'};[Console]::Out.WriteLine('PASS:missing setup refuses');[Console]::SetIn([IO.StringReader]::new('partial'));$refused=$false;try{[void](ReadSetupLine 8 $true)}catch{$refused=$true};if(!$refused){throw 'truncated request'};[Console]::Out.WriteLine('PASS:truncated request refuses');\n`;
fs.writeFileSync(out+'/pure.ps1','\uFEFF'+pure);
// Match the product EncodedCommand host. The immutable large pure fixture stays
// at its exact private path rather than exceeding Windows' argv length limit.
const invocation="[Console]::Out.WriteLine('PHASE:host-invoked'); & '"+path.win32.normalize(out+'/pure.ps1').replace(/'/g,"''")+"'";
const exe=path.win32.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),pureStarted=Date.now(),r=cp.spawnSync(exe,['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-EncodedCommand',Buffer.from(invocation,'utf16le').toString('base64')],{windowsHide:true,timeout:8000,encoding:'utf8',maxBuffer:32768,input:'warm\nhash\n\n\n{"id":1,"operation":"stop"}\n'});
const pureDiagnostic=phaseDiagnostic('pure',r,pureStarted);assert(!r.error&&r.status===0&&!r.signal,JSON.stringify(pureDiagnostic));
const checks=r.stdout.split(/\r?\n/).filter(l=>l.startsWith('PASS:'));assert.equal(checks.length,cases.length+negatives.length+badEnvelopes.length+5);
fs.writeFileSync(out+'/proof.json',JSON.stringify({sourceHead:cp.execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),hashes:{source:sha(fs.readFileSync(sourceFile)),managed:sha(fs.readFileSync(managed)),generated:sha(script),assembly:sha(fs.readFileSync(dll))},compiler:inputs.compiler,references:inputs.references,checks,passed:checks.length,scope:'Fixed compiler and generated PS parser, bounded setup/managed JSON pure methods only. No Create/Attach/Stop/PInvoke/Job/PTY/project/native app execution.'},null,2));console.log(JSON.stringify({out,passed:checks.length}));

});

test('framing failure diagnostics retain timeout/status/output bounds and cannot mask the original result on write failure',()=>{
 const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
 const source=fs.readFileSync(__filename,'utf8');
 const functionSource=source.slice(source.indexOf('function phaseDiagnostic('),source.indexOf('const sha='));
 const written=[],logged=[];let refuses=false;
 const report=vm.runInNewContext('('+functionSource.trim()+')',{out:'C:\\owned-proof',Date:{now:()=>100},path,
  fs:{writeFileSync:(file,text,options)=>{if(refuses)throw Error('fixture storage refused');written.push({file,text,options});}},
  console:{error:text=>logged.push(text)}});
 const first=report('pure',{status:null,signal:'SIGTERM',error:{name:'Error',code:'ETIMEDOUT'},stdout:'x'.repeat(9000),stderr:'bounded failure'},1);
 assert.equal(first.status,null);assert.equal(first.error.code,'ETIMEDOUT');assert.equal(first.signal,'SIGTERM');
 assert.equal(first.stdout.length,4096);assert.equal(first.stderr,'bounded failure');assert.equal(first.elapsedMs,99);
 assert.equal(written[0].options.flag,'wx');assert.match(logged[0],/MANAGED-FRAMING-DIAGNOSTIC/);
 refuses=true;const preserved=report('compile',{status:1,signal:null,error:null,stdout:'compiler failure',stderr:''},1);
 assert.equal(preserved.status,1);assert.equal(preserved.stdout,'compiler failure');assert.equal(preserved.diagnosticWriteFailed,true);
});
