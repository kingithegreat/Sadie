import { createStreamController, redactBeforeStream } from '../message-router';

describe('Streaming policy', () => {
  test('does not stream before reflection accept', async () => {
    const sc = createStreamController();
    const chunks: string[] = [];
    sc.onChunk(c => chunks.push(c));
    sc.emit('hello'); // suppressed by default
    expect(chunks).toHaveLength(0);
    sc.open();
    sc.emit('world');
    expect(chunks).toEqual(['world']);
  });

  test('suppresses stream on explain/fail', async () => {
    const sc = createStreamController();
    const chunks: string[] = [];
    sc.onChunk(c => chunks.push(c));
    sc.close();
    sc.emit('should-not-appear');
    expect(chunks).toHaveLength(0);
  });

  test('token pacing preserves order', async () => {
    const sc = createStreamController({ paceMs: 1 });
    const out: string[] = [];
    sc.onChunk(c => out.push(c));
    sc.open();
    await sc.emitTokens(['a', 'b', 'c']);
    expect(out).toEqual(['a', 'b', 'c']);
  });

  test('redaction removes tool artifacts', () => {
    const text = 'Result: {"path":"/Users/a/secret","success":true}';
    const redacted = redactBeforeStream(text);
    expect(redacted).not.toMatch(/\/Users\/a\/secret/);
    expect(redacted).toMatch(/\[redacted tool output\]/i);
  });
});
