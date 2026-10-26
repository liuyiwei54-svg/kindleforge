import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { convert, detectFormat } from '../lib/engine';
import { htmlToText, utf8Encode } from '../lib/engine/util';
import { bookStats } from '../lib/engine/model';
import { buildMinimalEpub, CHINESE_TXT, readFixture, tinyPng } from './engine.helpers';

const xml = new XMLParser({ ignoreAttributes: false, allowBooleanAttributes: true });

async function openEpub(data: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(data);
}

async function fileText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`missing ${path}`);
  return file.async('string');
}

function compressionOf(zip: JSZip, path: string): number | undefined {
  const data = (zip.files[path] as unknown as {
    _data?: { compressionMethod?: number; compression?: number | { magic?: string } };
  })._data;
  if (!data) return undefined;
  if (typeof data.compressionMethod === 'number') return data.compressionMethod;
  if (typeof data.compression === 'number') return data.compression;
  const magic = data.compression?.magic;
  if (typeof magic === 'string' && magic.length >= 2) {
    return magic.charCodeAt(0) | (magic.charCodeAt(1) << 8);
  }
  return undefined;
}

function navChapterCount(nav: string): number {
  return (nav.match(/<li><a href="text\/chap-\d+\.xhtml"/g) ?? []).length;
}

/** Asserts the invariants both calibre and Kindle enforce. */
async function expectValidEpub(data: Uint8Array): Promise<JSZip> {
  const zip = await openEpub(data);
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);

  // 1. mimetype must be the first entry and stored uncompressed.
  expect(names[0]).toBe('mimetype');
  expect(await fileText(zip, 'mimetype')).toBe('application/epub+zip');
  expect(compressionOf(zip, 'mimetype')).toBe(0);
  // ...which we also verify against the raw local file header.
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  expect(view.getUint16(8, true)).toBe(0); // compression method 0 = stored
  expect(view.getUint16(26, true)).toBe(8); // file name length of "mimetype"

  // 2. OCF container points at the OPF.
  const container = await fileText(zip, 'META-INF/container.xml');
  expect(container).toContain('full-path="OEBPS/content.opf"');

  // 3. OPF is valid XML with the required metadata and nav/NCX.
  const opf = await fileText(zip, 'OEBPS/content.opf');
  expect(() => xml.parse(opf)).not.toThrow();
  expect(opf).toContain('<dc:identifier id="bookid">urn:uuid:');
  expect(opf).toContain('<dc:language>');
  expect(opf).toContain('property="dcterms:modified"');
  expect(opf).toContain('properties="nav"');
  expect(opf).toContain('<spine toc="ncx"');

  // 4. Every XHTML document is well-formed and declares UTF-8 + a language.
  for (const name of names.filter((n) => n.endsWith('.xhtml'))) {
    const body = await fileText(zip, name);
    expect(body, name).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body, name).toContain('<!DOCTYPE html>');
    expect(body, name).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(() => xml.parse(body), name).not.toThrow();
  }

  // 5. nav + NCX exist and agree with each other.
  const nav = await fileText(zip, 'OEBPS/nav.xhtml');
  expect(nav).toContain('epub:type="toc"');
  expect(nav).toContain('epub:type="landmarks"');
  const ncx = await fileText(zip, 'OEBPS/toc.ncx');
  expect(ncx).toContain('<navMap>');
  return zip;
}

