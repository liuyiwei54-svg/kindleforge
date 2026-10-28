/**
 * POST /api/library/:id/send — Send to Kindle.
 * Body is optional: `{ mode?: 'smtp' | 'eml' }`. `eml` is served by the
 * dedicated /eml route; here we only support direct SMTP delivery.
 */
import {
  badRequest,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../../lib/server/errors';
import { sendToKindle } from '../../../../../lib/server/mailer';
import { guardApiRequest, readJsonBody } from '../../../../../lib/server/request';

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
    const body = (await readJsonBody(request, { maxBytes: 16 * 1024 })) as { mode?: unknown };
    if (body.mode !== undefined && body.mode !== 'smtp') {
      throw badRequest('This endpoint sends over SMTP; use GET /eml for a draft.', {
        zh: '此接口通过 SMTP 发送；如需 .eml 草稿请用 GET /eml。',
        en: 'This endpoint sends via SMTP; use GET /eml for an .eml draft.',
      });
    }
    return jsonResponse(await sendToKindle(id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
