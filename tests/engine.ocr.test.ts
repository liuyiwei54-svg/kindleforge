import { describe, expect, it } from 'vitest';
import { convert, type EngineHost } from '../lib/engine';
import {
  findPdftoppm,
  findTesseract,
  ocrPdf,
  resolveOcrLanguage,
  tesseractLanguages,
} from '../lib/engine/node/ocr';
import { createEngineHost } from '../lib/engine/node/host';
import { readFixture } from './engine.helpers';

const tesseract = await findTesseract();
const pdftoppm = await findPdftoppm();
const canOcr = tesseract !== null && pdftoppm !== null;

function cjkCount(text: string): number {
  return (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
}

describe('ocr tooling', () => {
  it('finds tesseract and pdftoppm', async () => {
    expect(tesseract === null || tesseract.includes('tesseract')).toBe(true);
    expect(pdftoppm === null || pdftoppm.includes('pdftoppm')).toBe(true);
  });

  it('has the Chinese language pack when tesseract is installed', async () => {
    if (!tesseract) return;
    const languages = await tesseractLanguages();
    expect(languages).toContain('chi_sim');
    expect(languages).toContain('eng');
  });

  it('maps ISO / BCP 47 codes onto installed tessdata packs', async () => {
    if (!tesseract) return;
    expect((await resolveOcrLanguage('zh')).language).toBe('chi_sim');
    expect((await resolveOcrLanguage('zh-CN')).language).toBe('chi_sim');
    expect((await resolveOcrLanguage('en')).language).toBe('eng');
    expect((await resolveOcrLanguage('eng')).language).toBe('eng');
    expect((await resolveOcrLanguage('chi_sim+eng')).language).toContain('chi_sim');
  });

  it('falls back with a warning when the language is not installed', async () => {
    if (!tesseract) return;
    const resolved = await resolveOcrLanguage('fr');
    expect(resolved.language).toMatch(/chi_sim|eng/);
    expect(resolved.warnings.join(' ')).toContain('没有安装');
    expect(resolved.warnings.join(' ')).toContain('可用');
  });

  it('passes tessdata names straight through (frontend may send chi_sim)', async () => {
    if (!tesseract) return;
    expect((await resolveOcrLanguage('chi_sim')).language).toBe('chi_sim');
    expect((await resolveOcrLanguage('eng')).language).toBe('eng');
    expect((await resolveOcrLanguage('chi_sim+eng')).language).toBe('chi_sim+eng');
  });

  it('falls back chi_tra → chi_sim when traditional Chinese is missing', async () => {
    if (!tesseract) return;
    const languages = await tesseractLanguages();
    if (languages.includes('chi_tra')) return;
    const resolved = await resolveOcrLanguage('chi_tra');
    expect(resolved.language).toBe('chi_sim');
    expect(resolved.warnings.join(' ')).toContain('chi_tra');
  });

  it('defaults to chi_sim+eng silently when no language is requested', async () => {
    if (!tesseract) return;
    const resolved = await resolveOcrLanguage();
    expect(resolved.language).toBe('chi_sim+eng');
    expect(resolved.warnings).toEqual([]);
    const auto = await resolveOcrLanguage('auto');
    expect(auto.warnings).toEqual([]);
    expect(auto.language).toBe('chi_sim+eng');
  });
});

describe.skipIf(!canOcr)('OCR on a scanned PDF', () => {
  it('renders pages at 300dpi and recognises Chinese text', async () => {
    const data = readFixture('scanned.pdf');
    const result = await ocrPdf(data, 'chi_sim+eng');
    expect(cjkCount(result.text)).toBeGreaterThan(20);
    expect(result.text).toMatch(/数字化的第一页|扫描件/);
  }, 180_000);

  it('accepts an ISO language code (zh) and returns a reflowable EPUB', async () => {
    const host = await createEngineHost();
    const data = readFixture('scanned.pdf');
    const result = await convert(
      { name: 'scanned.pdf', data },
      { target: 'epub', options: { ocr: true, ocrLanguage: 'zh' } },
      host,
    );
    expect(result.engine).toBe('ocr');
    expect(result.mime).toBe('application/epub+zip');
    expect(result.book?.chapters).toBeGreaterThanOrEqual(1);
    expect(result.warnings.join(' ')).toContain('OCR');
    // 'zh' must map to an installed pack, not fail with "language unavailable".
    expect(result.warnings.join(' ')).not.toContain('没有安装');

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(result.data);
    const chapters = Object.keys(zip.files).filter((n) => /^OEBPS\/text\/chap-\d+\.xhtml$/.test(n));
    const text = (await Promise.all(chapters.map((c) => zip.file(c)!.async('string')))).join('\n');
    expect(cjkCount(text)).toBeGreaterThan(20);
    expect(text).toContain('数字化的第一页');
  }, 120_000);

  it('asks for tesseract when OCR is requested but unavailable', async () => {
    const host: EngineHost = { tesseract: { available: false } };
    let code = '';
    try {
      await convert({ name: 'scanned.pdf', data: readFixture('scanned.pdf') }, { target: 'epub', options: { ocr: true } }, host);
    } catch (error) {
      code = (error as { code?: string }).code ?? '';
    }
    expect(code).toBe('ENGINE_MISSING');
  });

  it('still lets calibre handle PDFs when OCR is off', async () => {
    const host = await createEngineHost();
    if (!host.calibre?.available) return;
    const data = readFixture('scanned.pdf');
    const result = await convert({ name: 'scanned.pdf', data }, { target: 'epub' }, host);
    expect(result.engine).toBe('calibre');
    expect(result.data.length).toBeGreaterThan(10_000);
  }, 120_000);
});
