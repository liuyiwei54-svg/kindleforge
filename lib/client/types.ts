import type { Capability, DeviceId, FormatId } from '@/lib/engine/types';

export interface FormatCapabilities {
  pairs: Capability[];
  source: 'api' | 'builtin';
  engines?: { calibre: boolean; pandoc: boolean; tesseract: boolean };
}

export type ItemStatus =
  | 'idle'
  | 'preparing'
  | 'uploading'
  | 'running'
  | 'local'
  | 'done'
  | 'error'
  | 'canceled';

export interface ConversionOutput {
  filename: string;
  mime: string;
  size: number;
  engine: string;
  warnings: string[];
  /** Present for local conversions (browser-owned bytes). */
  data?: Uint8Array;
  /** Present for server conversions. */
  downloadUrl?: string;
  book?: { title?: string; author?: string; chapters?: number; images?: number };
}

export interface FileError {
  code: string;
  message: string;
  hint: string;
}

export interface FileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  from: FormatId;
  status: ItemStatus;
  progress: number;
  mode: 'local' | 'server' | null;
  jobId?: string;
  result?: ConversionOutput;
  error?: FileError;
  /** Non-fatal note, e.g. local→server fallback. */
  notice?: string;
}

export interface RecentEntry {
  to: FormatId;
  device?: DeviceId;
  at: number;
}
