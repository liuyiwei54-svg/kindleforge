import { guardApiRequest } from '../../../../../lib/server/request';
/**
 * GET /api/jobs/:id/download — stream the result with a correct UTF-8
 * Content-Disposition (Chinese filenames survive) and the result MIME type.
 *
 * The file is intentionally *not* deleted on download: the job stays
 * downloadable until its 10-minute TTL, matching the product copy.
 */
import {
  methodNotAllowedResponse,
  notFound,
  optionsResponse,
  resultGone,
  resultNotReady,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { getJobStore } from '../../../../../lib/server/jobs';
import {
  buildContentDisposition,
  isJobId,
  readJobFile,
} from '../../../../../lib/server/storage';

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

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const params = await context.params;
    const id = params?.id;
    if (!isJobId(id)) throw notFound();

    const job = getJobStore().get(id);
    if (!job) throw notFound();
    if (job.status === 'error') throw notFound('Result');
    if (job.status !== 'done' || !job.resultPath || !job.resultName) throw resultNotReady();

    let bytes: Buffer;
    try {
      bytes = await readJobFile(job.id, job.resultPath);
    } catch {
      throw resultGone();
    }

    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        'Content-Type': job.resultMime ?? 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'Content-Disposition': buildContentDisposition(job.resultName),
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'Content-Transfer-Encoding': 'binary',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
