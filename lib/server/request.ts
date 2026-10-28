/**
 * Small helpers shared by the v2 routes: bounded JSON/multipart parsing with
 * a friendly 400 instead of a Next.js stack trace.
 */
import { badRequest, jsonResponse, lengthRequired, tooLarge } from './errors';
import { evaluateRequestOrigin } from './origin';

export interface ReadJsonOptions {
  maxBytes?: number;
  /** Require a body (an empty body becomes an error instead of `{}`). */
  required?: boolean;
}

export async function readJsonBody(
  request: Request,
  options: ReadJsonOptions = {},
): Promise<unknown> {
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    const length = Number(declared);
    if (Number.isFinite(length) && length > maxBytes) throw tooLarge(length, maxBytes);
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw badRequest('Could not read the request body.');
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > maxBytes) throw tooLarge(bytes, maxBytes);
  if (!text.trim()) {
    if (options.required) throw badRequest('The request body is required.');
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw badRequest('The request body is not valid JSON.');
  }
}

export async function readFormData(
  request: Request,
  maxBytes: number,
): Promise<FormData> {
  const declared = request.headers.get('content-length');
  if (declared === null) throw lengthRequired(true);
  const length = Number(declared);
  if (!Number.isFinite(length) || length <= 0) throw lengthRequired(true);
  if (length > maxBytes) throw tooLarge(length, maxBytes);
  try {
    return await request.formData();
  } catch {
    throw badRequest('Could not read the multipart form data.');
  }
}


/**
 * Route-level Host/Origin guard (defence in depth next to `middleware.ts`).
 * Returns a ready 403 response, or null when the request may proceed. Direct
 * handler tests omit Host, which is allowed here; real requests always carry
 * one and Next middleware enforces it strictly.
 */
export function guardApiRequest(request: Request): Response | null {
  const result = evaluateRequestOrigin(request.headers, process.env, { allowMissingHost: true });
  if (result.ok) return null;
  return jsonResponse(result.body, { status: result.status });
}
