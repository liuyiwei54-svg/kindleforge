/**
 * POST /api/metadata/search — Google Books / Open Library lookup.
 * Body: `{ q }` or `{ title, author?, isbn? }`. Never caches empty results.
 */
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import { searchMetadata } from '../../../../lib/server/metadata';
import { guardApiRequest, readJsonBody } from '../../../../lib/server/request';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['POST', 'OPTIONS'];

export function GET(): Response {
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

export async function POST(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const body = await readJsonBody(request, { maxBytes: 16 * 1024, required: true });
    return jsonResponse(await searchMetadata(body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
