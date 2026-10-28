/**
 * GET /api/settings — public settings (never the SMTP password, only
 *                    hasPassword)
 * PUT /api/settings — partial update; returns the full Settings object.
 */
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../lib/server/errors';
import { guardApiRequest, readJsonBody } from '../../../lib/server/request';
import { getSettings, updateSettings } from '../../../lib/server/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'PUT', 'OPTIONS'];

export function POST(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function DELETE(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PATCH(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function OPTIONS(): Response {
  return optionsResponse(ALLOWED);
}

export async function GET(): Promise<Response> {
  try {
    return jsonResponse(await getSettings());
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const body = await readJsonBody(request, { maxBytes: 512 * 1024, required: true });
    const settings = await updateSettings(body);
    return jsonResponse(settings);
  } catch (error) {
    return toErrorResponse(error);
  }
}
