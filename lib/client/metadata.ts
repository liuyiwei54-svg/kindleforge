import type { MetadataSearchResult } from '@/lib/shared/types';
import { apiJson } from './http';

export interface MetadataQuery {
  q?: string;
  title?: string;
  author?: string;
  isbn?: string;
}

export async function searchMetadata(query: MetadataQuery, signal?: AbortSignal): Promise<MetadataSearchResult> {
  const body: MetadataQuery = {};
  if (query.q?.trim()) body.q = query.q.trim();
  if (query.title?.trim()) body.title = query.title.trim();
  if (query.author?.trim()) body.author = query.author.trim();
  if (query.isbn?.trim()) body.isbn = query.isbn.replace(/[^0-9Xx]/g, '');
  return apiJson<MetadataSearchResult>('/api/metadata/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

const SEPARATORS = [' - ', ' — ', ' – ', ' -- ', ' _ ', ' by '];

/**
 * Turn `三体 - 刘慈欣.epub` into an editable guess. Deliberately conservative:
 * it only splits on obvious separators, and never throws.
 */
export function metadataCoverProxyUrl(url: string): string {
  return `/api/metadata/cover?url=${encodeURIComponent(url)}`;
}

export function guessBookInfo(filename: string): { title: string; author?: string } {
  const base = filename
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return { title: filename };

  for (const separator of SEPARATORS) {
    const index = base.lastIndexOf(separator);
    if (index > 0) {
      const title = base.slice(0, index).trim();
      const author = base.slice(index + separator.length).trim();
      if (title && author) return { title, author };
    }
  }
  return { title: base };
}
