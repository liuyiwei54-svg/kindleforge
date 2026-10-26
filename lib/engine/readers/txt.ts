/**
 * Plain-text reader.
 *
 * TXT is the format people actually own a decade of. The job is to find the
 * chapter boundaries the author already wrote, not to invent structure. Encoding
 * detection lives in util so the same heuristics are reused by FB2 sidecars.
 */

import type { Book } from '../types';
import type { Reader } from './types';
import { addChapter, createBook, guessTitleFromFilename, normalizeBook } from '../model';
import {
  detectChapterHeading,
  detectTextEncoding,
  escapeHtml,
  isSceneBreak,
  normalizeSpace,
  splitParagraphs,
} from '../util';

type Block = { type: 'p'; text: string } | { type: 'hr' };

interface Section {
  title: string;
  blocks: Block[];
}

/** A chapter title must not keep the trailing punctuation people type. */
function cleanHeading(title: string): string {
  return normalizeSpace(title).replace(/[.。、，,：:；;]+$/g, '');
}

function sectionTextLength(section: Section | undefined): number {
  if (!section) return Number.POSITIVE_INFINITY;
  return section.blocks.reduce((sum, block) => sum + (block.type === 'p' ? block.text.length : 0), 0);
}

function blocksToHtml(blocks: Block[]): string {
  const out: string[] = [];
  for (const block of blocks) {
    if (block.type === 'hr') {
      if (out.length === 0) continue; // never start a chapter with a divider
      out.push('<hr class="scene-break"/>');
      continue;
    }
    const text = normalizeSpace(block.text);
    if (!text) continue;
    out.push(`<p>${escapeHtml(text)}</p>`);
  }
  // A trailing divider after the last paragraph is noise.
  while (out.length > 0 && out[out.length - 1].startsWith('<hr')) out.pop();
  return out.join('\n');
}

/**
 * Chapters longer than this are split at a paragraph boundary. 30k characters is
 * roughly 40 Kindle screens — big enough to keep a scene together, small enough
 * that the e-ink reader does not choke on one giant XHTML file.
 */
const MAX_CHAPTER_CHARS = 30_000;

function splitVeryLongSection(section: Section, titlePrefix: string): Section[] {
  const total = section.blocks.reduce(
    (n, b) => n + (b.type === 'p' ? b.text.length + 1 : 0),
    0,
  );
  if (total <= MAX_CHAPTER_CHARS) return [section];

  const parts: Section[] = [];
  let current: Block[] = [];
  let length = 0;
  let index = 1;
  const push = () => {
    if (current.length === 0) return;
    parts.push({
      title: parts.length === 0 ? section.title : `${section.title || titlePrefix} (${index})`,
      blocks: current,
    });
    current = [];
    length = 0;
    index += 1;
  };
  for (const block of section.blocks) {
    // A single giant paragraph (no blank lines at all) still has to be split,
    // preferring a sentence boundary near the limit.
    if (block.type === 'p' && block.text.length > MAX_CHAPTER_CHARS) {
      let rest = block.text;
      while (rest.length > 0) {
        const room = MAX_CHAPTER_CHARS - length;
        if (room <= 0) push();
        const take = Math.min(rest.length, Math.max(1000, MAX_CHAPTER_CHARS - length));
        let cut = take;
        if (take < rest.length) {
          const window = rest.slice(0, take);
          const sentence = Math.max(
            window.lastIndexOf('。'),
            window.lastIndexOf('！'),
            window.lastIndexOf('？'),
            window.lastIndexOf('. '),
            window.lastIndexOf('\n'),
          );
          if (sentence > take * 0.6) cut = sentence + 1;
        }
        current.push({ type: 'p', text: rest.slice(0, cut) });
        length += cut;
        rest = rest.slice(cut);
        if (rest.length > 0) push();
      }
      continue;
    }
    const size = block.type === 'p' ? block.text.length + 1 : 0;
    if (length > 0 && length + size > MAX_CHAPTER_CHARS) push();
    current.push(block);
    length += size;
  }
  push();
  return parts;
}

interface PreambleInfo {
  title?: string;
  author?: string;
}

/**
 * Recognise the "《书名》 / 作者：某某" block that starts most TXT novels. Only
 * short, sentence-free lines qualify — prose must never be mistaken for a header.
 */
