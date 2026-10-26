/**
 * EPUB reader.
 *
 * Reads OCF (mimetype + container.xml) → OPF (manifest / spine / metadata) →
 * each spine XHTML, resolving images into book resources. TOC labels come from
 * nav.xhtml or toc.ncx. DRM is detected and refused: we never pretend to strip
 * it.
 */

import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { Book, Resource } from '../types';
import { ConversionError } from '../types';
import type { Reader } from './types';
import { addChapter, createBook, addResource, normalizeBook } from '../model';
import { splitHtmlByHeadings, resolveHtmlImage, imageSinkFor } from './html';
import { ZipBudget, assertArchiveSane, readZipEntry, readZipText } from './zip-safety';
import {
  detectLanguage,
  extractBodyHtml,
  extractMetaContent,
  htmlToText,
  mediaTypeFromBytes,
  mediaTypeFromName,
  normalizeResourcePath,
  posixBasename,
  posixDirname,
  resolveZipPath,
  sanitizeHtml,
  truncateText,
} from '../util';

const OPF_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  textNodeName: '#text',
  isArray: (name, jpath) =>
    [
      'package.manifest.item',
      'package.spine.itemref',
      'package.metadata.subject',
      'package.metadata.creator',
      'package.metadata.date',
      'package.metadata.meta',
    ].includes(String(jpath)) || name === 'navPoint',
});

type XmlNode = Record<string, unknown> | string | number | null | undefined;

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function xmlText(node: XmlNode): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  const text = (node as Record<string, unknown>)['#text'];
  if (typeof text === 'string') return text.trim();
  if (typeof text === 'number') return String(text);
  return '';
}

function attr(node: unknown, name: string): string {
  if (!node || typeof node !== 'object') return '';
  const value = (node as Record<string, unknown>)[`@_${name}`];
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
  path: string;
}

interface TocEntry {
  path: string;
  label: string;
  level: number;
}

const FONT_TYPES = new Set(['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/font-sfnt', 'application/vnd.ms-opentype']);

function isFontReference(uri: string, mediaType?: string): boolean {
  if (mediaType && FONT_TYPES.has(mediaType)) return true;
  return /\.(ttf|otf|woff2?)$/i.test(uri);
}

