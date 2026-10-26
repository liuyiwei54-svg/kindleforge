/**
 * FB2 (FictionBook) reader.
 *
 * FB2 is XML: `<description>` holds metadata, `<body>` holds sections, and
 * `<binary>` carries base64 images. Notes live in a second `<body name="notes">`
 * and become a footnotes chapter at the end.
 */

import { XMLParser } from 'fast-xml-parser';
import type { Book } from '../types';
import { ConversionError } from '../types';
import type { Reader } from './types';
import { addChapter, createBook, guessTitleFromFilename, normalizeBook } from '../model';
import {
  base64ToBytes,
  escapeHtml,
  htmlToText,
  mediaTypeFromBytes,
  mediaTypeFromName,
  normalizeSpace,
  sanitizeHtml,
  truncateText,
} from '../util';

const FC_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  textNodeName: '#text',
  isArray: (_name, jpath) => String(jpath).endsWith('.binary') || String(jpath).endsWith('.section'),
});

type Node = Record<string, unknown>;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function text(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((n) => text(n)).join(' ').trim();
  const value = (node as Node)['#text'];
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
}

function attr(node: unknown, name: string): string {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return '';
  const value = (node as Node)[`@_${name}`];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

export const readFb2: Reader = async (input) => {
  let doc: Node;
  try {
    doc = FC_PARSER.parse(new TextDecoder('utf-8').decode(input.data)) as Node;
  } catch {
    throw new ConversionError('INVALID_FILE', 'FB2 不是合法 XML。', {
      zh: '文件可能已损坏，或其实是另一种格式（如 EPUB）。',
      en: 'The file is not valid XML — it may be damaged or mislabelled.',
    });
  }
  const root = (doc.FictionBook ?? doc.fictionbook) as Node | undefined;
  if (!root) {
    throw new ConversionError('INVALID_FILE', '不是 FB2：缺少 FictionBook 根元素。', {
      zh: '请确认文件来自 FB2 阅读器或来源网站。',
      en: 'No FictionBook root element — this is not an FB2 file.',
    });
  }

  const warnings: string[] = [];
  const description = (root.description ?? {}) as Node;
  const titleInfo = (description['title-info'] ?? {}) as Node;
  const publishInfo = (description['publish-info'] ?? {}) as Node;

  const title = text(titleInfo['book-title']) || guessTitleFromFilename(input.name);
  const authors = asArray(titleInfo.author as unknown)
    .map((a) => {
      const node = a as Node;
      const parts = [text(node['first-name']), text(node['middle-name']), text(node['last-name'])].filter(
        Boolean,
      );
      const joiner = parts.every((part) => /\p{Script=Han}/u.test(part)) ? '' : ' ';
      return normalizeSpace(parts.join(joiner) || text(node.nickname));
    })
    .filter(Boolean);

  const book: Book = createBook({
    title,
    sourceFormat: 'fb2',
    author: authors.join(', ') || undefined,
    language: text(titleInfo.lang) || undefined,
    publisher: text(publishInfo.publisher) || undefined,
    date: text(publishInfo.year) || undefined,
    description: annotationText(titleInfo.annotation) || undefined,
  });

  // base64 binaries → book resources, id → path.
  const binaries = new Map<string, string>();
  for (const raw of asArray(root.binary as unknown)) {
    const node = raw as Node;
    const id = attr(node, 'id');
    if (!id) continue;
    const contentType = attr(node, 'content-type') || mediaTypeFromName(id) || 'image/jpeg';
    if (!contentType.startsWith('image/')) continue;
    let data: Uint8Array;
    try {
      data = base64ToBytes(text(node) || String(node['#text'] ?? ''));
    } catch {
      continue;
    }
    if (data.length === 0) continue;
    const path = `images/${id.replace(/[^\w.-]+/g, '-')}`;
    if (!book.resources.some((r) => r.path === path)) {
      book.resources.push({
        path,
        data,
        mediaType: mediaTypeFromBytes(data) ?? contentType,
      });
    }
    binaries.set(id, path);
  }

  // Coverpage
  const coverRef = attr((titleInfo.coverpage as Node | undefined)?.image, 'href').replace(/^#/, '');
  if (coverRef && binaries.has(coverRef)) book.meta.coverPath = binaries.get(coverRef);

  const bodies = asArray(root.body as unknown) as Node[];
  const mainBodies = bodies.filter((b) => attr(b, 'name') !== 'notes');
  const noteBodies = bodies.filter((b) => attr(b, 'name') === 'notes');

  const ctx: RenderContext = { book, binaries, warnings };

  for (const body of mainBodies) {
    const bodyTitle = renderTitle(body.title, ctx);
    const sections = asArray(body.section as unknown) as Node[];
    if (sections.length === 0) {
      const html = renderChildren(body, ctx);
      if (htmlToText(html).length > 0) addChapter(book, { title: bodyTitle, html, level: 0 });
      continue;
    }
    if (bodyTitle && sections.length > 0) {
      // A body title acts as a part heading; keep it as the chapter's own title
      // only when the first section has none.
      if (!renderTitle(sections[0].title, ctx)) {
        sections[0].title = sections[0].title ?? { p: bodyTitle };
      }
    }
    sections.forEach((section) => renderSection(section, ctx, 0));
  }

  // Footnotes from <body name="notes">.
  const noteSections: Node[] = [];
  for (const body of noteBodies) {
    for (const section of asArray(body.section as unknown) as Node[]) noteSections.push(section);
  }
  if (noteSections.length > 0) {
    const html = noteSections
      .map((section, index) => {
        const body = renderChildren(section, ctx).replace(/<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>/g, '');
        return `<p><sup>${index + 1}</sup> ${body}</p>`;
      })
      .join('\n');
    if (htmlToText(html).length > 0) {
      addChapter(book, { title: '注释', html, level: 0 });
    }
  }

  if (book.chapters.length === 0) {
    throw new ConversionError('INVALID_FILE', 'FB2 中没有可读正文。', {
      zh: '文件可能只有图片或元数据。',
      en: 'The FB2 contains no readable body sections.',
    });
  }

  return normalizeBook(book, { fallbackTitle: guessTitleFromFilename(input.name), warnings });
};

/** <annotation> is a container of <p>s, not a text node. */
function annotationText(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const annotation = node as Node;
  const paragraphs = asArray(annotation.p as unknown)
    .map((p) => text(p))
    .filter(Boolean);
  const merged = paragraphs.length > 0 ? paragraphs.join(' ') : text(node);
  return truncateText(normalizeSpace(merged), 600) || undefined;
}

interface RenderContext {
  book: Book;
  binaries: Map<string, string>;
  warnings: string[];
}

function renderTitle(titleNode: unknown, ctx: RenderContext): string {
  if (!titleNode) return '';
  const node = titleNode as Node;
  const parts = asArray(node.p as unknown)
    .map((p) => text(p))
    .filter(Boolean);
  if (parts.length > 0) return normalizeSpace(parts.join(' '));
  return normalizeSpace(text(titleNode));
}

function renderSection(section: Node, ctx: RenderContext, depth: number): void {
  const title = renderTitle(section.title, ctx);
  const inner = renderChildren(section, ctx, true);
  const nested = asArray(section.section as unknown) as Node[];

  // Only emit the section itself when it has prose outside its subsections.
  const ownHtml = inner;
  if (htmlToText(ownHtml).length > 0 || /<img\b/i.test(ownHtml)) {
    addChapter(ctx.book, { title, html: ownHtml, level: Math.min(depth, 3) });
  } else if (title && nested.length > 0) {
    // A pure container: promote its title to the children's heading level.
    nested.forEach((child) => {
      if (!renderTitle(child.title, ctx)) child.title = { p: title };
      renderSection(child, ctx, depth);
    });
    return;
  }

  nested.forEach((child) => renderSection(child, ctx, depth + 1));
}

/** Serialise every child element of `node` except its own <title>. */
function renderChildren(node: Node, ctx: RenderContext, skipSections = false): string {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return escapeHtml(text(node));
  const out: string[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key.startsWith('@_') || key === '#text' || key === 'title') continue;
    if (skipSections && key === 'section') continue;
    for (const child of asArray(value as unknown)) {
      out.push(renderBlock(key, child, ctx));
    }
  }
  const raw = out.filter(Boolean).join('\n');
  return sanitizeHtml(raw, {
    resolveImage: (src) => (src.startsWith('images/') ? src : null),
  }).html;
}

function renderBlock(tag: string, value: unknown, ctx: RenderContext): string {
  const name = tag.toLowerCase();
  if (typeof value !== 'object' || value === null) {
    if (name === 'empty-line') return '<br/>';
    const literal = escapeHtml(normalizeSpace(text(value)));
    return literal ? `<p>${literal}</p>` : '';
  }
  switch (name) {
    case 'p':
    case 'v': {
      const html = text(value);
      if (!html) return '';
      return `<p>${renderInline(value, ctx)}</p>`;
    }
    case 'subtitle':
      return `<h3>${escapeHtml(text(value))}</h3>`;
    case 'empty-line':
      return '<br/>';
    case 'image': {
      const href = attr(value, 'href').replace(/^#/, '');
      const path = ctx.binaries.get(href);
      if (!path) {
        if (href) ctx.warnings.push(`FB2 图片缺失，已跳过（missing binary）: ${truncateText(href, 40)}`);
        return '';
      }
      return `<img src="${escapeHtml(path)}" alt=""/>`;
    }
    case 'section':
      // Handled by renderSection; a stray nested section inside inline flow is
      // rendered flat to avoid losing text.
      return renderChildren(value as Node, ctx, true);
    case 'poem':
    case 'epigraph':
    case 'cite':
    case 'annotation': {
      const inner = renderChildren(value as Node, ctx);
      if (!inner) return '';
      const cls = name === 'epigraph' ? ' class="epigraph"' : '';
      return `<blockquote${cls}>${inner}</blockquote>`;
    }
    case 'stanza':
      return renderChildren(value as Node, ctx);
    case 'text-author':
      return `<p class="author">${escapeHtml(normalizeSpace(text(value)))}</p>`;
    case 'table':
    case 'tr':
    case 'td':
    case 'th':
      return '';
    default:
      return renderChildren(value as Node, ctx);
  }
}

const INLINE_TAGS: Record<string, string> = {
  emphasis: 'em',
  strong: 'strong',
  code: 'code',
  strikethrough: 'del',
  sub: 'sub',
  sup: 'sup',
};

function renderInline(value: unknown, ctx: RenderContext): string {
  const node = typeof value === 'object' && value !== null ? (value as Node) : {};
  const raw = text(value);
  let html = escapeHtml(raw);
  for (const [fb2Tag, htmlTag] of Object.entries(INLINE_TAGS)) {
    const chunks = asArray(node[fb2Tag] as unknown);
    for (const chunk of chunks) {
      const inner = escapeHtml(text(chunk));
      if (!inner) continue;
      // XML parsing loses the order of text vs inline children, so splice the
      // styled run where we can and append it otherwise — never lose the words.
      if (html.includes(inner)) html = html.replace(inner, `<${htmlTag}>${inner}</${htmlTag}>`);
      else html += ` <${htmlTag}>${inner}</${htmlTag}>`;
    }
  }
  // Footnote references: <a type="note" href="#n1">…</a>
  const links = asArray(node.a as unknown);
  for (const link of links) {
    const label = escapeHtml(text(link));
    const type = attr(link, 'type');
    if (label) {
      html = html.replace(
        label,
        type === 'note' ? `<sup>${label}</sup>` : label,
      );
    }
  }
  const images = asArray(node.image as unknown);
  for (const image of images) {
    const href = attr(image, 'href').replace(/^#/, '');
    const path = ctx.binaries.get(href);
    if (path) html += `<img src="${escapeHtml(path)}" alt=""/>`;
    else if (href) ctx.warnings.push(`FB2 图片缺失，已跳过（missing binary）: ${truncateText(href, 40)}`);
  }
  return html;
}
