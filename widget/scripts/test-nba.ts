import path from 'path';

// Import only the NBA tool handler to avoid side effects
const { nbaQueryHandler } = require('../src/main/tools/nba');

(async () => {
  try {
    // Test multiple scenarios
    const tests = [
      { type: 'news', query: 'Stephen Curry', perPage: 5 },
      { type: 'games', query: 'Warriors', date: new Date().toISOString().slice(0,10).replace(/-/g,'-'), perPage: 5 },
      { type: 'roster', query: 'Warriors', perPage: 10 },
      { type: 'players', query: 'Stephen', perPage: 5 }
    ];

    for (const args of tests) {
      try {
        console.log('[TEST] Running:', args);
        const res = await nbaQueryHandler(args);
        console.log('[TEST] Result:', args.type, JSON.stringify(res, null, 2));
      } catch (err) {
        console.error('[TEST] Error for', args, err);
      }
    }
  } catch (err) {
    console.error('[TEST] Error running test:', err);
  }
})();