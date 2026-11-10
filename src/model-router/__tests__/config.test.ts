import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO_DEFAULT_CONFIG_PATH, RouterConfigError, decideLive, loadRouterConfig, parseRouterConfig } from '../config';
import { tempDir } from './helpers';

const repoDefault = JSON.parse(fs.readFileSync(REPO_DEFAULT_CONFIG_PATH, 'utf8'));

describe('router config', () => {
  it('ships the agreed default tier models and fallbacks in config/model-router.json', () => {
    const config = loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: {} });
    expect(config.tiers.cheap.model).toBe('qwen/qwen3.7-flash');
    expect(config.tiers.cheap.fallbacks).toEqual(['deepseek/deepseek-v4.1-flash']);
    expect(config.tiers.mid.model).toBe('anthropic/claude-sonnet-5.5');
    expect(config.tiers.mid.fallbacks).toEqual(['openai/gpt-6.1-terra']);
    expect(config.tiers.top.model).toBe('anthropic/claude-opus-5.5');
    expect(config.tiers.top.fallbacks).toEqual(['openai/gpt-6.1-sol']);
    expect(config.live).toBe(false);
    expect(config.monthlyCapUsd).toBe(35);
    expect(config.chat).toEqual({ defaultTier: 'cheap', maxTier: 'mid' });
  });

  it('model IDs come from the file, not from code', () => {
    const dir = tempDir();
    const custom = JSON.parse(JSON.stringify(repoDefault));
    custom.tiers.cheap.model = 'z-ai/glm-5.3-flash';
    custom.tiers.cheap.fallbacks = ['qwen/qwen3.7-flash'];
    const file = path.join(dir, 'custom.json');
    fs.writeFileSync(file, JSON.stringify(custom));
    const config = loadRouterConfig({ path: file, env: {} });
    expect(config.tiers.cheap.model).toBe('z-ai/glm-5.3-flash');
    expect(config.source).toBe(file);
  });

  it('resolution order: explicit > MODEL_ROUTER_CONFIG > ~/.homebot shared > fallback', () => {
    const home = tempDir();
    const shared = path.join(home, '.homebot', 'model-router', 'config.json');
    fs.mkdirSync(path.dirname(shared), { recursive: true });
    const sharedCfg = { ...repoDefault, monthlyCapUsd: 7 };
    fs.writeFileSync(shared, JSON.stringify(sharedCfg));
    expect(loadRouterConfig({ env: {}, homeDir: home }).monthlyCapUsd).toBe(7);
    const envFile = path.join(home, 'env.json');
    fs.writeFileSync(envFile, JSON.stringify({ ...repoDefault, monthlyCapUsd: 9 }));
    expect(loadRouterConfig({ env: { MODEL_ROUTER_CONFIG: envFile }, homeDir: home }).monthlyCapUsd).toBe(9);
    expect(loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: { MODEL_ROUTER_CONFIG: envFile }, homeDir: home }).monthlyCapUsd).toBe(35);
    const emptyHome = tempDir();
    const fromFallback = loadRouterConfig({ env: {}, homeDir: emptyHome, fallback: { ...repoDefault, monthlyCapUsd: 3 } });
    expect(fromFallback.monthlyCapUsd).toBe(3);
    expect(fromFallback.ledgerPath).toBe(path.join(emptyHome, '.homebot', 'model-router', 'ledger.json'));
  });

  it('env overrides cap, ledger and live', () => {
    const config = loadRouterConfig({
      path: REPO_DEFAULT_CONFIG_PATH,
      env: { MODEL_ROUTER_MONTHLY_CAP_USD: '12.5', MODEL_ROUTER_LEDGER: '/tmp/x-ledger.json', MODEL_ROUTER_LIVE: 'true' },
    });
    expect(config.monthlyCapUsd).toBe(12.5);
    expect(config.ledgerPath).toBe(path.resolve('/tmp/x-ledger.json'));
    expect(config.live).toBe(true);
  });

  it('rejects bad config with the field at fault', () => {
    const bad = JSON.parse(JSON.stringify(repoDefault));
    bad.tiers.mid.model = 'not a model id';
    expect(() => parseRouterConfig(bad, 'x')).toThrow(/tiers\.mid\.model/);
    const missing = JSON.parse(JSON.stringify(repoDefault));
    delete missing.tiers.top;
    expect(() => parseRouterConfig(missing, 'x')).toThrow(RouterConfigError);
    const noCap = { ...repoDefault, monthlyCapUsd: -1 };
    expect(() => parseRouterConfig(noCap, 'x')).toThrow(/monthlyCapUsd/);
    expect(() => loadRouterConfig({ path: '/nonexistent/router.json', env: {} })).toThrow(/not found/);
  });

  it('live needs BOTH the live switch and the key', () => {
    const config = loadRouterConfig({ path: REPO_DEFAULT_CONFIG_PATH, env: {} });
    expect(decideLive(config, {}).live).toBe(false);
    expect(decideLive(config, { OPENROUTER_API_KEY: 'k' }).live).toBe(false);
    const liveConfig = { ...config, live: true };
    expect(decideLive(liveConfig, {}).live).toBe(false);
    expect(decideLive(liveConfig, {}).reason).toMatch(/OPENROUTER_API_KEY is not set/);
    expect(decideLive(liveConfig, { OPENROUTER_API_KEY: 'k' }).live).toBe(true);
  });
});
