import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { assertArchiveSafe, inspectZip, looksLikeZip } from '../lib/server/archive';
import { ApiError } from '../lib/server/errors';

async function makeZip(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

async function expectApiError(promise: () => unknown, code: string): Promise<void> {
  try {
    await promise();
    throw new Error(`expected ApiError ${code}, but nothing was thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe(code);
  }
}

describe('archive safety inspection', () => {
  it('parses a normal zip and reports entry/size totals', async () => {
    const bytes = await makeZip({
      'META-INF/container.xml': '<container/>',
      'OEBPS/book.opf': '<package/>',
      'OEBPS/chapter1.xhtml': '<html><body>第一章</body></html>',
    });
    expect(looksLikeZip(bytes)).toBe(true);
    const info = inspectZip(bytes);
    expect(info.isZip).toBe(true);
    expect(info.entries).toBe(3);
    expect(info.drm).toBe(false);
    expect(info.uncompressedBytes).toBeGreaterThan(0);
    expect(() => assertArchiveSafe(bytes)).not.toThrow();
  });

  it('does not treat a non-zip as an archive', () => {
    const txt = new TextEncoder().encode('just text, no zip');
    expect(looksLikeZip(txt)).toBe(false);
    const info = inspectZip(txt);
    expect(info.isZip).toBe(false);
    expect(() => assertArchiveSafe(txt)).not.toThrow();
  });

  it('rejects a high-expansion zip bomb (ratio > 200)', async () => {
    const zeros = new Uint8Array(2 * 1024 * 1024); // 2MB of zeros
    const bytes = await makeZip({ 'zeros.bin': zeros });
    const info = inspectZip(bytes);
    expect(info.entries).toBe(1);
    expect(info.uncompressedBytes / Math.max(info.compressedBytes, 1)).toBeGreaterThan(200);
    await expectApiError(() => assertArchiveSafe(bytes), 'ZIP_BOMB');
  });

  it('rejects an archive with more than 5000 entries', async () => {
    const zip = new JSZip();
    for (let i = 0; i < 5001; i += 1) zip.file(`page-${i}.txt`, 'x');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'STORE' });
    const info = inspectZip(bytes);
    expect(info.entries).toBe(5001);
    await expectApiError(() => assertArchiveSafe(bytes), 'ZIP_BOMB');
  }, 60_000);

  it('rejects DRM (encryption.xml covering non-font resources)', async () => {
    const bytes = await makeZip({
      'META-INF/encryption.xml': `<?xml version="1.0"?>
        <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
            <CipherData><CipherReference URI="OEBPS/chapter1.xhtml"/></CipherData>
          </EncryptedData>
        </encryption>`,
      'OEBPS/chapter1.xhtml': '<html><body>locked</body></html>',
    });
    const info = inspectZip(bytes);
    expect(info.hasEncryptionManifest).toBe(true);
    expect(info.drm).toBe(true);
    await expectApiError(() => assertArchiveSafe(bytes), 'DRM');
  });

  it('allows font-only obfuscation and reports a warning', async () => {
    const bytes = await makeZip({
      'META-INF/encryption.xml': `<?xml version="1.0"?>
        <encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
            <CipherData><CipherReference URI="OEBPS/fonts/serif.otf"/></CipherData>
          </EncryptedData>
        </encryption>`,
      'OEBPS/fonts/serif.otf': 'font-bytes',
      'OEBPS/chapter1.xhtml': '<html><body>readable</body></html>',
    });
    const info = inspectZip(bytes);
    expect(info.drm).toBe(false);
    expect(info.fontObfuscation).toBe(true);
    expect(info.warnings).toContain('FONT_OBFUSCATION');
    const safe = assertArchiveSafe(bytes);
    expect(safe.warnings).toContain('FONT_OBFUSCATION');
  });
});
