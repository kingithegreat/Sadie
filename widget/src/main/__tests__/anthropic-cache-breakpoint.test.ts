/**
 * The second cache breakpoint, on the conversation.
 *
 * The first sits at the end of the system block and covers tools + system.
 * Everything after it was re-read at full price every turn — and in an agentic
 * loop that is the part that grows: each round adds an assistant tool_use and
 * a tool_result, so by round five the uncached portion dwarfs the schemas the
 * first breakpoint saves. On Opus that is the largest cost lever available.
 */

import { withConversationCacheBreakpoint } from '../custom-llm-client';

const CACHE = { type: 'ephemeral' };
const msg = (role: string, content: any) => ({ role, content });
const markerCount = (msgs: any[]) =>
  msgs.filter(m => Array.isArray(m.content) && m.content.some((b: any) => b.cache_control)).length;

describe('marking the conversation prefix', () => {
  it('marks the second-to-last message, not the newest one', () => {
    // The newest message has never been seen, so caching it buys nothing; the
    // prefix BEFORE it is what repeats next turn.
    const out = withConversationCacheBreakpoint(
      [msg('user', 'one'), msg('assistant', 'two'), msg('user', 'three')],
      CACHE,
    );
    expect(out[1].content[0].cache_control).toEqual(CACHE);
    expect(Array.isArray(out[2].content)).toBe(false);
  });

  it('adds exactly one marker, so the four-breakpoint budget is not spent here', () => {
    const out = withConversationCacheBreakpoint(
      [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c'), msg('assistant', 'd'), msg('user', 'e')],
      CACHE,
    );
    expect(markerCount(out)).toBe(1);
  });

  it('leaves a short conversation alone', () => {
    // Nothing repeats yet, and the minimum cacheable prefix would ignore it.
    const short = [msg('user', 'hello'), msg('assistant', 'hi')];
    expect(withConversationCacheBreakpoint(short, CACHE)).toBe(short);
  });

  it('marks the last block of a tool-result message rather than a new one', () => {
    const out = withConversationCacheBreakpoint(
      [
        msg('user', 'do it'),
        msg('user', [{ type: 'tool_result', tool_use_id: 'a', content: 'ok' }]),
        msg('user', 'and now this'),
      ],
      CACHE,
    );
    expect(out[1].content).toHaveLength(1);
    expect(out[1].content[0].type).toBe('tool_result');
    expect(out[1].content[0].cache_control).toEqual(CACHE);
  });

  it('never sends an empty text block, which the API rejects', () => {
    const msgs = [msg('user', 'a'), msg('assistant', ''), msg('user', 'c')];
    // Left exactly as it was rather than marked with an empty block.
    expect(withConversationCacheBreakpoint(msgs, CACHE)).toBe(msgs);
  });

  it('does not mutate what the caller passed in', () => {
    const msgs = [msg('user', 'a'), msg('assistant', 'b'), msg('user', 'c')];
    const before = JSON.stringify(msgs);
    withConversationCacheBreakpoint(msgs, CACHE);
    expect(JSON.stringify(msgs)).toBe(before);
  });

  it('survives a malformed array rather than throwing mid-request', () => {
    expect(withConversationCacheBreakpoint(null as any, CACHE)).toBeNull();
    expect(withConversationCacheBreakpoint([], CACHE)).toEqual([]);
  });
});
