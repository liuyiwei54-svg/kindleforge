import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import {
  extractIsbn,
  guessMetadata,
  isbnToUrn,
  isValidIsbn,
  normalizeIsbn,
} from '../lib/engine/metadata';
import { ConversionError } from '../lib/engine/types';
import { applyEpubMetadata, assertSafeArchivePaths } from '../lib/engine/node/epub-meta';
import { readEpub } from '../lib/engine/readers/epub';
import { buildMinimalEpub, readFixture, tinyPng } from './engine.helpers';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
});

async function openZip(data: Uint8Array): Promise<JSZip> {
  return JSZip.loadAsync(data);
}

async function readOpf(zip: JSZip): Promise<string> {
  const name = Object.keys(zip.files).find((entry) => entry.endsWith('.opf'));
  if (!name) throw new Error('no OPF');
  return zip.file(name)!.async('string');
}

function localHeader(data: Uint8Array): {
  method: number;
  nameLength: number;
  extraLength: number;
  name: string;
  content: string;
} {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const nameLength = view.getUint16(26, true);
  const extraLength = view.getUint16(28, true);
  const name = new TextDecoder().decode(data.subarray(30, 30 + nameLength));
  const contentStart = 30 + nameLength + extraLength;
  const content = new TextDecoder().decode(data.subarray(contentStart, contentStart + 20));
  return { method: view.getUint16(8, true), nameLength, extraLength, name, content };
}

async function expectEpubFailure(promise: Promise<unknown>, code: string): Promise<ConversionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ConversionError);
    const conversionError = error as ConversionError;
    expect(conversionError.code).toBe(code);
    expect(conversionError.hint?.zh).toBeTruthy();
    expect(conversionError.hint?.en).toBeTruthy();
    return conversionError;
  }
  throw new Error(`expected ConversionError(${code})`);
}

describe('ISBN helpers', () => {
  it('validates ISBN-10 and ISBN-13 check digits', () => {
    expect(normalizeIsbn('978-7-5366-9293-0')).toBe('9787536692930');
    expect(normalizeIsbn('0-306-40615-2')).toBe('0306406152');
    expect(normalizeIsbn('9787536692931')).toBeNull();
    expect(normalizeIsbn('0306406153')).toBeNull();
    expect(isValidIsbn('978 7 5366 9293 0')).toBe(true);
    expect(isbnToUrn('0-306-40615-2')).toBe('urn:isbn:0306406152');
  });

  it('extracts the first valid ISBN from free text', () => {
    expect(extractIsbn('三体 978-7-5366-9293-0 典藏版')).toBe('9787536692930');
    expect(extractIsbn('ISBN: 0-306-40615-2')).toBe('0306406152');
    expect(extractIsbn('no isbn here 1234567890')).toBeNull();
    expect(extractIsbn('bad 978-7-5366-9293-1')).toBeNull();
  });
});