describe('EPUB structure', () => {
  it('produces a spec-compliant EPUB 3 from a Chinese TXT', async () => {
    const result = await convert(
      { name: '雨夜书店.txt', data: utf8Encode(CHINESE_TXT) },
      {
        target: 'epub',
        options: {
          typography: { indent: 2, lineHeight: 1.8, justify: true, fontFamily: 'serif' },
          metadata: { author: '林墨', title: '雨夜书店' },
        },
      },
    );

    expect(result.engine).toBe('builtin');
    expect(result.mime).toBe('application/epub+zip');
    expect(result.filename).toBe('雨夜书店.epub');
    expect(result.book?.chapters).toBeGreaterThanOrEqual(3);
    expect(result.warnings).toEqual([]);

    const zip = await expectValidEpub(result.data);

    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('<dc:title>雨夜书店</dc:title>');
    expect(opf).toContain('<dc:creator id="creator">林墨</dc:creator>');
    expect(opf).toContain('<dc:language>zh-CN</dc:language>');
    // No picture in a TXT, so the writer generates a text cover page instead.
    expect(zip.file('OEBPS/text/cover.xhtml')).not.toBeNull();
    const cover = await fileText(zip, 'OEBPS/text/cover.xhtml');
    expect(cover).toContain('title-page');
    expect(cover).toContain('雨夜书店');

    // No broken Chinese: every chapter document is valid UTF-8 with the text.
    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    expect(chapters.length).toBe(result.book?.chapters);
    const all = (await Promise.all(chapters.map((c) => fileText(zip, c)))).join('\n');
    expect(all).toContain('林墨第一次见到她');
    expect(all).toContain('全角标点：，。！？；：“”‘’（）——《》');

    // nav lists every chapter, in reading order.
    const nav = await fileText(zip, 'OEBPS/nav.xhtml');
    expect(navChapterCount(nav)).toBe(chapters.length);
    expect(nav).toContain('第一章 初遇');
  });

  it('writes the requested typography into the stylesheet', async () => {
    const result = await convert(
      { name: 'typo.txt', data: utf8Encode(CHINESE_TXT) },
      {
        target: 'epub',
        options: {
          typography: { indent: 1.5, lineHeight: 2, justify: false, hyphenate: false, fontSize: 20 },
        },
      },
    );
    const zip = await openEpub(result.data);
    const css = await fileText(zip, 'OEBPS/styles/book.css');
    expect(css).toContain('text-indent: 1.5em');
    expect(css).toContain('line-height: 2');
    expect(css).toContain('text-align: left');
    expect(css).toContain('hyphens: none');
    expect(css).toContain('font-size: 125%');
    expect(css).not.toMatch(/font-size:\s*\d+px/);
  });

  it('supports manga mode: RTL progression and the cover at the end', async () => {
    const result = await convert(
      { name: 'manga.cbz', data: readFixture('sample.cbz') },
      { target: 'epub', options: { mangaMode: true } },
    );
    const zip = await openEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('page-progression-direction="rtl"');
    const spine = opf.slice(opf.indexOf('<spine'), opf.indexOf('</spine>'));
    expect(spine.trimEnd().endsWith('<itemref idref="cover-page"/>')).toBe(true);
  });

  it('can omit the TOC entries while keeping the nav document valid', async () => {
    const result = await convert(
      { name: 'notoc.txt', data: utf8Encode(CHINESE_TXT) },
      { target: 'epub', options: { toc: false } },
    );
    const zip = await expectValidEpub(result.data);
    const nav = await fileText(zip, 'OEBPS/nav.xhtml');
    expect(navChapterCount(nav)).toBe(0);
    expect(nav).toContain('<ol>');
    const ncx = await fileText(zip, 'OEBPS/toc.ncx');
    expect(ncx).toContain('<navMap>');
    expect(ncx).not.toContain('<navPoint');
  });

  it('honours cover:false and metadata overrides', async () => {
    const result = await convert(
      { name: 'nocover.txt', data: utf8Encode(CHINESE_TXT) },
      { target: 'epub', options: { cover: false, metadata: { title: '改名之书', author: '某人' } } },
    );
    const zip = await openEpub(result.data);
    expect(zip.file('OEBPS/text/cover.xhtml')).toBeNull();
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).not.toContain('name="cover"');
    expect(opf).toContain('<dc:title>改名之书</dc:title>');
    expect(result.book?.title).toBe('改名之书');
  });
});

