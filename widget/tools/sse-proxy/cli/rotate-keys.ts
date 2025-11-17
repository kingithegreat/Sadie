#!/usr/bin/env ts-node
import { fetch } from 'undici';
import readline from 'readline';

const rl = readline.createInterface(process.stdin, process.stdout);
function question(q: string) { return new Promise<string>(res => rl.question(q, res)); }

async function run() {
  const base = process.env.PROXY_ADMIN_BASE || 'http://localhost:5050';
  const adminKey = process.env.ADMIN_API_KEY || 'adminchangeme';
  const op = (process.argv[2] || '').toLowerCase();
  if (!['add', 'remove', 'list'].includes(op)) {
    console.log('Usage: rotate-keys.ts <add|remove|list>');
    process.exit(1);
  }
  if (op === 'list') {
    const r = await fetch(`${base}/admin/keys`, { headers: { 'x-sadie-admin-key': adminKey } });
    console.log(await r.text());
    process.exit(0);
  }
  const key = process.argv[3] || await question('Key: ');
  if (op === 'add') {
    const r = await fetch(`${base}/admin/keys`, { method: 'POST', headers: { 'x-sadie-admin-key': adminKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    console.log(await r.text());
  } else {
    const r = await fetch(`${base}/admin/keys`, { method: 'DELETE', headers: { 'x-sadie-admin-key': adminKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    console.log(await r.text());
  }
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
