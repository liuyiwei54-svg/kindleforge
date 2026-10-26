/**
 * GET    /api/jobs/:id — poll status, progress, result metadata
 * DELETE /api/jobs/:id — immediate removal of record + temp files (204)
 *
 * Unknown or expired ids are indistinguishable (404) so ids cannot be probed.
 */
import {
  jsonResponse,
  methodNotAllowedResponse,
  notFound,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import { getJobStore, publicJob } from '../../../../lib/server/jobs';
import { isJobId } from '../../../../lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'DELETE', 'OPTIONS'];

export function POST(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PUT(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PATCH(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function OPTIONS(): Response {
  return optionsResponse(ALLOWED);
}

interface RouteContext {
  params: Promise<{ id: string }>;
}

async function idFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  const id = params?.id;
  if (!isJobId(id)) throw notFound();
  return id;
}

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await idFrom(context);
    const job = getJobStore().get(id);
    if (!job) throw notFound();
    return jsonResponse(publicJob(job));
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext): Promise<Response> {
  try {
    const id = await idFrom(context);
    const store = getJobStore();
    if (!store.get(id)) throw notFound();
    await store.remove(id);
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