describe('EPUB round-trips', () => {
  it('reads a hand-written EPUB 3 and converts it to TXT and HTML', async () => {
    const epub = await buildMinimalEpub();
    const asTxt = await convert({ name: 'hand.epub', data: epub }, { target: 'txt' });
    const text = new TextDecoder().decode(asTxt.data);
    expect(text).toContain('第一章 起风');
    expect(text).toContain('风从海上来，带着咸味与凉意。');
    expect(text).toContain('第二章 落雨');

    const asHtml = await convert({ name: 'hand.epub', data: epub }, { target: 'html' });
    const html = new TextDecoder().decode(asHtml.data);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('风从海上来');
    expect(html).toContain('<nav class="toc"');
    expect(html).toContain('data:image/png;base64,'); // images inlined
  });

  it('normalises EPUB → EPUB without losing text or chapters', async () => {
    const epub = await buildMinimalEpub();
    const result = await convert({ name: 'hand.epub', data: epub }, { target: 'epub' });
    const zip = await expectValidEpub(result.data);
    const text = await fileText(zip, 'OEBPS/text/chap-001.xhtml');
    expect(text).toContain('风从海上来');
    expect(result.book?.title).toBe('手写小书');
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('<dc:title>手写小书</dc:title>');
  });

  it('reads a real Project Gutenberg EPUB and rebuilds it', async () => {
    const data = readFixture('pride.epub');
    expect(detectFormat('pride.epub', data)).toBe('epub');

    const result = await convert({ name: 'pride.epub', data }, { target: 'epub' });
    expect(result.engine).toBe('builtin');
    expect(result.book?.title).toBe('Pride and Prejudice');
    expect(result.book?.author).toBe('Jane Austen');
    expect(result.book?.language).toBe('en');
    expect(result.book?.chapters).toBeGreaterThan(50);
    expect(result.book?.images).toBeGreaterThanOrEqual(1);

    const zip = await expectValidEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('<dc:title>Pride and Prejudice</dc:title>');
    expect(opf).toContain('<dc:language>en</dc:language>');
    expect(opf).toContain('properties="cover-image"');

    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    const text = (await Promise.all(chapters.slice(0, 5).map((c) => fileText(zip, c)))).join('\n');
    expect(text).toContain('universally acknowledged');
    // Chapter titles come from the source headings, not the TOC noise.
    const titles = chapters.map(async (c) => fileText(zip, c));
    expect((await Promise.all(titles)).join('\n')).toContain('Chapter I');
  });
});

