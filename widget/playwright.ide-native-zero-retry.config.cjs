'use strict';
const path = require('node:path');
const { EXPECTED_CASES } = require('../scripts/run-ide-native-zero-retry.cjs');
const testDir = process.env.HOMEBOT_NATIVE_ZERO_RETRY_TEST_DIR;
const output = process.env.HOMEBOT_NATIVE_ZERO_RETRY_OUTPUT;
if (!testDir || !output) throw Error('Use the native zero-retry runner; private fixture/artifact paths are required.');
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
module.exports = {
  testDir,
  testMatch: ['overlay.e2e.spec.ts', 'tooltip.e2e.spec.ts', 'workspace-problems.e2e.spec.ts'],
  grep: new RegExp('(?:' + EXPECTED_CASES.map(row => escape(row.title)).join('|') + ')$'),
  forbidOnly: true, fullyParallel: false, workers: 1, retries: 0, repeatEach: 1,
  timeout: 60000, globalTimeout: 300000, expect: { timeout: 15000 },
  reporter: [['line'], ['json', { outputFile: path.join(output, 'results.json') }], ['junit', { outputFile: path.join(output, 'results.xml') }]],
  outputDir: path.join(output, 'playwright-results'),
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure', video: 'retain-on-failure' }
};
