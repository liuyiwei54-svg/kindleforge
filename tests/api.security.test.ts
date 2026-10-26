import { describe, expect, it } from 'vitest';
import { GET as apiCatchAll } from '../app/api/[...path]/route';
import { POST } from '../app/api/convert/route';
import { DELETE, GET } from '../app/api/jobs/[id]/route';
import { GET as DOWNLOAD } from '../app/api/jobs/[id]/download/route';
import {
  buildContentDisposition,
  jobDirPath,
  safeFileName,
} from '../lib/server/storage';
import {
  clientIp,
  configureRateLimitsForTests,
  guardRequest,
  resetRateLimitsForTests,
  setTrustProxyForTests,
} from '../lib/server/ratelimit';

const BASE = 'http://127.0.0.1:3100';

interface ErrorBody {
  error: { code: string; message: string; hint?: { zh: string; en: string } };
}

/** Encode a real multipart body so the request carries Content-Length, like fetch/curl. */
async function encodedForm(body: FormData): Promise<{ payload: ArrayBuffer; contentType: string }> {
  const response = new Response(body);
  return {
    payload: await response.arrayBuffer(),
    contentType: response.headers.get('content-type') ?? 'multipart/form-data',
  };
}

function tinyForm(target = 'azw'): FormData {
  const form = new FormData();
  form.set('file', new File(['x'], 'a.txt', { type: 'text/plain' }));
  form.set('target', target); // invalid target keeps the request cheap
  return form;
}

async function postForm(
  form: FormData = tinyForm(),
  headers: Record<string, string> = {},
): Promise<Response> {
  const { payload, contentType } = await encodedForm(form);
  return POST(
    new Request(`${BASE}/api/convert`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        'content-length': String(payload.byteLength),
        ...headers,
      },
      body: payload,
    }),
  );
}

const traversalIds = ['../etc/passwd', '../../../../tmp/evil', '..%2F..%2Fetc%2Fpasswd', 'abc', '123', '.'];

describe('job id / path traversal defence', () => {
  it('rejects traversal-shaped ids on GET, DELETE and download with 404', async () => {
    for (const id of traversalIds) {
      const get = await GET(new Request(`${BASE}/api/jobs/${id}`), {
        params: Promise.resolve({ id }),
      });
      expect(get.status).toBe(404);
      expect(((await get.json()) as ErrorBody).error.code).toBe('NOT_FOUND');

      const download = await DOWNLOAD(new Request(`${BASE}/api/jobs/${id}/download`), {
        params: Promise.resolve({ id }),
      });
      expect(download.status).toBe(404);

      const deleted = await DELETE(
        new Request(`${BASE}/api/jobs/${id}`, { method: 'DELETE' }),
        { params: Promise.resolve({ id }) },
      );
      expect(deleted.status).toBe(404);
    }
  });

  it('never resolves a directory outside the temp root', () => {
    expect(() => jobDirPath('../escape')).toThrow();
    expect(() => jobDirPath('..')).toThrow();
    expect(() => jobDirPath('/etc/passwd')).toThrow();
    expect(() => jobDirPath('8c0f0e1a-1111-4222-8333-444455556666')).not.toThrow();
  });

  it('sanitises upload filenames and encodes CJK Content-Disposition', () => {
    expect(safeFileName('../../etc/passwd', 'fallback')).toBe('passwd');
    expect(safeFileName('..', 'fallback')).toBe('fallback');
    expect(safeFileName('a/b\\c.txt')).toBe('c.txt');
    expect(safeFileName('正常书名.epub')).toBe('正常书名.epub');

    const header = buildContentDisposition('测试 书.mobi');
    expect(header.startsWith('attachment;')).toBe(true);
    expect(header).toContain("filename*=UTF-8''");
    expect(header).toContain('%E6%B5%8B%E8%AF%95');
    expect(header).toContain('.mobi');
    // ASCII fallback must be readable, not a row of underscores.
    expect(header).toMatch(/filename="book-[0-9a-f]{8}\.mobi"/);
    expect(buildContentDisposition('pride.epub')).toContain('filename="pride.epub"');
  });
});

