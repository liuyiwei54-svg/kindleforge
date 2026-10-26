/**
 * Test fixtures & builders for the engine suite.
 *
 * Text fixtures are committed under `tests/fixtures/`; the hand-written EPUB is
 * assembled here so the DRM and font-obfuscation variants stay in one place.
 */

import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

export function readFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES, name)));
}

export function fixturePath(name: string): string {
  return join(FIXTURES, name);
}

/** A real 64×96 PNG (208 bytes) so libpng/sharp accept it. */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABgCAIAAAAip+O/AAAAl0lEQVR42u3cMRWAMAwFwJSHFAQgAwmIQAEC0IIcJKGADh2gpffXLL2XdEzStGzRcoZoPAAAAADfZnwqXOde1UPn9eisA3n3m8nPgk8MAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEMW7lLXttP6wA8ldCQAAAICuATdsxgpnCtS5+wAAAABJRU5ErkJggg==';

export function tinyPng(): Uint8Array {
  return new Uint8Array(Buffer.from(TINY_PNG_BASE64, 'base64'));
}

export const UTF8 = (text: string): Uint8Array => new TextEncoder().encode(text);

export interface MinimalEpubOptions {
  /** Adds META-INF/encryption.xml pointing at chapter 1. */
  drm?: boolean;
  /** Encryption only covers an embedded font (legal obfuscation, not DRM). */
  fontObfuscation?: boolean;
  withCover?: boolean;
  title?: string;
  language?: string;
  /** Break the spine so we can test the fallback path. */
  emptySpine?: boolean;
}

/**
 * A minimal, hand-written EPUB 3 that exercises every code path our reader cares
 * about: container, OPF manifest/spine, nav, NCX, a cover image, two chapters,
 * CSS and an image inside chapter 2.
 */
export async function buildMinimalEpub(options: MinimalEpubOptions = {}): Promise<Uint8Array> {
  const title = options.title ?? '手写小书';
  const language = options.language ?? 'zh-CN';
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
  );

  if (options.drm || options.fontObfuscation) {
    const uri = options.fontObfuscation ? 'OEBPS/fonts/book.ttf' : 'OEBPS/chapter1.xhtml';
    zip.file(
      'META-INF/encryption.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#">
  <enc:EncryptedData>
    <enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/>
    <enc:CipherData><enc:CipherReference URI="${uri}"/></enc:CipherData>
  </enc:EncryptedData>
</encryption>`,
    );
    if (options.fontObfuscation) zip.file('OEBPS/fonts/book.ttf', new Uint8Array([0, 1, 2, 3]));
  }

  const cover = options.withCover !== false;
  const png = tinyPng();
  if (cover) zip.file('OEBPS/images/cover.png', png);
  zip.file('OEBPS/images/sample.png', png);

  zip.file(
    'OEBPS/styles.css',
    'body { line-height: 1.6 }\np { margin: 0; text-indent: 2em }\n',
  );

  zip.file(
    'OEBPS/chapter1.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head><meta charset="utf-8"/><title>第一章</title><link rel="stylesheet" href="styles.css"/></head>
<body><h1>第一章 起风</h1>
<p>风从海上来，带着咸味与凉意。</p>
<p>这是第二段，全角标点：，。！？；：“”‘’。</p>
</body></html>`,
  );
  zip.file(
    'OEBPS/chapter2.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}">
<head><meta charset="utf-8"/><title>第二章</title><link rel="stylesheet" href="styles.css"/></head>
<body><h1>第二章 落雨</h1>
<p>雨落下来，像是有人在天上筛豆子。</p>
<p><img src="images/sample.png" alt="插图"/></p>
</body></html>`,
  );

  const spine = options.emptySpine
    ? ''
    : `<itemref idref="ch1"/><itemref idref="ch2"/>`;

  zip.file(
    'OEBPS/content.opf',
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${language}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:creator>测试作者</dc:creator>
    <dc:language>${language}</dc:language>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="styles.css" media-type="text/css"/>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
    <item id="sample-img" href="images/sample.png" media-type="image/png"/>
    ${cover ? '<item id="cover-img" href="images/cover.png" media-type="image/png" properties="cover-image"/>' : ''}
  </manifest>
  <spine toc="ncx">${spine}</spine>
</package>`,
  );

  zip.file(
    'OEBPS/nav.xhtml',
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><meta charset="utf-8"/><title>目录</title></head>
<body>
<nav epub:type="toc"><ol>
  <li><a href="chapter1.xhtml">第一章 起风</a></li>
  <li><a href="chapter2.xhtml">第二章 落雨</a></li>
</ol></nav>
</body></html>`,
  );

  zip.file(
    'OEBPS/toc.ncx',
    `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${language}">
  <head><meta name="dtb:uid" content="urn:uuid:11111111-2222-3333-4444-555555555555"/></head>
  <docTitle><text>${title}</text></docTitle>
  <navMap>
    <navPoint id="np-1" playOrder="1"><navLabel><text>第一章 起风</text></navLabel><content src="chapter1.xhtml"/></navPoint>
    <navPoint id="np-2" playOrder="2"><navLabel><text>第二章 落雨</text></navLabel><content src="chapter2.xhtml"/></navPoint>
  </navMap>
</ncx>`,
  );

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

/**
 * A ZIP whose central directory lies: it declares 1000 bytes for an entry that
 * actually inflates to 5 MB. Used to prove we measure real bytes, not headers.
 */
export async function buildLyingZip(declaredBytes = 1000): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('page-01.png', new Uint8Array(5 * 1024 * 1024));
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const patched = new Uint8Array(data);
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength);
  for (let i = 0; i + 30 <= patched.length; i += 1) {
    const signature = view.getUint32(i, false);
    if (signature === 0x504b0304) {
      view.setUint32(i + 22, declaredBytes, true); // local file header: uncompressed size
    } else if (signature === 0x504b0102) {
      view.setUint32(i + 24, declaredBytes, true); // central directory: uncompressed size
    }
  }
  return patched;
}

/** Chinese text with chapter headings and full-width punctuation. */
export const CHINESE_TXT = `雨夜书店
林墨

序章

这座城市的雨总是来得没有预兆。

第一章　初遇

林墨第一次见到她，是在图书馆的第三排书架前。

“这本书，”他说，“我也在找。”

***

第二章　离别

后来他们还是分开了。全角标点：，。！？；：“”‘’（）——《》。
`;

/** 1800+ chars of prose so a chapter survives the "too short" merge rule. */
export function longChineseProse(times = 12): string {
  return '雨落在旧书店的玻璃上，顺着木框滑下来。'.repeat(times);
}
