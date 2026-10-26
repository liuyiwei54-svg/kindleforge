/**
 * HTML reader.
 *
 * Saved web pages are 90% chrome. We locate the content root (article → main →
 * body), strip everything a Kindle cannot render, then rebuild chapters from the
 * h1–h3 outline.
 */

import type { Book } from '../types';
import type { Reader, ReaderContext } from './types';
import { addChapter, createBook, guessTitleFromFilename, normalizeBook } from '../model';
import {
  base64ToBytes,
  detectChapterHeading,
  extractBodyHtml,
  extractDocumentTitle,
  extractElementHtml,
  extractMetaContent,
  htmlToText,
  mediaTypeFromName,
  normalizeResourcePath,
  normalizeSpace,
  posixBasename,
  sanitizeHtml,
  truncateText,
} from '../util';

interface ImageSink {
  book: Book;
  warnings: string[];
  readerCtx?: ReaderContext;
  counter: { value: number };
}

export function resolveHtmlImage(src: string, alt: string, sink: ImageSink): string | null {
  const raw = src.trim();
  if (!raw) return null;

  if (/^data:/i.test(raw)) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(raw);
    if (!m) return null;
    const mediaType = m[1] || 'image/png';
    if (!mediaType.startsWith('image/')) return null;
    const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    sink.counter.value += 1;
    const path = `images/img-${String(sink.counter.value).padStart(3, '0')}.${ext}`;
    const data = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(m[3] ?? '');
    sink.book.resources.push({ path, data, mediaType });
    return path;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    sink.warnings.push(`已丢弃远程图片（remote image dropped）: ${truncateText(raw, 60)}`);
    return null;
  }

  const rel = normalizeResourcePath(raw);
  const asset =
    sink.readerCtx?.assets?.get(rel) ??
    sink.readerCtx?.assets?.get(posixBasename(rel)) ??
    undefined;
  if (!asset) {
    sink.warnings.push(
      `无法读取相对路径图片，已丢弃（relative image not accessible）: ${truncateText(rel, 60)}`,
    );
    return null;
  }
  const mediaType = asset.mediaType ?? mediaTypeFromName(rel) ?? 'image/png';
  sink.counter.value += 1;
  const base = posixBasename(rel).replace(/[^\w.-]+/g, '-');
  const path = `images/${String(sink.counter.value).padStart(3, '0')}-${base}`;
  sink.book.resources.push({ path, data: asset.data, mediaType });
  return path;
}

export interface HeadingSplit {
  title: string;
  level: number;
  body: string;
}

/**
 * A heading element often carries more than the chapter label: illustration
 * captions, page numbers, a "copyright" line. Prefer the line that looks like a
 * chapter marker, else the last meaningful line.
 */