describe('rate limiting', () => {
  it('direct mode uses the single-tenant bucket (200/h), not the remote 20/h cap', () => {
    resetRateLimitsForTests();
    setTrustProxyForTests(false);
    configureRateLimitsForTests({
      default: { limit: 1, concurrency: 50 },
      local: { limit: 3, concurrency: 50 },
    });
    try {
      // Spoofing never changes the identity, and the direct bucket is its own limit.
      expect(clientIp(new Request(BASE, { headers: { 'x-forwarded-for': '10.1.2.3' } }))).toBe('direct');
      expect(clientIp(new Request(BASE))).toBe('direct');

      const direct = (): Request => new Request(BASE, { headers: { 'x-forwarded-for': '10.1.2.3' } });
      guardRequest(direct()).release();
      guardRequest(direct()).release();
      guardRequest(direct()).release();
      try {
        guardRequest(direct());
        throw new Error('expected the 4th direct request to be limited');
      } catch (error) {
        const hint = (error as { hint?: { zh?: string } }).hint;
        expect(hint?.zh).toContain('直连');
        expect(hint?.zh).toContain('3');
      }
    } finally {
      setTrustProxyForTests(undefined);
      resetRateLimitsForTests();
    }
  });

  it('returns 429 + Retry-After once the sliding window is exhausted', async () => {
    resetRateLimitsForTests();
    configureRateLimitsForTests({
      local: { limit: 2, concurrency: 50 },
      default: { limit: 2, concurrency: 50 },
    });
    try {
      expect((await postForm()).status).toBe(400);
      expect((await postForm()).status).toBe(400);

      const limited = await postForm();
      expect(limited.status).toBe(429);
      expect(limited.headers.get('cache-control')).toContain('no-store');
      expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect(((await limited.json()) as ErrorBody).error.code).toBe('RATE_LIMITED');
    } finally {
      resetRateLimitsForTests();
    }
  });

  it('rotating X-Forwarded-For cannot bypass the window when trust proxy is off', async () => {
    resetRateLimitsForTests();
    setTrustProxyForTests(false);
    configureRateLimitsForTests({
      local: { limit: 2, concurrency: 50 },
      default: { limit: 2, concurrency: 50 },
    });
    try {
      // QA repro: a fresh spoofed XFF per request used to create a fresh bucket.
      expect((await postForm(tinyForm(), { 'x-forwarded-for': '203.0.113.1' })).status).toBe(400);
      expect((await postForm(tinyForm(), { 'x-forwarded-for': '203.0.113.2' })).status).toBe(400);
      const third = await postForm(tinyForm(), { 'x-forwarded-for': '203.0.113.3' });
      expect(third.status).toBe(429);
      expect(((await third.json()) as ErrorBody).error.code).toBe('RATE_LIMITED');
    } finally {
      setTrustProxyForTests(undefined);
      resetRateLimitsForTests();
    }
  });

  it('uses per-IP buckets only when trust proxy is enabled', () => {
    resetRateLimitsForTests();
    setTrustProxyForTests(true);
    configureRateLimitsForTests({
      local: { limit: 10, concurrency: 50 },
      default: { limit: 1, concurrency: 50 },
    });
    try {
      const request = (ip: string): Request =>
        new Request(`${BASE}/api/convert`, { headers: { 'x-forwarded-for': `${ip}, proxy` } });

      guardRequest(request('203.0.113.9')).release();
      expect(() => guardRequest(request('203.0.113.9'))).toThrowError(/Too many conversions/);
      // A genuinely different client gets its own bucket ...
      guardRequest(request('203.0.113.10')).release();
      // ... and loopback keeps the relaxed local bucket.
      for (let i = 0; i < 5; i += 1) guardRequest(request('127.0.0.1')).release();
    } finally {
      setTrustProxyForTests(undefined);
      resetRateLimitsForTests();
    }
  });

  it('enforces the concurrency cap and releases the slot', () => {
    resetRateLimitsForTests();
    configureRateLimitsForTests({
      local: { limit: 10, concurrency: 1 },
      default: { limit: 10, concurrency: 1 },
    });
    try {
      const first = guardRequest(new Request(`${BASE}/api/convert`));
      expect(() => guardRequest(new Request(`${BASE}/api/convert`))).toThrowError(
        /Too many concurrent requests/,
      );
      first.release();
      first.release(); // idempotent
      const second = guardRequest(new Request(`${BASE}/api/convert`));
      second.release();
    } finally {
      resetRateLimitsForTests();
    }
  });
});

describe('API namespace fallback', () => {
  it('answers unknown API paths with JSON 404 + no-store (never Next HTML)', async () => {
    const response = await apiCatchAll();
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as ErrorBody;
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.error.hint?.zh).toBeTruthy();
    expect(body.error.hint?.en).toBeTruthy();
  });
});

describe('upload length pre-check (chunked / missing Content-Length)', () => {
  it('rejects an undeclared-length multipart body with 411 before buffering', async () => {
    resetRateLimitsForTests();
    configureRateLimitsForTests({ local: { limit: 50, concurrency: 50 }, default: { limit: 50, concurrency: 50 } });
    try {
      const request = new Request(`${BASE}/api/convert`, {
        method: 'POST',
        headers: { 'content-type': 'multipart/form-data; boundary=----nope' },
        body: 'x',
      });
      expect(request.headers.get('content-length')).toBeNull();
      const response = await POST(request);
      expect(response.status).toBe(411);
      const body = (await response.json()) as ErrorBody;
      expect(body.error.code).toBe('LENGTH_REQUIRED');
      expect(body.error.hint?.zh).toContain('Content-Length');
    } finally {
      resetRateLimitsForTests();
    }
  });

  it('rejects a chunked upload (Transfer-Encoding) with 411', async () => {
    resetRateLimitsForTests();
    configureRateLimitsForTests({ local: { limit: 50, concurrency: 50 }, default: { limit: 50, concurrency: 50 } });
    try {
      const request = new Request(`${BASE}/api/convert`, {
        method: 'POST',
        headers: {
          'content-type': 'multipart/form-data; boundary=----nope',
          'transfer-encoding': 'chunked',
        },
        body: 'x',
      });
      const response = await POST(request);
      expect(response.status).toBe(411);
      expect(((await response.json()) as ErrorBody).error.code).toBe('LENGTH_REQUIRED');
    } finally {
      resetRateLimitsForTests();
    }
  });
});
