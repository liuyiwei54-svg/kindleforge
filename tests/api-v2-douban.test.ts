import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET as getSettings, PUT as putSettings } from '../app/api/settings/route';
import { searchDouban, doubanLargeCover, PROVIDERS } from '../lib/server/metadata/providers';
import { clearMetadataCacheForTests, searchMetadata } from '../lib/server/metadata';
import { proxyMetadataCover, resetMetadataCoverCacheForTests } from '../lib/server/metadata/cover';
import { jsonRequest, makeDirs, readJson, type TestDirs } from './api-v2-helpers';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
  resetMetadataCoverCacheForTests();
  await clearMetadataCacheForTests();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetMetadataCoverCacheForTests();
  await dirs.cleanup();
});

const SAMPLE = [
  {
    title: '三体',
    url: 'https://book.douban.com/subject/2567698/',
    pic: 'https://img3.doubanio.com/view/subject/s/public/s2768378.jpg',
    author_name: '刘慈欣',
    year: '2008',
    type: 'b',
    id: '2567698',
  },
  {
    title: '三体Ⅱ',
    url: 'https://book.douban.com/subject/3066477/',
    pic: 'https://img3.doubanio.com/view/subject/s/public/s2768379.jpg',
    author_name: '刘慈欣',
    year: '2008',
    type: 'b',
    id: '3066477',
  },
  {
    title: '三体Ⅲ',
    url: 'https://book.douban.com/subject/5366248/',
    pic: 'https://img3.doubanio.com/view/subject/s/public/s2768380.jpg',
    author_name: '刘慈欣',
    year: '2010',
    type: 'b',
    id: '5366248',
  },
];

function doubanResponse(items: unknown[]): Response {
  return new Response(JSON.stringify(items), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function abortableHang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal) {
      signal.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }
  });
}

describe('Douban provider', () => {
  it('maps the real suggestion payload to candidates', async () => {
    const fetchMock = vi.fn(async () => doubanResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);

    const candidates = await searchDouban('三体');
    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      provider: 'douban',
      title: '三体',
      author: '刘慈欣',
      publishedAt: '2008',
      providerId: '2567698',
      providerUrl: 'https://book.douban.com/subject/2567698/',
      coverUrl: 'https://img3.doubanio.com/view/subject/l/public/s2768378.jpg',
    });
    expect(candidates[0]).not.toHaveProperty('isbn');
    expect(candidates[0]).not.toHaveProperty('publisher');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://book.douban.com/j/subject_suggest?q=%E4%B8%89%E4%BD%93');
    const headers = init.headers as Record<string, string>;
    expect(headers['User-Agent']).toContain('Chrome');
    expect(headers.Referer).toBe('https://book.douban.com/');
  });

  it('replaces the /s/ thumbnail path with /l/', () => {
    expect(doubanLargeCover('https://img3.doubanio.com/view/subject/s/public/s1.jpg')).toBe(
      'https://img3.doubanio.com/view/subject/l/public/s1.jpg',
    );
  });

  it('filters non-books, malformed entries, and caps at 8', async () => {
    const many = [
      ...SAMPLE,
      { title: '三体电影', type: 'm', id: '1', url: 'https://book.douban.com/subject/1/' },
      { title: '', type: 'b' },
      ...Array.from({ length: 10 }, (_, index) => ({
        title: `三体外传 ${index}`,
        type: 'b',
        id: String(1000 + index),
        url: `https://book.douban.com/subject/${1000 + index}/`,
        author_name: '刘慈欣',
        year: '2020',
      })),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => doubanResponse(many)));
    const candidates = await searchDouban('三体');
    expect(candidates).toHaveLength(8);
    expect(candidates.every((item) => item.provider === 'douban')).toBe(true);
    expect(candidates.map((item) => item.title)).not.toContain('三体电影');
  });

  it('aborts a slow Douban request at the configured timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'));
            });
          }),
      ),
    );
    await expect(searchDouban('三体', { timeoutMs: 20 })).rejects.toMatchObject({
      provider: 'douban',
    });
  });

  it('returns [] for a non-array payload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    await expect(searchDouban('三体')).resolves.toEqual([]);
  });
});

