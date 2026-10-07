import { randomBytes, randomUUID } from 'crypto';
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
export function snapshotWorkspaceLaunch(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): WorkspaceApprovedLaunch {
  const targetEnv = { ...env };
  delete targetEnv.HOMEBOT_IDE_GATE_PIPE; delete targetEnv.HOMEBOT_IDE_GATE_CAP;
  return { executable, args: [...args], env: targetEnv };
}

export const WORKSPACE_PROCESS_GATE_SOURCE = `
'use strict';
const net=require('node:net'), spawn=require('node:child_process').spawn;
const pipe=process.env.HOMEBOT_IDE_GATE_PIPE, capability=process.env.HOMEBOT_IDE_GATE_CAP;
delete process.env.HOMEBOT_IDE_GATE_PIPE; delete process.env.HOMEBOT_IDE_GATE_CAP;
if(!/^hbi-[a-f0-9-]{36}$/.test(pipe||'')||! /^[a-f0-9]{64}$/.test(capability||'')) process.exit(125);
// No project require, profile, npm, or preload runs while this core launcher waits.
let received=false, child, text='', acknowledged=false;
const deadline=setTimeout(()=>process.exit(125),10000);
const slash=String.fromCharCode(92),newline=String.fromCharCode(10);
const connection=net.connect(slash+slash+'.'+slash+'pipe'+slash+pipe);
const fail=()=>{ if(!acknowledged) process.exit(125); };
connection.on('error',fail); connection.on('end',fail);
connection.on('connect',()=>connection.write(capability+newline));
connection.on('data',value=>{
 if(received) return;
 text+=value.toString(); if(text.length>131072) return process.exit(125);
 const end=text.indexOf(newline); if(end<0) return;
 received=true;clearTimeout(deadline);
 let launch;try{launch=JSON.parse(text.slice(0,end));}catch{return process.exit(125);}
 if(!launch||typeof launch.executable!=='string'||!launch.executable||!Array.isArray(launch.args)||launch.args.some(x=>typeof x!=='string')||!launch.env||typeof launch.env!=='object'||Array.isArray(launch.env)) return process.exit(125);
 const env={...launch.env};delete env.HOMEBOT_IDE_GATE_PIPE;delete env.HOMEBOT_IDE_GATE_CAP;
 // Root remains alive for the inherited shell's Ctrl+C/Break handling.
 process.on('SIGINT',()=>{});process.on('SIGBREAK',()=>{});
 try{child=spawn(launch.executable,launch.args,{env,stdio:'inherit',shell:false,windowsHide:true});}catch{return process.exit(126);}
 child.once('error',()=>process.exit(126));
 child.once('spawn',()=>{
  if(!Number.isSafeInteger(child.pid)||child.pid<=0) return process.exit(126);
  acknowledged=true;connection.end(JSON.stringify({pid:child.pid})+newline);
 });
 child.once('exit',(code)=>process.exit(Number.isInteger(code)?code:1));
});
`;