describe('other readers into EPUB', () => {
  it('converts DOCX (headings + inline image) to EPUB', async () => {
    const result = await convert(
      { name: 'sample.docx', data: readFixture('sample.docx') },
      { target: 'epub' },
    );
    expect(result.engine).toBe('builtin');
    const zip = await expectValidEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('image/png');
    expect(opf).toContain('<dc:title>雨夜书店</dc:title>');
    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    expect(chapters.length).toBe(3);
    const joined = (await Promise.all(chapters.map((c) => fileText(zip, c)))).join('\n');
    expect(joined).toContain('第一章 初遇');
    expect(joined).toContain('图书馆的第三排书架');
    expect(joined).toContain('<img src="../images/');
  });

  it('converts a CBZ into a fixed-layout EPUB with one page per picture', async () => {
    const result = await convert(
      { name: 'sample.cbz', data: readFixture('sample.cbz') },
      { target: 'epub' },
    );
    expect(result.engine).toBe('builtin');
    expect(result.book?.chapters).toBe(2);
    const zip = await expectValidEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    const page = await fileText(zip, 'OEBPS/text/chap-001.xhtml');
    expect(page).toContain('<meta name="viewport" content="width=480, height=720"/>');
    expect(page).toContain('<img src="../images/page-0001.png"');
  });

  it('converts a real CBR (RAR) comic into a fixed-layout EPUB', async () => {
    const result = await convert(
      { name: 'sample.cbr', data: readFixture('sample.cbr') },
      { target: 'epub' },
    );
    expect(result.engine).toBe('builtin');
    expect(result.book?.chapters).toBe(3);
    const zip = await expectValidEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('<meta property="rendition:layout">pre-paginated</meta>');
    const page = await fileText(zip, 'OEBPS/text/chap-001.xhtml');
    expect(page).toContain('<meta name="viewport" content="width=800, height=1200"/>');
    expect(page).toContain('<img src="../images/page-0001.png"');
  }, 30_000);

  it('converts a single image into a fixed-layout picture book', async () => {
    const result = await convert(
      { name: 'photo.png', data: tinyPng() },
      { target: 'epub' },
    );
    const zip = await expectValidEpub(result.data);
    const opf = await fileText(zip, 'OEBPS/content.opf');
    expect(opf).toContain('image/jpeg');
    expect(result.book?.images).toBe(1);
  });

  it('converts Markdown with frontmatter into chapters', async () => {
    const result = await convert(
      { name: 'english.md', data: readFixture('english.md') },
      { target: 'epub' },
    );
    expect(result.book?.title).toBe('The Lantern Keeper');
    expect(result.book?.author).toBe('Ada Fielding');
    expect(result.book?.language).toBe('en');
    const zip = await expectValidEpub(result.data);
    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    expect(chapters.length).toBe(3);
    const joined = (await Promise.all(chapters.map((c) => fileText(zip, c)))).join('\n');
    expect(joined).toContain('<blockquote>');
    expect(joined).toContain('<pre><code>');
    expect(joined).toContain('<li>');
  });

  it('converts a real Chinese TXT with scene breaks and full-width punctuation', async () => {
    const result = await convert(
      { name: 'zh-novel.txt', data: readFixture('zh-novel.txt') },
      { target: 'epub' },
    );
    expect(result.book?.title).toBe('雨夜书店');
    expect(result.book?.author).toBe('林墨');
    const zip = await expectValidEpub(result.data);
    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    const joined = (await Promise.all(chapters.map((c) => fileText(zip, c)))).join('\n');
    expect(joined).toContain('序章');
    expect(joined).toContain('第一章 初遇');
    expect(joined).toContain('番外一 书店的猫');
    expect(joined).toContain('<hr/>');
  });
});

describe('TXT writer', () => {
  it('keeps scene breaks and stays BOM-free through a TXT → EPUB → TXT trip', async () => {
    const epub = await convert(
      { name: 'zh-novel.txt', data: readFixture('zh-novel.txt') },
      { target: 'epub' },
    );
    const result = await convert({ name: 'zh-novel.epub', data: epub.data }, { target: 'txt' });
    expect(result.data[0]).not.toBe(0xef); // no UTF-8 BOM
    const text = new TextDecoder('utf-8', { fatal: true }).decode(result.data);
    expect(text).toContain('雨夜书店');
    expect(text).toContain('第一章 初遇');
    expect(text).toContain('***'); // the scene divider survives the round trip
    expect(text).toContain('墨点');
  });

  it('round-trips an EPUB into readable plain text', async () => {
    const epub = await buildMinimalEpub();
    const result = await convert({ name: 'hand.epub', data: epub }, { target: 'txt' });
    const bytes = result.data;
    expect(bytes[0]).not.toBe(0xef); // no UTF-8 BOM
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    expect(text).toContain('第一章 起风');
    expect(text).toContain('第二章 落雨');
    expect(text).toContain('雨落下来');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\n{3,}/);
  });
});

describe('book statistics', () => {
  it('reports plausible chapter / word / image counts', async () => {
    const book = {
      meta: { title: 't', sourceFormat: 'txt' as const },
      chapters: [{ id: 'c1', title: '一', html: '<p>这是中文 hello world</p>' }],
      resources: [{ path: 'images/a.png', data: tinyPng(), mediaType: 'image/png' }],
      sourceFormat: 'txt' as const,
    };
    const stats = bookStats(book);
    expect(stats.chapters).toBe(1);
    expect(stats.images).toBe(1);
    expect(stats.words).toBe(6); // 这是中文(4) + hello + world
    expect(htmlToText(book.chapters[0].html)).toBe('这是中文 hello world');
  });
});