describe('guessMetadata', () => {
  const cases: Array<{
    file: string;
    title: string;
    author?: string;
    isbn?: string;
    minConfidence?: number;
  }> = [
    { file: '《三体》刘慈欣.epub', title: '三体', author: '刘慈欣', minConfidence: 0.85 },
    { file: '三体 - 刘慈欣.epub', title: '三体', author: '刘慈欣', minConfidence: 0.7 },
    { file: '刘慈欣 - 三体.epub', title: '三体', author: '刘慈欣', minConfidence: 0.7 },
    { file: '[刘慈欣]三体.epub', title: '三体', author: '刘慈欣', minConfidence: 0.8 },
    { file: '【刘慈欣】三体.epub', title: '三体', author: '刘慈欣', minConfidence: 0.8 },
    { file: '三体 by 刘慈欣.epub', title: '三体', author: '刘慈欣', minConfidence: 0.9 },
    { file: '三体（刘慈欣）.epub', title: '三体', author: '刘慈欣', minConfidence: 0.75 },
    { file: '红楼梦 (曹雪芹).epub', title: '红楼梦', author: '曹雪芹', minConfidence: 0.7 },
    { file: '刘慈欣_三体.epub', title: '三体', author: '刘慈欣', minConfidence: 0.5 },
    { file: 'Pride and Prejudice - Jane Austen.epub', title: 'Pride and Prejudice', author: 'Jane Austen', minConfidence: 0.7 },
    { file: 'Jane Austen - Pride and Prejudice.epub', title: 'Pride and Prejudice', author: 'Jane Austen', minConfidence: 0.7 },
    { file: 'Pride and Prejudice by Jane Austen.epub', title: 'Pride and Prejudice', author: 'Jane Austen', minConfidence: 0.9 },
    { file: 'The Hobbit by J. R. R. Tolkien.epub', title: 'The Hobbit', author: 'J. R. R. Tolkien', minConfidence: 0.9 },
    { file: 'Sapiens (Yuval Noah Harari).epub', title: 'Sapiens', author: 'Yuval Noah Harari', minConfidence: 0.7 },
    {
      file: 'Sapiens - A Brief History of Humankind - Yuval Noah Harari.epub',
      title: 'Sapiens - A Brief History of Humankind',
      author: 'Yuval Noah Harari',
      minConfidence: 0.6,
    },
    { file: '978-7-5366-9293-0 三体.epub', title: '三体', isbn: '9787536692930', minConfidence: 0.3 },
    {
      file: '三体 (The Three-Body Problem) 9787536692930.epub',
      title: '三体 (The Three-Body Problem)',
      isbn: '9787536692930',
      minConfidence: 0.5,
    },
    { file: '《人类简史：从动物到上帝》尤瓦尔·赫拉利.epub', title: '人类简史：从动物到上帝', author: '尤瓦尔·赫拉利', minConfidence: 0.8 },
    { file: '《三体》.epub', title: '三体', minConfidence: 0.8 },
    { file: '[www.zlib.com] 三体.epub', title: '三体', minConfidence: 0.3 },
    { file: '三体 第2卷.epub', title: '三体 第2卷', minConfidence: 0.2 },
    { file: 'some_random_file_name.epub', title: 'some random file name', minConfidence: 0.2 },
    { file: '.epub', title: '未命名书籍', minConfidence: 0 },
  ];

  for (const testCase of cases) {
    it(`parses ${testCase.file}`, () => {
      const guessed = guessMetadata(testCase.file);
      expect(guessed.title).toBe(testCase.title);
      expect(guessed.author).toBe(testCase.author);
      if (testCase.isbn) expect(guessed.isbn).toBe(testCase.isbn);
      else expect(guessed.isbn).toBeUndefined();
      expect(guessed.confidence).toBeGreaterThanOrEqual(testCase.minConfidence ?? 0);
      expect(guessed.confidence).toBeLessThanOrEqual(1);
    });
  }

  it('never returns an empty title and drops scan-site noise', () => {
    expect(guessMetadata('').title.length).toBeGreaterThan(0);
    expect(guessMetadata('book (z-lib.org).epub').title).not.toContain('z-lib');
  });

  it('keeps invalid ISBN-looking digits in the title instead of inventing one', () => {
    const guessed = guessMetadata('978-7-5366-9293-1 三体.epub');
    expect(guessed.isbn).toBeUndefined();
    expect(guessed.title).toContain('三体');
  });
});