export function chapterTitleFromHeading(rawHtml: string): string {
  const text = htmlToText(rawHtml);
  const lines = text
    .split('\n')
    .map((l) => normalizeSpace(l))
    .filter(Boolean);
  if (lines.length === 0) return '';
  for (const line of lines) {
    if (detectChapterHeading(line)) return truncateText(line, 90);
  }
  const useful = lines.filter(
    (l) => !/^(?:illustration|caption|copyright|\[|\()/i.test(l) && l.length > 1,
  );
  // Multi-line headings are usually display titles ("PRIDE. / and / PREJUDICE")
  // that only read correctly when joined, so join rather than pick a line.
  return truncateText((useful.length > 0 ? useful : lines).join(' '), 90);
}

export interface SplitOptions {
  /** The document's own title; a matching heading is a title page, not a chapter. */
  documentTitle?: string;
  /** A leading heading is the document title even when only one section follows. */
  promoteLeadingHeading?: boolean;
}

function comparable(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Split a sanitised fragment on `<h1>`–`<h3>`, nesting-aware. */
export interface SplitResult {
  blocks: HeadingSplit[];
  /** Title heading promoted out of the body (title page / article headline). */
  promotedTitle?: string;
}

export function splitHtmlByHeadings(
  html: string,
  maxLevel = 3,
  options: SplitOptions = {},
): SplitResult {
  const re = new RegExp(`<h([1-${maxLevel}])\\b[^>]*>([\\s\\S]*?)<\\/h\\1>`, 'gi');
  const matches: Array<{ index: number; end: number; level: number; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    matches.push({
      index: m.index,
      end: m.index + m[0].length,
      level: Number(m[1]),
      title: chapterTitleFromHeading(m[2]),
    });
  }
  if (matches.length === 0) {
    return { blocks: [{ title: '', level: 0, body: html }] };
  }

  let splitLevel = Math.min(...matches.map((x) => x.level));
  let startAt = matches[0].index;
  let titleFromHeading: string | null = null;

  // `# Book` followed by several `##` sections: the h1 is a title page, not a
  // chapter. Recognise it by position (leading) or by matching the doc title.
  const topMost = matches.find((x) => x.level === splitLevel);
  const docTitle = options.documentTitle ? comparable(options.documentTitle) : '';
  if (topMost) {
    const topTitle = comparable(topMost.title);
    const isTitlePage =
      titleIsLeading(html, topMost.index) ||
      (docTitle.length > 3 &&
        topTitle.length > 3 &&
        (topTitle === docTitle ||
          topTitle.includes(docTitle) ||
          docTitle.includes(topTitle)));
    const deeper = matches.filter((x) => x.level > topMost.level && x.index > topMost.index);
    const requiredSections = options.promoteLeadingHeading ? 1 : 2;
    if (isTitlePage && deeper.length >= requiredSections) {
      splitLevel = Math.min(...deeper.map((x) => x.level));
      startAt = topMost.end;
      titleFromHeading = topMost.title;
    }
  }

  const splits = matches.filter((x) => x.level === splitLevel && x.index >= startAt);
  const before = html.slice(startAt, splits[0]?.index ?? html.length);
  const blocks: HeadingSplit[] = [];

  if (before.trim() && splits.length > 0) {
    blocks.push({ title: '', level: 0, body: before });
  } else if (splits.length === 0) {
    blocks.push({ title: titleFromHeading ?? '', level: 0, body: html });
    return { blocks, promotedTitle: titleFromHeading ?? undefined };
  }

  splits.forEach((split, i) => {
    const end = i + 1 < splits.length ? splits[i + 1].index : html.length;
    blocks.push({
      title: split.title,
      level: Math.max(0, split.level - splitLevel),
      body: html.slice(split.end, end),
    });
  });
  return { blocks, promotedTitle: titleFromHeading ?? undefined };
}

function titleIsLeading(html: string, index: number): boolean {
  const prefix = html.slice(0, index);
  return htmlToText(prefix).length < 40;
}

export const readHtml: Reader = async (input, readerCtx) => {
  const decoded = new TextDecoder('utf-8').decode(input.data);
  const warnings: string[] = [];
  const html = decoded.replace(/\r\n?/g, '\n');

  const docTitle = extractDocumentTitle(html);
  const title = docTitle || guessTitleFromFilename(input.name);

  const langMatch = /<html\b[^>]*\blang=["']([^"']+)["']/i.exec(html);
  const author =
    extractMetaContent(html, 'author') ??
    extractMetaContent(html, 'dc.creator') ??
    extractMetaContent(html, 'article:author') ??
    undefined;

  const book: Book = createBook({
    title,
    sourceFormat: 'html',
    author: author ?? undefined,
    language: langMatch?.[1],
    description: extractMetaContent(html, 'description') ?? undefined,
  });

  const region =
    extractElementHtml(html, 'article') ??
    extractElementHtml(html, 'main') ??
    extractElementHtml(html, 'body') ??
    extractBodyHtml(html);

  const sink: ImageSink = { book, warnings, readerCtx, counter: { value: 0 } };
  const { html: clean } = sanitizeHtml(region, {
    resolveImage: (src, alt) => resolveHtmlImage(src, alt, sink),
  });

  const { blocks, promotedTitle } = splitHtmlByHeadings(clean, 3, {
    documentTitle: docTitle ?? undefined,
    promoteLeadingHeading: true,
  });
  const meaningful = blocks.filter((b) => htmlToText(b.body).length > 0 || /<img\b/i.test(b.body));
  // Body copy between the headline and the first sub-heading belongs to the
  // first section, not to a made-up "preface".
  if (meaningful.length > 1 && !meaningful[0].title && htmlToText(meaningful[0].body).length < 800) {
    meaningful[1] = { ...meaningful[1], body: `${meaningful[0].body}\n${meaningful[1].body}` };
    meaningful.shift();
  }
  if (meaningful.length === 0) {
    addChapter(book, { title: '', html: '<p></p>', level: 0 });
  } else {
    meaningful.forEach((block, index) => {
      let chapterTitle = block.title;
      if (!chapterTitle && index === 0 && meaningful.length > 1) chapterTitle = '前言';
      addChapter(book, { title: chapterTitle, html: block.body, level: block.level });
    });
  }

  // "Article title - Site name" in <title>: the h1 is the real book title.
  const firstHeading = promotedTitle ?? blocks.find((block) => block.title)?.title;
  if (firstHeading) {
    const normalizedFirst = firstHeading.replace(/\s+/g, '').toLowerCase();
    const normalizedDoc = book.meta.title.replace(/\s+/g, '').toLowerCase();
    if (normalizedDoc.includes(normalizedFirst) || normalizedDoc === normalizedFirst) {
      book.meta.title = firstHeading;
    }
  }

  return normalizeBook(book, { fallbackTitle: title, warnings });
};

/** Used by the DOCX reader, which produces sanitised HTML but no document tree. */
export function htmlChapters(html: string, sink: ImageSink): Array<{ title: string; html: string; level: number }> {
  const { blocks } = splitHtmlByHeadings(html);
  return blocks
    .filter((b) => htmlToText(b.body).length > 0 || /<img\b/i.test(b.body))
    .map((b) => ({ title: b.title, html: b.body, level: b.level }));
}

export function imageSinkFor(book: Book, warnings: string[], readerCtx?: ReaderContext): ImageSink {
  return { book, warnings, readerCtx, counter: { value: 0 } };
}
