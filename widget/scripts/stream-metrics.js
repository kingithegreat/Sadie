const fs = require('fs');
const os = require('os');
const path = require('path');

function findTelemetryFile() {
  if (process.env.TEST_USERDATA) {
    const p = path.join(process.env.TEST_USERDATA, 'logs', 'telemetry-events.log');
    if (fs.existsSync(p)) return p;
  }
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const p1 = path.join(appData, 'HomeBot', 'logs', 'telemetry-events.log');
  if (fs.existsSync(p1)) return p1;
  const p2 = path.join(os.homedir(), 'HOMEBOT_DIAG', 'telemetry-events.log');
  if (fs.existsSync(p2)) return p2;
  return null;
}

const file = findTelemetryFile();
if (!file) {
  console.error('No telemetry-events.log found (checked TEST_USERDATA, %APPDATA% and ~/HOMEBOT_DIAG)');
  process.exit(2);
}

const lines = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean);
const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const total = events.length;
const byEvent = {};
for (const e of events) {
  byEvent[e.event] = (byEvent[e.event] || 0) + 1;
}

console.log('Telemetry events file:', file);
console.log('Total events:', total);
console.log('Events by name:');
for (const k of Object.keys(byEvent).sort((a,b)=>byEvent[b]-byEvent[a])) {
  console.log(`  ${k}: ${byEvent[k]}`);
}
