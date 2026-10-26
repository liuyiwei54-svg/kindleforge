import { describe, expect, it } from 'vitest';
import { GET } from '../app/api/health/route';

interface HealthBody {
  ok: boolean;
  uptime: number;
  version: string;
  engines: { calibre: boolean; pandoc: boolean; tesseract: boolean };
  engineDetails: Array<{ id: string; available: boolean; version: string | null; bin: string }>;
}

describe('GET /api/health', () => {
  it('returns ok, uptime, version and real engine probes', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');

    const body = (await response.json()) as HealthBody;
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(Object.keys(body.engines).sort()).toEqual(['calibre', 'pandoc', 'tesseract']);
    for (const value of Object.values(body.engines)) expect(typeof value).toBe('boolean');

    expect(body.engineDetails).toHaveLength(3);
    for (const detail of body.engineDetails) {
      expect(typeof detail.id).toBe('string');
      expect(typeof detail.available).toBe('boolean');
      expect(typeof detail.bin).toBe('string');
      if (detail.available) expect(typeof detail.version).toBe('string');
    }
    const calibre = body.engineDetails.find((detail) => detail.id === 'calibre');
    expect(calibre?.available).toBe(body.engines.calibre);
  }, 30_000);
});
