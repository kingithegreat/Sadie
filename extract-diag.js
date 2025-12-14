const { TraceReader } = require('@playwright/test/lib/trace/reader');

async function extractDiagLogs(tracePath) {
  const reader = new TraceReader();
  await reader.load(tracePath);
  const events = reader.events;

  const diagLogs = [];
  for (const event of events) {
    if (event.type === 'console') {
      const text = event.text || '';
      if (text.includes('[DIAG]')) {
        // Find context: 2 lines before and after
        // But since events are sequential, need to find nearby console events
        const index = events.indexOf(event);
        const context = [];
        for (let i = Math.max(0, index - 2); i <= Math.min(events.length - 1, index + 2); i++) {
          if (events[i].type === 'console') {
            context.push(events[i].text || '');
          }
        }
        diagLogs.push({
          log: text,
          context: context
        });
      }
    }
  }
  return diagLogs;
}

const tracePath = process.argv[2];
if (!tracePath) {
  console.error('Usage: node extract-diag.js <tracePath>');
  process.exit(1);
}

extractDiagLogs(tracePath).then(logs => {
  console.log(JSON.stringify(logs, null, 2));
}).catch(err => {
  console.error(err);
});