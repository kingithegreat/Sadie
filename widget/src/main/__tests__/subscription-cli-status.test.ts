import { classifySubscriptionStatus } from '../subscription-cli-status';

describe('subscription CLI status classification', () => {
  test('Codex counts only a ChatGPT login as a subscription', () => {
    expect(classifySubscriptionStatus('codex', { code: 0, output: 'Logged in using ChatGPT' }).status).toBe('ready');
    expect(classifySubscriptionStatus('codex', { code: 0, output: 'Logged in using an API key' }).status).toBe('api-key');
    expect(classifySubscriptionStatus('codex', { code: 1, output: 'Not logged in' }).status).toBe('signed-out');
  });

  test('Claude counts OAuth but not API billing as a subscription', () => {
    expect(classifySubscriptionStatus('claude-code', { code: 0, output: JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' }) }).status).toBe('ready');
    expect(classifySubscriptionStatus('claude-code', { code: 0, output: JSON.stringify({ loggedIn: true, authMethod: 'apiKey' }) }).status).toBe('api-key');
    expect(classifySubscriptionStatus('claude-code', { code: 1, output: JSON.stringify({ loggedIn: false, authMethod: 'none' }) }).status).toBe('signed-out');
  });

  test('unrecognized successful output remains unverified', () => {
    expect(classifySubscriptionStatus('codex', { code: 0, output: 'Logged in using workload identity' }).status).toBe('unknown');
    expect(classifySubscriptionStatus('claude-code', { code: 0, output: '{bad json' }).status).toBe('unknown');
    expect(classifySubscriptionStatus('codex', null).status).toBe('unknown');
  });
});
