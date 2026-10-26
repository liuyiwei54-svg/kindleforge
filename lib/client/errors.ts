import type { Dict } from '@/lib/i18n/types';
import { ApiError } from './api';
import type { FileError } from './types';

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function makeAbortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

/**
 * Turn anything thrown during a conversion into copy the user can act on.
 * Known API codes always use the localised dictionary, so the message matches
 * the page language even if the server answers in another one.
 */
export function describeError(error: unknown, errors: Dict['errors']): FileError {
  let code = 'INTERNAL';
  if (error instanceof ApiError) code = error.code;
  else if (error instanceof TypeError) code = 'NETWORK';
  else if (error instanceof Error && /worker/i.test(error.message)) code = 'WORKER';

  const known = code in errors ? errors[code as keyof Dict['errors']] : errors.INTERNAL;
  return { code, message: known.message, hint: known.hint };
}
