/**
 * A dead TTS socket must not break narration until the app restarts.
 *
 * Reported live from Media Studio:
 *
 *   "Could not record the narration: Stream closed before the synthesis
 *    completed (no turn.end received). The audio is likely truncated."
 *
 * followed by it continuing to fail. That second part is the diagnosis. The
 * MsEdgeTTS instance is a module-level singleton holding a WebSocket to
 * Microsoft's service; the service closes idle sockets, the instance survives,
 * and `getTTS`'s fast path hands the dead one back forever. A transient network
 * blip does not repeat indefinitely — a cached dead socket does.
 */

import { isRecoverableStreamError } from '../tools/voice';

describe('recognising a dead connection', () => {
  test('the exact error the user saw is recoverable', () => {
    const err = new Error(
      'Stream closed before the synthesis completed (no turn.end received). The audio is likely truncated.'
    );
    expect(isRecoverableStreamError(err)).toBe(true);
  });

  test('the other ways a socket dies', () => {
    for (const m of [
      'WebSocket is not open',
      'socket hang up',
      'read ECONNRESET',
      'write EPIPE',
      'Not connected',
    ]) {
      expect(isRecoverableStreamError(new Error(m))).toBe(true);
    }
  });

  test('case does not matter — these strings come from several libraries', () => {
    expect(isRecoverableStreamError(new Error('STREAM CLOSED'))).toBe(true);
  });

  test('a bad request is NOT retried', () => {
    // Retrying a rejected voice or malformed SSML just fails twice as slowly,
    // and hides the real message behind a delay.
    expect(isRecoverableStreamError(new Error('No Edge TTS voice available'))).toBe(false);
    expect(isRecoverableStreamError(new Error('Text-to-speech produced no audio file.'))).toBe(false);
    expect(isRecoverableStreamError(new Error('Invalid SSML'))).toBe(false);
  });

  test('non-Error inputs do not throw', () => {
    expect(isRecoverableStreamError(undefined)).toBe(false);
    expect(isRecoverableStreamError(null)).toBe(false);
    expect(isRecoverableStreamError('stream closed')).toBe(true);
  });
});