export const readEpub: Reader = async (input) => {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input.data);
  } catch {
    throw new ConversionError('INVALID_FILE', 'EPUB 解析失败：文件不是有效的 ZIP 容器。', {
      zh: '文件可能不完整或不是 EPUB。请重新下载后再试。',
      en: 'The file may be truncated or not an EPUB. Try downloading it again.',
    });
  }

  const warnings: string[] = [];
  assertArchiveSane(zip);
  const budget = new ZipBudget();
  await assertNoDrm(zip, warnings, budget);

  if (!zip.file('META-INF/container.xml')) {
    throw new ConversionError('INVALID_FILE', '不是有效的 EPUB：缺少 META-INF/container.xml。', {
      zh: '如果这是 MOBI/AZW3 文件，请把扩展名改正确后重试。',
      en: 'If this is really a MOBI/AZW3 file, fix its extension and retry.',
    });
  }
  const containerText = await readZipText(zip, 'META-INF/container.xml', budget);
  const rootPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(containerText)?.[1];
  if (!rootPath) {
    throw new ConversionError('INVALID_FILE', 'EPUB 的 container.xml 中没有 rootfile。', {
      zh: '文件结构损坏，无法定位 OPF 包文件。',
      en: 'The container is damaged — no OPF package file to read.',
    });
  }

  const opfPath = normalizeResourcePath(rootPath);
  const opfText = zip.file(opfPath) ? await readZipText(zip, opfPath, budget) : null;
  if (!opfText) {
    throw new ConversionError('INVALID_FILE', `EPUB 缺少包文件：${opfPath}`, {
      zh: '文件结构不完整，无法读取目录与章节。',
      en: 'The package file is missing, so the spine cannot be read.',
    });
  }

  let doc: Record<string, unknown>;
  try {
    doc = OPF_PARSER.parse(opfText) as Record<string, unknown>;
  } catch {
    throw new ConversionError('INVALID_FILE', 'EPUB 的 content.opf 不是合法 XML。', {
      zh: 'OPF 解析失败，文件可能已损坏。',
      en: 'The OPF could not be parsed; the file is likely damaged.',
    });
  }
  const pkg = (doc.package ?? {}) as Record<string, unknown>;
  if (!pkg.manifest && !pkg.spine) {
    throw new ConversionError('INVALID_FILE', 'EPUB 的 OPF 中缺少 manifest/spine。', {
      zh: '这不是一本结构完整的 EPUB。',
      en: 'This EPUB is not structurally complete.',
    });
  }

  const opfDir = posixDirname(opfPath);
  const metadata = (pkg.metadata ?? {}) as Record<string, unknown>;
  const manifest = (pkg.manifest ?? {}) as Record<string, unknown>;
  const spine = (pkg.spine ?? {}) as Record<string, unknown>;

  const items = new Map<string, ManifestItem>();
  for (const raw of asArray(manifest.item as unknown)) {
    const id = attr(raw, 'id');
    const href = attr(raw, 'href');
    if (!id || !href) continue;
    items.set(id, {
      id,
      href,
      mediaType: attr(raw, 'media-type'),
      properties: attr(raw, 'properties'),
      path: resolveZipPath(opfDir, href),
    });
  }

  const title = xmlText(metadata.title as XmlNode) || guessTitle(input.name);
  const creators = asArray(metadata.creator as unknown)
    .map((c) => xmlText(c as XmlNode))
    .filter(Boolean);
  const language = xmlText(metadata.language as XmlNode);
  const subjects = asArray(metadata.subject as unknown)
    .map((s) => xmlText(s as XmlNode))
    .filter(Boolean);
  const book: Book = createBook({
    title,
    sourceFormat: 'epub',
    author: creators.join(', ') || undefined,
    language: language || undefined,
    publisher: xmlText(metadata.publisher as XmlNode) || undefined,
    description: truncateText(htmlToText(xmlText(metadata.description as XmlNode)), 600) || undefined,
    date: xmlText(asArray(metadata.date as unknown)[0] as XmlNode) || undefined,
    subjects: subjects.length > 0 ? subjects : undefined,
  });

  // Fixed-layout EPUBs (comics, picture books) stay fixed-layout.
  const metas = asArray(metadata.meta as unknown);
  for (const meta of metas) {
    const property = attr(meta, 'property') || attr(meta, 'name');
    const value = attr(meta, 'content') || xmlText(meta as XmlNode);
    if (property === 'rendition:layout' && value === 'pre-paginated') book.fixedLayout = true;
  }

  // TOC labels (NCX first: it is what old Kindles actually read).
  const toc = await readToc(zip, pkg, opfDir, items, warnings, budget);
  const tocByPath = new Map<string, TocEntry>();
  for (const entry of toc) {
    if (!tocByPath.has(entry.path)) tocByPath.set(entry.path, entry);
  }

  const sink = imageSinkFor(book, warnings);
  const imageCache = new Map<string, string>();
  const imagePaths = new Map<string, string>();

  // Cover: <meta name="cover" content="id">, else manifest properties=cover-image.
  const coverItem = findCoverItem(metas, items);
  if (coverItem) {
    if (zip.file(coverItem.path)) {
      const data = await readZipEntry(zip, coverItem.path, budget);
      const mediaType =
        coverItem.mediaType || mediaTypeFromBytes(data) || mediaTypeFromName(coverItem.path) || 'image/jpeg';
      if (mediaType.startsWith('image/')) {
        const ext = mediaType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
        const resource = addResource(book, {
          path: `images/cover.${ext}`,
          data,
          mediaType,
        });
        book.meta.coverPath = resource.path;
        // Reuse this copy if a spine document shows the same picture.
        imageCache.set(coverItem.path, resource.path);
      }
    }
  }

  const spineRefs = asArray(spine.itemref as unknown);
  const readingOrder: ManifestItem[] = [];
  for (const ref of spineRefs) {
    const idref = attr(ref, 'idref');
    const linear = attr(ref, 'linear');
    const item = items.get(idref);
    if (!item) continue;
    if (linear === 'no') continue;
    if (!/xhtml|html/i.test(item.mediaType) && !/\.x?html?$/i.test(item.path)) continue;
    readingOrder.push(item);
  }

  if (readingOrder.length === 0) {
    // Broken spine: fall back to every XHTML document in manifest order.
    for (const item of items.values()) {
      if (/xhtml|html/i.test(item.mediaType)) readingOrder.push(item);
    }
    if (readingOrder.length > 0) warnings.push('EPUB 的 spine 为空，已按 manifest 顺序读取（empty spine, read manifest order）');
  }

  for (const item of readingOrder) {
    if (!zip.file(item.path)) {
      warnings.push(
        `EPUB 内缺少 spine 文件（missing spine document）: ${truncateText(item.href, 60)}`,
      );
      continue;
    }
    let raw: string;
    try {
      raw = await readZipText(zip, item.path, budget);
    } catch (error) {
      if (error instanceof ConversionError) throw error;
      warnings.push(`章节无法解码（unreadable chapter）: ${truncateText(item.href, 60)}`);
      continue;
    }

    // A dedicated cover/title page document would duplicate the generated cover.
    if (/<body\b[^>]*epub:type\s*=\s*["'](?:cover|titlepage)["']/i.test(raw)) continue;

    const bodyHtml = extractBodyHtml(stripHeadElements(raw));
    const baseDir = posixDirname(item.path);
    // JSZip only reads asynchronously, so resolve every <img> up front and give
    // the (synchronous) sanitiser a ready map.
    await prepareChapterImages(zip, baseDir, bodyHtml, sink, imagePaths, imageCache, budget);
    const { html: cleanReport } = sanitizeHtml(bodyHtml, {
      resolveImage: (src) => imagePaths.get(`${baseDir}|${src}`) ?? null,
    });

    const { blocks } = splitHtmlByHeadings(cleanReport, 3, { documentTitle: book.meta.title });
    const fallbackLabel = tocByPath.get(item.path)?.label ?? '';
    const meaningful = blocks.filter(
      (b) => htmlToText(b.body).length > 0 || /<img\b/i.test(b.body),
    );
    if (meaningful.length === 0) continue;

    // A spine document that only shows the cover picture would duplicate the
    // generated cover page, so it is dropped.
    if (
      meaningful.length === 1 &&
      htmlToText(meaningful[0].body).length === 0 &&
      book.meta.coverPath &&
      meaningful[0].body.includes(book.meta.coverPath)
    ) {
      continue;
    }

    // Content before the first heading of a spine document is the tail of the
    // previous chapter (EPUB files are split by size, not by chapter). Append it
    // instead of inventing a chapter.
    if (meaningful.length > 1 && !meaningful[0].title && book.chapters.length > 0) {
      const previous = book.chapters[book.chapters.length - 1];
      previous.html = `${previous.html}\n${meaningful[0].body}`;
      meaningful.shift();
    }

    meaningful.forEach((block) => {
      let chapterTitle = block.title;
      if (!chapterTitle && book.chapters.length === 0) {
        // Front matter: only trust the NCX when the document has no headings at all.
        chapterTitle = meaningful.length === 1 && fallbackLabel ? fallbackLabel : '前言';
      }
      addChapter(book, { title: chapterTitle, html: block.body, level: block.level });
    });
  }

  if (book.chapters.length === 0) {
    throw new ConversionError('INVALID_FILE', 'EPUB 中没有可读的正文文本。', {
      zh: '这可能是一本纯图片漫画或扫描书，请改用「漫画 / 图片」路径转换。',
      en: 'It may be an image-only comic or scan — use the comic/image path instead.',
    });
  }

  if (!language) {
    const sample = book.chapters
      .slice(0, 2)
      .map((c) => htmlToText(c.html))
      .join(' ')
      .slice(0, 4000);
    const detected = detectLanguage(sample);
    if (detected !== 'und') book.meta.language = detected === 'zh' ? 'zh-CN' : detected;
  }

  return normalizeBook(book, { fallbackTitle: guessTitleFromFileName(input.name), warnings });
};

function guessTitle(name: string): string {
  return guessTitleFromFileName(name);
}

function guessTitleFromFileName(name: string): string {
  const base = name.split('/').pop() ?? name;
  return base.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || '未命名书籍';
}

/** `<head>` carries `<title>` and `<link>`s; the sanitiser would drop them but
 *  some files put invalid nesting around it, so remove it up front. */
function stripHeadElements(html: string): string {
  return html
    .replace(/<head\b[\s\S]*?<\/head>/gi, '')
    .replace(/<title\b[\s\S]*?<\/title>/gi, '');
}

async function assertNoDrm(zip: JSZip, warnings: string[], budget: ZipBudget): Promise<void> {
  if (!zip.file('META-INF/encryption.xml')) return;
  const text = await readZipText(zip, 'META-INF/encryption.xml', budget);
  // Encryption elements may be namespace-prefixed (`<enc:EncryptedData>`).
  const encrypted = /<(?:[\w.-]+:)?EncryptedData\b/i.test(text);
  if (!encrypted) return;

  const references = Array.from(
    text.matchAll(/<(?:[\w.-]+:)?CipherReference\b[^>]*URI\s*=\s*["']([^"']+)["']/gi),
  ).map(
    (m) => m[1],
  );
  const nonFont = references.filter((uri) => !isFontReference(uri));
  if (nonFont.length > 0 || references.length === 0) {
    throw new ConversionError('DRM', '这本 EPUB 受 DRM 保护，无法转换。', {
      zh: '本项目不解密 DRM。请从购买它的商店导出无 DRM 的版本，或换一份文件。',
      en: 'We do not break DRM. Export a DRM-free copy from the store you bought it, or use another file.',
    });
  }

  warnings.push(`字体已混淆，已跳过原字体（obfuscated fonts skipped）: ${references.length}`);
}

function findCoverItem(metas: unknown[], items: Map<string, ManifestItem>): ManifestItem | undefined {
  for (const meta of metas) {
    const name = attr(meta, 'name');
    if (name !== 'cover') continue;
    const id = attr(meta, 'content');
    const item = items.get(id);
    if (item && (!item.mediaType || item.mediaType.startsWith('image/'))) return item;
  }
  for (const item of items.values()) {
    if (item.properties.split(/\s+/).includes('cover-image')) return item;
  }
  for (const item of items.values()) {
    if (item.mediaType.startsWith('image/') && /cover/i.test(item.href)) return item;
  }
  return undefined;
}

async function readToc(
  zip: JSZip,
  pkg: Record<string, unknown>,
  opfDir: string,
  items: Map<string, ManifestItem>,
  warnings: string[],
  budget: ZipBudget,
): Promise<TocEntry[]> {
  const entries: TocEntry[] = [];
  const parser = OPF_PARSER;

  // 1. NCX (EPUB 2 + Kindle compatibility).
  const ncxId = attr(pkg.spine, 'toc');
  const ncxItem =
    (ncxId ? items.get(ncxId) : undefined) ??
    Array.from(items.values()).find((i) => i.mediaType === 'application/x-dtbncx+xml');
  if (ncxItem) {
    if (zip.file(ncxItem.path)) {
      try {
        const parsed = parser.parse(await readZipText(zip, ncxItem.path, budget)) as Record<
          string,
          unknown
        >;
        const navMap = (parsed.ncx as Record<string, unknown> | undefined)?.navMap as
          | Record<string, unknown>
          | undefined;
        const walk = (node: Record<string, unknown>, level: number) => {
          for (const point of asArray(node.navPoint as unknown)) {
            const p = point as Record<string, unknown>;
            const label = xmlText((p.navLabel as Record<string, unknown> | undefined)?.text as XmlNode);
            const src = attr(p.content, 'src');
            if (src) {
              entries.push({
                path: resolveZipPath(opfDir, src),
                label: label.replace(/\s+/g, ' ').trim(),
                level,
              });
            }
            walk(p, level + 1);
          }
        };
        if (navMap) walk(navMap, 0);
      } catch {
        warnings.push('toc.ncx 解析失败，目录将从正文标题重建（NCX unparsable）');
      }
    }
  }

  // 2. EPUB 3 nav.xhtml — only used when the NCX gave us nothing.
  if (entries.length === 0) {
    const navItem =
      Array.from(items.values()).find((i) => i.properties.split(/\s+/).includes('nav')) ??
      Array.from(items.values()).find((i) => /nav\.x?html?$/i.test(i.path));
    if (navItem) {
      if (zip.file(navItem.path)) {
        const text = await readZipText(zip, navItem.path, budget);
        const navBody = extractNavToc(text);
        const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(navBody))) {
          entries.push({
            path: resolveZipPath(posixDirname(navItem.path), m[1]),
            label: htmlToText(m[2]).replace(/\s+/g, ' ').trim(),
            level: 0,
          });
        }
      }
    }
  }

  return entries;
}

