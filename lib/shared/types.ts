/**
 * Cross-cutting v2 types shared by the server API and the browser.
 *
 * Type-only: importing this file from a client component must never pull
 * server code into the bundle. Keep it free of runtime values.
 */
import type { FormatId } from '../engine/types';

export type MetadataProvider = 'douban' | 'google' | 'openlibrary';

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  /** The password itself never leaves the server. */
  hasPassword: boolean;
}

export interface Settings {
  version: 1;
  library: { dir: string; autoSave: boolean };
  metadata: {
    enabled: boolean;
    providers: MetadataProvider[];
    language: 'auto' | 'zh' | 'en';
  };
  send: {
    smtp: SmtpSettings;
    kindleEmail: string;
    /** 25 by default, capped at 50 (Amazon's limit). */
    maxAttachmentMb: number;
  };
}

/** Partial update accepted by PUT /api/settings. */
export interface SettingsPatch {
  library?: Partial<Settings['library']>;
  metadata?: Partial<Settings['metadata']>;
  send?: {
    smtp?: Partial<SmtpSettings> & { password?: string; clearPassword?: boolean };
    kindleEmail?: string;
    maxAttachmentMb?: number;
  };
}

export interface LibraryEntry {
  id: string;
  /** File name on disk, relative to the library directory. */
  filename: string;
  title: string;
  author: string;
  format: FormatId;
  size: number;
  addedAt: number;
  updatedAt: number;
  sourceName?: string;
  sourceFormat?: FormatId;
  engine?: string;
  isbn?: string;
  publisher?: string;
  language?: string;
  description?: string;
  hasCover: boolean;
  /** Bumped whenever the cover changes, used as a cache-busting query. */
  coverVersion?: number;
  savedFromJobId?: string;
  sendCount?: number;
  lastSentAt?: number;
  lastSendOk?: boolean;
  /** True when the file vanished from disk behind our back. */
  missing?: boolean;
}

export interface LibraryList {
  entries: LibraryEntry[];
  total: number;
  dir: string;
}

export interface MetadataCandidate {
  provider: MetadataProvider;
  title: string;
  author: string;
  publisher?: string;
  publishedAt?: string;
  language?: string;
  isbn?: string;
  description?: string;
  /** Remote image URL (http/https only). */
  coverUrl?: string;
  /** Link to the provider's page for this book. */
  providerUrl?: string;
  /** Provider-specific id, useful for dedupe. */
  providerId?: string;
}

export interface MetadataSearchResult {
  ok: boolean;
  candidates: MetadataCandidate[];
  cached: boolean;
  /** 'offline' when every provider failed, so the UI can degrade quietly. */
  reason?: 'offline' | 'disabled' | 'empty';
  hint?: string;
}

/** Fields a user may edit on a library entry. */
export interface MetadataPatch {
  title?: string;
  author?: string;
  isbn?: string;
  publisher?: string;
  language?: string;
  description?: string;
  /** http(s) URL of a new cover. */
  coverUrl?: string;
}

export interface SendResult {
  ok: boolean;
  message: string;
  messageId?: string;
  hint?: string;
}

export interface SendLogEntry {
  entryId: string;
  title: string;
  at: number;
  ok: boolean;
  messageId?: string;
  code?: string;
}
