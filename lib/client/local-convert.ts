import type { FormatId, KindleOptions } from '@/lib/engine/types';
import type { LocalConvertMessage, LocalConvertReply } from './worker-protocol';

export interface LocalConvertInput {
  name: string;
  data: Uint8Array;
  target: FormatId;
  options?: KindleOptions;
}

export interface LocalConvertOutput {
  data: Uint8Array;
  filename: string;
  mime: string;
  warnings: string[];
  engine: string;
  durationMs: number;
  book?: { title?: string; author?: string; chapters?: number; images?: number };
}

export interface LocalConversion {
  promise: Promise<LocalConvertOutput>;
  cancel: () => void;
}

export function localWorkerSupported(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Run `lib/engine`'s isomorphic convert() inside a dedicated Web Worker.
 * A worker per conversion keeps cancellation trivial (terminate) and guarantees
 * the main thread stays responsive while an EPUB is being assembled.
 */
export function startLocalConversion(input: LocalConvertInput): LocalConversion {
  let worker: Worker | null = null;
  let settled = false;
  let rejectPromise: ((reason: unknown) => void) | null = null;

  const cleanup = () => {
    worker?.terminate();
    worker = null;
  };

  const promise = new Promise<LocalConvertOutput>((resolve, reject) => {
    rejectPromise = reject;
    if (!localWorkerSupported()) {
      settled = true;
      reject(new Error('Web Worker unavailable'));
      return;
    }
    try {
      worker = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      settled = true;
      reject(error);
      return;
    }

    const instance = worker;
    instance.onmessage = (event: MessageEvent<LocalConvertReply>) => {
      if (settled) return;
      const reply = event.data;
      if (!reply || typeof reply !== 'object') return;
      settled = true;
      cleanup();
      if (reply.type === 'done') {
        resolve({
          data: new Uint8Array(reply.data),
          filename: reply.filename,
          mime: reply.mime,
          warnings: Array.isArray(reply.warnings) ? reply.warnings : [],
          engine: reply.engine,
          durationMs: reply.durationMs,
          book: reply.book,
        });
      } else {
        const error = new Error(reply.message || 'local conversion failed') as Error & { code?: string };
        error.code = reply.code;
        reject(error);
      }
    };

    instance.onerror = (event) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(event.message || 'local worker error'));
    };

    instance.onmessageerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('local worker message error'));
    };

    const buffer = input.data.buffer.slice(input.data.byteOffset, input.data.byteOffset + input.data.byteLength) as ArrayBuffer;
    const message: LocalConvertMessage = {
      type: 'convert',
      name: input.name,
      target: input.target,
      options: input.options,
      data: buffer,
    };
    try {
      instance.postMessage(message, [buffer]);
    } catch (error) {
      settled = true;
      cleanup();
      reject(error);
    }
  });

  return {
    promise,
    cancel() {
      if (settled) return;
      settled = true;
      cleanup();
      rejectPromise?.(new DOMException('Aborted', 'AbortError'));
    },
  };
}
