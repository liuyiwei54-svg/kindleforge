/**
 * Rewrite an EPUB package: metadata fields and cover.
 *
 * Used by the v2 library PATCH endpoint. We deliberately edit the OPF text
 * instead of re-serialising the XML tree: it preserves element order, unknown
 * namespaces and vendor metadata that a round-trip through a parser would drop.
 *
 * Guarantees:
 * - existing elements are updated in place, missing ones appended to <metadata>
 * - the OPF keeps its original indentation/order otherwise
 * - the cover image gets `properties="cover-image"`, a cover XHTML page, a
 *   spine entry and a guide reference (all idempotent)
 * - the rebuilt ZIP keeps `mimetype` first, STORED, with no extra field
 */

import JSZip from 'jszip';
import { ConversionError } from '../types';
import type { ApplyEpubMetadataResult, EpubCoverPatch, EpubMetadataPatch } from '../metadata';
import { isbnToUrn, normalizeIsbn } from '../metadata';
import {
  escapeAttr,
  escapeHtml,
  fileAsName,
  imageSize,
  mediaTypeFromName,
  normalizeResourcePath,
  posixBasename,
  posixDirname,
  resolveZipPath,
  uuid,
} from '../util';

const OPF_NS = 'http://www.idpf.org/2007/opf';

interface ManifestItem {
  raw: string;
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

/* ------------------------------------------------------------- xml utils -- */

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function attrOf(attrs: string, name: string): string | undefined {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*["']([^"']*)["']`, 'i');
  return re.exec(attrs)?.[1];
}

/** Remove every occurrence of the given attribute names from an attribute blob. */
function withoutAttrs(attrs: string, names: string[]): string {
  let out = attrs;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\s+${escaped}\\s*=\\s*("[^"]*"|'[^']*')`, 'gi'), '');
  }
  return out.trim();
}

function mergeAttrs(attrs: string, additions: Record<string, string>): string {
  const cleaned = withoutAttrs(attrs, Object.keys(additions));
  const extra = Object.entries(additions)
    .map(([key, value]) => `${key}="${escapeAttr(value)}"`)
    .join(' ');
  return `${cleaned}${cleaned ? ' ' : ''}${extra}`.trim();
}

function makeElement(tag: string, attrs: string, text: string): string {
  const attrText = attrs.trim();
  return `<${tag}${attrText ? ` ${attrText}` : ''}>${escapeXmlText(text)}</${tag}>`;
}

/** Replace the first element of `tag` inside `block`, or append one. */
function setElement(
  block: string,
  tag: string,
  value: string,
  opts: { attrs?: Record<string, string>; appendTo?: string } = {},
): { block: string; changed: boolean } {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`<${escapedTag}\\b([^>]*)>([\\s\\S]*?)</${escapedTag}>`, 'i');
  const match = re.exec(block);
  if (match) {
    const attrs = opts.attrs ? mergeAttrs(match[1], opts.attrs) : match[1].trim();
    const replacement = makeElement(tag, attrs, value);
    return { block: block.slice(0, match.index) + replacement + block.slice(match.index + match[0].length), changed: true };
  }
  const element = makeElement(tag, Object.entries(opts.attrs ?? {}).map(([k, v]) => `${k}="${escapeAttr(v)}"`).join(' '), value);
  const anchor = opts.appendTo ?? '</metadata>';
  const at = block.lastIndexOf(anchor);
  const inserted = at === -1 ? `${block}\n    ${element}` : `${block.slice(0, at)}    ${element}\n  ${block.slice(at)}`;
  return { block: inserted, changed: true };
}

function appendToBlock(block: string, element: string, closing: string): string {
  const at = block.lastIndexOf(closing);
  if (at === -1) return `${block}\n    ${element}`;
  return `${block.slice(0, at)}    ${element}\n  ${block.slice(at)}`;
}

