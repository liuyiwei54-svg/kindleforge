/**
 * QA (independent) — v2 metadata search: provider merge, cache, offline /
 * disabled reasons, validation, and the "only the query leaves the machine"
 * privacy contract (no cookies, no body, fixed hosts).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as SEARCH } from '../../app/api/metadata/search/route';
import { clearMetadataCacheForTests } from '../../lib/server/metadata';
import { resetSettingsForTests, updateSettings } from '../../lib/server/settings';
import type { MetadataSearchResult } from '../../lib/shared/types';
import { jsonRequest, makeDirs, type TestDirs } from '../api-v2-helpers';

let dirs: TestDirs;
let calls: string[] = [];

function googleResponse(): Response {
  return Response.json({
    totalItems: 1,
    items: [
      {
        id: 'g1',
        volumeInfo: {
          title: '三体',
          authors: ['刘慈欣'],
          publisher: '重庆出版社',
          publishedDate: '2008',
          language: 'zh',
          industryIdentifiers: [{ type: 'ISBN_13', identifier: '9787536692930' }],
          description: '地球往事。',
          imageLinks: { thumbnail: 'http://books.google.com/books/content?id=g1&printsec=frontcover' },
        },
      },
    ],
  });
}

function openLibraryResponse(): Response {
  return Response.json({
    docs: [
      {
        key: '/works/OL1W',
        title: '三体',
        author_name: ['刘慈欣'],
        first_publish_year: 2008,
        language: ['chi'],
        isbn: ['9787536692930'],
        publisher: ['重庆出版社'],
        cover_i: 4242,
      },
      {
        key: '/works/OL2W',
        title: 'The Three-Body Problem',
        author_name: ['Cixin Liu'],
        first_publish_year: 2014,
        language: ['eng'],
        isbn: ['9780765382030'],
        cover_i: 777,
      },
    ],
  });
}

function stubProviders(): void {
  calls = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const headers = new Headers(init?.headers);
    expect(headers.get('cookie')).toBeNull();
    expect(init?.body ?? null).toBeNull();
    if (url.startsWith('https://www.googleapis.com/books/')) return googleResponse();
    if (url.startsWith('https://openlibrary.org/')) return openLibraryResponse();
    // Douban is part of the default provider set; this fixture has no results.
    if (url.startsWith('https://book.douban.com/')) return Response.json([]);
    throw new Error(`unexpected host ${url}`);
  });
}

beforeEach(async () => {
  dirs = await makeDirs();
  clearMetadataCacheForTests();
  stubProviders();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await dirs.cleanup();
});

async function search(body: unknown): Promise<{ status: number; body: MetadataSearchResult }> {
  const response = await SEARCH(jsonRequest('http://localhost/api/metadata/search', body));
  return { status: response.status, body: (await response.json()) as MetadataSearchResult };
}

describe('metadata search', () => {
  it('merges providers, dedupes by title+author and keeps ISBN/cover candidates', async () => {
    const result = await search({ title: '三体', author: '刘慈欣' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.cached).toBe(false);
    expect(result.body.candidates).toHaveLength(2);
    const chinese = result.body.candidates.find((candidate) => candidate.title === '三体');
    expect(chinese).toMatchObject({
      author: '刘慈欣',
      isbn: '9787536692930',
      publisher: '重庆出版社',
      language: 'zh',
    });
    expect(chinese?.coverUrl).toContain('books.google.com');
    expect(calls).toHaveLength(3);
    expect(calls.every((url) => /^https:\/\//.test(url))).toBe(true);
  });

  it('caches the merged result for 30 days and reports cached=true', async () => {
    await search({ title: '三体', author: '刘慈欣' });
    const second = await search({ title: '三体', author: '刘慈欣' });
    expect(second.body.cached).toBe(true);
    expect(calls).toHaveLength(3); // cache hit: no new provider requests
    expect(second.body.candidates).toHaveLength(2);
  });

  it('returns reason=offline with bilingual hint when providers are unreachable', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const result = await search({ q: '三体' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(false);
    expect(result.body.reason).toBe('offline');
    expect(result.body.candidates).toEqual([]);
    expect(typeof result.body.hint).toBe('string');
    expect(result.body.hint).toMatch(/unreachable|暂不可达/i);
  });

  it('returns reason=disabled without any network call when metadata is off', async () => {
    await updateSettings({ metadata: { enabled: false } });
    await resetSettingsForTests();
    const result = await search({ q: '三体' });
    expect(result.body.ok).toBe(false);
    expect(result.body.reason).toBe('disabled');
    expect(calls).toHaveLength(0);
  });

  it('validates input: 400 for bad ISBN, empty query, and oversized q', async () => {
    expect((await search({ isbn: '123' })).status).toBe(400);
    expect((await search({})).status).toBe(400);
    expect((await search({ q: 'x'.repeat(301) })).status).toBe(400);
    const bad = (await (await SEARCH(jsonRequest('http://localhost/api/metadata/search', { isbn: '123' }))).json()) as {
      error: { code: string; hint: { zh: string; en: string } };
    };
    expect(bad.error.code).toBe('BAD_REQUEST');
    expect(bad.error.hint.zh).toContain('ISBN');
  });

  it('honours the provider subset setting', async () => {
    await updateSettings({ metadata: { providers: ['openlibrary'] } });
    await resetSettingsForTests();
    const result = await search({ q: 'three body' });
    expect(result.status).toBe(200);
    expect(calls.some((url) => url.includes('googleapis'))).toBe(false);
    expect(calls.every((url) => url.startsWith('https://openlibrary.org/'))).toBe(true);
  });

  it('maps Douban book suggestions, upgrades /s/ covers to /l/ and skips non-books', async () => {
    await updateSettings({ metadata: { providers: ['douban'] } });
    await resetSettingsForTests();
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      const headers = new Headers(init?.headers);
      expect(headers.get('referer')).toBe('https://book.douban.com/');
      expect(headers.get('user-agent')).toMatch(/Chrome/);
      expect(url).toContain('/j/subject_suggest?q=');
      return Response.json([
        {
          type: 'b',
          id: '123',
          title: '三体',
          author_name: '刘慈欣',
          year: '2008',
          pic: 'https://img1.doubanio.com/view/subject/s/public/s1.jpg',
          url: 'https://book.douban.com/subject/123/',
        },
        { type: 'm', id: '9', title: 'A movie, not a book' },
      ]);
    });
    const result = await search({ title: '三体' });
    expect(result.status).toBe(200);
    expect(result.body.candidates).toHaveLength(1);
    expect(result.body.candidates[0]).toMatchObject({
      provider: 'douban',
      title: '三体',
      author: '刘慈欣',
      publishedAt: '2008',
      providerId: '123',
    });
    expect(result.body.candidates[0]?.coverUrl).toContain('/l/public/s1.jpg');
    expect(calls).toHaveLength(1);
  });

  it('degrades a Douban failure (418) while Google still answers', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith('https://book.douban.com/')) return new Response('blocked', { status: 418 });
      if (url.startsWith('https://www.googleapis.com/books/')) return googleResponse();
      if (url.startsWith('https://openlibrary.org/')) return Response.json({ docs: [] });
      throw new Error(`unexpected host ${url}`);
    });
    const result = await search({ q: '三体' });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.candidates).toHaveLength(1);
    expect(result.body.candidates[0]?.provider).toBe('google');
    expect(calls).toHaveLength(3);
  });
});
