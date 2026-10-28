/**
 * GET /api/metadata/cover?url=... — bounded proxy for metadata cover images.
 * Validates public http(s), follows at most 3 redirects, caps at 8 MiB / 10 s,
 * returns raster image types only and supports ETag / If-None-Match.
 */
import {
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import {
  METADATA_COVER_CACHE_CONTROL,
  proxyMetadataCover,
} from '../../../../lib/server/metadata/cover';
import { guardApiRequest } from '../../../../lib/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'OPTIONS'];

export function POST(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PUT(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PATCH(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function DELETE(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function OPTIONS(): Response {
  return optionsResponse(ALLOWED);
}

export async function GET(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const url = new URL(request.url).searchParams.get('url') ?? '';
    const cover = await proxyMetadataCover(url, request.headers.get('if-none-match'));
    if (cover.notModified) {
      return new Response(null, {
        status: 304,
        headers: { etag: cover.etag, 'cache-control': cover.cacheControl },
      });
    }
    return new Response(new Uint8Array(cover.data ?? new Uint8Array()), {
      status: 200,
      headers: {
        'content-type': cover.contentType ?? 'application/octet-stream',
        'content-length': String(cover.data?.byteLength ?? 0),
        etag: cover.etag,
        'cache-control': cover.cacheControl ?? METADATA_COVER_CACHE_CONTROL,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
