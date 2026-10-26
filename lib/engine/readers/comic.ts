/**
 * Shared comic / picture-book builder used by CBZ, CBR and single-image input.
 *
 * The result is a fixed-layout book: one XHTML page per picture (or per N
 * pictures), with the pixel size carried on the <img> so the EPUB writer can
 * emit a matching viewport meta tag.
 */

import type { Book, FormatId } from '../types';
import { addChapter, createBook } from '../model';
import {
  imageSize,
  mediaTypeFromBytes,
  mediaTypeFromName,
  naturalCompare,
  normalizeSpace,
  posixBasename,
} from '../util';
import { escapeHtml } from '../util';

export interface ComicPage {
  /** Archive path or filename; used for ordering and cover detection. */
  name: string;
  data: Uint8Array;
  mediaType?: string;
}

export interface ComicBuildOptions {
  title: string;
  sourceFormat: FormatId;
  /** Pictures per chapter. 1 (default) = one page per chapter. */
  pagesPerChapter?: number;
  warnings?: string[];
  language?: string;
  author?: string;
}

/** 8 MiB: above this an e-ink device visibly stalls loading a page. */
const PAGE_WARN_BYTES = 8 * 1024 * 1024;

export function buildComicBook(pages: ComicPage[], options: ComicBuildOptions): Book {
  const warnings = options.warnings ?? [];
  const perChapter = Math.max(1, options.pagesPerChapter ?? 1);
  const book: Book = createBook({
    title: options.title,
    sourceFormat: options.sourceFormat,
    language: options.language,
    author: options.author,
    fixedLayout: true,
  });

  const usable = pages
    .filter((page) => page.data.length > 0)
    .sort((a, b) => naturalCompare(a.name, b.name));

  const resources: Array<{ page: ComicPage; path: string; mediaType: string; width?: number; height?: number }> =
    [];
  for (const [index, page] of usable.entries()) {
    const snapshot = imageSize(page.data);
    const mediaType =
      page.mediaType ?? snapshot?.mediaType ?? mediaTypeFromBytes(page.data) ?? mediaTypeFromName(page.name);
    if (!mediaType || !mediaType.startsWith('image/')) continue;
    if (page.data.length > PAGE_WARN_BYTES) {
      warnings.push(
        `第 ${index + 1} 张图片超过 8MB，阅读器可能变慢（page ${index + 1} is over 8 MB and may load slowly）: ${posixBasename(page.name)}`,
      );
    }
    const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
    const path = `images/page-${String(index + 1).padStart(4, '0')}.${ext}`;
    book.resources.push({ path, data: page.data, mediaType });
    resources.push({ page, path, mediaType, width: snapshot?.width, height: snapshot?.height });
  }

  if (resources.length === 0) {
    return book;
  }

  const coverIndex = resources.findIndex((r) => /(^|[/_.-])cover([/_.-]|$)/i.test(r.page.name));
  const cover = resources[coverIndex === -1 ? 0 : coverIndex];
  book.meta.coverPath = cover.path;

  // One chapter per page is the honest mapping for a comic: page numbers in the
  // TOC match page numbers on the device.
  for (let start = 0; start < resources.length; start += perChapter) {
    const group = resources.slice(start, start + perChapter);
    const html = group
      .map((item, offset) => {
        const pageNumber = start + offset + 1;
        const size =
          item.width && item.height ? ` width="${item.width}" height="${item.height}"` : '';
        return `<div class="page"><img src="${item.path}" alt="${escapeHtml(
          `第 ${pageNumber} 页`,
        )}"${size}/></div>`;
      })
      .join('\n');
    const from = start + 1;
    const to = start + group.length;
    const title =
      perChapter === 1
        ? `第 ${from} 页`
        : `第 ${from}–${to} 页`;
    addChapter(book, { title, html, level: 0 });
  }

  if (book.meta.title.trim() === '') book.meta.title = options.title;
  book.meta.language = options.language ?? 'zh-CN';
  warnings.push(`图片已按整页排版（${resources.length} fixed-layout pages）`);
  return book;
}

/** Accept only entries whose extension looks like a picture. */
export function isComicImage(name: string): boolean {
  return mediaTypeFromName(normalizeSpace(name))?.startsWith('image/') ?? false;
}
