import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../app/api/metadata/search/route';
import {
  clearMetadataCacheForTests,
  guessForFilename,
  searchMetadata,
} from '../lib/server/metadata';
import { updateSettings } from '../lib/server/settings';
import { jsonRequest, makeDirs, type TestDirs } from './api-v2-helpers';
import type { MetadataCandidate, MetadataSearchResult } from '../lib/shared/types';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
  await clearMetadataCacheForTests();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await dirs.cleanup();
});

function google(items: unknown[]): Response {
  return new Response(JSON.stringify({ items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function openLibrary(docs: unknown[]): Response {
  return new Response(JSON.stringify({ docs }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function candidate(overrides: Partial<MetadataCandidate> = {}): MetadataCandidate {
  return {
    title: '三体',
    author: '刘慈欣',
    provider: 'google',
    ...overrides,
  };
}

function mockProviders(googleItems: unknown[], docs: unknown[]): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('googleapis.com')) return google(googleItems);
    if (url.includes('openlibrary.org')) return openLibrary(docs);
    if (url.includes('douban.com')) return new Response('[]', { status: 200 });
    throw new Error(`unexpected url ${url}`);
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

describe('filename guessing', () => {
  it('handles 《title》, title - author, author - title and ISBN', async () => {
    expect(await guessForFilename('《三体》 - 刘慈欣.epub')).toMatchObject({
      title: '三体',
      author: '刘慈欣',
    });
    expect(await guessForFilename('Pride and Prejudice - Jane Austen.epub')).toMatchObject({
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
    });
    expect(await guessForFilename('刘慈欣 - 三体.epub')).toMatchObject({
      title: '三体',
      author: '刘慈欣',
    });
    const isbn = await guessForFilename('三体 9787536692930.epub');
    expect(isbn.isbn).toBe('9787536692930');
    expect(isbn.title).not.toContain('9787536692930');
  });
});

describe('POST /api/metadata/search', () => {
  it('returns a disabled diagnostic when online lookup is off', async () => {
    await updateSettings({ metadata: { enabled: false } });
    const response = await POST(jsonRequest('http://localhost/api/metadata/search', { q: '三体' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as MetadataSearchResult;
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('disabled');
    expect(body.hint).toBeTruthy();
  });

  it('rejects an empty or invalid search payload', async () => {
    const empty = await POST(jsonRequest('http://localhost/api/metadata/search', {}));
    expect(empty.status).toBe(400);
    const badIsbn = await POST(
      jsonRequest('http://localhost/api/metadata/search', { isbn: '123' }),
    );
    expect(badIsbn.status).toBe(400);
  });

  it('merges Google Books and Open Library results', async () => {
    mockProviders(
      [
        {
          id: 'g1',
          volumeInfo: {
            title: '三体',
            authors: ['刘慈欣'],
            publisher: '重庆出版社',
            publishedDate: '2008',
            language: 'zh',
            industryIdentifiers: [{ type: 'ISBN_13', identifier: '9787536692930' }],
            description: '地球往事',
            imageLinks: { thumbnail: 'http://books.google.com/books/content?id=g1' },
          },
        },
      ],
      [
        {
          key: '/works/OL1W',
          title: 'The Three-Body Problem',
          author_name: ['Cixin Liu'],
          first_publish_year: 2008,
          isbn: ['9780765382030'],
          publisher: ['Tor'],
          language: ['eng'],
          cover_i: 42,
        },
      ],
    );

    const response = await POST(
      jsonRequest('http://localhost/api/metadata/search', { title: '三体', author: '刘慈欣' }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as MetadataSearchResult;
    expect(body.ok).toBe(true);
    expect(body.cached).toBe(false);
    expect(body.candidates).toHaveLength(2);
    const googleCandidate = body.candidates.find((item) => item.provider === 'google')!;
    expect(googleCandidate).toMatchObject({
      title: '三体',
      author: '刘慈欣',
      provider: 'google',
      isbn: '9787536692930',
      publisher: '重庆出版社',
      language: 'zh',
    });
    expect(googleCandidate.coverUrl).toContain('https://');
    const open = body.candidates.find((item) => item.provider === 'openlibrary');
    expect(open?.coverUrl).toContain('covers.openlibrary.org');
  });

  it('queries only by ISBN when provided and strips hyphens', async () => {
    const fetchMock = mockProviders([], []);
    const result = await searchMetadata({ isbn: '978-7-5366-9293-0' });
    expect(result.ok).toBe(true);
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.every((url) => url.includes('9787536692930'))).toBe(true);
    expect(urls.some((url) => url.includes('author='))).toBe(false);
  });

  it('caches a non-empty result for 30 days', async () => {
    const fetchMock = mockProviders(
      [{ volumeInfo: { title: '三体', authors: ['刘慈欣'] } }],
      [],
    );
    const first = await searchMetadata({ q: '三体' });
    expect(first.candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const second = await searchMetadata({ q: '三体' });
    expect(second.cached).toBe(true);
    expect(second.candidates).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not cache empty results and degrades to offline when both providers fail', async () => {
    mockProviders([], []);
    const empty = await searchMetadata({ q: 'nothing at all' });
    expect(empty.candidates).toHaveLength(0);
    expect(empty.reason).toBe('empty');

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const offline = await searchMetadata({ q: '三体' });
    expect(offline.ok).toBe(false);
    expect(offline.reason).toBe('offline');
    expect(offline.cached).toBe(false);
    expect(offline.candidates).toEqual([]);
  });

  it('ranks the preferred language first', async () => {
    await updateSettings({ metadata: { language: 'zh' } });
    mockProviders(
      [{ volumeInfo: { title: 'Beta Book', authors: ['A'], language: 'en' } }],
      [{ title: '三体', author_name: ['刘慈欣'], language: ['chi'] }],
    );
    const result = await searchMetadata({ q: 'book' });
    expect(result.candidates[0]!.title).toBe('三体');

    await updateSettings({ metadata: { language: 'en' } });
    await clearMetadataCacheForTests();
    const english = await searchMetadata({ q: 'book' });
    expect(english.candidates[0]!.title).toBe('Beta Book');
  });

  it('deduplicates the same title/author from both providers', async () => {
    mockProviders(
      [{ volumeInfo: { title: '三体', authors: ['刘慈欣'] } }],
      [{ title: '三体', author_name: ['刘慈欣'] }],
    );
    const result = await searchMetadata({ q: '三体' });
    expect(result.candidates).toHaveLength(1);
  });

  it('only sends the query string to providers (no local paths)', async () => {
    const fetchMock = mockProviders(
      [{ volumeInfo: { title: '三体', authors: ['刘慈欣'] } }],
      [],
    );
    await searchMetadata({ title: '三体', author: '刘慈欣' });
    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(
      urls.every(
        (url) =>
          url.startsWith('https://www.googleapis.com/') ||
          url.startsWith('https://openlibrary.org/') ||
          url.startsWith('https://book.douban.com/'),
      ),
    ).toBe(true);
    expect(urls.join(' ')).not.toContain(dirs.root);
    expect(urls.join(' ')).not.toContain('kindleforge');
  });
});
