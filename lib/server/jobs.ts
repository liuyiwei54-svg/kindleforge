/**
 * In-memory job store (no database, by design).
 *
 * - max 2 conversions run at once, FIFO queue
 * - every job has a hard 5-minute timeout
 * - finished jobs are reclaimed 10 minutes after they stop changing (TTL)
 * - a 60s sweep interval is registered once per process (globalThis, so Next's
 *   dev HMR cannot stack intervals), and tmp files are removed on exit
 *
 * The store is built to be testable: construct your own with short timings and
 * call `sweep()` directly.
 */
import { randomUUID } from 'node:crypto';
import type { FormatId, KindleOptions } from '../engine/types';
import { ConversionError } from '../engine/types';
import { config } from './config';
import { ApiError, type BilingualHint } from './errors';
import { redactHint, redactServerPaths } from './redact';
import { deleteJobDir, deleteTmpRootSync, sweepOrphanJobDirs } from './storage';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobError {
  code: string;
  message: string;
  hint?: BilingualHint;
}

export interface JobSource {
  /** Original upload name; kept in memory only, never logged. */
  name: string;
  size: number;
  format: FormatId;
}

export interface Job {
  id: string;
  status: JobStatus;
  /** 0-100. Coarse stages: 5 → 10 → 35 → 75 → 95 → 100. */
  progress: number;
  createdAt: number;
  updatedAt: number;
  engine?: string;
  warnings: string[];
  durationMs?: number;
  error?: JobError;
  source: JobSource;
  target: FormatId;
  options?: KindleOptions;
  /** File name inside the job dir, e.g. "output.epub". */
  resultPath?: string;
  /** User-facing download name, may be CJK. */
  resultName?: string;
  resultMime?: string;
  resultSize?: number;
}

export interface JobProgressPatch {
  progress?: number;
  engine?: string;
  warnings?: string[];
}

export interface JobTaskContext {
  jobId: string;
  update: (patch: JobProgressPatch) => void;
}

export interface JobOutput {
  engine: string;
  warnings: string[];
  durationMs: number;
  resultPath: string;
  resultName: string;
  resultMime: string;
  resultSize: number;
}

export type JobTask = (ctx: JobTaskContext) => Promise<JobOutput>;

export interface CreateJobInput {
  source: JobSource;
  target: FormatId;
  options?: KindleOptions;
  warnings?: string[];
}

export interface JobStoreOptions {
  maxConcurrent?: number;
  jobTimeoutMs?: number;
  ttlMs?: number;
}

const DEFAULTS = {
  maxConcurrent: config.maxConcurrency,
  jobTimeoutMs: config.convertTimeoutMs,
  ttlMs: config.jobTtlMs,
};

class JobTimeoutError extends Error {
  constructor() {
    super('Conversion timed out.');
    this.name = 'JobTimeoutError';
  }
}

interface QueuedTask {
  task: JobTask;
  onSettled?: () => void;
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof JobTimeoutError;
}

