let executeTool: any;
let config: any;
try {
  // Prefer the compiled dist bundle to avoid TS parsing issues in Jest
  const dist = require('../../dist/main/index.js');
  executeTool = dist.executeTool;
  config = dist.assertPermission ? dist : require('../config-manager');
} catch (e) {
  // Fallback to source modules
  ({ executeTool } = require('../tools'));
  config = require('../config-manager');
}

jest.setTimeout(20000);

test('runtime smoke: nba_query executes without throwing', async () => {
  // Ensure permissions allow tool execution in test environment
  jest.spyOn(config, 'assertPermission').mockImplementation(() => true);

  const res = await executeTool({ name: 'nba_query', arguments: { team: 'LAL' } }, {});

  expect(res).toBeDefined();
  expect(typeof res.success).toBe('boolean');
});
