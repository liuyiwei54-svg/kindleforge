import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  JobStore,
  engineFailureWarning,
  publicJob,
  toJobError,
  type JobOutput,
  type JobStatus,
} from '../lib/server/jobs';
import { TMP_ROOT, writeJobFile } from '../lib/server/storage';

function output(overrides: Partial<JobOutput> = {}): JobOutput {
  return {
    engine: 'builtin',
    warnings: [],
    durationMs: 3,
    resultPath: 'output.epub',
    resultName: 'out.epub',
    resultMime: 'application/epub+zip',
    resultSize: 3,
    ...overrides,
  };
}

function makeJob(store: JobStore) {
  return store.create({
    source: { name: '测试 书.txt', size: 10, format: 'txt' },
    target: 'epub',
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
  intervalMs = 5,
): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function statusOf(store: JobStore, id: string): JobStatus | undefined {
  return store.get(id)?.status;
}

describe('JobStore queue', () => {
  it('runs at most maxConcurrent jobs, in FIFO order', async () => {
    const store = new JobStore({ maxConcurrent: 1, jobTimeoutMs: 5_000, ttlMs: 60_000 });
    const started: string[] = [];
    let active = 0;
    let peak = 0;

    const ids = [makeJob(store).id, makeJob(store).id, makeJob(store).id];
    for (const id of ids) {
      store.enqueue(id, async () => {
        started.push(id);
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 15));
        active -= 1;
        return output();
      });
    }

    expect(store.queueState().running).toHaveLength(1);
    expect(store.queueState().queued).toHaveLength(2);

    await waitFor(() => ids.every((id) => statusOf(store, id) === 'done'));
    expect(started).toEqual(ids);
    expect(peak).toBe(1);
    for (const id of ids) {
      expect(store.get(id)?.progress).toBe(100);
      expect(store.get(id)?.resultName).toBe('out.epub');
    }
    store.dispose();
  }, 15_000);

  it('runs two jobs concurrently when maxConcurrent is 2', async () => {
    const store = new JobStore({ maxConcurrent: 2, jobTimeoutMs: 5_000, ttlMs: 60_000 });
    let active = 0;
    let peak = 0;
    const ids = [makeJob(store).id, makeJob(store).id, makeJob(store).id];

    for (const id of ids) {
      store.enqueue(id, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
        return output();
      });
    }

    await waitFor(() => ids.every((id) => statusOf(store, id) === 'done'));
    expect(peak).toBe(2);
    store.dispose();
  }, 15_000);

  it('times out a hung task after jobTimeoutMs and frees the slot', async () => {
    const store = new JobStore({ maxConcurrent: 2, jobTimeoutMs: 40, ttlMs: 60_000 });
    const hung = makeJob(store);
    const next = makeJob(store);

    store.enqueue(hung.id, () => new Promise<JobOutput>(() => undefined));
    store.enqueue(next.id, async () => output());

    await waitFor(() => statusOf(store, hung.id) === 'error');
    const job = store.get(hung.id);
    expect(job?.error?.code).toBe('TIMEOUT');
    expect(job?.error?.hint?.zh).toBeTruthy();
    await waitFor(() => statusOf(store, next.id) === 'done');
    store.dispose();
  }, 15_000);

  it('reclaims finished jobs after the TTL, including their temp files', async () => {
    const store = new JobStore({ maxConcurrent: 2, jobTimeoutMs: 5_000, ttlMs: 20 });
    const job = makeJob(store);
    store.enqueue(job.id, async () => output());
    await waitFor(() => statusOf(store, job.id) === 'done');

    await writeJobFile(job.id, 'output.epub', new Uint8Array([1, 2, 3]));
    const dir = join(TMP_ROOT, job.id);
    expect(existsSync(dir)).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 35));
    const result = await store.sweep();
    expect(result.removed).toBe(1);
    expect(store.get(job.id)).toBeUndefined();
    expect(existsSync(dir)).toBe(false);
    store.dispose();
  }, 15_000);

  it('remove() deletes the record and the temp directory immediately', async () => {
    const store = new JobStore({ maxConcurrent: 2, jobTimeoutMs: 5_000, ttlMs: 60_000 });
    const job = makeJob(store);
    store.enqueue(job.id, async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return output();
    });
    await writeJobFile(job.id, 'output.epub', new Uint8Array([1]));
    await store.remove(job.id);
    expect(store.get(job.id)).toBeUndefined();
    expect(existsSync(join(TMP_ROOT, job.id))).toBe(false);
    store.dispose();
  }, 15_000);
});

