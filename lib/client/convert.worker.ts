/// <reference lib="webworker" />
/**
 * Local conversion worker. This is the zero-upload path: the File's bytes are
 * transferred into this worker, `lib/engine` converts them isomorphically, and
 * the resulting EPUB is transferred back. No network is involved anywhere.
 */
import { convert } from '@/lib/engine';
import { ConversionError } from '@/lib/engine/types';
import type { LocalConvertMessage, LocalConvertReply } from './worker-protocol';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = async (event: MessageEvent<LocalConvertMessage>) => {
  const message = event.data;
  if (!message || message.type !== 'convert') return;

  try {
    const result = await convert(
      { name: message.name, data: new Uint8Array(message.data) },
      { target: message.target, options: message.options },
    );
    const copy = result.data.buffer.slice(
      result.data.byteOffset,
      result.data.byteOffset + result.data.byteLength,
    ) as ArrayBuffer;
    const reply: LocalConvertReply = {
      type: 'done',
      data: copy,
      filename: result.filename,
      mime: result.mime,
      warnings: result.warnings,
      engine: result.engine,
      durationMs: result.durationMs,
      book: result.book,
    };
    ctx.postMessage(reply, [copy]);
  } catch (error) {
    const code = error instanceof ConversionError ? error.code : undefined;
    const text = error instanceof Error ? error.message : String(error);
    const reply: LocalConvertReply = { type: 'error', code, message: text };
    ctx.postMessage(reply);
  }
};
