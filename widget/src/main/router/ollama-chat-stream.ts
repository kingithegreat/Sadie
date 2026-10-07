import { StringDecoder } from 'string_decoder';
import type { Readable } from 'stream';

/** Read Ollama's NDJSON records independently of HTTP chunk/UTF-8 boundaries. */
export function readOllamaChatStream(
  stream: Readable,
  signal: AbortSignal,
  onRecord: (record: any) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    let settled = false;
    let done = false;

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      stream.removeListener('data', data);
      stream.removeListener('end', end);
      stream.removeListener('close', close);
      // Retain the guarded error listener: an aborted HTTP stream may emit its
      // transport error after we have already settled this promise.
      if (error) reject(error);
      else resolve();
    }

    function parse(line: string, final = false): void {
      if (!line.trim() || settled) return;
      let record: any;
      try { record = JSON.parse(line); }
      catch { throw new Error(final ? 'The local model sent an incomplete response.' : 'The local model sent an invalid response.'); }
      if (record?.error) throw new Error(String(record.error));
      onRecord(record);
      if (record?.done === true) { done = true; finish(); stream.destroy(); }
    }

    function data(chunk: Buffer | string): void {
      if (settled) return;
      try {
        buffer += typeof chunk === 'string' ? chunk : decoder.write(chunk);
        let newline: number;
        while (!settled && (newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + 1);
          parse(line);
        }
      } catch (error) { finish(error as Error); stream.destroy(); }
    }

    function end(): void {
      if (settled) return;
      try {
        buffer += decoder.end();
        parse(buffer, true);
        if (!done) finish(new Error('The local model connection finished before the response was complete.'));
      } catch (error) { finish(error as Error); }
    }

    function close(): void {
      if (!settled) finish(new Error('The local model connection closed before the response was complete.'));
    }

    function abort(): void {
      const error = new Error('The local model request was cancelled.');
      error.name = 'AbortError';
      finish(error);
      stream.destroy();
    }

    stream.on('data', data);
    stream.on('end', end);
    stream.on('close', close);
    stream.on('error', (error: Error) => finish(error));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
