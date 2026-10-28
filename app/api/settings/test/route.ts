/**
 * POST /api/settings/test — SMTP connection diagnostic.
 *
 * Always answers HTTP 200 (when the request itself is readable) with
 * `{ ok, message, hint?, code? }`; the UI shows the hint via aria-live.
 * Body: `{ smtp?: { host?, port?, secure?, user?, from?, password? } }`;
 * omitted fields fall back to the saved settings and saved password.
 */
import {
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
} from '../../../../lib/server/errors';
import { testSmtpConnection } from '../../../../lib/server/mailer';
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
    const body = await readJsonBody(request, { maxBytes: 64 * 1024 });
    return jsonResponse(await testSmtpConnection(body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
