/**
 * Book / Chapter construction helpers.
 *
 * Readers build the intermediate `Book` representation through this module so
 * every format ends up with the same guarantees: sequential ids, no empty
 * chapters, a title, a language and a cover when one exists.
 */

import type { Book, BookMeta, Chapter, FormatId, Resource } from './types';
import {
  countWords,
  detectChapterHeading,
  detectLanguage,
  escapeHtml,
  htmlToText,
  languageTag,
  readingMinutes,
  sanitizeHtml,
  truncateText,
} from './util';
import { cleanBaseName } from './util';

/**
 * Reader diagnostics travel with the Book so `convert()` can surface them
 * without changing the frozen `Reader` contract.
 */
const WARNINGS = Symbol.for('kindleforge.warnings');

export function attachWarnings(book: Book, warnings: string[]): void {
  (book as Book & { [WARNINGS]?: string[] })[WARNINGS] = warnings;
}

export function bookWarnings(book: Book): string[] {
  return (book as Book & { [WARNINGS]?: string[] })[WARNINGS] ?? [];
}

export interface BookInit {
  title: string;
  sourceFormat: FormatId;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  date?: string;
  subjects?: string[];
  coverPath?: string;
  fixedLayout?: boolean;
}

export function createBook(init: BookInit): Book {
  const meta: BookMeta = {
    title: init.title.trim() || '未命名书籍',
    sourceFormat: init.sourceFormat,
  };
  if (init.author) meta.author = init.author.trim();
  if (init.language) meta.language = init.language;
  if (init.publisher) meta.publisher = init.publisher;
  if (init.description) meta.description = init.description;
  if (init.date) meta.date = init.date;
  if (init.subjects?.length) meta.subjects = init.subjects;
  if (init.coverPath) meta.coverPath = init.coverPath;

  const book: Book = { meta, chapters: [], resources: [], sourceFormat: init.sourceFormat };
  if (init.fixedLayout) book.fixedLayout = true;
  return book;
}

export interface ChapterInit {
  title?: string;
  html: string;
  level?: number;
}

/** Append a chapter and return it (ids are re-assigned by normalizeBook). */
export function addChapter(book: Book, init: ChapterInit): Chapter {
  const chapter: Chapter = {
    id: `chapter-${String(book.chapters.length + 1).padStart(3, '0')}`,
    title: (init.title ?? '').trim(),
    html: init.html,
  };
  if (init.level !== undefined) chapter.level = init.level;
  book.chapters.push(chapter);
  return chapter;
}

export function addResource(book: Book, resource: Resource): Resource {
  const existing = book.resources.find((r) => r.path === resource.path);
  if (existing) return existing;
  book.resources.push(resource);
  return resource;
}

/** `Pride and Prejudice (z-lib.org).epub` -> `Pride and Prejudice` */
export function guessTitleFromFilename(filename: string): string {
  const base = cleanBaseName(filename);
  const stripped = base
    .replace(/^[\s_\-–—]+|[\s_\-–—]+$/g, '')
    .replace(/^《(.*)》$/, '$1')
    .replace(/(?:^|\s)(?:www\.[^\s]+|https?:\/\/\S+)$/i, '')
    .trim();
  return stripped || '未命名书籍';
}

export interface NormalizeOptions {
  /** Used when the book has no title yet. */
  fallbackTitle?: string;
  /** Chapters shorter than this (chars) get merged into their neighbour. */
  minChapterChars?: number;
  /** Set false to keep every chapter, however short (comics, fixed layout). */
  mergeShortChapters?: boolean;
  /** Warnings are appended (bilingual, short). */
  warnings?: string[];
}

function chapterStats(chapter: Chapter): { textLength: number; hasImage: boolean } {
  const hasImage = /<img\b/i.test(chapter.html);
  const text = htmlToText(chapter.html);
  return { textLength: text.length, hasImage };
}

/**
 * Fill in the blanks every reader leaves behind:
 * title/language defaults, empty-chapter removal, short-chapter merging,
 * sequential ids, cover selection.
 */
