/** GET /api/library/stats — header counters for the library page. */
import { guardApiRequest } from '../../../../lib/server/request';
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import { libraryStats } from '../../../../lib/server/library';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'OPTIONS'];

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

export async function GET(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    return jsonResponse(await libraryStats());
  } catch (error) {
    return toErrorResponse(error);
  }
}
