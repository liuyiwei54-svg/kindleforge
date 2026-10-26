import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { convert } from '../lib/engine';
import { ensureEpubToc, parseNavEntries } from '../lib/engine/node/epub-toc';
import {
  buildCalibreArgs,
  buildCalibreFailure,
  extractWarnings,
  findCalibre,
} from '../lib/engine/node/calibre';
import { redactEngineOutput } from '../lib/engine/node/redact';
import { findPandoc } from '../lib/engine/node/pandoc';
import { createEngineHost } from '../lib/engine/node/host';
import { utf8Encode } from '../lib/engine/util';
import { CHINESE_TXT, longChineseProse } from './engine.helpers';

const calibre = await findCalibre();
const hasCalibre = calibre !== null;

/** Magic checks we care about: Kindle opens these or it does not. */
function asciiAt(data: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...data.subarray(offset, offset + length));
}

/** Remove the NCX from an EPUB, mimicking calibre's `--epub-version 3` output. */
async function stripNcx(data: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files);
  const opfName = names.find((name) => name.endsWith('.opf'))!;
  const ncxName = names.find((name) => name.endsWith('.ncx'));
  let opf = await zip.file(opfName)!.async('string');
  opf = opf.replace(/<item\b[^>]*application\/x-dtbncx\+xml[^>]*\/?>\s*/i, '');
  opf = opf.replace(/(<spine\b[^>]*)\s+toc\s*=\s*"[^"]*"/i, '$1');

  const out = new JSZip();
  out.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  for (const name of names) {
    if (zip.files[name].dir || name === 'mimetype' || name === ncxName || name === opfName) continue;
    out.file(name, await zip.files[name].async('uint8array'));
  }
  out.file(opfName, opf);
  return out.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

function compressionMethodOf(zip: JSZip, path: string): string | undefined {
  const data = (zip.files[path] as unknown as { _data?: { compression?: { magic?: string } } })._data;
  return data?.compression?.magic;
}

const MANY_CHAPTERS = [
  '第一章 起风',
  '',
  longChineseProse(40),
  '',
  '第二章 落雨',
  '',
  longChineseProse(40),
  '',
  '第三章 天晴',
  '',
  longChineseProse(40),
].join('\n');

describe('calibre argument builder', () => {
  it('never emits the option calibre 8 removed', () => {
    const args = buildCalibreArgs({ inputPath: 'a.epub', outputPath: 'b.mobi', target: 'mobi' });
    expect(args).not.toContain('--no-default-epub-cover');
  });

  it('uses the Kindle profile, embedded fonts and our typography', () => {
    const args = buildCalibreArgs({
      inputPath: 'a.epub',
      outputPath: 'b.mobi',
      target: 'mobi',
      options: { typography: { indent: 2, lineHeight: 1.8 } },
    });
    expect(args[0]).toBe('a.epub');
    expect(args[1]).toBe('b.mobi');
    expect(args).toContain('--output-profile');
    expect(args[args.indexOf('--output-profile') + 1]).toBe('kindle');
    expect(args).toContain('--embed-all-fonts');
    expect(args).toContain('--mobi-file-type');
    expect(args[args.indexOf('--mobi-file-type') + 1]).toBe('both');
    const css = args[args.indexOf('--extra-css') + 1];
    expect(css).toContain('text-indent: 2em');
    expect(css).toContain('line-height: 1.8');
    expect(css).not.toContain('@charset');
  });

  it('asks calibre for a heading-based TOC when building EPUB', () => {
    const args = buildCalibreArgs({ inputPath: 'a.odt', outputPath: 'b.epub', target: 'epub' });
    expect(args).toContain('--level1-toc');
    expect(args[args.indexOf('--level1-toc') + 1]).toContain('h1');
    expect(args).toContain('--level2-toc');
    expect(args).toContain('--epub-version');
    const mobi = buildCalibreArgs({ inputPath: 'a.odt', outputPath: 'b.mobi', target: 'mobi' });
    expect(mobi).not.toContain('--level1-toc');
  });

  it('adds the PDF page setup and skips ebook-only flags', () => {
    const args = buildCalibreArgs({ inputPath: 'a.epub', outputPath: 'b.pdf', target: 'pdf' });
    expect(args).toContain('--paper-size');
    expect(args[args.indexOf('--paper-size') + 1]).toBe('a5');
    expect(args.filter((a) => a.startsWith('--pdf-page-margin-'))).toHaveLength(4);
    const docx = buildCalibreArgs({ inputPath: 'a.epub', outputPath: 'b.docx', target: 'docx' });
    expect(docx).not.toContain('--output-profile');
    expect(docx).not.toContain('--extra-css');
  });

  it('passes metadata overrides through', () => {
    const args = buildCalibreArgs({
      inputPath: 'a.epub',
      outputPath: 'b.azw3',
      target: 'azw3',
      options: { metadata: { title: '书名', author: '作者', language: 'zh-CN' } },
    });
    expect(args[args.indexOf('--title') + 1]).toBe('书名');
    expect(args[args.indexOf('--authors') + 1]).toBe('作者');
    expect(args[args.indexOf('--language') + 1]).toBe('zh-CN');
  });
});