function extractNavToc(html: string): string {
  const m = /<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i.exec(html);
  if (m) return m[1];
  const anyNav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(html);
  return anyNav ? anyNav[1] : html;
}

/** Read + register every image referenced by one chapter document. */
async function prepareChapterImages(
  zip: JSZip,
  baseDir: string,
  html: string,
  sink: ReturnType<typeof imageSinkFor>,
  imagePaths: Map<string, string>,
  imageCache: Map<string, string>,
  budget: ZipBudget,
): Promise<void> {
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  const sources = new Set<string>();
  while ((m = re.exec(html))) {
    const src = /\bsrc\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1];
    if (src) sources.add(src);
  }
  for (const src of sources) {
    const key = `${baseDir}|${src}`;
    if (imagePaths.has(key)) continue;
    const resolved = await resolveEpubImage(zip, baseDir, src, sink, imageCache, budget);
    if (resolved) imagePaths.set(key, resolved);
  }
}

async function resolveEpubImage(
  zip: JSZip,
  baseDir: string,
  src: string,
  sink: ReturnType<typeof imageSinkFor>,
  imageCache: Map<string, string>,
  budget: ZipBudget,
): Promise<string | null> {
  const raw = src.trim();
  if (!raw) return null;

  if (/^data:/i.test(raw)) {
    return resolveHtmlImage(raw, '', sink);
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    sink.warnings.push(`已丢弃远程图片（remote image dropped）: ${truncateText(raw, 60)}`);
    return null;
  }

  const candidates = [resolveZipPath(baseDir, raw), normalizeResourcePath(raw)];
  let path = '';
  for (const candidate of candidates) {
    if (zip.file(candidate)) {
      path = candidate;
      break;
    }
  }
  if (!path) {
    sink.warnings.push(
      `EPUB 内缺少图片，已丢弃（missing image in archive）: ${truncateText(raw, 60)}`,
    );
    return null;
  }

  const cached = imageCache.get(path);
  if (cached !== undefined) return cached || null;

  if (!zip.file(path)) return null;
  const data = await readZipEntry(zip, path, budget);
  const mediaType =
    mediaTypeFromBytes(data) ?? mediaTypeFromName(path) ?? 'image/jpeg';
  if (!mediaType.startsWith('image/')) {
    imageCache.set(path, '');
    return null;
  }

  const ext = (path.split('.').pop() ?? 'jpg').toLowerCase().replace('jpeg', 'jpg');
  sink.counter.value += 1;
  const base = posixBasename(path).replace(/[^\w.-]+/g, '-') || `img.${ext}`;
  const resourcePath = `images/${String(sink.counter.value).padStart(3, '0')}-${base}`;
  addResource(sink.book, { path: resourcePath, data, mediaType });
  imageCache.set(path, resourcePath);
  return resourcePath;
}
