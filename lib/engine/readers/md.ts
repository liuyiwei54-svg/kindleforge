/**
 * Markdown reader.
 *
 * A deliberately small Markdown subset — the one people actually write books
 * and notes in: headings, paragraphs, emphasis, links, images, lists, quotes,
 * fenced code and pipe tables. No plugin ecosystem, no surprise HTML.
 */

import type { Book } from '../types';
import type { Reader, ReaderContext } from './types';
import { addChapter, createBook, guessTitleFromFilename, normalizeBook } from '../model';
import {
  base64ToBytes,
  decodeEntities,
  escapeHtml,
  mediaTypeFromName,
  normalizeResourcePath,
  posixBasename,
  sanitizeHtml,
  truncateText,
} from '../util';

interface Frontmatter {
  [key: string]: string;
}

function parseFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const normalized = text.replace(/\r\n?/g, '\n');
  if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized };
  const end = normalized.indexOf('\n---', 4);
  if (end === -1) return { frontmatter: {}, body: normalized };
  const raw = normalized.slice(4, end);
  const frontmatter: Frontmatter = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2].replace(/^["']|["']$/g, '').trim();
    if (value) frontmatter[m[1].toLowerCase()] = value;
  }
  const body = normalized.slice(end + 4).replace(/^\n/, '');
  return { frontmatter, body };
}

interface Heading {
  lineIndex: number;
  level: number;
  text: string;
}

function collectHeadings(lines: string[]): Heading[] {
  const headings: Heading[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) headings.push({ lineIndex: i, level: m[1].length, text: m[2].trim() });
  });
  return headings;
}

function joinWrappedLines(lines: string[]): string {
  let out = '';
  for (const line of lines) {
    const piece = line.trim();
    if (!piece) continue;
    if (!out) {
      out = piece;
      continue;
    }
    const prev = out[out.length - 1] ?? '';
    const next = piece[0] ?? '';
    const cjk = /\p{Script=Han}/u.test(prev) && /\p{Script=Han}/u.test(next);
    const wasHardBreak = /  $/.test(out);
    out += wasHardBreak ? `\n${piece}` : cjk ? piece : ` ${piece}`;
  }
  return out;
}

interface RenderContext {
  book: Book;
  warnings: string[];
  readerCtx?: ReaderContext;
  imageCounter: { value: number };
}

function addImageResource(ctx: RenderContext, src: string, alt: string): string | null {
  const trimmed = src.trim();
  if (!trimmed) return null;

  if (/^data:/i.test(trimmed)) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/is.exec(trimmed);
    if (!m) {
      ctx.warnings.push(`无法解析的内联图片（unparsable inline image）: ${truncateText(alt || 'image', 30)}`);
      return null;
    }
    const mediaType = m[1] || 'image/png';
    if (!mediaType.startsWith('image/')) return null;
    const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    ctx.imageCounter.value += 1;
    const path = `images/md-${String(ctx.imageCounter.value).padStart(3, '0')}.${ext}`;
    const data = m[2] ? base64ToBytes(m[3]) : new TextEncoder().encode(decodeEntities(m[3] ?? ''));
    ctx.book.resources.push({ path, data, mediaType });
    return path;
  }

  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    ctx.warnings.push(
      `已丢弃远程图片（remote image dropped）: ${truncateText(trimmed, 60)}`,
    );
    return null;
  }

  // Relative path: resolvable only when the caller supplied sibling files.
  const rel = normalizeResourcePath(trimmed);
  const asset = ctx.readerCtx?.assets?.get(rel);
  if (!asset) {
    ctx.warnings.push(
      `无法读取相对路径图片，已丢弃（relative image not accessible）: ${truncateText(rel, 60)}`,
    );
    return null;
  }
  const mediaType = asset.mediaType ?? mediaTypeFromName(rel) ?? 'image/png';
  ctx.imageCounter.value += 1;
  const base = posixBasename(rel).replace(/[^\w.-]+/g, '-');
  const path = `images/${String(ctx.imageCounter.value).padStart(3, '0')}-${base}`;
  ctx.book.resources.push({ path, data: asset.data, mediaType });
  return path;
}

