import { describe, expect, it } from 'vitest';
import {
  convert,
  detectFormat,
  engineStatus,
  canRunLocally,
  listPairs,
  type EngineHost,
} from '../lib/engine';
import { ConversionError } from '../lib/engine/types';
import { readTxt } from '../lib/engine/readers/txt';
import { readMd } from '../lib/engine/readers/md';
import { readHtml } from '../lib/engine/readers/html';
import { readEpub } from '../lib/engine/readers/epub';
import { readFb2 } from '../lib/engine/readers/fb2';
import { readCbz } from '../lib/engine/readers/cbz';
import { readCbr } from '../lib/engine/readers/cbr';
import { readImage } from '../lib/engine/readers/image';
import { bookWarnings } from '../lib/engine/model';
import { escapeHtml, utf8Encode } from '../lib/engine/util';
import {
  buildLyingZip,
  buildMinimalEpub,
  CHINESE_TXT,
  readFixture,
  tinyPng,
  longChineseProse,
} from './engine.helpers';

async function expectError(promise: Promise<unknown>, code: string): Promise<ConversionError> {
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

describe('detectFormat', () => {
  it('uses magic numbers before the extension', async () => {
    const epub = await buildMinimalEpub();
    expect(detectFormat('book.txt', epub)).toBe('epub');
    expect(detectFormat('book.bin', readFixture('sample.docx'))).toBe('docx');
    expect(detectFormat('book.bin', readFixture('sample.cbz'))).toBe('cbz');
    expect(detectFormat('x', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]))).toBe('pdf');
    expect(detectFormat('x', tinyPng())).toBe('image');
    expect(detectFormat('x', new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image');
    expect(detectFormat('x', new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]))).toBe('cbr');
    expect(detectFormat('x', utf8Encode('{\\rtf1\\ansi}'))).toBe('rtf');
    expect(detectFormat('x', utf8Encode('<?xml version="1.0"?><FictionBook></FictionBook>'))).toBe('fb2');
  });

  it('detects MOBI/AZW3 by the BookMOBI creator at offset 60', () => {
    const palm = new Uint8Array(80);
    palm.set(new TextEncoder().encode('BOOKMOBI'), 60);
    expect(detectFormat('x.mobi', palm)).toBe('mobi');
    expect(detectFormat('x.azw3', palm)).toBe('azw3');
    expect(detectFormat('x.azw', palm)).toBe('azw');
  });

  it('falls back to the extension for text formats', () => {
    expect(detectFormat('a.txt', utf8Encode('hello'))).toBe('txt');
    expect(detectFormat('a.md', utf8Encode('# title'))).toBe('md');
    expect(detectFormat('a.html', utf8Encode('<html></html>'))).toBe('html');
    expect(detectFormat('a.markdown', utf8Encode('# t'))).toBe('md');
  });

  it('unmasks a text file that was renamed to .epub', () => {
    expect(detectFormat('book.epub', utf8Encode(CHINESE_TXT))).toBe('txt');
    expect(detectFormat('book.epub', utf8Encode('<!doctype html><html><body>x</body></html>'))).toBe(
      'html',
    );
  });

  it('returns null for binary junk', () => {
    expect(detectFormat('x.dat', new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toBeNull();
  });
});

describe('capabilities', () => {
  it('marks the zero-upload paths as local', () => {
    expect(canRunLocally('txt', 'epub')).toBe(true);
    expect(canRunLocally('md', 'epub')).toBe(true);
    expect(canRunLocally('epub', 'txt')).toBe(true);
    expect(canRunLocally('epub', 'html')).toBe(true);
    expect(canRunLocally('docx', 'epub')).toBe(false);
    expect(canRunLocally('epub', 'mobi')).toBe(false);
    expect(canRunLocally('txt', 'azw')).toBe(false);
  });

  it('lists pairs without duplicates and with quality notes', () => {
    const pairs = listPairs();
    expect(pairs.length).toBeGreaterThan(50);
    const keys = new Set(pairs.map((p) => `${p.from}>${p.to}`));
    expect(keys.size).toBe(pairs.length);
    expect(pairs.find((p) => p.from === 'txt' && p.to === 'epub')?.engine).toBe('builtin');
    expect(pairs.find((p) => p.from === 'epub' && p.to === 'mobi')?.engine).toBe('calibre');
    expect(pairs.find((p) => p.from === 'pdf' && p.to === 'epub')?.note?.en).toContain('OCR');
  });

  it('reports engine status from the injected host only', async () => {
    expect(await engineStatus()).toEqual({ calibre: false, pandoc: false, tesseract: false });
    const host: EngineHost = {
      calibre: { available: true, run: async () => ({ data: new Uint8Array(), warnings: [] }) },
    };
    expect(await engineStatus(host)).toEqual({ calibre: true, pandoc: false, tesseract: false });
  });
});

describe('TXT reader', () => {
  it('finds Chinese chapter headings and keeps the preamble as metadata', async () => {
    const book = await readTxt({ name: 'zh-novel.txt', data: readFixture('zh-novel.txt') });
    expect(book.meta.title).toBe('雨夜书店');
    expect(book.meta.author).toBe('林墨');
    expect(book.chapters.map((c) => c.title)).toEqual([
      '序章',
      '第一章 初遇',
      '第二章 离别',
      '第三章 重逢',
      '番外一 书店的猫',
    ]);
    expect(book.chapters[1].html).toContain('<p>');
    expect(book.chapters[1].html).toContain('图书馆的第三排书架');
  });

  it('decodes GB18030 text and warns about it', async () => {
    const gb = new Uint8Array([
      181, 218, 210, 187, 213, 194, 32, 178, 226, 202, 212, 10, 10, 213, 226, 202, 199, 210, 187, 182,
      206, 214, 208, 206, 196, 206, 196, 215, 214, 163, 172, 211, 195, 192, 180, 188, 236, 178, 233,
      177, 224, 194, 235, 204, 189, 178, 226, 202, 199, 183, 241, 213, 253, 200, 183, 161, 163, 10,
    ]);
    const book = await readTxt({ name: 'gbk.txt', data: gb });
    expect(book.chapters[0].title).toBe('第一章 测试');
    expect(book.chapters[0].html).toContain('这是一段中文文字');
    expect(bookWarnings(book).join(' ')).toContain('GB18030');
  });

  it('keeps mid-chapter scene breaks', async () => {
    const book = await readTxt({
      name: 'short.txt',
      data: utf8Encode(`${longChineseProse(20)}\n\n***\n\n${longChineseProse(5)}`),
    });
    expect(book.chapters.length).toBe(1);
    expect(book.chapters[0].html).toContain('<hr class="scene-break"/>');
    const [before, after] = book.chapters[0].html.split('<hr class="scene-break"/>');
    expect(before).toContain('雨落');
    expect(after).toContain('雨落');
  });

  it('splits text without headings every 30k characters', async () => {
    const book = await readTxt({
      name: 'huge.txt',
      data: utf8Encode(longChineseProse(3000)),
    });
    expect(book.chapters.length).toBeGreaterThanOrEqual(2);
    expect(bookWarnings(book).join(' ')).toContain('未识别到章节标题');
  });
});

describe('Markdown reader', () => {
  it('reads frontmatter and heading levels', async () => {
    const book = await readMd({ name: 'english.md', data: readFixture('english.md') });
    expect(book.meta.title).toBe('The Lantern Keeper');
    expect(book.meta.author).toBe('Ada Fielding');
    expect(book.meta.language).toBe('en');
    expect(book.chapters.map((c) => c.title)).toEqual(['One', 'Two', 'Three']);
    expect(book.chapters[1].html).toContain('<ul>');
    expect(book.chapters[2].html).toContain('<pre><code>');
  });

  it('renders tables, lists, links and inline images', async () => {
    const png = tinyPng();
    const md = `# 书

## 表格

| 名称 | 数量 |
| --- | --- |
| 苹果 | 3 |

- 第一项
- 第二项

[链接](https://example.com) 与 ![图](data:image/png;base64,${Buffer.from(png).toString('base64')})

![远程](https://example.com/x.png)
`;
    const book = await readMd({ name: 'table.md', data: utf8Encode(md) });
    const html = book.chapters[0].html;
    expect(html).toContain('<table>');
    expect(html).toContain('<th>名称</th>');
    expect(html).toContain('<td>苹果</td>');
    expect(html).toContain('<a href="https://example.com">链接</a>');
    expect(book.resources.length).toBe(1);
    expect(book.resources[0].mediaType).toBe('image/png');
    expect(html).toContain(`<img src="${book.resources[0].path}"`);
    expect(bookWarnings(book).join(' ')).toContain('远程图片');
  });
});

describe('HTML reader', () => {
  it('extracts the article, strips chrome and splits on headings', async () => {
    const png = Buffer.from(tinyPng()).toString('base64');
    const page = `<!doctype html><html lang="zh-CN"><head><title>雨后 - 某博客</title>
<meta name="author" content="阿乙"></head>
<body><nav>首页 分类 关于</nav><header>站点横幅</header>
<article><h1>雨后</h1><p>雨停了，街上没有人。</p>
<h2>第二天</h2><p>太阳出来，水洼里有一只麻雀。</p>
<img src="data:image/png;base64,${png}" alt="插图">
<img src="https://cdn.example.com/remote.png"></article>
<footer>版权</footer><script>track()</script></body></html>`;
    const book = await readHtml({ name: 'post.html', data: utf8Encode(page) });
    expect(book.meta.title).toBe('雨后');
    expect(book.meta.author).toBe('阿乙');
    expect(book.chapters.map((c) => c.title)).toEqual(['第二天']);
    const joined = book.chapters.map((c) => c.html).join('\n');
    expect(joined).toContain('麻雀');
    expect(joined).not.toContain('首页 分类 关于');
    expect(joined).not.toContain('track(');
    expect(joined).toContain('<img src="images/');
    expect(book.resources.length).toBe(1);
    expect(bookWarnings(book).join(' ')).toContain('远程图片');
  });

  it('rejects an empty document gracefully', async () => {
    const book = await readHtml({ name: 'empty.html', data: utf8Encode('<html><body></body></html>') });
    expect(book.chapters.length).toBe(1);
    expect(bookWarnings(book).join(' ')).toContain('没有可读正文');
  });
});

describe('EPUB reader', () => {
  it('reads metadata, cover, TOC and images', async () => {
    const epub = await buildMinimalEpub();
    const book = await readEpub({ name: 'hand.epub', data: epub });
    expect(book.meta.title).toBe('手写小书');
    expect(book.meta.author).toBe('测试作者');
    expect(book.meta.language).toBe('zh-CN');
    expect(book.meta.coverPath).toBeDefined();
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章 起风', '第二章 落雨']);
    expect(book.chapters[1].html).toContain('<img src="images/');
    expect(book.resources.some((r) => r.mediaType === 'image/png')).toBe(true);
  });

  it('rejects DRM-protected EPUBs', async () => {
    const epub = await buildMinimalEpub({ drm: true });
    const error = await expectError(readEpub({ name: 'drm.epub', data: epub }), 'DRM');
    expect(error.hint?.en).toContain('DRM');
  });

  it('allows font obfuscation (not DRM) with a warning', async () => {
    const epub = await buildMinimalEpub({ fontObfuscation: true });
    const book = await readEpub({ name: 'font.epub', data: epub });
    expect(book.chapters.length).toBe(2);
    expect(bookWarnings(book).join(' ')).toContain('字体已混淆');
  });

  it('falls back to the manifest when the spine is empty', async () => {
    const epub = await buildMinimalEpub({ emptySpine: true });
    const book = await readEpub({ name: 'nospine.epub', data: epub });
    expect(book.chapters.length).toBe(2);
    expect(bookWarnings(book).join(' ')).toContain('spine');
  });

  it('reports a broken container clearly', async () => {
    const jszip = (await import('jszip')).default;
    const zip = new jszip();
    zip.file('mimetype', 'application/epub+zip');
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expectError(readEpub({ name: 'broken.epub', data }), 'INVALID_FILE');
  });
});

describe('FB2 reader', () => {
  it('reads sections, inline styles, images and notes', async () => {
    const png = Buffer.from(tinyPng()).toString('base64');
    const fb2 = `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description><title-info>
    <book-title>测试 FB2</book-title>
    <author><first-name>张</first-name><last-name>三</last-name></author>
    <lang>zh</lang>
    <annotation><p>一段简介。</p></annotation>
  </title-info></description>
  <body>
    <section><title><p>第一章</p></title><p>正文一，含<emphasis>斜体</emphasis>。</p>
      <image l:href="#pic.png"/></section>
    <section><title><p>第二章</p></title><p>正文二。</p></section>
  </body>
  <body name="notes"><section id="n1"><title><p>1</p></title><p>注释一。</p></section></body>
  <binary id="pic.png" content-type="image/png">${png}</binary>
</FictionBook>`;
    const book = await readFb2({ name: 'book.fb2', data: utf8Encode(fb2) });
    expect(book.meta.title).toBe('测试 FB2');
    expect(book.meta.author).toBe('张三');
    expect(book.meta.description).toContain('简介');
    expect(book.chapters.map((c) => c.title)).toEqual(['第一章', '第二章', '注释']);
    expect(book.chapters[0].html).toContain('<em>斜体</em>');
    expect(book.chapters[0].html).toContain('<img src="');
    expect(book.resources.length).toBe(1);
  });

  it('rejects non-FB2 XML', async () => {
    await expectError(
      readFb2({ name: 'x.fb2', data: utf8Encode('<?xml version="1.0"?><root/>') }),
      'INVALID_FILE',
    );
  });
});

describe('CBZ reader', () => {
  it('reads pages in natural order with a cover', async () => {
    const book = await readCbz({ name: 'sample.cbz', data: readFixture('sample.cbz') });
    expect(book.fixedLayout).toBe(true);
    expect(book.chapters.map((c) => c.title)).toEqual(['第 1 页', '第 2 页']);
    expect(book.meta.coverPath).toBe('images/page-0001.jpg'.replace('.jpg', '.png'));
    expect(book.resources.length).toBe(2);
    expect(book.chapters[0].html).toContain('width="480"');
  });

  it('rejects a ZIP without pictures', async () => {
    const jszip = (await import('jszip')).default;
    const zip = new jszip();
    zip.file('readme.txt', 'no pictures here');
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expectError(readCbz({ name: 'empty.cbz', data }), 'INVALID_FILE');
  });

  it('rejects a non-ZIP archive', async () => {
    await expectError(readCbz({ name: 'bad.cbz', data: utf8Encode('not a zip') }), 'INVALID_FILE');
  });

  it('measures real bytes, not the declared size (forged ZIP)', async () => {
    const data = await buildLyingZip();
    // The central directory claims 1 KB; the entry really inflates to 5 MB.
    await expectError(readCbz({ name: 'lying.cbz', data }), 'TOO_LARGE');
  }, 30_000);

  it('refuses archives with too many entries (zip bomb guard)', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (let i = 0; i < 5001; i += 1) zip.file(`f/${i}.txt`, '');
    const data = await zip.generateAsync({ type: 'uint8array' });
    await expectError(readCbz({ name: 'bomb.cbz', data }), 'TOO_LARGE');
  }, 30_000);
});