/** Collect the tail of a failure chain — external engine stderr belongs in the job. */
function collectFailureText(
  error: unknown,
  options: { includeMessage: boolean; includeHint: boolean },
  limit: number,
): string | null {
  const seen = new Set<unknown>();
  const parts: string[] = [];
  const textOf = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  const visit = (value: unknown, depth: number, top: boolean): void => {
    if (value == null || depth > 3) return;
    if (typeof value === 'string') {
      const text = textOf(value);
      if (text) parts.push(text);
      return;
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    const candidate = value as {
      message?: unknown;
      stderr?: unknown;
      detail?: unknown;
      cause?: unknown;
      hint?: { zh?: unknown; en?: unknown };
    };
    const stderr = textOf(candidate.stderr);
    if (stderr) parts.push(stderr);
    const detail = textOf(candidate.detail);
    if (detail) parts.push(detail);
    if (options.includeMessage || !top) {
      const message = textOf(candidate.message);
      if (message) parts.push(message);
    }
    if (options.includeHint && candidate.hint) {
      const zh = textOf(candidate.hint.zh);
      if (zh) parts.push(zh);
      const en = textOf(candidate.hint.en);
      if (en) parts.push(en);
    }
    visit(candidate.cause, depth + 1, false);
  };

  visit(error, 0, true);
  const text = [...new Set(parts)].join('\n').trim();
  if (!text) return null;
  const tail = text.slice(-limit);
  return tail.length < text.length ? `…${tail}` : tail;
}

/** Only engine-level extras (stderr/detail/cause), for job.warnings diagnostics. */
export function engineDiagnostics(error: unknown, limit = 800): string | null {
  return collectFailureText(error, { includeMessage: false, includeHint: false }, limit);
}

/**
 * One-line diagnostic for `job.warnings`. Prefers real stderr/cause. Some
 * adapters (calibre) put the stderr tail inside `hint` instead — only surface it
 * when it is substantial, so short bilingual hints stay on `error.hint` alone
 * and the same text is never pasted into both warnings and error.message.
 */
export function engineFailureWarning(error: unknown, limit = 800): string | null {
  const direct = engineDiagnostics(error, limit);
  if (direct) return redactServerPaths(direct);
  if (!error || typeof error !== 'object') return null;
  const hint = (error as { hint?: { zh?: unknown; en?: unknown } }).hint;
  const text = [hint?.zh, hint?.en]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim();
  if (text.length <= 200) return null;
  const tail = text.slice(-500);
  return redactServerPaths(tail.length < text.length ? `…${tail}` : tail);
}

/**
 * Duck-typed mapping. Next dev can load a module twice (separate route
 * compilations / HMR), which breaks `instanceof` across realms — so we key off
 * `name` + `code` instead of the class identity.
 */
function readCodedError(
  error: unknown,
): { code: string; message: string; hint?: BilingualHint } | null {
  if (!error || typeof error !== 'object') return null;
  const candidate = error as { name?: unknown; code?: unknown; message?: unknown; hint?: unknown };
  if (typeof candidate.code !== 'string') return null;
  if (candidate.name !== 'ConversionError' && candidate.name !== 'ApiError') return null;
  const hint = candidate.hint;
  return {
    code: candidate.code,
    message: redactServerPaths(
      typeof candidate.message === 'string' ? candidate.message : 'Conversion failed.',
    ),
    ...(hint && typeof hint === 'object'
      ? { hint: redactHint(hint as BilingualHint) }
      : {}),
  };
}

/**
 * Keep `error.message` short and single-line: engine adapters sometimes embed a
 * whole stderr transcript there. The tail lives in `job.warnings` instead, so
 * the same text is never pasted twice.
 */
function shortMessage(message: string, max = 160): string {
  const firstLine = (message.split(/\r?\n/, 1)[0] ?? '').replace(/\s+/g, ' ').trim();
  const compact = firstLine || message.replace(/\s+/g, ' ').trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max).replace(/\s+\S*$/, '')}…`;
}

export function toJobError(error: unknown): JobError {
  if (isTimeoutError(error)) {
    return {
      code: 'TIMEOUT',
      message: 'Conversion exceeded the 5-minute limit.',
      hint: {
        zh: '转换超过 5 分钟被中止。超大 PDF/漫画建议先拆分，或改用更简单的目标格式。',
        en: 'Conversions are capped at 5 minutes. Split very large PDFs/comics or pick a lighter target.',
      },
    };
  }
  const coded = readCodedError(error) ?? (error instanceof ConversionError || error instanceof ApiError
    ? {
        code: error.code,
        message: error.message,
        ...(error.hint ? { hint: error.hint } : {}),
      }
    : null);
  // Keep the coded message concise: engine stderr goes to job.warnings via
  // `engineFailureWarning` at the route, never duplicated into error.message.
  if (coded) return { ...coded, message: shortMessage(coded.message) };

  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[job] failed (${name})`);
  return {
    code: 'INTERNAL',
    message: 'Conversion failed.',
    hint: {
      zh: '转换过程中出现内部错误。请重试；若持续失败请换一种源格式。',
      en: 'An internal error interrupted the conversion. Retry, or try a different source format.',
    },
  };
}

export class JobStore {
  readonly maxConcurrent: number;
  readonly jobTimeoutMs: number;
  readonly ttlMs: number;

  private readonly jobs = new Map<string, Job>();
  private readonly tasks = new Map<string, QueuedTask>();
  private readonly queue: string[] = [];
  private readonly running = new Set<string>();
  private disposed = false;

