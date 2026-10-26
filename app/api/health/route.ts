/**
 * GET /api/health — liveness + real optional-engine availability.
 * Never cached, never touches user data.
 */
import { engineAvailability, probeEngines } from '../../../lib/server/engines';
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../lib/server/errors';
import { APP_VERSION } from '../../../lib/server/version';

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

export async function GET(): Promise<Response> {
  try {
    const details = await probeEngines();
    const engines = await engineAvailability();
    return jsonResponse(
      {
        ok: true,
        uptime: Math.round(process.uptime()),
        version: APP_VERSION,
        engines,
        engineDetails: details.map((detail) => ({
          id: detail.id,
          available: detail.available,
          version: detail.version ?? null,
          bin: detail.bin,
        })),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
