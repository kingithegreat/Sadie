import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

process.env.NODE_ENV = 'test';

const testConfigDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sadie-test-'));
process.env.SADIE_TEST_CONFIG_DIR = testConfigDir;

console.log('[JEST SETUP] Test config directory:', testConfigDir);