  constructor(options: JobStoreOptions = {}) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULTS.maxConcurrent);
    this.jobTimeoutMs = Math.max(1, options.jobTimeoutMs ?? DEFAULTS.jobTimeoutMs);
    this.ttlMs = Math.max(1, options.ttlMs ?? DEFAULTS.ttlMs);
  }

  create(input: CreateJobInput): Job {
    const now = Date.now();
    const job: Job = {
      id: randomUUID(),
      status: 'queued',
      progress: 0,
      createdAt: now,
      updatedAt: now,
      warnings: input.warnings ? [...input.warnings] : [],
      source: input.source,
      target: input.target,
      ...(input.options ? { options: input.options } : {}),
    };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  update(id: string, patch: Partial<Omit<Job, 'id' | 'createdAt'>>): Job | undefined {
    const current = this.jobs.get(id);
    if (!current) return undefined;
    const next: Job = { ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: Date.now() };
    this.jobs.set(id, next);
    return next;
  }

  /** Remove a job and its files. Safe when the job is already gone. */
  async remove(id: string): Promise<boolean> {
    const existed = this.jobs.delete(id);
    this.tasks.delete(id);
    this.running.delete(id);
    const index = this.queue.indexOf(id);
    if (index >= 0) this.queue.splice(index, 1);
    await deleteJobDir(id);
    return existed;
  }

  enqueue(id: string, task: JobTask, onSettled?: () => void): void {
    if (this.disposed) throw new Error('JobStore disposed');
    this.tasks.set(id, { task, onSettled });
    this.queue.push(id);
    this.startQueued();
  }

  /** Public queue snapshot (used by tests and diagnostics). */
  queueState(): { queued: string[]; running: string[] } {
    return { queued: [...this.queue], running: [...this.running] };
  }

  private startQueued(): void {
    while (this.running.size < this.maxConcurrent && this.queue.length > 0) {
      const id = this.queue.shift();
      if (!id) break;
      const entry = this.tasks.get(id);
      if (!entry || !this.jobs.has(id)) {
        this.tasks.delete(id);
        continue;
      }
      this.running.add(id);
      void this.execute(id, entry);
    }
  }

  private async execute(id: string, entry: QueuedTask): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) {
      this.tasks.delete(id);
      this.running.delete(id);
      return;
    }
    this.update(id, { status: 'running', progress: Math.max(5, job.progress) });

    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new JobTimeoutError()), this.jobTimeoutMs);
        timer.unref?.();
      });
      const result = await Promise.race([
        entry.task({
          jobId: id,
          update: (patch) => {
            this.update(id, patch);
          },
        }),
        timeout,
      ]);
      this.update(id, {
        status: 'done',
        progress: 100,
        engine: result.engine,
        warnings: result.warnings,
        durationMs: result.durationMs,
        resultPath: result.resultPath,
        resultName: result.resultName,
        resultMime: result.resultMime,
        resultSize: result.resultSize,
      });
    } catch (error) {
      const mapped = toJobError(error);
      // Never echo the user's filename, even if a lower layer put it in a message.
      const message = job.source.name ? mapped.message.split(job.source.name).join('<file>') : mapped.message;
      this.update(id, { status: 'error', error: { ...mapped, message } });
    } finally {
      if (timer) clearTimeout(timer);
      this.running.delete(id);
      this.tasks.delete(id);
      try {
        entry.onSettled?.();
      } catch {
        /* rate-limit release must never break the worker */
      }
      this.startQueued();
    }
  }

  /**
   * Reclaim finished jobs past their TTL and fail jobs stuck in the queue.
   * Called every 60s in production; tests call it directly.
   */
  async sweep(now = Date.now()): Promise<{ removed: number; timedOut: number }> {
    let removed = 0;
    let timedOut = 0;
    for (const job of [...this.jobs.values()]) {
      const terminal = job.status === 'done' || job.status === 'error';
      if (terminal) {
        if (now - job.updatedAt > this.ttlMs) {
          await this.remove(job.id);
          removed += 1;
        }
        continue;
      }
      // A queued job that never got a worker slot (e.g. hung workers) is failed
      // after two timeout windows instead of waiting forever.
      if (!this.running.has(job.id) && now - job.createdAt > this.jobTimeoutMs * 2) {
        this.update(job.id, {
          status: 'error',
          error: toJobError(new JobTimeoutError()),
        });
        timedOut += 1;
      }
    }
    return { removed, timedOut };
  }

  /** Stop accepting work and clear the in-memory map (files are left to storage cleanup). */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    this.tasks.clear();
    this.jobs.clear();
  }
}

/* ------------------------------------------------------------------ */
/* Process-wide singleton                                              */
/* ------------------------------------------------------------------ */

interface GlobalState {
  store?: JobStore;
  sweepTimer?: ReturnType<typeof setInterval>;
  shutdownHooks?: boolean;
}

interface JobGlobal {
  __kindleforgeJobStore?: JobStore;
  __kindleforgeJobStoreVersion?: number;
  __kindleforgeSweepTimer?: ReturnType<typeof setInterval>;
  __kindleforgeShutdownHooks?: boolean;
  __kindleforgeBootSweepStarted?: boolean;
}