function manifestItems(manifestBlock: string): ManifestItem[] {
  const items: ManifestItem[] = [];
  const re = /<item\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(manifestBlock))) {
    // `[^>]*` swallows the self-closing slash; strip it before rebuilding.
    const attrs = match[1].replace(/\/\s*$/, '');
    items.push({
      raw: match[0],
      id: attrOf(attrs, 'id') ?? '',
      href: attrOf(attrs, 'href') ?? '',
      mediaType: attrOf(attrs, 'media-type') ?? '',
      properties: (attrOf(attrs, 'properties') ?? '').split(/\s+/).filter(Boolean),
    });
  }
  return items;
}

function nextItemId(items: ManifestItem[], base: string): string {
  const used = new Set(items.map((item) => item.id));
  if (!used.has(base)) return base;
  for (let i = 2; i < 200; i += 1) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${uuid().slice(0, 8)}`;
}

function relativePath(fromDir: string, targetPath: string): string {
  const from = fromDir ? fromDir.split('/') : [];
  const to = normalizeResourcePath(targetPath).split('/');
  let common = 0;
  while (common < from.length && common < to.length && from[common] === to[common]) common += 1;
  const up = Array.from({ length: from.length - common }, () => '..');
  return [...up, ...to.slice(common)].join('/') || posixBasename(targetPath);
}

function toIsoDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return trimmed;
}

function coverExtension(mediaType: string, filename?: string): string {
  const fromName = filename?.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
  if (fromName && /^(jpe?g|png|gif|webp|avif)$/.test(fromName)) return fromName === 'jpeg' ? 'jpg' : fromName;
  if (mediaType === 'image/png') return 'png';
  if (mediaType === 'image/gif') return 'gif';
  if (mediaType === 'image/webp') return 'webp';
  if (mediaType === 'image/avif') return 'avif';
  return 'jpg';
}

/* ------------------------------------------------------------------ main -- */

/** Reject entry names that try to escape the archive root (zip-slip). */
export function assertSafeArchivePaths(names: string[]): void {
  for (const name of names) {
    if (/(^|\/)\.\.(\/|$)/.test(name) || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      throw new ConversionError('INVALID_FILE', `EPUB 内含非法路径条目（path traversal）: ${name.slice(0, 80)}`, {
        zh: '这个压缩包试图写入目录之外的路径，已拒绝处理。',
        en: 'The archive contains a path traversal entry and was refused.',
      });
    }
  }
}

async function loadPackage(data: Uint8Array): Promise<{
  zip: JSZip;
  opfPath: string;
  opf: string;
  opfDir: string;
}> {
  if (!data || data.length === 0) {
    throw new ConversionError('INVALID_FILE', 'EPUB 数据为空。', {
      zh: '没有可写入的文件内容。',
      en: 'There is no EPUB content to update.',
    });
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new ConversionError('INVALID_FILE', 'EPUB 解析失败：不是有效的 ZIP 容器。', {
      zh: '文件可能已损坏，或不是 EPUB。',
      en: 'The file is damaged or not an EPUB.',
    });
  }

  // ZIP-slip: we never extract to disk, but a traversal path means the file is
  // hostile and we refuse to rewrite it.
  assertSafeArchivePaths(Object.keys(zip.files).filter((name) => !zip.files[name].dir));

  const containerFile = zip.file('META-INF/container.xml');
  if (!containerFile) {
    throw new ConversionError('INVALID_FILE', '不是有效的 EPUB：缺少 META-INF/container.xml。', {
      zh: '文件可能不是 EPUB，或已损坏。',
      en: 'The file is not a valid EPUB (missing container.xml).',
    });
  }
  const container = await containerFile.async('string');
  const opfPath = /full-path\s*=\s*["']([^"']+)["']/i.exec(container)?.[1];
  if (!opfPath) {
    throw new ConversionError('INVALID_FILE', 'EPUB 的 container.xml 中没有 rootfile。', {
      zh: '文件结构损坏，无法定位 OPF。',
      en: 'No OPF package file is referenced.',
    });
  }
  const normalizedOpf = normalizeResourcePath(opfPath);
  const opfFile = zip.file(normalizedOpf);
  if (!opfFile) {
    throw new ConversionError('INVALID_FILE', `EPUB 缺少包文件：${normalizedOpf}`, {
      zh: '文件结构不完整。',
      en: 'The package document is missing.',
    });
  }
  return {
    zip,
    opfPath: normalizedOpf,
    opf: await opfFile.async('string'),
    opfDir: posixDirname(normalizedOpf),
  };
}

/**
 * Apply metadata and (optionally) a new cover to an EPUB. Returns the rebuilt
 * file; throws `ConversionError('INVALID_FILE')` for broken/hostile input.
 */
export async function applyEpubMetadata(
  data: Uint8Array,
  meta: EpubMetadataPatch = {},
  cover?: EpubCoverPatch,
): Promise<ApplyEpubMetadataResult> {
  const warnings: string[] = [];
  const changed: string[] = [];
  const { zip, opfPath, opf: originalOpf, opfDir } = await loadPackage(data);

  let opf = originalOpf;

  // OPF 3 does not require xmlns:opf, but we write opf: attributes for EPUB 2
  // readers, so make sure the prefix is declared.
  if (!/<package\b[^>]*\bxmlns:opf\s*=/i.test(opf)) {
    opf = opf.replace(/<package\b([^>]*)>/i, (_match, attrs: string) => `<package${attrs} xmlns:opf="${OPF_NS}">`);
  }

  const metadataMatch = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(opf);
  const manifestMatch = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf);
  const spineMatch = /<spine\b[^>]*>([\s\S]*?)<\/spine>/i.exec(opf);
  if (!metadataMatch || !manifestMatch) {
    throw new ConversionError('INVALID_FILE', 'EPUB 的 OPF 缺少 metadata/manifest。', {
      zh: '这不是一个结构完整的 EPUB。',
      en: 'The OPF is not structurally complete.',
    });
  }

  let metadata = metadataMatch[1];
  let manifest = manifestMatch[1];
  let spine = spineMatch ? spineMatch[1] : '';
  const spineAttrs = spineMatch ? /<spine\b([^>]*)>/i.exec(opf)?.[1] ?? '' : '';
  const guideMatch = /<guide\b[^>]*>([\s\S]*?)<\/guide>/i.exec(opf);
  let guide = guideMatch ? guideMatch[1] : '';

  const version = /<package\b[^>]*\bversion\s*=\s*["']([^"']+)["']/i.exec(opf)?.[1] ?? '3.0';
  const isEpub3 = version.trim().startsWith('3');

  /* ---------------------------------------------------------- metadata -- */

  if (meta.title && meta.title.trim()) {
    const result = setElement(metadata, 'dc:title', meta.title.trim());
    metadata = result.block;
    changed.push('title');
  }

  const authorNames = (meta.authors ?? (meta.author ? [meta.author] : []))
    .map((name) => name.trim())
    .filter(Boolean);
  if (authorNames.length > 0) {
    const creatorXml = authorNames
      .map((name, index) => {
        const id = index === 0 ? 'creator' : `creator-${index + 1}`;
        const attrs = `id="${id}" opf:role="aut" opf:file-as="${escapeAttr(fileAsName(name))}"`;
        return makeElement('dc:creator', attrs, name);
      })
      .join('\n    ');

    // Replace the whole creator group in place so other elements keep order.
    const creatorRe = /<dc:creator\b[^>]*>[\s\S]*?<\/dc:creator>\s*/gi;
    const firstCreator = creatorRe.exec(metadata);
    const insertAt = firstCreator ? firstCreator.index : -1;
    metadata = metadata.replace(creatorRe, '');
    metadata =
      insertAt >= 0
        ? `${metadata.slice(0, insertAt)}${creatorXml}\n    ${metadata.slice(insertAt)}`
        : appendToBlock(metadata, creatorXml, '</metadata>');

    if (isEpub3) {
      metadata = metadata.replace(
        /<meta\b[^>]*refines\s*=\s*["']#creator["'][^>]*property\s*=\s*["'](?:file-as|role)["'][^>]*>[\s\S]*?<\/meta>\s*/gi,
        '',
      );
      const refines = [
        '<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>',
        `<meta refines="#creator" property="file-as">${escapeXmlText(fileAsName(authorNames[0]))}</meta>`,
      ].join('\n    ');
      metadata = appendToBlock(metadata, refines, '</metadata>');
    }
    changed.push('creator');
  }

  if (meta.language && meta.language.trim()) {
    const result = setElement(metadata, 'dc:language', meta.language.trim());
    metadata = result.block;
    changed.push('language');
  }
  if (meta.publisher && meta.publisher.trim()) {
    metadata = setElement(metadata, 'dc:publisher', meta.publisher.trim()).block;
    changed.push('publisher');
  }
  if (meta.description && meta.description.trim()) {
    metadata = setElement(metadata, 'dc:description', meta.description.trim()).block;
    changed.push('description');
  }
  if (meta.date && meta.date.trim()) {
    metadata = setElement(metadata, 'dc:date', toIsoDate(meta.date)).block;
    changed.push('date');
  }

  const isbn = meta.isbn ? normalizeIsbn(meta.isbn) : null;
  if (meta.isbn && !isbn) {
    warnings.push(`ISBN 校验失败，已忽略（invalid ISBN ignored）: ${meta.isbn}`);
  }
  const identifierValue = isbn
    ? isbnToUrn(isbn)
    : meta.identifier && meta.identifier.trim()
      ? meta.identifier.trim()
      : null;
  if (identifierValue) {
    const ns = /<dc:identifier\b([^>]*)>[\s\S]*?<\/dc:identifier>/i.exec(metadata);
    if (ns) {
      const attrs = ns[1].trim();
      const replacement = makeElement('dc:identifier', attrs, identifierValue);
      metadata = `${metadata.slice(0, ns.index)}${replacement}${metadata.slice(ns.index + ns[0].length)}`;
    } else {
      metadata = appendToBlock(
        metadata,
        makeElement('dc:identifier', 'id="bookid"', identifierValue),
        '</metadata>',
      );
      if (!/<package\b[^>]*\bunique-identifier\s*=/i.test(opf)) {
        opf = opf.replace(/<package\b([^>]*)>/i, (_m, attrs: string) => `<package${attrs} unique-identifier="bookid">`);
      }
    }
    changed.push('identifier');
  }

  if (meta.subjects && meta.subjects.length > 0) {
    const subjects = meta.subjects.map((subject) => subject.trim()).filter(Boolean);
    if (subjects.length > 0) {
      metadata = metadata.replace(/<dc:subject\b[^>]*>[\s\S]*?<\/dc:subject>\s*/gi, '');
      const xml = subjects
        .map((subject) => `<dc:subject>${escapeXmlText(subject)}</dc:subject>`)
        .join('\n    ');
      metadata = appendToBlock(metadata, xml, '</metadata>');
      changed.push('subject');
    }
  }

  /* ------------------------------------------------------------- cover -- */

  const newFiles = new Map<string, Uint8Array>();
  let coverResult: ApplyEpubMetadataResult['cover'];

  if (cover && cover.data.length > 0) {
    const declaredMediaType = cover.mediaType?.trim() ?? mediaTypeFromName(cover.filename ?? '') ?? 'image/jpeg';
    if (!declaredMediaType.startsWith('image/')) {
      warnings.push(`封面格式不受支持，已跳过（unsupported cover media type）: ${declaredMediaType}`);
    } else {
      const mediaType = declaredMediaType === 'image/jpg' ? 'image/jpeg' : declaredMediaType;
      const items = manifestItems(manifest);
      const coverMetaId = attrOf(
        /<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*>/i.exec(metadata)?.[0] ?? '',
        'content',
      );

      let coverItem =
        items.find((item) => item.properties.includes('cover-image')) ??
        (coverMetaId ? items.find((item) => item.id === coverMetaId) : undefined) ??
        items.find((item) => /(^|\/)cover\.(?:jpe?g|png|gif|webp|avif)$/i.test(item.href));

      const ext = coverExtension(mediaType, cover.filename);
      let imagePath: string;
      let imageHref: string;

      if (coverItem) {
        imageHref = coverItem.href;
        imagePath = resolveZipPath(opfDir, imageHref);
        const attrs = mergeAttrs(
          withoutAttrs(
            (/<item\b([^>]*)\/?>/i.exec(coverItem.raw)?.[1] ?? '').replace(/\/\s*$/, ''),
            ['media-type', 'properties'],
          ),
          { 'media-type': mediaType, properties: 'cover-image' },
        );
        manifest = manifest.replace(coverItem.raw, `<item ${attrs}/>`);
        if (!coverItem.properties.includes('cover-image')) {
          coverItem = { ...coverItem, properties: [...coverItem.properties, 'cover-image'] };
        }
      } else {
        imageHref = `images/cover.${ext}`;
        imagePath = resolveZipPath(opfDir, imageHref);
        const id = nextItemId(items, 'cover-image');
        manifest = appendToBlock(
          manifest,
          `<item id="${id}" href="${escapeAttr(imageHref)}" media-type="${escapeAttr(
            mediaType,
          )}" properties="cover-image"/>`,
          '</manifest>',
        );
        coverItem = {
          raw: '',
          id,
          href: imageHref,
          mediaType,
          properties: ['cover-image'],
        } as ManifestItem;
      }

      if (coverItem.mediaType && coverItem.mediaType !== mediaType) {
        // Keep the OPF honest about what the bytes really are.
        manifest = manifest.replace(
          new RegExp(`(<item\\b[^>]*\\bid\\s*=\\s*["']${coverItem.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*?)\\bmedia-type\\s*=\\s*["'][^"']*["']`, 'i'),
          `$1 media-type="${mediaType}"`,
        );
      }

      newFiles.set(imagePath, cover.data);

      // `<meta name="cover" content="id">` for EPUB 2 / Kindle.
      const metaCoverRe = /<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\/?>/i;
      const metaCover = `<meta name="cover" content="${escapeAttr(coverItem.id)}"/>`;
      if (metaCoverRe.test(metadata)) metadata = metadata.replace(metaCoverRe, metaCover);
      else metadata = appendToBlock(metadata, metaCover, '</metadata>');

      /* ---- cover XHTML page ------------------------------------------ */
      const itemsAfterCover = manifestItems(manifest);
      const existingPage = itemsAfterCover.find((item) => /(^|\/)cover\.x?html?$/i.test(item.href));

      const guideRef = /<reference\b[^>]*\btype\s*=\s*["']cover["'][^>]*>/i.exec(guide)?.[0];
      const guideHref = guideRef ? attrOf(guideRef, 'href') : undefined;
      const pageItem =
        existingPage ??
        (guideHref
          ? itemsAfterCover.find((item) => item.href === guideHref)
          : undefined);

      let pagePath: string;
      let pageHref: string;
      let pageId: string;
      if (pageItem) {
        pageHref = pageItem.href;
        pagePath = resolveZipPath(opfDir, pageHref);
        pageId = pageItem.id;
      } else {
        pageId = nextItemId(itemsAfterCover, 'cover-page');
        pageHref = 'cover.xhtml';
        pagePath = resolveZipPath(opfDir, pageHref);
      }

      const pageDir = posixDirname(pagePath);
      const imgSrc = relativePath(pageDir, imagePath);
      const size = imageSize(cover.data);
      const viewport = size ? `width=${size.width}, height=${size.height}` : 'width=1200, height=1600';
      const language = (
        /<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i.exec(metadata)?.[1] ?? 'en'
      ).trim();
      const coverPage = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(
        language,
      )}" lang="${escapeAttr(language)}">