describe('applyEpubMetadata — metadata fields', () => {
  it('writes every field in place, escaped and namespaced', async () => {
    const epub = await buildMinimalEpub({ title: '旧标题', language: 'en' });
    const before = await readOpf(await openZip(epub));
    expect(before).toContain('<dc:title>旧标题</dc:title>');

    const result = await applyEpubMetadata(
      epub,
      {
        title: '雨夜书店 & <测试>',
        author: '刘慈欣',
        language: 'zh-CN',
        publisher: '出版社 & Co',
        description: '简介 "引号" <标签>',
        isbn: '978-7-5366-9293-0',
        date: '2024-05-01',
      },
      { data: tinyPng(), mediaType: 'image/png', filename: 'cover.png' },
    );

    expect(result.changed).toEqual(
      expect.arrayContaining(['title', 'creator', 'language', 'publisher', 'description', 'date', 'identifier', 'cover']),
    );
    expect(result.cover?.mediaType).toBe('image/png');

    const zip = await openZip(result.data);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');

    const opf = await readOpf(zip);
    expect(() => xml.parse(opf)).not.toThrow();
    // A self-closing slash must never end up in the middle of an <item>.
    expect(opf).not.toMatch(/\/\s+[a-z-]+="/i);

    expect(opf).toContain('<dc:title>雨夜书店 &amp; &lt;测试&gt;</dc:title>');
    const parsed = xml.parse(opf) as any;
    const metadata = parsed.package.metadata;
    expect(metadata.title).toBe('雨夜书店 & <测试>');
    expect(metadata.creator['#text']).toBe('刘慈欣');
    expect(metadata.creator['@_role']).toBe('aut');
    expect(metadata.creator['@_file-as']).toBe('刘慈欣');
    expect(metadata.language).toBe('zh-CN');
    expect(metadata.publisher).toBe('出版社 & Co');
    expect(metadata.description).toBe('简介 "引号" <标签>');
    expect(metadata.identifier['#text']).toBe('urn:isbn:9787536692930');
    expect(metadata.date).toBe('2024-05-01');
    // EPUB 3 refinement meta for the creator.
    const meta = Array.isArray(metadata.meta) ? metadata.meta : [metadata.meta];
    expect(meta.some((entry: any) => entry['@_property'] === 'file-as')).toBe(true);
    expect(opf).toContain('xmlns:opf="http://www.idpf.org/2007/opf"');
  });

  it('keeps the ZIP invariant: mimetype first, STORED, no extra field', async () => {
    const epub = await buildMinimalEpub();
    const result = await applyEpubMetadata(epub, { title: '新标题' }, { data: tinyPng(), mediaType: 'image/png' });
    const header = localHeader(result.data);
    expect(header.name).toBe('mimetype');
    expect(header.method).toBe(0);
    expect(header.extraLength).toBe(0);
    expect(header.content).toBe('application/epub+zip');
  });

  it('returns the original bytes when nothing is requested', async () => {
    const epub = await buildMinimalEpub();
    const result = await applyEpubMetadata(epub, {});
    expect(result.changed).toEqual([]);
    expect(result.data).toBe(epub);
  });

  it('warns about an invalid ISBN and leaves the identifier alone', async () => {
    const epub = await buildMinimalEpub();
    const result = await applyEpubMetadata(epub, { title: 'x', isbn: '978-7-5366-9293-1' });
    expect(result.warnings.join(' ')).toContain('ISBN');
    expect(result.changed).not.toContain('identifier');
    const opf = await readOpf(await openZip(result.data));
    expect(opf).toContain('urn:uuid:11111111-2222-3333-4444-555555555555');
  });

  it('only adds EPUB 3 refines metadata for EPUB 3 packages', async () => {
    // Downgrade the package version to 2.0 and re-zip.
    const epub = await buildMinimalEpub();
    const zip = await openZip(epub);
    const opfName = Object.keys(zip.files).find((name) => name.endsWith('.opf'))!;
    let opf = await zip.file(opfName)!.async('string');
    opf = opf.replace(/version="3\.0"/, 'version="2.0"');
    const out = new JSZip();
    out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    for (const name of Object.keys(zip.files)) {
      if (zip.files[name].dir || name === 'mimetype' || name === opfName) continue;
      out.file(name, await zip.files[name].async('uint8array'));
    }
    out.file(opfName, opf);
    const epub2 = await out.generateAsync({ type: 'uint8array' });

    const result = await applyEpubMetadata(epub2, { author: 'Ada' });
    const updated = await readOpf(await openZip(result.data));
    expect(updated).toContain('opf:file-as="Ada"');
    expect(updated).not.toContain('property="file-as"');
  });
});

describe('applyEpubMetadata — cover', () => {
  it('adds cover image, page, spine entry, guide reference and meta cover', async () => {
    const epub = await buildMinimalEpub({ title: '封面测试' });
    const result = await applyEpubMetadata(epub, {}, { data: tinyPng(), mediaType: 'image/png' });

    const zip = await openZip(result.data);
    const names = Object.keys(zip.files);
    const opf = await readOpf(zip);

    // Exactly one cover-image manifest item.
    expect((opf.match(/properties="cover-image"/g) ?? []).length).toBe(1);
    expect((opf.match(/<meta name="cover"/g) ?? []).length).toBe(1);
    expect((opf.match(/type="cover"/g) ?? []).length).toBe(1);

    const coverItem = /<item\b[^>]*properties="cover-image"[^>]*\/>/.exec(opf)![0];
    const coverId = /id="([^"]+)"/.exec(coverItem)![1];
    expect(new RegExp(`<meta name="cover" content="${coverId}"`).test(opf)).toBe(true);

    const pagePath = 'OEBPS/cover.xhtml';
    expect(names).toContain(pagePath);
    const page = await zip.file(pagePath)!.async('string');
    expect(() => xml.parse(page)).not.toThrow();
    expect(page).toContain('<meta name="viewport" content="width=64, height=96"/>');
    expect(page).toContain('width: 100%');
    expect(page).toContain('src="images/cover.png"');

    // Spine: cover page first.
    const spine = /<spine\b[^>]*>([\s\S]*?)<\/spine>/.exec(opf)![1];
    const firstRef = /<itemref\b[^>]*idref="([^"]+)"/.exec(spine)![1];
    expect(firstRef).toBe('cover-page');

    // Guide reference exists and points at the page.
    expect(opf).toMatch(/<reference\b[^>]*type="cover"[^>]*href="cover\.xhtml"/);
    expect(result.cover?.imagePath).toBe('OEBPS/images/cover.png');
    expect(result.cover?.pagePath).toBe(pagePath);
  });

  it('is idempotent: applying twice does not duplicate anything', async () => {
    const epub = await buildMinimalEpub();
    const cover = { data: tinyPng(), mediaType: 'image/png' as const };
    const meta = { title: '幂等测试', author: '某人', isbn: '0306406152' };

    const first = await applyEpubMetadata(epub, meta, cover);
    const second = await applyEpubMetadata(first.data, meta, cover);
    const zip = await openZip(second.data);
    const opf = await readOpf(zip);
    const names = Object.keys(zip.files);

    expect((opf.match(/<dc:title>/g) ?? []).length).toBe(1);
    expect((opf.match(/<dc:creator\b/g) ?? []).length).toBe(1);
    expect((opf.match(/properties="cover-image"/g) ?? []).length).toBe(1);
    expect((opf.match(/<meta name="cover"/g) ?? []).length).toBe(1);
    expect((opf.match(/type="cover"/g) ?? []).length).toBe(1);
    expect((opf.match(/idref="cover-page"/g) ?? []).length).toBe(1);
    expect((opf.match(/<item\b[^>]*href="cover\.xhtml"/g) ?? []).length).toBe(1);
    expect(names.filter((name) => name === 'OEBPS/cover.xhtml')).toHaveLength(1);
    expect(names[0]).toBe('mimetype');
  });

  it('replaces the image of an existing cover page', async () => {
    const epub = await buildMinimalEpub();
    const first = await applyEpubMetadata(epub, {}, { data: tinyPng(), mediaType: 'image/png' });
    const bigger = new Uint8Array(tinyPng());
    const second = await applyEpubMetadata(first.data, {}, { data: bigger, mediaType: 'image/png' });
    const secondZip = await openZip(second.data);
    const names = Object.keys(secondZip.files);
    expect(names.filter((name) => name.endsWith('cover.xhtml'))).toHaveLength(1);
    const page = await secondZip.file('OEBPS/cover.xhtml')!.async('string');
    expect((page.match(/<img\b/g) ?? []).length).toBe(1);
  });

  it('rejects a non-image cover with a warning', async () => {
    const epub = await buildMinimalEpub();
    const result = await applyEpubMetadata(epub, { title: 'x' }, {
      data: new TextEncoder().encode('not an image'),
      mediaType: 'application/pdf',
    });
    expect(result.warnings.join(' ')).toContain('封面');
    expect(result.cover).toBeUndefined();
  });
});

