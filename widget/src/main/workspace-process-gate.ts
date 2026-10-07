import { randomBytes, randomUUID } from 'crypto';
import * as path from 'path';
import type { WorkspaceApprovedLaunch } from './workspace-windows-job';

export interface WorkspaceProcessGate {
  pipeName: string;
  capability: string;
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

/** Fixed core-only launcher; the profile/npm command arrives after Job membership. */
export function createWorkspaceProcessGate(env: NodeJS.ProcessEnv): WorkspaceProcessGate {
  const pipeName = `hbi-${randomUUID()}`;
  const capability = randomBytes(32).toString('hex');
  return {
    pipeName, capability, executable: process.execPath, args: ['-e', WORKSPACE_PROCESS_GATE_SOURCE],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '', HOMEBOT_IDE_GATE_PIPE: pipeName, HOMEBOT_IDE_GATE_CAP: capability },
  };
}

/** Copy approved data before awaits; private bootstrap flags never reach targets. */
export function snapshotWorkspaceLaunch(executable: string, args: readonly string[], env: NodeJS.ProcessEnv, options: { cwd?: string; adapter?: 'cross-spawn' } = {}): WorkspaceApprovedLaunch {
  const targetEnv = { ...env };
  delete targetEnv.HOMEBOT_IDE_GATE_PIPE; delete targetEnv.HOMEBOT_IDE_GATE_CAP;
  if (options.cwd !== undefined && !path.isAbsolute(options.cwd)) throw new Error('The approved target working directory must be absolute.');
  const launch: WorkspaceApprovedLaunch = { executable, args: [...args], env: targetEnv, ...(options.cwd ? { cwd: options.cwd } : {}) };
  if (options.adapter) {
    if (options.adapter !== 'cross-spawn') throw new Error('The launch adapter is not supported.');
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    const comspec = process.env.comspec || process.env.ComSpec || process.env.COMSPEC || (systemRoot && path.win32.join(systemRoot, 'System32', 'cmd.exe'));
    if (!comspec || !path.win32.isAbsolute(comspec)) throw new Error('The main Windows command interpreter is unavailable.');
    launch.adapter = { kind: 'cross-spawn', modulePath: require.resolve('cross-spawn'), comspec };
  }
  return launch;
}

export const WORKSPACE_PROCESS_GATE_SOURCE = `
'use strict';
const net=require('node:net'), spawn=require('node:child_process').spawn;
const pipe=process.env.HOMEBOT_IDE_GATE_PIPE, capability=process.env.HOMEBOT_IDE_GATE_CAP;
delete process.env.HOMEBOT_IDE_GATE_PIPE; delete process.env.HOMEBOT_IDE_GATE_CAP;
if(!/^hbi-[a-f0-9-]{36}$/.test(pipe||'')||! /^[a-f0-9]{64}$/.test(capability||'')) process.exit(125);
// No project require, profile, npm, or preload runs while this core launcher waits.
let received=false, child, text='', acknowledged=false, accepted=false, completed;
const deadline=setTimeout(()=>process.exit(125),10000);
const slash=String.fromCharCode(92),newline=String.fromCharCode(10);
const connection=net.connect(slash+slash+'.'+slash+'pipe'+slash+pipe);
const fail=()=>{ if(!accepted) process.exit(125); };
connection.on('error',fail); connection.on('end',fail);
connection.on('connect',()=>connection.write(capability+newline));
connection.on('data',value=>{
 if(received) {
  text+=value.toString();if(text.length>4096)return process.exit(125);
  const end=text.indexOf(newline);if(end<0)return;
  if(accepted||text.slice(0,end)!=='accepted')return process.exit(125);
  accepted=true;clearTimeout(deadline);connection.end();if(completed)process.exit(completed.exitCode);return;
 }
 text+=value.toString(); if(text.length>131072) return process.exit(125);
 const end=text.indexOf(newline); if(end<0) return;
 received=true;clearTimeout(deadline);
 let launch;try{launch=JSON.parse(text.slice(0,end));}catch{return process.exit(125);}text='';
 if(!launch||typeof launch.executable!=='string'||!launch.executable||!Array.isArray(launch.args)||launch.args.some(x=>typeof x!=='string')||!launch.env||typeof launch.env!=='object'||Array.isArray(launch.env)) return process.exit(125);
 const env={...launch.env};delete env.HOMEBOT_IDE_GATE_PIPE;delete env.HOMEBOT_IDE_GATE_CAP;
 // Root remains alive for the inherited shell's Ctrl+C/Break handling.
 process.on('SIGINT',()=>{});process.on('SIGBREAK',()=>{});
 try{
  let spawnTarget=spawn;
  if(launch.adapter){
   if(launch.adapter.kind!=='cross-spawn'||typeof launch.adapter.modulePath!=='string'||typeof launch.adapter.comspec!=='string')return process.exit(126);
   // The absolute application anchor and parent comspec were snapshotted in
   // main. No package import runs before the verified Job handoff.
   process.env.comspec=launch.adapter.comspec;spawnTarget=require(launch.adapter.modulePath);
  }
  child=spawnTarget(launch.executable,launch.args,{env,...(launch.cwd?{cwd:launch.cwd}:{}),stdio:'inherit',shell:false,windowsHide:true});
 }catch{return process.exit(126);}
 child.once('error',()=>process.exit(126));
 child.once('spawn',()=>{
  if(!Number.isSafeInteger(child.pid)||child.pid<=0) return process.exit(126);
  acknowledged=true;connection.write(JSON.stringify({type:'spawn',pid:child.pid})+newline);
 });
 child.once('exit',(code)=>{
  if(!acknowledged)return process.exit(126);
  completed={type:'completed',pid:child.pid,exitCode:Number.isInteger(code)?code:1};
  if(accepted)return process.exit(completed.exitCode);
  connection.write(JSON.stringify(completed)+newline);
 });
});
`;