export function normalizeBook(book: Book, options: NormalizeOptions = {}): Book {
  const warnings = options.warnings;
  if (warnings) attachWarnings(book, warnings);
  const minChars = options.minChapterChars ?? 160;
  const mergeShort = options.mergeShortChapters !== false && book.fixedLayout !== true;

  // 1. Drop chapters with neither text nor pictures (a nav page, a section
  //    boundary, an empty Word paragraph run…).
  const kept = book.chapters.filter((c) => {
    const stats = chapterStats(c);
    return stats.hasImage || stats.textLength > 0;
  });
  if (kept.length !== book.chapters.length && warnings) {
    warnings.push(
      `已移除 ${book.chapters.length - kept.length} 个空章节（${book.chapters.length - kept.length} empty sections removed）`,
    );
  }
  book.chapters = kept;

  // 2. Merge very short chapters. A 2-line "chapter" is a layout artifact, not
  //    a chapter — but its heading is still useful as a section break.
  // Only a book with a real chapter list gets merged; in a five-chapter short
  // story a 100-character chapter is intentional.
  if (mergeShort && book.chapters.length >= 6) {
    const merged: Chapter[] = [];
    let mergeCount = 0;
    for (const chapter of book.chapters) {
      const stats = chapterStats(chapter);
      const target = merged[merged.length - 1];
      // Never merge something that announces itself as a chapter: a two-line
      // chapter titled "第一章" is a stylistic choice, not a parsing artefact.
      const declaresChapter = Boolean(chapter.title && detectChapterHeading(chapter.title));
      if (target && stats.textLength < minChars && !stats.hasImage && !declaresChapter) {
        const heading = chapter.title
          ? `<h3 class="section">${escapeHtml(chapter.title)}</h3>\n`
          : '';
        target.html = `${target.html}\n${heading}${chapter.html}`;
        mergeCount += 1;
        continue;
      }
      merged.push({ ...chapter });
    }
    if (mergeCount > 0 && warnings) {
      warnings.push(
        `已把 ${mergeCount} 个超短章节并入相邻章节（${mergeCount} very short sections merged）`,
      );
    }
    book.chapters = merged;
  }

  // 3. Stable sequential ids.
  book.chapters = book.chapters.map((chapter, i) => ({
    ...chapter,
    id: `chapter-${String(i + 1).padStart(3, '0')}`,
    title: chapter.title.trim(),
  }));

  // 4. Never hand a writer a chapterless book.
  if (book.chapters.length === 0) {
    const title = book.meta.title || options.fallbackTitle || '未命名书籍';
    book.chapters = [{ id: 'chapter-001', title, html: '<p></p>' }];
    if (warnings) warnings.push('原文件没有可读正文（no readable text found in the source）');
  }

  // 5. Title + language.
  if (!book.meta.title.trim()) {
    book.meta.title = options.fallbackTitle || '未命名书籍';
  }
  const sampleText = book.chapters
    .slice(0, 3)
    .map((c) => htmlToText(c.html))
    .join('\n')
    .slice(0, 8000);
  book.meta.language = languageTag(book.meta.language ?? detectLanguage(sampleText));

  // 6. Cover: honour meta.coverPath, else a resource that calls itself a cover,
  //    else (fixed layout) the first picture.
  const cover = pickCoverResource(book);
  if (cover) book.meta.coverPath = cover.path;
  else delete book.meta.coverPath;

  // 7. Resources: dedupe by path, drop empty payloads.
  const seen = new Set<string>();
  book.resources = book.resources.filter((r) => {
    if (!r.path || r.data.length === 0 || seen.has(r.path)) return false;
    seen.add(r.path);
    return true;
  });

  return book;
}

export function pickCoverResource(book: Book): Resource | undefined {
  if (book.meta.coverPath) {
    const exact = book.resources.find((r) => r.path === book.meta.coverPath);
    if (exact) return exact;
  }
  const images = book.resources.filter((r) => r.mediaType.startsWith('image/'));
  if (images.length === 0) return undefined;
  const named = images.find((r) => /(^|[/_.-])cover([/_.-]|$)/i.test(r.path));
  if (named) return named;
  if (book.fixedLayout) return images[0];
  return undefined;
}

export interface BookStats {
  chapters: number;
  words: number;
  images: number;
  readingMinutes: number;
}

export function bookStats(book: Book): BookStats {
  let words = 0;
  for (const chapter of book.chapters) {
    words += countWords(htmlToText(chapter.html));
  }
  return {
    chapters: book.chapters.length,
    words,
    images: book.resources.filter((r) => r.mediaType.startsWith('image/')).length,
    readingMinutes: readingMinutes(words),
  };
}

export function bookSummary(book: Book): NonNullable<import('./types').ConversionResult['book']> {
  const stats = bookStats(book);
  return {
    title: book.meta.title,
    author: book.meta.author,
    language: book.meta.language,
    chapters: stats.chapters,
    images: stats.images,
  };
}

/** Meta description fallback: first ~120 chars of real prose. */
export function autoDescription(book: Book): string | undefined {
  if (book.meta.description) return book.meta.description;
  for (const chapter of book.chapters) {
    const text = htmlToText(chapter.html);
    if (text.length > 40) return truncateText(text, 180);
  }
  return undefined;
}

/**
 * Canonicalise a chapter body: sanitise, strip a leading heading that merely
 * repeats the chapter title (readers extract it into `title`).
 */
export function cleanChapterHtml(html: string, title?: string): string {
  const { html: sanitized } = sanitizeHtml(html);
  let out = sanitized;
  if (title) {
    const leading = /^<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/i.exec(out);
    if (leading) {
      const headingText = htmlToText(leading[2]).trim();
      if (headingText && headingText === title.trim()) {
        out = out.slice(leading[0].length).trim();
      }
    }
  }
  return out;
}
