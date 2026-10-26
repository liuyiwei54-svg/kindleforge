/**
 * Post-process a calibre-produced EPUB so old Kindles can read its TOC.
 *
 * calibre 8 with `--epub-version 3` writes `nav.xhtml` but no `toc.ncx`. Kindle
 * firmware before KF8 (and several readers) only look at the NCX, so we rebuild
 * the navigation document from the nav and patch the OPF — without touching the
 * content or downgrading the EPUB version.
 *
 * Also keeps the OCF invariant: `mimetype` first and STORED.
 */

import JSZip from 'jszip';
import {
  decodeEntities,
  escapeHtml as escapeXml,
  normalizeResourcePath,
  posixBasename,
  posixDirname,
} from '../util';

export interface EpubTocResult {
  data: Uint8Array;
  warnings: string[];
  /** True when the package was rebuilt (NCX added or OPF patched). */
  patched: boolean;
}

interface NavEntry {
  href: string;
  label: string;
  depth: number;
}

const OPF_MEDIA = 'application/oebps-package+xml';
const NCX_MEDIA = 'application/x-dtbncx+xml';

function relativeHref(fromDir: string, targetPath: string): string {
  if (!fromDir) return targetPath;
  const prefix = `${fromDir}/`;
  if (targetPath.startsWith(prefix)) return targetPath.slice(prefix.length);
  return posixBasename(targetPath);
}

/** Parse the `<nav epub:type="toc">` into a flat list with nesting depth. */
export function parseNavEntries(navHtml: string): NavEntry[] {
  const navMatch =
    /<nav\b[^>]*epub:type\s*=\s*["']toc["'][^>]*>([\s\S]*?)<\/nav>/i.exec(navHtml) ??
    /<nav\b[^>]*>([\s\S]*?)<\/nav>/i.exec(navHtml);
  const body = navMatch ? navMatch[1] : navHtml;

  const entries: NavEntry[] = [];
  let depth = 1;
  const tokenRe = /<ol\b[^>]*>|<\/ol>|<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(body))) {
    const token = match[0];
    if (/^<ol\b/i.test(token)) {
      depth += 1;
      continue;
    }
    if (/^<\/ol>/i.test(token)) {
      depth = Math.max(1, depth - 1);
      continue;
    }
    const attrs = match[1] ?? '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    const label = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (!label) continue;
    entries.push({ href, label, depth: Math.max(1, depth - 1) });
  }
  return entries;
}

function buildNcx(options: {
  title: string;
  uid: string;
  lang: string;
  entries: NavEntry[];
}): string {
  const { title, uid, lang, entries } = options;
  let playOrder = 0;

  // Build a depth tree first, then serialise it.
  interface Node {
    entry: NavEntry;
    children: Node[];
  }
  const roots: Node[] = [];
  const stack: Node[] = [];
  for (const entry of entries) {
    const node: Node = { entry, children: [] };
    const level = Math.max(0, entry.depth - 1);
    while (stack.length > level) stack.pop();
    if (stack.length === 0) roots.push(node);
    else stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const serialise = (nodes: Node[], indent: string): string =>
    nodes
      .map((node) => {
        playOrder += 1;
        const children =
          node.children.length > 0 ? `\n${serialise(node.children, `${indent}  `)}\n${indent}` : '';
        return `${indent}<navPoint id="navpoint-${playOrder}" playOrder="${playOrder}">
${indent}  <navLabel><text>${escapeXml(node.entry.label)}</text></navLabel>
${indent}  <content src="${escapeXml(node.entry.href)}"/>${children}
${indent}</navPoint>`;
      })
      .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeXml(lang)}">
  <head>
    <meta name="dtb:uid" content="${escapeXml(uid)}"/>
    <meta name="dtb:depth" content="${Math.max(1, ...entries.map((e) => e.depth))}"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(title)}</text></docTitle>
  <navMap>
${serialise(roots, '    ')}
  </navMap>
</ncx>`;
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing zip entry: ${path}`);
  return file.async('string');
}

/**
 * Ensure the EPUB has a usable `toc.ncx`. Returns the original bytes when the
 * package already has one (referenced from the manifest and the spine).
 */