/**
 * Bump when the in-memory store's behaviour changes in a way that matters for
 * jobs created by an older module instance. A running `next dev` replaces the
 * store exactly once per bump (in-flight dev jobs are abandoned); ordinary HMR
 * keeps the store, so a conversion never vanishes because another file changed.
 */
const STORE_VERSION = 3;

function jobGlobal(): JobGlobal {
  return globalThis as unknown as JobGlobal;
}

function registerShutdownHooks(): void {
  const g = jobGlobal();
  if (g.__kindleforgeShutdownHooks) return;
  g.__kindleforgeShutdownHooks = true;

  const shutdown = (signal: NodeJS.Signals) => {
    try {
      deleteTmpRootSync();
    } finally {
      // Next dev installs its own handlers; ours must still terminate cleanly.
      process.exit(signal === 'SIGTERM' ? 143 : 130);
    }
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  // Deliberately no normal-`exit` root wipe: the temp root is shared by a dev
  // server and short-lived CLI/smoke processes, so a helper process exiting
  // must not delete another process's in-flight jobs. Crash leftovers are
  // handled by the 24h boot sweep instead.
}

const VITEST = Boolean(process.env.VITEST);

/** The server-wide store. Registers the 60s sweep interval exactly once. */
export function getJobStore(): JobStore {
  const g = jobGlobal();
  // Next dev HMR can keep an instance of an older JobStore class alive on
  // globalThis. Only a deliberate STORE_VERSION bump replaces it — doing this on
  // every HMR would drop jobs whenever an unrelated file changed.
  if (g.__kindleforgeJobStore && g.__kindleforgeJobStoreVersion !== STORE_VERSION) {
    g.__kindleforgeJobStore.dispose();
    g.__kindleforgeJobStore = undefined;
  }
  if (!g.__kindleforgeJobStore) {
    g.__kindleforgeJobStore = new JobStore();
    g.__kindleforgeJobStoreVersion = STORE_VERSION;
  }
  const store = g.__kindleforgeJobStore;
  if (!VITEST && !g.__kindleforgeBootSweepStarted) {
    g.__kindleforgeBootSweepStarted = true;
    // Reclaim directories a previous hard crash left behind before new work.
    void sweepOrphanJobDirs(config.orphanMaxAgeMs)
      .then((result) => {
        if (result.removed.length > 0) {
          console.info(`[storage] boot sweep removed ${result.removed.length} orphan job dir(s)`);
        }
      })
      .catch(() => undefined);
  }
  if (!g.__kindleforgeSweepTimer && !VITEST) {
    g.__kindleforgeSweepTimer = setInterval(() => {
      void store.sweep().catch(() => undefined);
    }, 60_000);
    g.__kindleforgeSweepTimer.unref?.();
    registerShutdownHooks();
  }
  return store;
}

/** Test helper: drop the singleton so the next getJobStore() starts clean. */
export function resetJobStoreForTests(): void {
  const g = jobGlobal();
  g.__kindleforgeJobStore?.dispose();
  if (g.__kindleforgeSweepTimer) {
    clearInterval(g.__kindleforgeSweepTimer);
    g.__kindleforgeSweepTimer = undefined;
  }
  g.__kindleforgeJobStore = new JobStore();
}

/* ------------------------------------------------------------------ */
/* API serialisation (no source filename, no disk paths)               */
/* ------------------------------------------------------------------ */

export interface PublicJobResult {
  filename: string;
  size: number;
  mime: string;
  downloadUrl: string;
}

export interface PublicJob {
  id: string;
  status: JobStatus;
  progress: number;
  target: FormatId;
  engine: string | null;
  warnings: string[];
  durationMs: number | null;
  error: JobError | null;
  source: { format: FormatId; size: number };
  result: PublicJobResult | null;
  createdAt: string;
  updatedAt: string;
}

export function publicJob(job: Job): PublicJob {
  const result: PublicJobResult | null =
    job.status === 'done' && job.resultName && job.resultMime
      ? {
          filename: job.resultName,
          size: job.resultSize ?? 0,
          mime: job.resultMime,
          downloadUrl: `/api/jobs/${job.id}/download`,
        }
      : null;
  return {
    id: job.id,
    status: job.status,
    progress: Math.max(0, Math.min(100, Math.round(job.progress))),
    target: job.target,
    engine: job.engine ?? null,
    warnings: job.warnings,
    durationMs: job.durationMs ?? null,
    error: job.error ?? null,
    source: { format: job.source.format, size: job.source.size },
    result,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
  };
}