function parsePreamble(lines: string[]): PreambleInfo | null {
  const paragraphs = lines.map((line) => normalizeSpace(line)).filter(Boolean).slice(0, 3);
  if (paragraphs.length === 0) return null;
  const joined = paragraphs.join('\n');
  if (joined.length > 120) return null;

  const titleLine = paragraphs[0];
  if (titleLine.length > 60 || /[。！？；，,]$/.test(titleLine)) return null;

  const info: PreambleInfo = {};
  const bookMatch = /^《(.+)》$/.exec(titleLine);
  info.title = (bookMatch ? bookMatch[1] : titleLine).trim();

  const authorLine = paragraphs[1];
  if (authorLine && authorLine.length <= 40) {
    const m = /^(?:作者|著者|著)\s*[:：]?\s*(.+)$/.exec(authorLine);
    if (m) info.author = m[1].trim();
    else if (/^by\s+/i.test(authorLine)) info.author = authorLine.replace(/^by\s+/i, '').trim();
    else if (!/[。！？；，,]/.test(authorLine) && /\p{Script=Han}/u.test(authorLine)) {
      info.author = authorLine.trim();
    }
  }
  return info;
}

export const readTxt: Reader = async (input) => {
  const decoded = detectTextEncoding(input.data);
  const warnings = [...decoded.warnings];
  const text = decoded.text.replace(/\r\n?/g, '\n').replace(/\u0000/g, '');

  const bookTitle = guessTitleFromFilename(input.name);
  const sections: Section[] = [];
  let current: Section = { title: '', blocks: [] };
  let paragraphLines: string[] = [];
  const preambleLines: string[] = [];
  let seenHeading = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const paragraphs = splitParagraphs(paragraphLines.join('\n'));
    for (const p of paragraphs) current.blocks.push({ type: 'p', text: p });
    paragraphLines = [];
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const heading = detectChapterHeading(line);
    if (heading) {
      flushParagraph();
      if (current.title || current.blocks.length > 0) sections.push(current);
      current = { title: cleanHeading(heading.title), blocks: [] };
      seenHeading = true;
      continue;
    }
    if (isSceneBreak(line)) {
      flushParagraph();
      current.blocks.push({ type: 'hr' });
      continue;
    }
    if (!seenHeading && preambleLines.length < 4) preambleLines.push(line.trim());
    paragraphLines.push(line);
  }
  flushParagraph();
  if (current.title || current.blocks.length > 0) sections.push(current);

  if (sections.length === 0) {
    sections.push({ title: '', blocks: [{ type: 'p', text: text.trim() }] });
  }

  const book: Book = createBook({ title: bookTitle, sourceFormat: 'txt' });

  // Most Chinese TXT files start with the title and the author before the first
  // chapter; two short header lines are metadata, not a chapter.
  const preambleInfo =
    sections.length > 1 && sections[0] && !sections[0].title && preambleLines.length > 0
      ? parsePreamble(preambleLines)
      : null;
  if (preambleInfo && sectionTextLength(sections[0]) <= 150) {
    if (preambleInfo.title) book.meta.title = preambleInfo.title;
    if (preambleInfo.author) book.meta.author = preambleInfo.author;
    sections.shift();
  }

  const headed = sections.filter((s) => s.title);
  let index = 0;
  for (const section of sections) {
    const isOnly = sections.length === 1;
    let title = section.title;
    if (!title && !isOnly) title = index === 0 ? '前言' : `正文 ${index + 1}`;
    if (!title && isOnly) title = ''; // single-piece text: the cover carries the title
    index += 1;

    const parts = splitVeryLongSection({ ...section, title }, bookTitle);
    for (const part of parts) {
      const html = blocksToHtml(part.blocks);
      if (!html) continue;
      addChapter(book, { title: part.title, html, level: 0 });
    }
  }

  if (headed.length === 0 && text.length > MAX_CHAPTER_CHARS) {
    warnings.push(
      `未识别到章节标题，已按每 ${MAX_CHAPTER_CHARS} 字拆分（no chapter headings found, split every ${MAX_CHAPTER_CHARS} chars）`,
    );
  }
  if (decoded.encoding !== 'utf-8') {
    warnings.push(`文本编码：${decoded.encoding.toUpperCase()}（encoding detected: ${decoded.encoding.toUpperCase()}）`);
  }

  // A txt file often starts with its own title repeated on line one.
  if (book.chapters.length > 0 && book.meta.title === '未命名书籍') {
    book.meta.title = bookTitle;
  }

  return normalizeBook(book, { fallbackTitle: bookTitle, warnings });
};
