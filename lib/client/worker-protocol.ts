import type { FormatId, KindleOptions } from '@/lib/engine/types';

export interface LocalConvertMessage {
  type: 'convert';
  name: string;
  target: FormatId;
  options?: KindleOptions;
  data: ArrayBuffer;
}

export interface LocalConvertSuccess {
  type: 'done';
  data: ArrayBuffer;
  filename: string;
  mime: string;
  warnings: string[];
  engine: string;
  durationMs: number;
  book?: { title?: string; author?: string; chapters?: number; images?: number };
}

export interface LocalConvertFailure {
  type: 'error';
  code?: string;
  message: string;
}

export type LocalConvertReply = LocalConvertSuccess | LocalConvertFailure;
