/**
 * EPUB 3 writer with NCX + legacy Kindle metadata.
 *
 * Non-negotiables (calibre and Kindle both behave badly otherwise):
 * - `mimetype` is the very first ZIP entry and is STORED (uncompressed)
 * - `META-INF/container.xml` points at a valid OPF 3 package document
 * - `nav.xhtml` has `properties="nav"`, plus a `toc.ncx` for old Kindles
 * - every XHTML document is well-formed, UTF-8, and declares the book language
 */

import JSZip from 'jszip';
import type { Book, Chapter, KindleOptions, Resource } from '../types';
import { bookCss, directionCss } from './styles';
import {
  escapeAttr,
  escapeHtml,
  fileAsName,
  imageSize,
  mediaTypeFromName,
  normalizeResourcePath,
  sanitizeHtml,
  truncateText,
  uuid,
} from '../util';

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

interface Manuscript {
  meta: Book['meta'];
  lang: string;
  identifier: string;
  chapters: Chapter[];
  resources: Resource[];
  options: KindleOptions;
  /** Set once we know whether a cover page exists, for the landmarks nav. */
  includeCoverPage?: boolean;
}

interface ManifestEntry {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface TocEntry extends ManifestEntry {
  title: string;
  level?: number;
}

function isoDate(value: string | undefined): string {
  if (value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
    if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  }
  return new Date().toISOString().slice(0, 10);
}

function modifiedStamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function languageOf(book: Book): string {
  const lang = (book.meta.language ?? '').trim();
  return lang || 'zh-CN';
}

/** Point every relative <img src> at the right place from `text/`. */
function rewriteImageSrcs(html: string, prefix: string): string {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]*)(")/gi, (match, head: string, src: string, tail: string) => {
    const value = src.trim();
    if (!value) return match;
    if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)) return match;
    if (value.startsWith('../')) return match;
    return `${head}${prefix}${normalizeResourcePath(value)}${tail}`;
  });
}

function viewportFor(html: string, resources: Resource[]): { width: number; height: number } | null {
  const img = /<img\b[^>]*>/i.exec(html)?.[0];
  if (!img) return null;
  const width = Number(/\bwidth="(\d+)"/i.exec(img)?.[1] ?? 0);
  const height = Number(/\bheight="(\d+)"/i.exec(img)?.[1] ?? 0);
  if (width > 0 && height > 0) return { width, height };
  const src = /\bsrc="([^"]*)"/i.exec(img)?.[1];
  if (!src) return null;
  const resource = resources.find((r) => r.path === src || r.path === normalizeResourcePath(src));
  if (!resource) return null;
  const size = imageSize(resource.data);
  return size ? { width: size.width, height: size.height } : null;
}