describe('applyEpubMetadata — real books and failures', () => {
  it('rewrites the Gutenberg EPUB and is still readable by our reader', async () => {
    const pride = readFixture('pride.epub');
    const result = await applyEpubMetadata(
      pride,
      { title: 'Pride and Prejudice (KindleForge)', author: 'Jane Austen', language: 'en', isbn: '9780141439518' },
      { data: tinyPng(), mediaType: 'image/png' },
    );

    const zip = await openZip(result.data);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    // Existing NCX + nav are untouched.
    expect(names).toContain('OEBPS/toc.ncx');
    const opf = await readOpf(zip);
    expect(opf).toContain('<dc:title>Pride and Prejudice (KindleForge)</dc:title>');
    expect(opf).toContain('urn:isbn:9780141439518');
    expect(opf).toContain('properties="cover-image"');
    expect(opf).not.toMatch(/\/\s+[a-z-]+="/i);

    const book = await readEpub({ name: 'pride.epub', data: result.data });
    expect(book.meta.title).toBe('Pride and Prejudice (KindleForge)');
    expect(book.meta.author).toBe('Jane Austen');
    expect(book.chapters.length).toBeGreaterThan(50);
    expect(book.meta.coverPath).toBeDefined();
  });

  it('rejects a corrupt archive', async () => {
    await expectEpubFailure(
      applyEpubMetadata(new Uint8Array([1, 2, 3, 4, 5]), { title: 'x' }),
      'INVALID_FILE',
    );
  });

  it('rejects a ZIP without an OPF', async () => {
    const zip = new JSZip();
    zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expectEpubFailure(applyEpubMetadata(data, { title: 'x' }), 'INVALID_FILE');
  });

  it('refuses zip-slip entry names', () => {
    expect(() => assertSafeArchivePaths(['OEBPS/content.opf', '../evil.txt'])).toThrow(ConversionError);
    expect(() => assertSafeArchivePaths(['/etc/passwd'])).toThrow(ConversionError);
    expect(() => assertSafeArchivePaths(['C:\\Windows\\evil'])).toThrow(ConversionError);
    expect(() => assertSafeArchivePaths(['OEBPS/content.opf', 'images/cover.jpg'])).not.toThrow();
  });
});
