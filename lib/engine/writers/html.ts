/**
 * Single-file HTML writer.
 *
 * "Save as one .html you can open anywhere" — images are inlined as data URIs so
 * the file is self-contained, and a clickable TOC is generated at the top.
 */

import type { Book, KindleOptions, Resource } from '../types';
import { bookCss } from './styles';
import {
  bytesToBase64,
  escapeHtml,
  normalizeResourcePath,
  sanitizeHtml,
  truncateText,
} from '../util';

function dataUri(resource: Resource): string {
  return `data:${resource.mediaType};base64,${bytesToBase64(resource.data)}`;
}

function inlineImages(html: string, resources: Resource[], warnings: string[]): string {
  const map = new Map<string, string>();
  for (const resource of resources) {
    if (!resource.mediaType.startsWith('image/')) continue;
    map.set(normalizeResourcePath(resource.path), dataUri(resource));
  }
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]*)(")/gi, (match, head: string, src: string, tail: string) => {
    const value = src.trim();
    if (value.startsWith('data:')) return match;
    const uri = map.get(normalizeResourcePath(value));
    if (!uri) {
      warnings.push(`HTML 内缺少图片，已移除（missing image removed）: ${truncateText(value, 60)}`);
      return '';
    }
    return `${head}${uri}${tail}`;
  });
}

export async function writeHtml(
  book: Book,
  options: KindleOptions = {},
  warnings: string[] = [],
): Promise<Uint8Array> {
  const meta = { ...book.meta, ...(options.metadata ?? {}) };
  const lang = meta.language || 'zh-CN';
  const cover = meta.coverPath
    ? book.resources.find((r) => normalizeResourcePath(r.path) === normalizeResourcePath(meta.coverPath ?? ''))
    : undefined;

  const toc = book.chapters
    .map((chapter, index) => {
      const title = chapter.title || `第 ${index + 1} 节`;
      return `      <li><a href="#ch-${index + 1}">${escapeHtml(title)}</a></li>`;
    })
    .join('\n');

  const sections = book.chapters
    .map((chapter, index) => {
      const html = inlineImages(sanitizeHtml(chapter.html).html, book.resources, warnings);
      const heading = chapter.title ? `<h1>${escapeHtml(chapter.title)}</h1>` : '';
      return `<section class="chapter" id="ch-${index + 1}">
${heading}
${html}
</section>`;
    })
    .join('\n');

  const coverFigure = cover
    ? `<figure class="cover"><img src="${dataUri(cover)}" alt="封面"/></figure>`
    : '';

  const document = `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(meta.title)}</title>
<meta name="author" content="${escapeHtml(meta.author ?? '')}"/>
<meta name="generator" content="KindleForge"/>
<style>
${bookCss(options)}
body { max-width: 42em; margin: 0 auto; padding: 1.5em 1em 4em; }
.book-header { text-align: center; margin-bottom: 2em; }
.book-header h1 { page-break-before: auto; break-before: auto; font-size: 2em; margin: 0.6em 0 0.2em; }
.book-header .author { font-size: 1.1em; color: #444; text-indent: 0; }
nav.toc { border: 1px solid #ddd; padding: 1em 1.4em; margin: 2em 0; }
nav.toc ol { margin: 0.4em 0 0 1.2em; }
figure.cover { margin: 0 0 2em; }
figure.cover img { max-height: 80vh; width: auto; }
@media print { nav.toc { page-break-after: always; } }
</style>
</head>
<body>
<header class="book-header">
<h1>${escapeHtml(meta.title)}</h1>
${meta.author ? `<p class="author">${escapeHtml(meta.author)}</p>` : ''}
</header>
${coverFigure}
<nav class="toc" aria-label="目录">
<h2>目录</h2>
<ol>
${toc}
</ol>
</nav>
${sections}
</body>
</html>
`;

  return new TextEncoder().encode(document);
}