function chapterXhtml(
  meta: Manuscript,
  chapter: Chapter,
  index: number,
  isCover: boolean,
  fixed: boolean,
): string {
  const title = chapter.title || `${meta.meta.title} · ${index + 1}`;
  const viewport = fixed ? viewportFor(chapter.html, meta.resources) : null;
  const viewportMeta = viewport
    ? `\n<meta name="viewport" content="width=${viewport.width}, height=${viewport.height}"/>`
    : '';
  const bodyClass = fixed ? ' class="fixed"' : '';
  const titleHeading =
    chapter.title && !fixed && !isCover
      ? `\n<h1>${escapeHtml(chapter.title)}</h1>`
      : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(
    meta.lang,
  )}" lang="${escapeAttr(meta.lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css"/>${viewportMeta}
</head>
<body${bodyClass}>
<section epub:type="${isCover ? 'cover' : 'chapter'}" class="chapter">${titleHeading}
${chapter.html}
</section>
</body>
</html>`;
}

function coverXhtml(meta: Manuscript, coverResource: Resource | undefined): string {
  const body = coverResource
    ? `<img src="../${escapeAttr(coverResource.path)}" alt="封面"/>`
    : `<div class="title-page">
<h1>${escapeHtml(meta.meta.title)}</h1>${meta.meta.author ? `\n<p class="author">${escapeHtml(meta.meta.author)}</p>` : ''}${
        meta.meta.publisher ? `\n<p class="imprint">${escapeHtml(meta.meta.publisher)}</p>` : ''
      }
</div>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(
    meta.lang,
  )}" lang="${escapeAttr(meta.lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(meta.meta.title)}</title>
<link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="cover">
<section class="cover">${body}</section>
</body>
</html>`;
}

interface TocNode {
  entry: TocEntry;
  children: TocNode[];
}

/** Turn the flat chapter list into a tree using `level` (0 = top level). */
function tocTree(entries: TocEntry[]): TocNode[] {
  const roots: TocNode[] = [];
  let current: TocNode | null = null;
  for (const entry of entries) {
    const node: TocNode = { entry, children: [] };
    const level = Math.max(0, entry.level ?? 0);
    if (level === 0 || !current) {
      roots.push(node);
      current = node;
      continue;
    }
    current.children.push(node);
  }
  return roots;
}

function navList(nodes: TocNode[], indent: string): string {
  const lines = nodes.map((node) => {
    const link = `<a href="${node.entry.href}">${escapeHtml(node.entry.title)}</a>`;
    if (node.children.length === 0) return `${indent}<li>${link}</li>`;
    return `${indent}<li>${link}\n${indent}  <ol>\n${navList(node.children, `${indent}    `)}\n${indent}  </ol>\n${indent}</li>`;
  });
  return lines.join('\n');
}

function navXhtml(meta: Manuscript, entries: TocEntry[], includeToc: boolean): string {
  const ordered = entries;
  const items = includeToc ? navList(tocTree(ordered), '      ') : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(
    meta.lang,
  )}" lang="${escapeAttr(meta.lang)}">
<head>
<meta charset="utf-8"/>
<title>目录</title>
<link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body>
<nav epub:type="toc" role="doc-toc" id="toc">
  <h1>目录</h1>
  <ol>
${items}
  </ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
  <ol>${
    ordered[0]
      ? `\n    <li><a epub:type="bodymatter" href="${ordered[0].href}">开始阅读</a></li>`
      : ''
  }${
    meta.includeCoverPage
      ? `\n    <li><a epub:type="cover" href="text/cover.xhtml">封面</a></li>`
      : ''
  }
  </ol>
</nav>
</body>
</html>`;
}

function ncxXml(meta: Manuscript, entries: TocEntry[], includeToc: boolean): string {
  let playOrder = 0;
  const render = (nodes: TocNode[], depth: number): string => {
    const indent = '  '.repeat(depth + 1);
    return nodes
      .map((node) => {
        playOrder += 1;
        const point = `${indent}<navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">
${indent}  <navLabel><text>${escapeHtml(node.entry.title)}</text></navLabel>
${indent}  <content src="${node.entry.href}"/>${
          node.children.length > 0 ? `\n${render(node.children, depth + 1)}\n${indent}` : ''
        }${node.children.length > 0 ? `</navPoint>` : '\n' + indent + '</navPoint>'}`;
        return point;
      })
      .join('\n');
  };
  const points = includeToc ? render(tocTree(entries), 1) : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeAttr(meta.lang)}">
  <head>
    <meta name="dtb:uid" content="${escapeAttr(meta.identifier)}"/>
    <meta name="dtb:depth" content="${entries.some((entry) => (entry.level ?? 0) > 0) ? 2 : 1}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeHtml(meta.meta.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

function contentOpf(meta: Manuscript, manifest: ManifestEntry[], spineIds: string[], fixed: boolean): string {
  const subjects = (meta.meta.subjects ?? []).filter(Boolean);
  const metadata: string[] = [
    `    <dc:identifier id="bookid">${escapeHtml(meta.identifier)}</dc:identifier>`,
    `    <dc:title>${escapeHtml(meta.meta.title)}</dc:title>`,
  ];
  if (meta.meta.author) {
    metadata.push(`    <dc:creator id="creator">${escapeHtml(meta.meta.author)}</dc:creator>`);
    metadata.push('    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>');
    metadata.push(
      `    <meta refines="#creator" property="file-as">${escapeHtml(fileAsName(meta.meta.author))}</meta>`,
    );
  }
  metadata.push(`    <dc:language>${escapeHtml(meta.lang)}</dc:language>`);
  if (meta.meta.publisher) metadata.push(`    <dc:publisher>${escapeHtml(meta.meta.publisher)}</dc:publisher>`);
  if (meta.meta.description) {
    metadata.push(`    <dc:description>${escapeHtml(truncateText(meta.meta.description, 900))}</dc:description>`);
  }
  metadata.push(`    <dc:date>${escapeHtml(isoDate(meta.meta.date))}</dc:date>`);
  for (const subject of subjects.slice(0, 12)) {
    metadata.push(`    <dc:subject>${escapeHtml(subject)}</dc:subject>`);
  }
  metadata.push(`    <meta property="dcterms:modified">${modifiedStamp()}</meta>`);
  if (manifest.some((m) => m.id === 'cover-image')) {
    // Legacy Kindle + calibre read this instead of properties="cover-image".
    metadata.push('    <meta name="cover" content="cover-image"/>');
  }
  if (fixed) {
    metadata.push('    <meta property="rendition:layout">pre-paginated</meta>');
    metadata.push('    <meta property="rendition:spread">auto</meta>');
  }

  const manifestXml = manifest
    .map(
      (item) =>
        `    <item id="${escapeAttr(item.id)}" href="${escapeAttr(item.href)}" media-type="${escapeAttr(
          item.mediaType,
        )}"${item.properties ? ` properties="${escapeAttr(item.properties)}"` : ''}/>`,
    )
    .join('\n');

  const spineXml = spineIds.map((id) => `    <itemref idref="${escapeAttr(id)}"/>`).join('\n');
  const rtl = meta.options.mangaMode ? ' page-progression-direction="rtl"' : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeAttr(
    meta.lang,
  )}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
${metadata.join('\n')}
  </metadata>
  <manifest>
${manifestXml}
  </manifest>
  <spine toc="ncx"${rtl}>
${spineXml}
  </spine>
</package>`;
}

export async function writeEpub(book: Book, options: KindleOptions = {}): Promise<Uint8Array> {
  const meta = {
    ...book.meta,
    ...(options.metadata ?? {}),
  };
  const fixed = book.fixedLayout === true;
  const manuscript: Manuscript = {
    meta,
    lang: languageOf({ ...book, meta }),
    identifier: `urn:uuid:${uuid()}`,
    chapters: book.chapters,
    resources: book.resources,
    options,
  };

  const zip = new JSZip();
  // MUST be first and STORED: readers sniff the ZIP local header for it.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', CONTAINER_XML);

  zip.file('OEBPS/styles/book.css', bookCss(options) + directionCss(Boolean(options.mangaMode)));
  zip.file('META-INF/com.apple.ibooks.display-options.xml', `<?xml version="1.0" encoding="UTF-8"?>
<display_options>
  <platform name="*">
    <option name="specified-fonts">false</option>
  </platform>
</display_options>`);

  const manifest: ManifestEntry[] = [
    { id: 'css', href: 'styles/book.css', mediaType: 'text/css' },
    { id: 'nav', href: 'nav.xhtml', mediaType: 'application/xhtml+xml', properties: 'nav' },
    { id: 'ncx', href: 'toc.ncx', mediaType: 'application/x-dtbncx+xml' },
  ];

  // Images first so the manifest order is stable across runs.
  const seenPaths = new Set<string>();
  for (const resource of book.resources) {
    if (!resource.path || resource.data.length === 0) continue;
    const path = normalizeResourcePath(resource.path).replace(/^\/+/, '');
    if (!path || seenPaths.has(path)) continue;
    seenPaths.add(path);
    const mediaType = resource.mediaType || mediaTypeFromName(path) || 'application/octet-stream';
    zip.file(`OEBPS/${path}`, resource.data);
    manifest.push({ id: `res-${manifest.length}`, href: path, mediaType });
  }

  const coverResource = meta.coverPath
    ? book.resources.find((r) => r.path === normalizeResourcePath(meta.coverPath ?? ''))
    : undefined;
  const includeCover = options.cover !== false;
  if (coverResource) {
    const path = normalizeResourcePath(coverResource.path);
    const entry = manifest.find((m) => m.href === path);
    if (entry) {
      entry.id = 'cover-image';
      entry.properties = 'cover-image';
    }
  }

  // A comic's page 1 usually *is* its cover; emitting a separate cover page
  // would show it twice — except in manga mode, where the 表紙 genuinely belongs
  // at the end of the reading order.
  const coverInsideContent =
    fixed && coverResource
      ? book.chapters[0]?.html.includes(coverResource.path) === true
      : false;
  const coverPage = includeCover && (!coverInsideContent || options.mangaMode === true);
  manuscript.includeCoverPage = coverPage;

  const spineIds: string[] = [];
  if (coverPage) {
    zip.file('OEBPS/text/cover.xhtml', coverXhtml(manuscript, coverResource));
    manifest.push({
      id: 'cover-page',
      href: 'text/cover.xhtml',
      mediaType: 'application/xhtml+xml',
    });
    if (!options.mangaMode) spineIds.push('cover-page');
  }

  const entries: TocEntry[] = [];
  const safeTitle = (chapter: Chapter): string =>
    chapter.title.trim() || truncateText(`${meta.title} ${chapter.id}`, 60);

  book.chapters.forEach((chapter, index) => {
    const id = `chap-${String(index + 1).padStart(3, '0')}`;
    const href = `text/${id}.xhtml`;
    const sanitized = sanitizeHtml(chapter.html).html;
    const html = rewriteImageSrcs(sanitized, '../');
    zip.file(`OEBPS/${href}`, chapterXhtml(manuscript, { ...chapter, html }, index, false, fixed));
    const entry: TocEntry = {
      id,
      href,
      mediaType: 'application/xhtml+xml',
      title: safeTitle(chapter),
      level: chapter.level ?? 0,
    };
    manifest.push({ id, href, mediaType: entry.mediaType });
    entries.push(entry);
    spineIds.push(id);
  });

  if (coverPage && options.mangaMode) spineIds.push('cover-page');

  zip.file('OEBPS/nav.xhtml', navXhtml(manuscript, entries, options.toc !== false));
  zip.file('OEBPS/toc.ncx', ncxXml(manuscript, entries, options.toc !== false));
  zip.file(
    'OEBPS/content.opf',
    contentOpf(manuscript, manifest, spineIds, fixed),
  );

  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/epub+zip',
  });
}
