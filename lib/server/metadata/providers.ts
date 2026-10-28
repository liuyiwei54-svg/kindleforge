/**
 * Metadata providers (Douban, Google Books, Open Library).
 *
 * Privacy: only the query string (title / author / ISBN) is sent. The book
 * file is never uploaded and no identifiers are attached. Douban has no public
 * API; the suggestion endpoint is used on a best-effort, personal-use basis and
 * can be disabled in Settings.
 */
import type { MetadataCandidate, MetadataProvider } from '../../shared/types';
import { METADATA_TIMEOUT_MS } from '../settings-defaults';
import {
  DESKTOP_CHROME_UA,
  DOUBAN_REFERER,
  withTimeoutSignal,
} from './http';

export class ProviderError extends Error {
  readonly provider: MetadataProvider;
  readonly status?: number;
  constructor(provider: MetadataProvider, message: string, status?: number) {
    super(message);
    this.name = 'ProviderError';
    this.provider = provider;
    this.status = status;
  }
}

interface FetchJsonOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

async function fetchJson(url: string, options: FetchJsonOptions = {}): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? METADATA_TIMEOUT_MS;
  const response = await fetch(url, {
    signal: withTimeoutSignal(timeoutMs, options.signal),
    headers: {
      Accept: 'application/json, text/plain, */*',
      ...options.headers,
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new HttpError(response.status);
  return response.json();
}

function text(value: unknown, max = 4000): string {
  return typeof value === 'string' ? value.replace(/<[^>]+>/g, '').trim().slice(0, max) : '';
}

function https(url: unknown): string | undefined {
  if (typeof url !== 'string' || !url.trim()) return undefined;
  const trimmed = url.trim().replace(/^http:\/\//i, 'https://');
  return /^https:\/\//i.test(trimmed) ? trimmed : undefined;
}

function isbnFromGoogle(identifiers: unknown): string | undefined {
  if (!Array.isArray(identifiers)) return undefined;
  const items = identifiers as Array<Record<string, unknown>>;
  const byType = (type: string) =>
    items.find((entry) => String(entry.type ?? '').toUpperCase() === type);
  for (const type of ['ISBN_13', 'ISBN_10']) {
    const value = byType(type)?.identifier;
    if (typeof value === 'string') {
      const digits = value.replace(/[\s-]/g, '').toUpperCase();
      if (/^\d{13}$/.test(digits) || /^\d{9}[\dX]$/.test(digits)) return digits;
    }
  }
  return undefined;
}

interface ProviderOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface GoogleVolumeInfo {
  title?: unknown;
  authors?: unknown;
  publisher?: unknown;
  publishedDate?: unknown;
  description?: unknown;
  language?: unknown;
  industryIdentifiers?: unknown;
  imageLinks?: Record<string, unknown>;
}

export async function searchGoogle(
  query: string,
  options: ProviderOptions = {},
): Promise<MetadataCandidate[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=10&printType=books`;
  let payload: unknown;
  try {
    payload = await fetchJson(url, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      headers: { 'User-Agent': 'KindleForge/0.1 (+local library metadata lookup)' },
    });
  } catch (error) {
    throw new ProviderError(
      'google',
      (error as Error).message || 'request failed',
      error instanceof HttpError ? error.status : undefined,
    );
  }
  const items = (payload as { items?: unknown })?.items;
  if (!Array.isArray(items)) return [];
  const candidates: MetadataCandidate[] = [];
  for (const item of items as Array<Record<string, unknown>>) {
    const volume = (item.volumeInfo ?? {}) as GoogleVolumeInfo;
    const title = text(volume.title, 200);
    if (!title) continue;
    const authors = Array.isArray(volume.authors)
      ? (volume.authors as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    const imageLinks = volume.imageLinks ?? {};
    const coverUrl = https(imageLinks.thumbnail) ?? https(imageLinks.smallThumbnail);
    const isbn = isbnFromGoogle(volume.industryIdentifiers);
    candidates.push({
      provider: 'google',
      title,
      author: authors.map((a) => a.trim()).filter(Boolean).join(', '),
      ...(text(volume.publisher, 200) ? { publisher: text(volume.publisher, 200) } : {}),
      ...(text(volume.publishedDate, 40) ? { publishedAt: text(volume.publishedDate, 40) } : {}),
      ...(text(volume.language, 16) ? { language: text(volume.language, 16) } : {}),
      ...(isbn ? { isbn } : {}),
      ...(text(volume.description) ? { description: text(volume.description) } : {}),
      ...(coverUrl ? { coverUrl } : {}),
      ...(typeof item.id === 'string' ? { providerId: item.id } : {}),
    });
  }
  return candidates;
}

interface OpenLibraryDoc {
  key?: unknown;
  title?: unknown;
  author_name?: unknown;
  first_publish_year?: unknown;
  isbn?: unknown;
  publisher?: unknown;
  language?: unknown;
  cover_i?: unknown;
}

function openLibraryLanguage(value: unknown): string | undefined {
  const codes = Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  const first = codes[0];
  if (!first) return undefined;
  if (/^(?:eng|en)$/i.test(first)) return 'en';
  if (/^(?:chi|zho|zh)$/i.test(first)) return 'zh';
  return first;
}

function firstIsbn(values: unknown): string | undefined {
  if (!Array.isArray(values)) return undefined;
  const normalized = (values as unknown[])
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/[\s-]/g, '').toUpperCase())
    .filter((v) => /^\d{13}$/.test(v) || /^\d{9}[\dX]$/.test(v));
  return normalized.find((v) => v.length === 13) ?? normalized[0];
}

export async function searchOpenLibrary(
  query: string,
  options: ProviderOptions = {},
): Promise<MetadataCandidate[]> {
  const fields =
    'key,title,author_name,first_publish_year,isbn,publisher,language,cover_i';
  const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10&fields=${encodeURIComponent(fields)}`;
  let payload: unknown;
  try {
    payload = await fetchJson(url, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      headers: { 'User-Agent': 'KindleForge/0.1 (+local library metadata lookup)' },
    });
  } catch (error) {
    throw new ProviderError(
      'openlibrary',
      (error as Error).message || 'request failed',
      error instanceof HttpError ? error.status : undefined,
    );
  }
  const docs = (payload as { docs?: unknown })?.docs;
  if (!Array.isArray(docs)) return [];
  const candidates: MetadataCandidate[] = [];
  for (const doc of docs as OpenLibraryDoc[]) {
    const title = text(doc.title, 200);
    if (!title) continue;
    const authors = Array.isArray(doc.author_name)
      ? (doc.author_name as unknown[]).filter((a): a is string => typeof a === 'string')
      : [];
    const publishers = Array.isArray(doc.publisher)
      ? (doc.publisher as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
    const coverId = typeof doc.cover_i === 'number' ? doc.cover_i : undefined;
    const isbn = firstIsbn(doc.isbn);
    candidates.push({
      provider: 'openlibrary',
      title,
      author: authors.map((a) => a.trim()).filter(Boolean).join(', '),
      ...(publishers[0] ? { publisher: publishers[0].slice(0, 200) } : {}),
      ...(typeof doc.first_publish_year === 'number'
        ? { publishedAt: String(doc.first_publish_year) }
        : {}),
      ...(openLibraryLanguage(doc.language)
        ? { language: openLibraryLanguage(doc.language) }
        : {}),
      ...(isbn ? { isbn } : {}),
      ...(coverId
        ? { coverUrl: `https://covers.openlibrary.org/b/id/${coverId}-L.jpg` }
        : {}),
      ...(typeof doc.key === 'string' ? { providerId: doc.key } : {}),
    });
  }
  return candidates;
}

interface DoubanSuggestItem {
  title?: unknown;
  url?: unknown;
  pic?: unknown;
  author_name?: unknown;
  year?: unknown;
  type?: unknown;
  id?: unknown;
}

/** `/s/` is a small thumbnail; `/l/` is the same image at ~350x500. */
export function doubanLargeCover(pic: string): string {
  return pic.replace(/\/s\//, '/l/');
}

export async function searchDouban(
  query: string,
  options: ProviderOptions = {},
): Promise<MetadataCandidate[]> {
  const url = `https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`;
  let payload: unknown;
  try {
    payload = await fetchJson(url, {
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      headers: {
        'User-Agent': DESKTOP_CHROME_UA,
        Referer: DOUBAN_REFERER,
        Accept: 'application/json, text/javascript, */*; q=0.01',
      },
    });
  } catch (error) {
    throw new ProviderError(
      'douban',
      (error as Error).message || 'request failed',
      error instanceof HttpError ? error.status : undefined,
    );
  }
  if (!Array.isArray(payload)) return [];
  const candidates: MetadataCandidate[] = [];
  for (const raw of payload as DoubanSuggestItem[]) {
    if (candidates.length >= 8) break;
    // The endpoint can also return movies/music; `type: "b"` is a book.
    if (raw.type !== undefined && raw.type !== 'b') continue;
    const title = text(raw.title, 200);
    if (!title) continue;
    const author = text(raw.author_name, 300);
    const year = text(raw.year, 40);
    const pic = https(raw.pic);
    const providerUrlRaw = https(raw.url);
    const subjectId =
      typeof raw.id === 'string' && /^\d+$/.test(raw.id)
        ? raw.id
        : providerUrlRaw?.match(/\/subject\/(\d+)\//)?.[1];
    let providerUrl = providerUrlRaw;
    if (providerUrl) {
      try {
        if (new URL(providerUrl).hostname !== 'book.douban.com') providerUrl = undefined;
      } catch {
        providerUrl = undefined;
      }
    }
    if (!providerUrl && subjectId) providerUrl = `https://book.douban.com/subject/${subjectId}/`;
    candidates.push({
      provider: 'douban',
      title,
      author,
      ...(year ? { publishedAt: year } : {}),
      ...(pic ? { coverUrl: doubanLargeCover(pic) } : {}),
      ...(providerUrl ? { providerUrl } : {}),
      ...(subjectId ? { providerId: subjectId } : {}),
    });
  }
  return candidates;
}

export const PROVIDERS: Record<MetadataProvider, typeof searchGoogle> = {
  douban: searchDouban,
  google: searchGoogle,
  openlibrary: searchOpenLibrary,
};
