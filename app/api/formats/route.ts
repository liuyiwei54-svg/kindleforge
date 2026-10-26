/**
 * GET /api/formats — the conversion matrix the UI renders.
 * `pairs` is filtered by what this machine can actually run (calibre probe),
 * while `formats`/`devices` stay static. Cached for 5s inside the probe.
 */
import {
  DEVICES,
  FORMAT_INFO,
  INPUT_FORMATS,
  OUTPUT_FORMATS,
  capabilities,
} from '../../../lib/engine/formats';
import type { FormatId, FormatInfo } from '../../../lib/engine/types';
import { engineAvailability, probeEngines } from '../../../lib/server/engines';
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../lib/server/errors';

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

const FORMAT_ORDER: FormatId[] = [...INPUT_FORMATS, ...OUTPUT_FORMATS.filter((id) => !INPUT_FORMATS.includes(id))];

export async function GET(): Promise<Response> {
  try {
    const engines = await engineAvailability();
    const details = await probeEngines();
    const formats: FormatInfo[] = FORMAT_ORDER.map((id) => FORMAT_INFO[id]);
    const formatsById = Object.fromEntries(formats.map((info) => [info.id, info])) as Record<
      FormatId,
      FormatInfo
    >;
    return jsonResponse({
      formats,
      formatsById,
      inputFormats: INPUT_FORMATS,
      outputFormats: OUTPUT_FORMATS,
      devices: DEVICES,
      // Full declared matrix (SEO/marketing surface). `availablePairs` is the
      // subset this machine can actually run right now — use it to disable
      // options in the converter rather than hiding rows from the matrix.
      pairs: capabilities(),
      availablePairs: capabilities({ calibre: engines.calibre }),
      engines,
      engineDetails: details.map((detail) => ({
        id: detail.id,
        available: detail.available,
        version: detail.version ?? null,
        bin: detail.bin,
      })),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
