import { guardApiRequest } from '../../../../../lib/server/request';
/** GET /api/library/:id/file — download a library file (RFC 5987 filename). */
import { readFile } from 'node:fs/promises';
import {
  NO_STORE,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { libraryFilePath } from '../../../../../lib/server/library';
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
    const file = await libraryFilePath(id);
    const data = await readFile(file.path);
    return new Response(new Uint8Array(data), {
      status: 200,
      headers: {
        'content-type': file.mime,
        'content-length': String(data.byteLength),
        'content-disposition': buildContentDisposition(file.filename),
        ...NO_STORE,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
