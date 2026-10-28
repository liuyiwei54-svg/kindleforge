/**
 * Server-side proxy for third-party metadata cover images.
 *
 * Search providers return public image URLs. Rendering those directly in the
 * page leaks the reader's IP to Google/Open Library and, on an https page,
 * http-only thumbnails would be blocked as mixed content. This proxy fetches
 * one image at a time with the same SSRF/size rules as library covers:
 *   - http(s) only, public DNS answer only, no credentials
 *   - manual redirects (max 3), every hop re-validated
 *   - 10s timeout, 8 MiB response cap, raster image MIME only
 *   - small in-memory ETag cache so repeated renders do not re-fetch
 */
import { createHash } from 'node:crypto';
import { ApiError, badRequest, coverNotImage, coverProxyFailed, tooLarge } from '../errors';
import { assertPublicHttpUrl } from '../net';
import { imageRequestHeaders } from './http';

export const METADATA_COVER_MAX_BYTES = 8 * 1024 * 1024;
export const METADATA_COVER_TIMEOUT_MS = 10_000;
export const METADATA_COVER_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const REDIRECT_LIMIT = 3;
const CACHE_MAX_ENTRIES = 64;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

interface CachedCover {
  url: string;
  data: Uint8Array;
  contentType: string;
  etag: string;
  at: number;
}

const cache = new Map<string, CachedCover>();
let cacheBytes = 0;

function etagFor(data: Uint8Array): string {
  return `"kf-cover-${createHash('sha1').update(data).digest('hex').slice(0, 32)}"`;
}

function etagMatches(header: string | null | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim().replace(/^W\//, ''))
    .includes(etag);
}

function remember(entry: CachedCover): void {
  const previous = cache.get(entry.url);
  if (previous) cacheBytes -= previous.data.byteLength;
  cache.delete(entry.url);
  cache.set(entry.url, entry);
  cacheBytes += entry.data.byteLength;
  while (cache.size > CACHE_MAX_ENTRIES || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.entries().next().value as [string, CachedCover] | undefined;
    if (!oldest) break;
    cache.delete(oldest[0]);
    cacheBytes -= oldest[1].data.byteLength;
  }
}

export interface MetadataCoverResult {
  notModified: boolean;
  etag: string;
  cacheControl: string;
  contentType?: string;
  data?: Uint8Array;
}

/** Cache policy for the proxied image. The URL is immutable in practice. */
export const METADATA_COVER_CACHE_CONTROL = 'public, max-age=604800, stale-while-revalidate=86400';

async function readCappedImage(response: Response): Promise<{ data: Uint8Array; contentType: string }> {
  const rawType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const contentType = rawType === 'image/jpg' ? 'image/jpeg' : rawType;
  if (!IMAGE_TYPES.has(contentType)) throw coverNotImage();

  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > METADATA_COVER_MAX_BYTES) {
    await response.body?.cancel();
    throw tooLarge(declared, METADATA_COVER_MAX_BYTES);
  }

  const reader = response.body?.getReader();
  if (!reader) throw coverNotImage();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > METADATA_COVER_MAX_BYTES) {
      await reader.cancel();
      throw tooLarge(total, METADATA_COVER_MAX_BYTES);
    }
    chunks.push(value);
  }
  if (total === 0) throw coverNotImage();
  return { data: new Uint8Array(Buffer.concat(chunks)), contentType };
}

function coverTimeout(): ApiError {
  return new ApiError('TIMEOUT', 504, 'The cover server took too long to respond.', {
    zh: '封面服务器响应超时（10 秒），请稍后重试。',
    en: 'The cover server timed out after 10 seconds. Try again later.',
  });
}

async function download(rawUrl: string): Promise<{ data: Uint8Array; contentType: string; url: string }> {
  let current = await assertPublicHttpUrl(rawUrl);
  const deadline = Date.now() + METADATA_COVER_TIMEOUT_MS;
  for (let hop = 0; hop <= REDIRECT_LIMIT; hop += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw coverTimeout();
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(remaining),
        headers: imageRequestHeaders(current),
      });
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error instanceof Error && error.name === 'TimeoutError') throw coverTimeout();
      throw coverProxyFailed();
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw coverProxyFailed('the redirect had no Location header');
      await response.body?.cancel();
      current = await assertPublicHttpUrl(new URL(location, current));
      continue;
    }
    if (!response.ok) throw coverProxyFailed(`HTTP ${response.status}`);
    const image = await readCappedImage(response);
    return { ...image, url: current.toString() };
  }
  throw coverProxyFailed('too many redirects');
}

/**
 * Return a bounded raster image for a metadata candidate URL. The `If-None-Match`
 * argument makes repeat renders cheap without downloading the image again.
 */
export async function proxyMetadataCover(
  rawUrl: string,
  ifNoneMatch?: string | null,
): Promise<MetadataCoverResult> {
  const value = rawUrl.trim();
  if (!value) throw badRequest('The url query parameter is required.');
  if (value.length > 4096) throw badRequest('The cover URL is too long.');

  const validated = await assertPublicHttpUrl(value);
  const key = validated.toString();
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < METADATA_COVER_CACHE_TTL_MS) {
    // LRU touch.
    cache.delete(key);
    cache.set(key, cached);
    if (etagMatches(ifNoneMatch, cached.etag)) {
      return { notModified: true, etag: cached.etag, cacheControl: METADATA_COVER_CACHE_CONTROL };
    }
    return {
      notModified: false,
      etag: cached.etag,
      cacheControl: METADATA_COVER_CACHE_CONTROL,
      contentType: cached.contentType,
      data: cached.data,
    };
  }

  const image = await download(key);
  const entry: CachedCover = {
    url: image.url,
    data: image.data,
    contentType: image.contentType,
    etag: etagFor(image.data),
    at: Date.now(),
  };
  // A redirect may change the canonical URL; cache both spellings.
  remember({ ...entry, url: key });
  if (image.url !== key) remember(entry);

  if (etagMatches(ifNoneMatch, entry.etag)) {
    return { notModified: true, etag: entry.etag, cacheControl: METADATA_COVER_CACHE_CONTROL };
  }
  return {
    notModified: false,
    etag: entry.etag,
    cacheControl: METADATA_COVER_CACHE_CONTROL,
    contentType: entry.contentType,
    data: entry.data,
  };
}

/** Test-only: forget every cached image. */
export function resetMetadataCoverCacheForTests(): void {
  cache.clear();
  cacheBytes = 0;
}
