import type { Book, ConverterInput } from '../types';

/**
 * Extra inputs a reader may use. Folder / ZIP batch uploads will fill this in;
 * single-file conversions leave it undefined. Kept optional so the contract
 * `(input) => Promise<Book>` still holds.
 */
export interface ReaderContext {
  /** Additional files addressed by their archive-relative path. */
  assets?: Map<string, { data: Uint8Array; mediaType?: string }>;
  /** Reserved for callers that want to receive diagnostics mid-read. */
  signal?: AbortSignal;
}

export type Reader = (input: ConverterInput, ctx?: ReaderContext) => Promise<Book>;
