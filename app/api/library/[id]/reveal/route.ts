import { guardApiRequest } from '../../../../../lib/server/request';
/** POST /api/library/:id/reveal — reveal in Finder (macOS only). */
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { revealLibraryEntry } from '../../../../../lib/server/library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['POST', 'OPTIONS'];

interface Context {
  params: Promise<{ id: string }>;
}

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

export async function POST(request: Request, context: Context): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const { id } = await context.params;
    await revealLibraryEntry(id);
    return jsonResponse({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
