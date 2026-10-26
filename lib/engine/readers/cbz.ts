/**
 * CBZ reader (comic book ZIP). A CBZ is just a ZIP full of pictures, so this is
 * the same page builder as CBR/image, fed from JSZip.
 */

import JSZip from 'jszip';
import { ConversionError } from '../types';
import type { Reader } from './types';
import { guessTitleFromFilename, normalizeBook } from '../model';
import { buildComicBook, isComicImage, type ComicPage } from './comic';
import { naturalCompare } from '../util';
import { ZipBudget, assertArchiveSane, readZipEntry } from './zip-safety';

export const readCbz: Reader = async (input) => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.data);
  } catch {
    throw new ConversionError('INVALID_FILE', 'CBZ 不是有效的 ZIP 压缩包。', {
      zh: '请确认文件没有下载不完整；CBR/RAR 文件请把扩展名改成 .cbr。',
      en: 'The archive looks truncated. RAR comics should use the .cbr extension.',
    });
  }

  assertArchiveSane(zip);

  const all = Object.keys(zip.files);
  const names = all
    .filter((name) => !zip.files[name].dir && isComicImage(name))
    .sort(naturalCompare);
  if (names.length === 0) {
    throw new ConversionError('INVALID_FILE', 'CBZ 中没有图片。', {
      zh: '压缩包里需要 jpg/png/webp 等图片文件。',
      en: 'The archive contains no jpg/png/webp images.',
    });
  }

  const warnings: string[] = [];
  const budget = new ZipBudget();
  const pages: ComicPage[] = [];
  for (const name of names) {
    try {
      pages.push({ name, data: await readZipEntry(zip, name, budget) });
    } catch (error) {
      // A bomb must fail the whole conversion; a single corrupt page is skipped.
      if (error instanceof ConversionError) throw error;
      warnings.push(`图片无法读取，已跳过（unreadable page skipped）: ${name}`);
    }
  }

  const title = guessTitleFromFilename(input.name);
  const book = buildComicBook(pages, {
    title,
    sourceFormat: 'cbz',
    warnings,
  });
  if (book.chapters.length === 0) {
    throw new ConversionError('INVALID_FILE', 'CBZ 中的图片格式不受支持。', {
      zh: '请确认图片是 jpg/png/webp/gif 之一。',
      en: 'Images must be jpg, png, webp or gif.',
    });
  }
  return normalizeBook(book, { fallbackTitle: title, warnings, mergeShortChapters: false });
};
