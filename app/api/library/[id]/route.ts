/**
 * GET    /api/library/:id — one entry
 * PATCH  /api/library/:id — metadata/cover edit (EPUB rewritten, warnings returned)
 * DELETE /api/library/:id — remove file, cover and index row (204)
 */
import {
  emptyResponse,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import {
  deleteLibraryEntry,
  getLibraryEntry,
  patchLibraryEntry,
} from '../../../../lib/server/library';
import { guardApiRequest, readJsonBody } from '../../../../lib/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'PATCH', 'DELETE', 'OPTIONS'];

interface Context {
  params: Promise<{ id: string }>;
}

export function POST(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PUT(): Response {
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
    return jsonResponse(await getLibraryEntry(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await context.params;
    const body = await readJsonBody(request, { maxBytes: 256 * 1024, required: true });
    const { entry, warnings } = await patchLibraryEntry(id, body);
    return jsonResponse(warnings.length ? { ...entry, warnings } : entry);
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await context.params;
    await deleteLibraryEntry(id);
    return emptyResponse(204);
  } catch (error) {
    return toErrorResponse(error);
  }
}