export async function ensureEpubToc(data: Uint8Array): Promise<EpubTocResult> {
  const warnings: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    return { data, warnings, patched: false };
  }

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) return { data, warnings, patched: false };
  const container = await containerFile.async('string');
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(container)?.[1];
  if (!opfPath) return { data, warnings, patched: false };
  const opfDir = posixDirname(normalizeResourcePath(opfPath));
  if (!zip.file(opfPath)) return { data, warnings, patched: false };

  let opf = await readZipText(zip, opfPath);

  // ---- 1. Existing NCX? ------------------------------------------------
  const manifestBlock = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf)?.[1] ?? '';
  const itemRe = /<item\b([^>]*)\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  let ncxHref: string | null = null;
  let navHref: string | null = null;
  let ncxId: string | null = null;
  const itemIds = new Set<string>();
  while ((itemMatch = itemRe.exec(manifestBlock))) {
    const attrs = itemMatch[1];
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const mediaType = /\bmedia-type\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const properties = /\bproperties\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ?? '';
    const id = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (id) itemIds.add(id);
    if (!href) continue;
    if (mediaType === NCX_MEDIA) {
      ncxHref = href;
      ncxId = id ?? 'ncx';
    }
    if (properties.split(/\s+/).includes('nav')) navHref = href;
  }

  const ncxPath = ncxHref ? normalizeResourcePath(resolve(opfDir, ncxHref)) : null;
  const spineAttr = /<spine\b([^>]*)>/i.exec(opf)?.[1] ?? '';
  const spineToc = /\btoc\s*=\s*["']([^"']+)["']/i.exec(spineAttr)?.[1] ?? null;
  const ncxFileExists = Boolean(ncxPath && zip.file(ncxPath));
  const ncxReferenced = Boolean(
    ncxPath && spineToc && ncxId && spineToc === ncxId && ncxFileExists,
  );

  // ---- 2. Find the nav document ---------------------------------------
  const navPath = navHref
    ? normalizeResourcePath(resolve(opfDir, navHref))
    : Object.keys(zip.files).find((name) => /(^|\/)nav\.x?html?$/i.test(name)) ?? null;
  const navText = navPath && zip.file(navPath) ? await readZipText(zip, navPath) : '';

  if (ncxReferenced && ncxPath) {
    // Already Kindle-compatible. If older firmware expects a `<spine toc>` we
    // have it; nothing to do.
    return { data, warnings, patched: false };
  }

  const entries = navText ? parseNavEntries(navText) : [];
  const docTitle =
    decodeEntities(/<dc:title\b[^>]*>([\s\S]*?)<\/dc:title>/i.exec(opf)?.[1] ?? '').trim() ||
    'Untitled';
  const uid =
    decodeEntities(/<dc:identifier\b[^>]*>([\s\S]*?)<\/dc:identifier>/i.exec(opf)?.[1] ?? '').trim() ||
    `urn:uuid:${crypto.randomUUID?.() ?? Date.now()}`;
  const lang = decodeEntities(/<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i.exec(opf)?.[1] ?? '').trim() ||
    'en';

  const targetDir = navPath ? posixDirname(navPath) : opfDir;
  const targetPath = targetDir ? `${targetDir}/toc.ncx` : 'toc.ncx';

  const contentChanges = new Map<string, Uint8Array>();

  // ---- 3. Write NCX ----------------------------------------------------
  if (!ncxFileExists) {
    if (entries.length === 0) {
      warnings.push(
        'calibre 产物里没有目录，无法补齐 toc.ncx（no TOC in the calibre output, NCX skipped）',
      );
      return { data, warnings, patched: false };
    }
    const ncx = buildNcx({ title: docTitle, uid, lang, entries });
    contentChanges.set(targetPath, new TextEncoder().encode(ncx + '\n'));
  }

  const finalNcxPath = ncxFileExists && ncxPath ? ncxPath : targetPath;
  const finalNcxHref =
    ncxFileExists && ncxHref ? ncxHref : relativeHref(opfDir, finalNcxPath);
  const finalNcxId = ncxFileExists && ncxId ? ncxId : nextId(itemIds, 'ncx');

  // ---- 4. Patch OPF ----------------------------------------------------
  if (!ncxFileExists) {
    const item = `    <item id="${finalNcxId}" href="${finalNcxHref}" media-type="${NCX_MEDIA}"/>`;
    opf = opf.replace(/<\/manifest>/i, `${item}\n  </manifest>`);
  }
  if (!spineToc) {
    opf = opf.replace(/<spine\b([^>]*)>/i, (_m, attrs: string) => `<spine toc="${finalNcxId}"${attrs}>`);
  } else if (spineToc !== finalNcxId) {
    opf = opf.replace(/(<spine\b[^>]*\btoc\s*=\s*["'])[^"']*(["'])/i, `$1${finalNcxId}$2`);
  }
  contentChanges.set(opfPath, new TextEncoder().encode(opf));

  // ---- 5. Rebuild the container, mimetype first & STORED ---------------
  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (name === 'mimetype') continue;
    const replacement = contentChanges.get(name);
    if (replacement) {
      out.file(name, replacement);
      contentChanges.delete(name);
      continue;
    }
    out.file(name, await file.async('uint8array'));
  }
  for (const [name, content] of contentChanges) out.file(name, content);

  const rebuilt = await out.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/epub+zip',
  });

  warnings.push(
    ncxFileExists
      ? '已把 calibre 产物里的 toc.ncx 接回 OPF（re-linked toc.ncx）'
      : '已为 calibre 产物补上 toc.ncx，兼容旧款 Kindle（added toc.ncx for Kindle compatibility）',
  );

  return { data: rebuilt, warnings, patched: true };
}

function nextId(existing: Set<string>, base: string): string {
  if (!existing.has(base)) return base;
  for (let i = 1; i < 100; i += 1) {
    const candidate = `${base}-${i}`;
    if (!existing.has(candidate)) return candidate;
  }
  return `${base}-x`;
}

function resolve(baseDir: string, href: string): string {
  const clean = href.split('#')[0] ?? '';
  return baseDir ? `${baseDir}/${clean}` : clean;
}