describe('toJobError', () => {
  it('maps coded engine errors across module realms (duck-typed)', () => {
    const engineMissing = Object.assign(new Error('no engine'), {
      name: 'ConversionError',
      code: 'ENGINE_MISSING',
      hint: { zh: '缺少引擎', en: 'engine missing' },
    });
    expect(toJobError(engineMissing)).toEqual({
      code: 'ENGINE_MISSING',
      message: 'no engine',
      hint: { zh: '缺少引擎', en: 'engine missing' },
    });

    const drm = Object.assign(new Error('drm'), { name: 'ApiError', code: 'DRM' });
    expect(toJobError(drm).code).toBe('DRM');

    expect(toJobError(new Error('boom')).code).toBe('INTERNAL');
    expect(toJobError('nope').code).toBe('INTERNAL');
  });

  it('redacts absolute temp paths from message, hint and warnings', () => {
    const leak =
      'could not read file:///var/folders/ab/cd/T/kindleforge/8c0f0e1a-1111-4222-8333-444455556666/input.epub (also /var/folders/ab/cd/T/kindleforge-calibre-x/input.epub)';
    const failure = Object.assign(new Error(leak), {
      name: 'ConversionError',
      code: 'INTERNAL',
      stderr: leak,
      hint: { zh: leak, en: leak },
    });
    const mapped = toJobError(failure);
    expect(mapped.message).not.toMatch(/\/var\/folders|file:\/\//);
    expect(mapped.hint?.zh).not.toMatch(/\/var\/folders|file:\/\//);
    expect(engineFailureWarning(failure)).not.toMatch(/\/var\/folders|file:\/\//);
    expect(mapped.message).toContain('<job>');
  });

  it('keeps error.message short and exposes engine stderr only via warnings', () => {
    const cause = new Error('ebook-convert: error: no such option: --bogus');
    const failure = Object.assign(new Error('Calibre exited 2'), {
      name: 'ConversionError',
      code: 'INTERNAL',
      cause,
    });
    const mapped = toJobError(failure);
    expect(mapped.message).toBe('Calibre exited 2'); // no duplicated stderr
    const warning = engineFailureWarning(failure);
    // Detail must survive in structured warnings, whatever the exact wording.
    expect(warning).toMatch(/no such option|--bogus/);

    const stderrOnly = Object.assign(new Error('engine failed'), {
      name: 'ConversionError',
      code: 'INTERNAL',
      stderr: 'x'.repeat(900) + 'TAIL-MARKER',
    });
    expect(toJobError(stderrOnly).message).toBe('engine failed');
    expect(engineFailureWarning(stderrOnly)).toContain('TAIL-MARKER');

    // Multi-line engine transcripts are compressed to a short single line.
    const multiline = Object.assign(
      new Error('Calibre 退出码 1: boom\n  File "site.py", line 42, in <module>\n  more detail'),
      { name: 'ConversionError', code: 'INTERNAL' },
    );
    const compact = toJobError(multiline);
    expect(compact.message).toBe('Calibre 退出码 1: boom');
    expect(compact.message.length).toBeLessThan(200);

    // Calibre adapters put stderr inside hint: surface substantial tails only.
    const hintOnly = Object.assign(new Error('engine failed'), {
      name: 'ConversionError',
      code: 'INTERNAL',
      hint: { zh: `${'详情'.repeat(200)} HINT-TAIL`, en: 'engine failed' },
    });
    expect(engineFailureWarning(hintOnly)).toContain('HINT-TAIL');

    const shortHint = Object.assign(new Error('broken file'), {
      name: 'ConversionError',
      code: 'INVALID_FILE',
      hint: { zh: '文件损坏', en: 'broken file' },
    });
    expect(engineFailureWarning(shortHint)).toBeNull();
  });
});

describe('publicJob serialisation', () => {
  it('never leaks the source filename or any disk path', async () => {
    const store = new JobStore({ maxConcurrent: 1, jobTimeoutMs: 5_000, ttlMs: 60_000 });
    const job = store.create({
      source: { name: '机密 书名.docx', size: 42, format: 'docx' },
      target: 'epub',
      warnings: ['SERVER_NOTE'],
    });
    store.update(job.id, {
      status: 'done',
      progress: 100,
      engine: 'builtin',
      resultPath: 'output.epub',
      resultName: '机密 书名.epub',
      resultMime: 'application/epub+zip',
      resultSize: 99,
      durationMs: 12,
    });

    const view = publicJob(store.get(job.id)!);
    const serialised = JSON.stringify(view);
    expect(serialised).not.toContain('机密 书名.docx');
    expect(serialised).not.toContain(TMP_ROOT);
    expect(view.source).toEqual({ format: 'docx', size: 42 });
    expect(view.result).toEqual({
      filename: '机密 书名.epub',
      size: 99,
      mime: 'application/epub+zip',
      downloadUrl: `/api/jobs/${job.id}/download`,
    });
    expect(view.warnings).toEqual(['SERVER_NOTE']);
    store.dispose();
  });
});