describe('CBR reader', () => {
  it('unpacks a real RAR comic (WASM, no system unrar)', async () => {
    const book = await readCbr({ name: 'sample.cbr', data: readFixture('sample.cbr') });
    expect(book.fixedLayout).toBe(true);
    expect(book.chapters.length).toBe(3);
    expect(book.chapters.map((c) => c.title)).toEqual(['第 1 页', '第 2 页', '第 3 页']);
    expect(book.resources.length).toBe(3);
    expect(book.resources[0].mediaType).toBe('image/png');
    expect(book.chapters[0].html).toContain('width="800"');
    expect(book.chapters[0].html).toContain('height="1200"');
  });

  it('refuses non-RAR input with a clear error', async () => {
    const error = await expectError(readCbr({ name: 'bad.cbr', data: utf8Encode('nope') }), 'INVALID_FILE');
    expect(error.message).toContain('CBR');
  });

  it('refuses a truncated RAR', async () => {
    const rarHeader = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    await expectError(readCbr({ name: 'broken.cbr', data: rarHeader }), 'INVALID_FILE');
  });
});

describe('image reader', () => {
  it('converts a picture to a fixed-layout page', async () => {
    const book = await readImage({ name: 'photo.png', data: tinyPng() });
    expect(book.fixedLayout).toBe(true);
    expect(book.chapters.length).toBe(1);
    expect(book.chapters[0].html).toContain('<img src="images/page-0001');
    expect(book.resources.length).toBe(1);
    expect(book.resources[0].mediaType).toMatch(/^image\//);
  });

  it('rejects a file that is not a picture', async () => {
    await expectError(readImage({ name: 'x.png', data: utf8Encode('hello') }), 'INVALID_FILE');
  });
});

describe('orchestration errors and engine routing', () => {
  it('rejects an unsupported pair with a hint', async () => {
    const error = await expectError(
      convert({ name: 'a.txt', data: utf8Encode(CHINESE_TXT) }, { target: 'azw' }),
      'UNSUPPORTED_PAIR',
    );
    expect(error.message).toContain('txt → azw');
    expect(error.hint?.zh).toContain('可以转换');
  });

  it('rejects empty input', async () => {
    await expectError(convert({ name: 'a.txt', data: new Uint8Array() }, { target: 'epub' }), 'INVALID_FILE');
  });

  it('asks for calibre instead of faking a MOBI', async () => {
    await expectError(
      convert({ name: 'a.txt', data: utf8Encode(CHINESE_TXT) }, { target: 'mobi' }),
      'ENGINE_MISSING',
    );
    await expectError(
      convert({ name: 'a.txt', data: utf8Encode(CHINESE_TXT) }, { target: 'mobi' }, {
        calibre: { available: false, run: async () => ({ data: new Uint8Array(), warnings: [] }) },
      }),
      'ENGINE_MISSING',
    );
  });

  it('builds our own EPUB before handing a TXT to calibre', async () => {
    const requests: Array<{ fromExt: string; target: string; data: Uint8Array }> = [];
    const host: EngineHost = {
      calibre: {
        available: true,
        run: async (request) => {
          requests.push({ fromExt: request.fromExt, target: request.target, data: request.data });
          return { data: new Uint8Array([1, 2, 3]), warnings: ['calibre note'] };
        },
      },
    };
    const result = await convert(
      { name: 'a.txt', data: utf8Encode(CHINESE_TXT) },
      { target: 'mobi' },
      host,
    );
    expect(result.engine).toBe('builtin+calibre');
    expect(result.warnings).toContain('calibre note');
    expect(result.data).toEqual(new Uint8Array([1, 2, 3]));
    expect(requests[0].fromExt).toBe('epub');
    expect(requests[0].target).toBe('mobi');
    // The intermediate payload really is an EPUB, not raw text.
    expect(String.fromCharCode(...requests[0].data.slice(0, 2))).toBe('PK');
    expect(result.filename.endsWith('.mobi')).toBe(true);
  });

  it('hands calibre-native inputs straight to calibre', async () => {
    const requests: Array<{ fromExt: string; data: Uint8Array }> = [];
    const input = utf8Encode('%PDF-1.4 fake');
    const host: EngineHost = {
      calibre: {
        available: true,
        run: async (request) => {
          requests.push({ fromExt: request.fromExt, data: request.data });
          return { data: new Uint8Array([9]), warnings: [] };
        },
      },
    };
    const result = await convert({ name: 'scan.pdf', data: input }, { target: 'epub' }, host);
    expect(result.engine).toBe('calibre');
    expect(requests[0].fromExt).toBe('pdf');
    expect(requests[0].data).toBe(input);
  });

  it('surfaces reader warnings in the conversion result', async () => {
    const gb = new Uint8Array([
      181, 218, 210, 187, 213, 194, 32, 178, 226, 202, 212, 10, 10, 213, 226, 202, 199,
    ]);
    const result = await convert({ name: 'gbk.txt', data: gb }, { target: 'epub' });
    expect(result.warnings.join(' ')).toContain('GB18030');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.book?.chapters).toBe(1);
  });

  it('keeps HTML output self-contained', async () => {
    const epub = await buildMinimalEpub();
    const result = await convert({ name: 'hand.epub', data: epub }, { target: 'html' });
    const html = new TextDecoder().decode(result.data);
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('<nav class="toc"');
    expect(html).toContain('第一章 起风');
    expect(() => escapeHtml(html)).not.toThrow();
  });
});
