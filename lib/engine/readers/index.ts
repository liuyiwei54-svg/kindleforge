/**
 * Reader registry. `index.ts` is the only other module that imports this file;
 * keeping the registry here means adding a format is a one-line change.
 */

import type { Book, ConverterInput, FormatId } from '../types';
import type { Reader, ReaderContext } from './types';
import { readTxt } from './txt';
import { readMd } from './md';
import { readHtml } from './html';
import { readEpub } from './epub';
import { readDocx } from './docx';
import { readFb2 } from './fb2';
import { readCbz } from './cbz';
import { readCbr } from './cbr';
import { readImage } from './image';

export type { Reader, ReaderContext } from './types';

export const READERS: Partial<Record<FormatId, Reader>> = {
  txt: readTxt,
  md: readMd,
  html: readHtml,
  epub: readEpub,
  docx: readDocx,
  fb2: readFb2,
  cbz: readCbz,
  cbr: readCbr,
  image: readImage,
};

export function readerFor(from: FormatId): Reader | undefined {
  return READERS[from];
}

export function hasReader(from: FormatId): boolean {
  return typeof READERS[from] === 'function';
}

export async function readBook(
  from: FormatId,
  input: ConverterInput,
  ctx?: ReaderContext,
): Promise<Book> {
  const reader = READERS[from];
  if (!reader) throw new Error(`no reader for ${from}`);
  return reader(input, ctx);
}
