/**
 * Writer registry. Writers are isomorphic: `(book, options) => Uint8Array`.
 * Everything that a Kindle cannot open natively (MOBI/AZW3/PDF/DOCX) goes
 * through calibre in `index.ts`, not here.
 */

import type { Book, FormatId, KindleOptions } from '../types';
import { writeEpub } from './epub';
import { writeHtml } from './html';
import { writeTxt } from './txt';

/** Writers may accept an extra warnings sink (the HTML writer reports images). */
export type Writer = (
  book: Book,
  options: KindleOptions,
  warnings?: string[],
) => Promise<Uint8Array>;

export const WRITERS: Partial<Record<FormatId, Writer>> = {
  epub: writeEpub,
  html: writeHtml,
  txt: writeTxt,
};

export function writerFor(to: FormatId): Writer | undefined {
  return WRITERS[to];
}

export function hasWriter(to: FormatId): boolean {
  return typeof WRITERS[to] === 'function';
}

export { writeEpub, writeHtml, writeTxt };