describe('calibre stderr handling', () => {
  it('keeps warnings, drops progress noise and anonymises temp paths', () => {
    const stderr = [
      '1% Starting',
      'WARNING: Could not find cover image',
      '  50% Parsing',
      'WARNING: font family not supported',
      '/tmp/kindleforge-calibre-abc/input.epub: not supported',
      '100% Done',
    ].join('\n');
    const warnings = extractWarnings(stderr, '/tmp/kindleforge-calibre-abc');
    expect(warnings.length).toBeGreaterThanOrEqual(2);
    expect(warnings.join(' ')).toContain('Could not find cover image');
    expect(warnings.join(' ')).toContain('<job>/input.epub: not supported');
    expect(warnings.join(' ')).not.toContain('Parsing');
  });
});

describe('calibre EPUB TOC repair', () => {
  it('parses nested nav entries into a depth tree', () => {
    const nav = `<nav epub:type="toc"><ol>
      <li><a href="a.xhtml">第一部</a><ol><li><a href="b.xhtml">第一章</a></li></ol></li>
      <li><a href="c.xhtml">第二部</a></li>
    </ol></nav>`;
    const entries = parseNavEntries(nav);
    expect(entries.map((e) => [e.label, e.depth])).toEqual([
      ['第一部', 1],
      ['第一章', 2],
      ['第二部', 1],
    ]);
  });

  it('adds toc.ncx, patches the OPF and keeps mimetype first + STORED', async () => {
    const epub = await convert({ name: '书.txt', data: utf8Encode(MANY_CHAPTERS) }, { target: 'epub' });
    const stripped = await stripNcx(epub.data);
    // Precondition: the input really has no NCX.
    expect(Object.keys((await JSZip.loadAsync(stripped)).files).some((n) => n.endsWith('.ncx'))).toBe(false);

    const result = await ensureEpubToc(stripped);
    expect(result.patched).toBe(true);
    expect(result.warnings.join(' ')).toContain('toc.ncx');

    const zip = await JSZip.loadAsync(result.data);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    expect(names[0]).toBe('mimetype');
    expect(compressionMethodOf(zip, 'mimetype')).toBe('\u0000\u0000');
    expect(names).toContain('OEBPS/toc.ncx');

    const ncx = await zip.file('OEBPS/toc.ncx')!.async('string');
    expect(ncx).toContain('<navMap>');
    expect((ncx.match(/<navPoint\b/g) ?? []).length).toBe(epub.book?.chapters);

    const opf = await zip.file('OEBPS/content.opf')!.async('string');
    expect(opf).toContain('media-type="application/x-dtbncx+xml"');
    expect(opf).toMatch(/<spine\b[^>]*toc="ncx"/);
  });

  it('leaves an EPUB that already has a linked NCX untouched', async () => {
    const epub = await convert({ name: '书.txt', data: utf8Encode(MANY_CHAPTERS) }, { target: 'epub' });
    const result = await ensureEpubToc(epub.data);
    expect(result.patched).toBe(false);
    expect(result.data).toBe(epub.data);
  });
});