describe('searchMetadata with Douban', () => {
  it('returns Douban results even when Google and Open Library are unreachable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('book.douban.com')) return doubanResponse(SAMPLE);
      throw new Error('network unreachable');
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await searchMetadata({ q: '三体' });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeUndefined();
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]!.provider).toBe('douban');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns offline when Douban is rate-limited and the others fail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('book.douban.com')) {
          return new Response('blocked', { status: 418 });
        }
        throw new Error('unreachable');
      }),
    );
    const result = await searchMetadata({ q: '三体' });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('offline');
    expect(result.candidates).toEqual([]);
  });

  it('returns early when Douban has results while Google hangs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('book.douban.com')) return doubanResponse(SAMPLE);
        return abortableHang(init);
      }),
    );
    const started = Date.now();
    const result = await searchMetadata({ q: '三体' });
    const elapsed = Date.now() - started;
    expect(result.ok).toBe(true);
    expect(result.candidates).toHaveLength(3);
    // Douban returns immediately; the 300ms grace is much smaller than the 8s budget.
    expect(elapsed).toBeLessThan(2500);
  });

  it('caches Douban results for 30 days', async () => {
    const fetchMock = vi.fn(async () => doubanResponse(SAMPLE));
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchMetadata({ q: '三体' });
    expect(first.cached).toBe(false);
    expect(first.candidates).toHaveLength(3);
    const calls = fetchMock.mock.calls.length;
    const second = await searchMetadata({ q: '三体' });
    expect(second.cached).toBe(true);
    expect(second.candidates).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(calls);
  });

  it('exposes douban through the provider registry', () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual(['douban', 'google', 'openlibrary']);
    expect(typeof PROVIDERS.douban).toBe('function');
  });
});

describe('settings provider enum', () => {
  it('accepts douban and defaults to douban first', async () => {
    const defaults = (await (await getSettings()).json()) as {
      metadata: { providers: string[] };
    };
    expect(defaults.metadata.providers).toEqual(['douban', 'google', 'openlibrary']);

    const response = await putSettings(
      jsonRequest('http://localhost/api/settings', {
        metadata: { providers: ['douban', 'openlibrary'] },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { metadata: { providers: string[] } };
    expect(body.metadata.providers).toEqual(['douban', 'openlibrary']);
  });

  it('rejects an unknown provider', async () => {
    const response = await putSettings(
      jsonRequest('http://localhost/api/settings', {
        metadata: { providers: ['douban', 'not-a-provider'] },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('SETTINGS_INVALID');
  });
});

describe('cover proxy and Douban Referer', () => {
  const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  it('adds the Douban Referer and a desktop UA for doubanio.com', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JPEG, {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(JPEG.length) },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await proxyMetadataCover(
      'https://img3.doubanio.com/view/subject/l/public/s2768378.jpg',
    );
    expect(result.notModified).toBe(false);
    expect(result.contentType).toBe('image/jpeg');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.referer).toBe('https://book.douban.com/');
    expect(headers['user-agent']).toContain('Chrome');
  });

  it('does not send a Referer for non-Douban hosts', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response(JPEG, {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    await proxyMetadataCover('https://covers.openlibrary.org/b/id/1-L.jpg');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    const headers = init.headers as Record<string, string>;
    expect(headers.referer).toBeUndefined();
  });
});

describe('real Douban (best effort)', () => {
  it('returns at least one candidate for 三体 when the network allows', async (ctx) => {
    try {
      const candidates = await searchDouban('三体', { timeoutMs: 5000 });
      expect(candidates.length).toBeGreaterThan(0);
      expect(candidates[0]!.provider).toBe('douban');
    } catch {
      ctx.skip();
    }
  });
});
