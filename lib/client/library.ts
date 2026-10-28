import type { FormatId } from '@/lib/engine/types';
import type { LibraryEntry, LibraryList, MetadataPatch, SendResult } from '@/lib/shared/types';
import { ApiError } from './api';
import { apiFetch, apiJson } from './http';

export type LibrarySort = 'added' | 'title' | 'author' | 'size';

export interface LibraryQuery {
  q?: string;
  sort?: LibrarySort;
  format?: FormatId | null;
}

export interface LibraryStats {
  total: number;
  totalBytes: number;
  latestAddedAt: number | null;
  dir: string;
}

export async function fetchLibrary(query: LibraryQuery = {}, signal?: AbortSignal): Promise<LibraryList> {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set('q', q);
  if (query.sort) params.set('sort', query.sort);
  if (query.format) params.set('format', query.format);
  const suffix = params.size > 0 ? `?${params.toString()}` : '';
  return apiJson<LibraryList>(`/api/library${suffix}`, { signal });
}

export async function fetchLibraryStats(signal?: AbortSignal): Promise<LibraryStats> {
  return apiJson<LibraryStats>('/api/library/stats', { signal });
}

/** Save a finished server job (bytes stay on the host). */
export async function saveJobToLibrary(jobId: string): Promise<LibraryEntry> {
  return apiJson<LibraryEntry>('/api/library', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId }),
  });
}

/** Save a local Worker result by uploading its bytes to this host. */
export async function saveFileToLibrary(
  file: File | Blob,
  filename: string,
  meta: { title?: string; author?: string } = {},
): Promise<LibraryEntry> {
  const body = new FormData();
  body.append('file', file, filename);
  if (meta.title?.trim()) body.append('title', meta.title.trim());
  if (meta.author?.trim()) body.append('author', meta.author.trim());
  return apiJson<LibraryEntry>('/api/library', { method: 'POST', body });
}

export async function updateLibraryEntry(id: string, patch: MetadataPatch): Promise<LibraryEntry> {
  return apiJson<LibraryEntry>(`/api/library/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteLibraryEntry(id: string): Promise<void> {
  await apiFetch(`/api/library/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function sendLibraryEntry(id: string): Promise<SendResult> {
  const result = await apiJson<SendResult>(`/api/library/${encodeURIComponent(id)}/send`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'smtp' }),
  });
  if (!result.ok) throw new ApiError('MAIL_UNREACHABLE', result.message, result.hint);
  return result;
}

export async function revealLibraryEntry(id: string): Promise<void> {
  await apiFetch(`/api/library/${encodeURIComponent(id)}/reveal`, { method: 'POST' });
}

export function libraryFileUrl(id: string): string {
  return `/api/library/${encodeURIComponent(id)}/file`;
}

export function libraryCoverUrl(entry: Pick<LibraryEntry, 'id' | 'coverVersion'>): string {
  const version = entry.coverVersion ?? 0;
  return `/api/library/${encodeURIComponent(entry.id)}/cover?v=${encodeURIComponent(String(version))}`;
}

export function libraryEmlUrl(id: string): string {
  return `/api/library/${encodeURIComponent(id)}/eml`;
}
