import { guardApiRequest } from '../../../../../lib/server/request';
/** GET /api/library/:id/eml — downloadable .eml draft (message/rfc822). */
import {
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { buildEml } from '../../../../../lib/server/mailer';
import { buildContentDisposition } from '../../../../../lib/server/storage';

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
    const eml = await buildEml(id);
    return new Response(new Uint8Array(eml.data), {
      status: 200,
      headers: {
        'content-type': 'message/rfc822',
        'content-length': String(eml.data.byteLength),
        'content-disposition': buildContentDisposition(eml.filename),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