describe('external engine output redaction', () => {
  const jobDir = '/var/folders/95/544cly013xxc3y4xr/T/kindleforge-calibre-a1b2c3';
  const stderr = [
    `ERROR: Could not read ${jobDir}/input.epub`,
    'WARNING: missing font /Users/yiwei/Library/fonts/serif.ttf',
    `File: file://${jobDir}/input.epub`,
    'job 9f8f8f8f-1234-4abc-9def-0123456789ab failed',
  ].join('\n');

  function assertNoLeak(text: string): void {
    expect(text).not.toContain('/var/folders');
    expect(text).not.toContain('/Users/');
    expect(text).not.toMatch(/file:\/\//);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  }

  it('replaces absolute paths with <job> but keeps the filename', () => {
    const redacted = redactEngineOutput(stderr, jobDir);
    assertNoLeak(redacted);
    expect(redacted).toContain('<job>/input.epub');
    expect(redacted).toContain('<job>/serif.ttf');
  });

  it('redacts warnings before they reach the API', () => {
    const warnings = extractWarnings(stderr, jobDir);
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    assertNoLeak(warnings.join('\n'));
  });

  it('redacts the failure message and its hint', () => {
    const error = buildCalibreFailure(1, stderr, '', jobDir);
    assertNoLeak(`${error.message}\n${error.hint?.zh ?? ''}\n${error.hint?.en ?? ''}`);
    expect(error.code).toBe('INTERNAL');
    expect(error.message).toContain('Calibre 退出码 1');
    expect(error.message).toContain('<job>/input.epub');
  });

  it('leaves ordinary text untouched', () => {
    const text = 'WARNING: cover image not found; using default';
    expect(redactEngineOutput(text)).toBe(text);
  });
});

describe('engine presence', () => {
  it('reports whether the optional engines exist', async () => {
    expect(calibre === null || calibre.includes('ebook-convert')).toBe(true);
    const pandoc = await findPandoc();
    expect(pandoc === null || pandoc.includes('pandoc')).toBe(true);
  });
});

describe.skipIf(!hasCalibre)('real calibre conversions', () => {
  it('converts our EPUB to MOBI with a valid PalmDOC/BOOKMOBI header', async () => {
    const host = await createEngineHost();
    const epub = await convert(
      { name: '书.txt', data: utf8Encode(MANY_CHAPTERS) },
      { target: 'epub' },
    );
    const mobi = await convert({ name: '书.epub', data: epub.data }, { target: 'mobi' }, host);
    expect(mobi.engine).toBe('calibre');
    expect(mobi.data.length).toBeGreaterThan(10_000);
    expect(asciiAt(mobi.data, 60, 8)).toBe('BOOKMOBI');
    expect(mobi.filename.endsWith('.mobi')).toBe(true);
  }, 120_000);

  it('converts TXT to AZW3 through builtin EPUB + calibre', async () => {
    const host = await createEngineHost();
    const result = await convert(
      { name: '书.txt', data: utf8Encode(MANY_CHAPTERS) },
      { target: 'azw3' },
      host,
    );
    expect(result.engine).toBe('builtin+calibre');
    expect(result.data.length).toBeGreaterThan(10_000);
    expect(asciiAt(result.data, 60, 8)).toBe('BOOKMOBI');
    expect(result.book?.chapters).toBeGreaterThanOrEqual(3);
  }, 120_000);

  it('converts EPUB to PDF and back to EPUB', async () => {
    const host = await createEngineHost();
    const epub = await convert(
      { name: '书.txt', data: utf8Encode(MANY_CHAPTERS) },
      { target: 'epub' },
    );
    const pdf = await convert({ name: '书.epub', data: epub.data }, { target: 'pdf' }, host);
    expect(pdf.engine).toBe('calibre');
    expect(asciiAt(pdf.data, 0, 4)).toBe('%PDF');
    expect(pdf.data.length).toBeGreaterThan(10_000);

    const back = await convert({ name: '书.pdf', data: pdf.data }, { target: 'epub' }, host);
    expect(back.engine).toBe('calibre');
    // Calibre's EPUB output is a real EPUB container.
    expect(asciiAt(back.data, 0, 2)).toBe('PK');
    expect(back.data.length).toBeGreaterThan(5_000);
  }, 180_000);

  it('converts DOCX to MOBI in one step', async () => {
    const host = await createEngineHost();
    const fs = await import('node:fs');
    const docx = new Uint8Array(fs.readFileSync('tests/fixtures/sample.docx'));
    const result = await convert({ name: 'sample.docx', data: docx }, { target: 'mobi' }, host);
    expect(result.engine).toBe('builtin+calibre');
    expect(asciiAt(result.data, 60, 8)).toBe('BOOKMOBI');
    expect(result.data.length).toBeGreaterThan(5_000);
  }, 120_000);

  it('warns when a scanned PDF has no text layer (DOCX target)', async () => {
    const host = await createEngineHost();
    const fs = await import('node:fs');
    const scan = new Uint8Array(fs.readFileSync('tests/fixtures/scanned.pdf'));
    const result = await convert({ name: 'scanned.pdf', data: scan }, { target: 'docx' }, host);
    expect(result.warnings.join(' ')).toContain('未检测到文字层');
    expect(result.warnings.join(' ')).toContain('OCR');
  }, 120_000);

  it('does not warn for a PDF that has a real text layer', async () => {
    const host = await createEngineHost();
    const epub = await convert({ name: '书.txt', data: utf8Encode(MANY_CHAPTERS) }, { target: 'epub' });
    const pdf = await convert({ name: '书.epub', data: epub.data }, { target: 'pdf' }, host);
    const back = await convert({ name: '书.pdf', data: pdf.data }, { target: 'docx' }, host);
    expect(back.warnings.join(' ')).not.toContain('未检测到文字层');
  }, 180_000);

  it('repairs the TOC for ODT → EPUB (toc.ncx present, nav ≥ 2, calibre re-reads it)', async () => {
    const host = await createEngineHost();
    const fs = await import('node:fs');
    const odt = new Uint8Array(fs.readFileSync('tests/fixtures/sample.odt'));
    const result = await convert({ name: 'sample.odt', data: odt }, { target: 'epub' }, host);
    expect(result.engine).toBe('calibre');
    expect(result.warnings.join(' ')).toContain('toc.ncx');

    const zip = await JSZip.loadAsync(result.data);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    expect(names[0]).toBe('mimetype');
    expect(compressionMethodOf(zip, 'mimetype')).toBe('\u0000\u0000');
    expect(names.some((name) => name.endsWith('toc.ncx'))).toBe(true);

    const navName = names.find((name) => /nav\.xhtml$/.test(name))!;
    const nav = await zip.file(navName)!.async('string');
    expect((nav.match(/<a\b[^>]*href=/g) ?? []).length).toBeGreaterThanOrEqual(2);

    const ncx = await zip.file(names.find((name) => name.endsWith('.ncx'))!)!.async('string');
    expect(ncx).toContain('第一章');
    expect(ncx).toContain('第二章');

    // Proof that calibre itself can still read the patched package.
    const mobi = await convert({ name: 'sample.epub', data: result.data }, { target: 'mobi' }, host);
    expect(asciiAt(mobi.data, 60, 8)).toBe('BOOKMOBI');
  }, 120_000);

  it('repairs the TOC for PDF → EPUB', async () => {
    const host = await createEngineHost();
    const epub = await convert({ name: '书.txt', data: utf8Encode(MANY_CHAPTERS) }, { target: 'epub' });
    const pdf = await convert({ name: '书.epub', data: epub.data }, { target: 'pdf' }, host);
    const result = await convert({ name: '书.pdf', data: pdf.data }, { target: 'epub' }, host);
    expect(result.engine).toBe('calibre');

    const zip = await JSZip.loadAsync(result.data);
    const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
    expect(names[0]).toBe('mimetype');
    expect(names.some((name) => name.endsWith('toc.ncx'))).toBe(true);
    const ncx = await zip.file(names.find((name) => name.endsWith('.ncx'))!)!.async('string');
    expect(ncx).toContain('<navMap>');
    expect((ncx.match(/<navPoint\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it('surfaces calibre engine status through the host', async () => {
    const { engineStatus } = await import('../lib/engine');
    const host = await createEngineHost();
    const status = await engineStatus(host);
    expect(status.calibre).toBe(true);
    expect(status.tesseract).toBe(true);
  });
});

describe('engine missing behaviour', () => {
  it('keeps CHINESE_TXT fixtures usable without calibre', async () => {
    const result = await convert({ name: 'a.txt', data: utf8Encode(CHINESE_TXT) }, { target: 'epub' });
    expect(result.engine).toBe('builtin');
  });
});