const INLINE_SOURCE =
  '(`[^`\\n]+`)|(!\\[[^\\]\\n]*\\]\\([^)\\n]+\\))|(\\[[^\\]\\n]+\\]\\([^)\\n]+\\))|(\\*\\*[^*\\n]+\\*\\*)|(__[^_\\n]+__)|(~~[^~\\n]+~~)|(\\*[^*\\n]+\\*)|(_[^_\\n]+_)|(<https?:\\/\\/[^>\\s]+>)|(<br\\s*\\/?>)';

function renderInline(input: string, ctx: RenderContext): string {
  let out = '';
  let last = 0;
  // Fresh instance per call: renderInline recurses, and a shared /g regex would
  // reset lastIndex from the inner call and loop forever.
  const pattern = new RegExp(INLINE_SOURCE, 'gi');
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(input))) {
    out += escapeHtml(input.slice(last, m.index));
    const token = m[0];
    last = m.index + token.length;

    if (token.startsWith('`')) {
      out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
      continue;
    }
    if (token.startsWith('![')) {
      const img = /^!\[([^\]]*)\]\((.*)\)$/.exec(token);
      const alt = img ? img[1] : '';
      const rawSrc = img ? img[2].trim().replace(/\s+"[^"]*"$/, '') : '';
      const resolved = addImageResource(ctx, rawSrc, alt);
      if (resolved) out += `<img src="${escapeHtml(resolved)}" alt="${escapeHtml(alt)}"/>`;
      else if (alt) out += `<em>${escapeHtml(alt)}</em>`;
      continue;
    }
    if (token.startsWith('[')) {
      const link = /^\[([^\]]+)\]\((.*)\)$/.exec(token);
      if (!link) {
        out += escapeHtml(token);
        continue;
      }
      const href = link[2].trim().replace(/\s+"[^"]*"$/, '');
      const label = link[1];
      if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
        out += `<a href="${escapeHtml(href)}">${renderInline(label, ctx)}</a>`;
      } else {
        // Internal/relative links cannot be resolved to a book resource here.
        out += renderInline(label, ctx);
      }
      continue;
    }
    if (token.startsWith('**') || token.startsWith('__')) {
      out += `<strong>${renderInline(token.slice(2, -2), ctx)}</strong>`;
      continue;
    }
    if (token.startsWith('~~')) {
      out += `<del>${renderInline(token.slice(2, -2), ctx)}</del>`;
      continue;
    }
    if (token.startsWith('*') || token.startsWith('_')) {
      out += `<em>${renderInline(token.slice(1, -1), ctx)}</em>`;
      continue;
    }
    if (token.startsWith('<https')) {
      const href = token.slice(1, -1);
      out += `<a href="${escapeHtml(href)}">${escapeHtml(href)}</a>`;
      continue;
    }
    // <br> and friends: keep as XHTML void tags.
    out += token.replace(/\s*\/?>$/, '/>');
  }
  out += escapeHtml(input.slice(last));
  return out;
}

function renderTable(lines: string[], ctx: RenderContext): string {
  const cells = (line: string) =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  const thead = `<thead><tr>${header.map((c) => `<th>${renderInline(c, ctx)}</th>`).join('')}</tr></thead>`;
  const tbody = rows.length
    ? `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${renderInline(c, ctx)}</td>`).join('')}</tr>`)
        .join('')}</tbody>`
    : '';
  return `<table>${thead}${tbody}</table>`;
}

function isTableStart(lines: string[], i: number): boolean {
  if (i + 1 >= lines.length) return false;
  if (!lines[i].includes('|')) return false;
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1]);
}

