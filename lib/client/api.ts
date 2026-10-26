import type { FormatId, KindleOptions } from '@/lib/engine/types';

export class ApiError extends Error {
  code: string;
  hint?: string;

  constructor(code: string, message?: string, hint?: string) {
    super(message ?? code);
    this.name = 'ApiError';
    this.code = code;
    this.hint = hint;
  }
}

export interface JobErrorPayload {
  code: string;
  message?: string;
  hint?: string | { zh?: string; en?: string };
}

export interface JobResponse {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  engine?: string;
  warnings?: string[];
  error?: JobErrorPayload;
  result?: {
    filename: string;
    size: number;
    mime: string;
    downloadUrl?: string;
  };
}

function hintToString(hint: JobErrorPayload['hint']): string | undefined {
  if (!hint) return undefined;
  if (typeof hint === 'string') return hint;
  return hint.zh ?? hint.en;
}

async function readError(response: Response): Promise<ApiError> {
  let code = 'INTERNAL';
  let message: string | undefined;
  let hint: string | undefined;
  try {
    const payload: unknown = await response.json();
    if (payload && typeof payload === 'object' && 'error' in payload) {
      const error = (payload as { error?: JobErrorPayload }).error;
      if (error && typeof error.code === 'string') {
        code = error.code;
        message = typeof error.message === 'string' ? error.message : undefined;
        hint = hintToString(error.hint);
      }
    }
  } catch {
    // non-JSON error body
  }
  if (code === 'INTERNAL') {
    if (response.status === 413) code = 'TOO_LARGE';
    else if (response.status === 415) code = 'UNSUPPORTED_PAIR';
    else if (response.status === 404) code = 'INTERNAL';
    else if (response.status >= 500) code = 'INTERNAL';
  }
  return new ApiError(code, message ?? `HTTP ${response.status}`, hint);
}

/** Queue a server-side conversion. Resolves with the job id. */
export async function queueConversion(
  file: File,
  target: FormatId,
  options: KindleOptions,
  signal?: AbortSignal,
): Promise<string> {
  const body = new FormData();
  body.append('file', file, file.name);
  body.append('target', target);
  body.append('options', JSON.stringify(options));

  let response: Response;
  try {
    response = await fetch('/api/convert', { method: 'POST', body, signal, cache: 'no-store' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK');
  }
  if (!response.ok) throw await readError(response);

  const payload: unknown = await response.json().catch(() => null);
  const jobId =
    payload && typeof payload === 'object'
      ? ((payload as { jobId?: unknown; id?: unknown }).jobId ?? (payload as { id?: unknown }).id)
      : undefined;
  if (typeof jobId !== 'string' || jobId.length === 0) throw new ApiError('INTERNAL');
  return jobId;
}

export async function fetchJob(jobId: string, signal?: AbortSignal): Promise<JobResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { cache: 'no-store', signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK');
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as JobResponse;
}

export function downloadUrlFor(jobId: string): string {
  return `/api/jobs/${encodeURIComponent(jobId)}/download`;
}

export async function cancelJob(jobId: string): Promise<void> {
  try {
    await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', cache: 'no-store' });
  } catch {
    // best effort — the server TTL will clean up anyway
  }
}

export interface WaitOptions {
  intervalMs?: number;
  signal?: AbortSignal;
  onUpdate?: (job: JobResponse) => void;
}

/** Poll every 800ms until the job finishes or the signal aborts. */
export async function waitForJob(jobId: string, options: WaitOptions = {}): Promise<JobResponse> {
  const { intervalMs = 800, signal, onUpdate } = options;
  const deadline = Date.now() + 10 * 60 * 1000;
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const job = await fetchJob(jobId, signal);
    onUpdate?.(job);
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() > deadline) throw new ApiError('TIMEOUT');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, intervalMs);
      function onAbort() {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}
