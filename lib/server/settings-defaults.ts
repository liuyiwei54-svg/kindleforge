/** Shared v2 defaults/limits used by settings, library and the mailer. */
import type { FormatId } from '../engine/types';
import type { MetadataProvider } from '../shared/types';

export const DEFAULT_PROVIDERS: readonly MetadataProvider[] = ['douban', 'google', 'openlibrary'];

export const DEFAULT_SEND_LIMIT_MB = 25;
export const MAX_SEND_LIMIT_MB = 50;

/** Amazon accepts only these formats for Send to Kindle. */
export const SEND_FORMATS: readonly FormatId[] = ['epub', 'pdf', 'docx', 'txt'];

export const METADATA_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const METADATA_TIMEOUT_MS = 10_000;
/** Hard upper bound for one online metadata search, including all providers. */
export const METADATA_TOTAL_TIMEOUT_MS = 8_000;
export const COVER_MAX_BYTES = 8 * 1024 * 1024;
export const COVER_MAX_EDGE = 1200;
export const COVER_JPEG_QUALITY = 82;
export const SEND_LOG_LIMIT = 200;