<head>
<meta charset="utf-8"/>
<title>Cover</title>
<meta name="viewport" content="${viewport}"/>
<style>
html, body { margin: 0; padding: 0; height: 100%; }
body { text-align: center; }
img { display: block; width: 100%; max-width: 100%; height: auto; }
</style>
</head>
<body epub:type="cover">
<div class="cover"><img src="${escapeAttr(imgSrc)}" alt="Cover"/></div>
</body>
</html>`;
      newFiles.set(pagePath, new TextEncoder().encode(coverPage));

      if (!pageItem) {
        manifest = appendToBlock(
          manifest,
          `<item id="${pageId}" href="${escapeAttr(pageHref)}" media-type="application/xhtml+xml"/>`,
          '</manifest>',
        );
      }

      // Spine: cover page first (only insert when it is not already there).
      const spineRef = new RegExp(`<itemref\\b[^>]*\\bidref\\s*=\\s*["']${pageId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i');
      if (!spineRef.test(spine)) {
        spine = `\n    <itemref idref="${pageId}"/>${spine}`;
      }

      // Guide reference.
      if (guideRef) {
        const updatedRef = guideRef.replace(/\bhref\s*=\s*["'][^"']*["']/i, `href="${escapeAttr(pageHref)}"`);
        guide = guide.replace(guideRef, updatedRef);
      } else {
        guide = appendToBlock(
          guide,
          `<reference type="cover" title="Cover" href="${escapeAttr(pageHref)}"/>`,
          '</guide>',
        );
      }

      coverResult = { imagePath, pagePath, mediaType };
      changed.push('cover');
    }
  }

  /* ------------------------------------------------------- write back -- */

  if (changed.length === 0) {
    return { data, warnings, changed };
  }

  opf =
    opf.slice(0, metadataMatch.index) +
    opf.slice(metadataMatch.index).replace(
      /<metadata\b([^>]*)>([\s\S]*?)<\/metadata>/i,
      (_m, attrs: string) => `<metadata${attrs}>${metadata}</metadata>`,
    );

  const manifestInOpf = /<manifest\b([^>]*)>([\s\S]*?)<\/manifest>/i.exec(opf);
  if (manifestInOpf) {
    opf =
      opf.slice(0, manifestInOpf.index) +
      `<manifest${manifestInOpf[1]}>${manifest}</manifest>` +
      opf.slice(manifestInOpf.index + manifestInOpf[0].length);
  }

  const spineInOpf = /<spine\b([^>]*)>([\s\S]*?)<\/spine>/i.exec(opf);
  if (spineInOpf) {
    opf =
      opf.slice(0, spineInOpf.index) +
      `<spine${spineInOpf[1]}>${spine}</spine>` +
      opf.slice(spineInOpf.index + spineInOpf[0].length);
  }

  if (guide || guideMatch) {
    if (guideMatch) {
      const guideMatchInOpf = /<guide\b[^>]*>([\s\S]*?)<\/guide>/i.exec(opf);
      if (guideMatchInOpf) {
        opf =
          opf.slice(0, guideMatchInOpf.index) +
          `<guide>${guide}</guide>` +
          opf.slice(guideMatchInOpf.index + guideMatchInOpf[0].length);
      }
    } else {
      opf = opf.replace('</package>', `  <guide>\n    ${guide}\n  </guide>\n</package>`);
    }
  }

  const output = new JSZip();
  output.file('mimetype', 'application/epub+zip', { compression: 'STORE' });

  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue;
    if (name === 'mimetype') continue;
    if (name === opfPath) {
      output.file(name, new TextEncoder().encode(opf));
      continue;
    }
    output.file(name, await file.async('uint8array'));
  }
  // Overwrite existing cover image/page entries and add the new ones.
  for (const [name, content] of newFiles) output.file(name, content);

  const rebuilt = await output.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    mimeType: 'application/epub+zip',
  });

  return { data: rebuilt, warnings, changed, cover: coverResult };
}

