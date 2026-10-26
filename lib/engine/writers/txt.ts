/**
 * Plain-text writer.
 *
 * Deliberately boring: chapter heading, blank line, prose, blank line between
 * paragraphs, `***` where the source had a scene break. UTF-8, no BOM — a BOM
 * makes some Kindle firmware show a stray glyph.
 */

import type { Book, KindleOptions } from '../types';
import { htmlToText } from '../util';

export async function writeTxt(book: Book, options: KindleOptions = {}): Promise<Uint8Array> {
  const meta = { ...book.meta, ...(options.metadata ?? {}) };
  const blocks: string[] = [];

  blocks.push(meta.title.trim() || '未命名书籍');
  if (meta.author) blocks.push(meta.author);
  if (meta.publisher) blocks.push(meta.publisher);

  for (const chapter of book.chapters) {
    const text = htmlToText(chapter.html);
    if (!text && !chapter.title) continue;
    if (chapter.title.trim()) {
      blocks.push('', chapter.title.trim(), '');
    } else {
      blocks.push('');
    }
    if (text) blocks.push(text);
  }

  const output = blocks
    .join('\n')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return new TextEncoder().encode(`${output}\n`);
}
