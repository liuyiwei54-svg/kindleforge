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

export interface FileMetadata {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  /** Candidate cover URL, applied to the saved library entry / EPUB on save. */
  coverUrl?: string;
}

export type LibraryActionState = 'idle' | 'saving' | 'saved' | 'sending' | 'sent' | 'error';

export interface LibraryAction {
  state: LibraryActionState;
  entryId?: string;
  hint?: string;
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
  /** Metadata applied to the next conversion (title/author etc.). */
  metadata?: FileMetadata;
  /** Collected separately: the engine options type has no ISBN field. */
  isbn?: string;
  /** Non-fatal note, e.g. local→server fallback. */
  notice?: string;
}

export interface RecentEntry {
  to: FormatId;
  device?: DeviceId;
  at: number;
}
