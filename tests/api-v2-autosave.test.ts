import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { POST as CONVERT } from '../app/api/convert/route';
import { GET as GET_JOB } from '../app/api/jobs/[id]/route';
import { GET as LIST, POST as CREATE } from '../app/api/library/route';
import { updateSettings } from '../lib/server/settings';
import type { Job } from '../lib/server/jobs';
import type { LibraryEntry, LibraryList } from '../lib/shared/types';
import {
  jsonRequest,
  makeDirs,
  multipartRequest,
  params,
  type TestDirs,
} from './api-v2-helpers';

let dirs: TestDirs;
const previousAutoSaveEnv = process.env.KF_AUTOSAVE_IN_TESTS;

beforeAll(() => {
  process.env.KF_AUTOSAVE_IN_TESTS = '1';
});

afterAll(() => {
  if (previousAutoSaveEnv === undefined) delete process.env.KF_AUTOSAVE_IN_TESTS;
  else process.env.KF_AUTOSAVE_IN_TESTS = previousAutoSaveEnv;
});

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  await dirs.cleanup();
});

async function convert(name: string, target = 'epub'): Promise<string> {
  const form = new FormData();
  form.set('file', new File([`第一章\n这是 ${name} 的正文。\n`], name));
  form.set('target', target);
  form.set('options', '{}');
  const response = await CONVERT(await multipartRequest('http://localhost/api/convert', form));
  expect(response.status).toBe(202);
  return ((await response.json()) as { jobId: string }).jobId;
}

async function waitForJob(jobId: string): Promise<Job> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const response = await GET_JOB(new Request(`http://localhost/api/jobs/${jobId}`), params({ id: jobId }));
    expect(response.status).toBe(200);
    const job = (await response.json()) as Job;
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not finish: ${job.status}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 40));
  }
}

describe('auto-save on conversion completion', () => {
  it('saves a real TXT → EPUB job into the temp library before reporting done', async () => {
    const jobId = await convert('我的书 - 张三.txt');
    const job = await waitForJob(jobId);
    expect(job.status).toBe('done');
    expect(job.warnings ?? []).not.toContainEqual(expect.stringContaining('Auto-save to library failed'));

    const listResponse = await LIST(new Request('http://localhost/api/library'));
    expect(listResponse.status).toBe(200);
    const list = (await listResponse.json()) as LibraryList;
    expect(list.total).toBe(1);
    const entry = list.entries[0]!;
    expect(entry.filename).toBe('我的书 - 张三.epub');
    expect(entry.title).toBe('我的书');
    expect(entry.author).toBe('张三');
    expect(entry.format).toBe('epub');
    expect(entry.savedFromJobId).toBe(jobId);
    expect(entry.sourceName).toBe('我的书 - 张三.txt');
    expect(entry.sourceFormat).toBe('txt');

    const absolute = path.join(list.dir, entry.filename);
    const info = await stat(absolute);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(entry.size);
  });

  it('supports the manual JSON {jobId} path and is idempotent', async () => {
    await updateSettings({ library: { autoSave: false } });
    const jobId = await convert('JSON 保存 - 李四.txt');
    const job = await waitForJob(jobId);
    expect(job.status).toBe('done');

    const before = (await (
      await LIST(new Request('http://localhost/api/library'))
    ).json()) as LibraryList;
    expect(before.total).toBe(0);

    const save = () =>
      CREATE(
        jsonRequest('http://localhost/api/library', { jobId }, 'POST'),
      );
    const first = await save();
    expect(first.status).toBe(201);
    const entry = (await first.json()) as LibraryEntry;
    expect(entry.savedFromJobId).toBe(jobId);
    expect(entry.format).toBe('epub');
    expect(entry.filename).toBe('JSON 保存 - 李四.epub');

    const second = await save();
    expect(second.status).toBe(201);
    expect(((await second.json()) as LibraryEntry).id).toBe(entry.id);
  });
});
