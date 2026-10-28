import { guardApiRequest } from '../../../../../lib/server/request';
/** GET /api/library/:id/cover — cover JPEG with ETag / 304 support. */
import {
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { libraryCoverFile } from '../../../../../lib/server/library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'OPTIONS'];

interface Context {
  params: Promise<{ id: string }>;
}

export function POST(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PUT(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function DELETE(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function OPTIONS(): Response {
  return optionsResponse(ALLOWED);
}

export async function GET(request: Request, context: Context): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await context.params;
    const cover = await libraryCoverFile(id);
    if (request.headers.get('if-none-match') === cover.etag) {
      return new Response(null, {
        status: 304,
        headers: { etag: cover.etag, 'cache-control': 'private, max-age=0, must-revalidate' },
      });
    }
    return new Response(new Uint8Array(cover.data), {
      status: 200,
      headers: {
        'content-type': 'image/jpeg',
        'content-length': String(cover.data.byteLength),
        etag: cover.etag,
        'cache-control': 'private, max-age=0, must-revalidate',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