function startsBlock(line: string): boolean {
  return (
    /^\s*(```|~~~)/.test(line) ||
    /^\s*#{1,6}\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*([-*+]|\d+[.)])\s+/.test(line) ||
    /^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line) ||
    /^\s*</.test(line)
  );
}

export function renderMarkdownBlocks(lines: string[], ctx: RenderContext): string {
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Fenced code (info string ignored — we do not need syntax classes).
    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const marker = fence[1];
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith(marker)) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      out.push(`<h${heading[1].length}>${renderInline(heading[2], ctx)}</h${heading[1].length}>`);
      i += 1;
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      // `---` directly under text is a setext h2, but we already handled the
      // common ATX headings; treat it as a scene divider.
      out.push('<hr class="scene-break"/>');
      i += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdownBlocks(quote, ctx)}</blockquote>`);
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const itemLines = [lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '')];
        i += 1;
        while (
          i < lines.length &&
          lines[i].trim() &&
          !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
          !startsBlock(lines[i])
        ) {
          itemLines.push(lines[i]);
          i += 1;
        }
        items.push(`<li>${renderInline(joinWrappedLines(itemLines), ctx)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }

    if (isTableStart(lines, i)) {
      const table: string[] = [lines[i], lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        table.push(lines[i]);
        i += 1;
      }
      out.push(renderTable(table, ctx));
      continue;
    }

    // A raw HTML block: let the sanitiser decide what survives.
    if (/^\s*</.test(line)) {
      const block: string[] = [];
      while (i < lines.length && lines[i].trim() && !/^\s*$/.test(lines[i])) {
        block.push(lines[i]);
        i += 1;
      }
      // Re-run through the HTML path so entities and nesting stay valid.
      const { html } = sanitizeInlineHtml(block.join('\n'), ctx);
      out.push(html);
      continue;
    }

    // Paragraph.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length > 0) {
      out.push(`<p>${renderInline(joinWrappedLines(para), ctx)}</p>`);
      continue;
    }
    i += 1;
  }

  return out.join('\n');
}

function sanitizeInlineHtml(html: string, ctx: RenderContext): { html: string } {
  return sanitizeHtml(html, {
    resolveImage: (src, alt) => {
      if (/^data:/i.test(src)) return addImageResource(ctx, src, alt);
      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
        ctx.warnings.push(`已丢弃远程图片（remote image dropped）: ${truncateText(src, 60)}`);
        return null;
      }
      return addImageResource(ctx, src, alt);
    },
  });
}

export const readMd: Reader = async (input, readerCtx) => {
  const text = new TextDecoder('utf-8').decode(input.data);
  const { frontmatter, body } = parseFrontmatter(text);
  const warnings: string[] = [];
  const book: Book = createBook({
    title: frontmatter.title || guessTitleFromFilename(input.name),
    sourceFormat: 'md',
    author: frontmatter.author,
    language: frontmatter.language,
    publisher: frontmatter.publisher,
    description: frontmatter.description,
    date: frontmatter.date,
  });
  if (frontmatter.subjects) {
    book.meta.subjects = frontmatter.subjects.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const ctx: RenderContext = { book, warnings, readerCtx, imageCounter: { value: 0 } };
  const lines = body.split('\n');
  const headings = collectHeadings(lines);

  // A single leading `# Title` followed by several lower-level headings is a
  // book title, not a chapter.
  let splitLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;
  let startLine = 0;
  const first = headings[0];
  if (
    first &&
    first.level === splitLevel &&
    first.lineIndex <= 8 &&
    headings.filter((h) => h.level > first.level).length >= 2
  ) {
    const headingText = normalizeHeadingText(first.text);
    if (!frontmatter.title && headingText) book.meta.title = headingText;
    splitLevel = Math.min(...headings.filter((h) => h.level > first.level).map((h) => h.level));
    startLine = first.lineIndex + 1;
  }

  const splits = headings.filter((h) => h.level === splitLevel && h.lineIndex >= startLine);

  if (splits.length === 0) {
    const html = renderMarkdownBlocks(lines.slice(startLine), ctx);
    addChapter(book, { title: '', html, level: 0 });
  } else {
    // Preamble before the first split heading becomes its own chapter.
    const preambleEnd = splits[0].lineIndex;
    const preambleLines = lines.slice(startLine, preambleEnd);
    if (preambleLines.join('').trim()) {
      const html = renderMarkdownBlocks(preambleLines, ctx);
      if (html) addChapter(book, { title: '前言', html, level: 0 });
    }
    splits.forEach((heading, index) => {
      const end = index + 1 < splits.length ? splits[index + 1].lineIndex : lines.length;
      const chapterLines = lines.slice(heading.lineIndex + 1, end);
      const html = renderMarkdownBlocks(chapterLines, ctx);
      addChapter(book, {
        title: normalizeHeadingText(heading.text),
        html,
        level: Math.max(0, heading.level - splitLevel),
      });
    });
  }

  return normalizeBook(book, { fallbackTitle: guessTitleFromFilename(input.name), warnings });
};

function normalizeHeadingText(text: string): string {
  return decodeEntities(text)
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
