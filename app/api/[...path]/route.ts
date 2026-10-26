/**
 * JSON 404 for the whole /api namespace.
 *
 * Without this file Next falls back to its HTML 404 page for unknown API
 * paths, which breaks clients that always expect `{ error: { code, … } }`.
 * Real routes (static or more specific dynamic segments) win over this
 * catch-all, so it only handles genuinely unmatched paths.
 */
import { errorBody, jsonResponse } from '../../../lib/server/errors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HINT = {
  zh: '接口不存在，请检查路径；任务接口为 /api/jobs/<jobId>。',
  en: 'No such API route. Check the path; job endpoints look like /api/jobs/<jobId>.',
};

function apiNotFound(): Response {
  return jsonResponse(errorBody('NOT_FOUND', 'API route not found.', HINT), { status: 404 });
}

export function GET(): Response {
  return apiNotFound();
}
export function POST(): Response {
  return apiNotFound();
}
export function PUT(): Response {
  return apiNotFound();
}
export function PATCH(): Response {
  return apiNotFound();
}
export function DELETE(): Response {
  return apiNotFound();
}
export function OPTIONS(): Response {
  return apiNotFound();
}
