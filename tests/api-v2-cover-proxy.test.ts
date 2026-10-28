import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}));

import { GET } from '../app/api/metadata/cover/route';
import { resetMetadataCoverCacheForTests } from '../lib/server/metadata/cover';

const PUBLIC = 'https://covers.example.com/cover.jpg';

function request(url?: string, headers?: Record<string, string>): Request {
  const query = url === undefined ? '' : `?url=${encodeURIComponent(url)}`;
  return new Request(`http://localhost/api/metadata/cover${query}`, { headers });
}

function imageResponse(
  bytes: Uint8Array,
  type = 'image/jpeg',
  extra: Record<string, string> = {},
): Response {
  return new Response(Uint8Array.from(bytes), {
    status: 200,
    headers: { 'content-type': type, 'content-length': String(bytes.byteLength), ...extra }
  });
}

function streamedBody(totalBytes: number): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(1024 * 1024, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x41));
    }
  });
}

beforeEach(() => {
  resetMetadataCoverCacheForTests();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetMetadataCoverCacheForTests();
});

describe('metadata cover proxy', () => {
  it('requires a url query parameter', async () => {
    const response = await GET(request());
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-http schemes and private addresses before fetching', async () => {
    for (const url of ['file:///etc/passwd', 'http://127.0.0.1/a.jpg', 'http://10.0.0.8/a.jpg', 'http://[::1]/a.jpg']) {
      const response = await GET(request(url));
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string } };
      expect(body.error.code).toBe('BAD_REQUEST');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects malformed URLs', async () => {
    const response = await GET(request('not a url'));
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects non-raster / non-image responses', async () => {
    for (const type of ['text/html', 'image/svg+xml', 'application/octet-stream']) {
      vi.mocked(fetch).mockResolvedValueOnce(imageResponse(new Uint8Array([1, 2, 3]), type));
      const response = await GET(request(PUBLIC));
      expect(response.status).toBe(415);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe('COVER_INVALID');
    }
  });

  it('rejects a declared Content-Length over 8 MiB', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      imageResponse(new Uint8Array([1]), 'image/jpeg', { 'content-length': String(9 * 1024 * 1024) })
    );
    const response = await GET(request(PUBLIC));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TOO_LARGE');
  });

  it('stops a chunked body once it exceeds 8 MiB', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(streamedBody(9 * 1024 * 1024), { status: 200, headers: { 'content-type': 'image/jpeg' } })
    );
    const response = await GET(request(PUBLIC));
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('TOO_LARGE');
  });

  it('returns the image with ETag and serves a conditional 304 from cache', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
    vi.mocked(fetch).mockResolvedValueOnce(imageResponse(bytes));
    const response = await GET(request(PUBLIC));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('content-length')).toBe(String(bytes.byteLength));
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('max-age=604800');
    const etag = response.headers.get('etag');
    expect(etag).toMatch(/^"kf-cover-[0-9a-f]{32}"$/);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const notModified = await GET(request(PUBLIC, { 'if-none-match': etag! }));
    expect(notModified.status).toBe(304);
    expect(notModified.headers.get('etag')).toBe(etag);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('follows a public redirect but rejects a redirect to a private address', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/real.jpg' } })
    );
    vi.mocked(fetch).mockResolvedValueOnce(imageResponse(new Uint8Array([9, 9, 9])));
    const ok = await GET(request(PUBLIC));
    expect(ok.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);

    resetMetadataCoverCacheForTests();
    vi.mocked(fetch).mockReset();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/private.jpg' } })
    );
    const blocked = await GET(request(PUBLIC));
    expect(blocked.status).toBe(400);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps upstream failures to 502 and timeouts to 504', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('nope', { status: 503 }));
    const failed = await GET(request(PUBLIC));
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe('COVER_UNAVAILABLE');

    vi.mocked(fetch).mockRejectedValueOnce(Object.assign(new Error('too slow'), { name: 'TimeoutError' }));
    const timeout = await GET(request(PUBLIC));
    expect(timeout.status).toBe(504);
    expect(((await timeout.json()) as { error: { code: string } }).error.code).toBe('TIMEOUT');
  });
});
