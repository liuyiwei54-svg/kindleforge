import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/formats/route';
import type { Capability, DeviceProfile, FormatInfo } from '../lib/engine/types';

interface FormatsBody {
  formats: FormatInfo[];
  formatsById: Record<string, FormatInfo>;
  inputFormats: string[];
  outputFormats: string[];
  devices: DeviceProfile[];
  pairs: Capability[];
  availablePairs: Capability[];
  engines: { calibre: boolean; pandoc: boolean; tesseract: boolean };
  engineDetails: Array<{ id: string; available: boolean; version: string | null }>;
}

describe('GET /api/formats', () => {
  it('lists formats, devices, pairs and engines with no-store', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');

    const body = (await response.json()) as FormatsBody;
    expect(Array.isArray(body.formats)).toBe(true);
    expect(body.formats.length).toBeGreaterThanOrEqual(15);

    const ids = body.formats.map((format) => format.id);
    expect(ids).toContain('epub');
    expect(ids).toContain('mobi');
    expect(ids).toContain('azw3');
    expect(ids).toContain('pdf');
    expect(ids).toContain('txt');
    expect(ids).toContain('docx');
    expect(ids).toContain('cbz');
    expect(ids).toContain('image');

    expect(body.formatsById.epub.mime).toBe('application/epub+zip');
    expect(body.inputFormats).toContain('txt');
    expect(body.outputFormats).toEqual(['epub', 'mobi', 'azw3', 'pdf', 'txt', 'docx', 'html']);

    expect(body.devices).toHaveLength(5);
    expect(body.devices.map((device) => device.id)).toContain('paperwhite');

    expect(Array.isArray(body.pairs)).toBe(true);
    expect(body.pairs.some((pair) => pair.from === 'txt' && pair.to === 'epub')).toBe(true);
    expect(body.availablePairs.length).toBeLessThanOrEqual(body.pairs.length);
    if (!body.engines.calibre) {
      expect(body.availablePairs.length).toBeLessThan(body.pairs.length);
    }
    expect(body.availablePairs.some((pair) => pair.from === 'txt' && pair.to === 'epub')).toBe(true);
    for (const pair of body.pairs) {
      expect(['builtin', 'calibre', 'pandoc']).toContain(pair.engine);
      expect(typeof pair.local).toBe('boolean');
    }

    expect(body.engines).toEqual({
      calibre: expect.any(Boolean),
      pandoc: expect.any(Boolean),
      tesseract: expect.any(Boolean),
    });
  }, 30_000);
});
