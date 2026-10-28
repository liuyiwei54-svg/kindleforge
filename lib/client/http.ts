import { ApiError } from './api';

function hintToString(hint: unknown): string | undefined {
  if (!hint) return undefined;
  if (typeof hint === 'string') return hint;
  if (typeof hint === 'object') {
    const value = hint as { zh?: unknown; en?: unknown };
    if (typeof value.zh === 'string') return value.zh;
    if (typeof value.en === 'string') return value.en;
  }
  return undefined;
}

/** Parse the shared `{ error: { code, message, hint } }` body into an ApiError. */
export async function readApiError(response: Response): Promise<ApiError> {
  let code = 'INTERNAL';
  let message: string | undefined;
  let hint: string | undefined;
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error?: { code?: unknown; message?: unknown; hint?: unknown } }).error;
      if (error && typeof error.code === 'string') {
        code = error.code;
        message = typeof error.message === 'string' ? error.message : undefined;
        hint = hintToString(error.hint);
      }
    }
  } catch {
    // non-JSON body — fall back to the status code
  }
  if (code === 'INTERNAL') {
    if (response.status === 404) code = 'NOT_FOUND';
    else if (response.status === 413) code = 'ATTACHMENT_TOO_LARGE';
    else if (response.status === 415) code = 'UNSUPPORTED_FORMAT';
  }
  return new ApiError(code, message ?? `HTTP ${response.status}`, hint);
}

/** fetch() that normalises network failures into ApiError('NETWORK'). */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, { cache: 'no-store', ...init });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK');
  }
  if (!response.ok) throw await readApiError(response);
  return response;
}

export async function apiJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(input, init);
  return (await response.json()) as T;
}
