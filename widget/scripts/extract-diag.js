const fs = require('fs');

async function extractDiagLogs(tracePath) {
  const content = fs.readFileSync(tracePath, 'utf8');
  const lines = content.split('\n').filter(line => line.trim());
  const events = lines.map(line => JSON.parse(line));

  console.log('Total events:', events.length);
  const types = new Set(events.map(e => e.type));
  console.log('Event types:', [...types]);

  const consoleEvents = events.filter(event => event.type === 'console' || event.type === 'stdout' || event.type === 'stderr');

  console.log('Total console/stdout/stderr events:', consoleEvents.length);
  consoleEvents.forEach(event => console.log(event.type + ': ' + (event.text || event.data || '')));

  const diagLogs = [];
  for (let i = 0; i < consoleEvents.length; i++) {
    const event = consoleEvents[i];
    const text = event.text || '';
    if (text.includes('[DIAG]')) {
      const context = [];
      for (let j = Math.max(0, i - 2); j <= Math.min(consoleEvents.length - 1, i + 2); j++) {
        context.push(consoleEvents[j].text || '');
      }
      diagLogs.push({
        log: text,
        context: context
      });
    }
  }
  return diagLogs;
}

const tracePath = process.argv[2];
if (!tracePath) {
  console.error('Usage: node scripts/extract-diag.js <tracePath>');
  process.exit(1);
}

extractDiagLogs(tracePath).then(logs => {
  console.log(JSON.stringify(logs, null, 2));
}).catch(err => {
  console.error(err);
});