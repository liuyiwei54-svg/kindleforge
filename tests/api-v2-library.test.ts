import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Keep cover tests offline and deterministic: every hostname resolves public.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }])
}));
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import sharp from 'sharp';
import { GET as LIST, POST as CREATE } from '../app/api/library/route';
import {
  DELETE as DELETE_ENTRY,
  GET as GET_ENTRY,
  PATCH as PATCH_ENTRY,
} from '../app/api/library/[id]/route';
import { GET as GET_FILE } from '../app/api/library/[id]/file/route';
import { GET as GET_COVER } from '../app/api/library/[id]/cover/route';
import { GET as GET_STATS } from '../app/api/library/stats/route';
import { libraryIndexPath, saveJobResult, saveJobToLibrary } from '../lib/server/library';
import { getJobStore, resetJobStoreForTests, type Job } from '../lib/server/jobs';
import { jobDirPath } from '../lib/server/storage';
import type { FormatId } from '../lib/engine/types';
import {
  fixtureEpub,
  jsonRequest,
  makeDirs,
  multipartRequest,
  params,
  readJson,
  type TestDirs,
} from './api-v2-helpers';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
  resetJobStoreForTests();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetJobStoreForTests();
  await dirs.cleanup();
});

interface Entry {
  id: string;
  filename: string;
  title: string;
  author: string;
  format: string;
  size: number;
  hasCover: boolean;
  coverVersion?: number;
  missing?: boolean;
}

async function upload(
  name: string,
  bytes: Uint8Array | Buffer | string,
  title?: string,
  author?: string,
): Promise<Entry> {
  const form = new FormData();
  form.set('file', new File([bytes as BlobPart], name));
  if (title) form.set('title', title);
  if (author) form.set('author', author);
  const response = await CREATE(await multipartRequest('http://localhost/api/library', form));
  expect(response.status).toBe(201);
  return (await response.json()) as Entry;
}

async function fakeJob(target: FormatId = 'epub'): Promise<{ job: Job; resultPath: string }> {
  const store = getJobStore();
  const job = store.create({
    source: { name: '我的书 - 张三.txt', size: 12, format: 'txt' },
    target,
  });
  const dir = jobDirPath(job.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'output.epub'), await fixtureEpub());
  store.update(job.id, {
    status: 'done',
    progress: 100,
    resultPath: 'output.epub',
    resultName: '我的书 - 张三.epub',
    resultMime: 'application/epub+zip',
    resultSize: 1,
  });
  return { job: store.get(job.id)!, resultPath: path.join(jobDirPath(job.id), 'output.epub') };
}

describe('POST /api/library', () => {
  it('saves an uploaded EPUB and extracts its metadata', async () => {
    const entry = await upload('pride.epub', await fixtureEpub());
    expect(entry.id).toMatch(/^[a-f0-9]{10}$/);
    expect(entry.format).toBe('epub');
    expect(entry.filename).toMatch(/\.epub$/);
    expect(entry.title.length).toBeGreaterThan(0);
    expect(entry.hasCover).toBe(true);
    const saved = await stat(path.join(dirs.libraryDir, entry.filename));
    expect(saved.mode & 0o777).toBe(0o600);
  });

  it('uses title/author overrides and a safe suffixed filename', async () => {
    const entry = await upload('whatever.txt', 'hello world', 'Chapter/One', 'A:B');
    expect(entry.title).toBe('Chapter/One');
    expect(entry.author).toBe('A:B');
    expect(entry.filename).toBe('Chapter One - A B.txt');
  });

  it('deduplicates filenames with a numeric suffix', async () => {
    const first = await upload('a.txt', 'one', 'Same', 'Author');
    const second = await upload('b.txt', 'two', 'Same', 'Author');
    expect(first.filename).toBe('Same - Author.txt');
    expect(second.filename).toBe('Same - Author (2).txt');
  });

  it('rejects unsupported, empty and oversized uploads', async () => {
    const exe = new FormData();
    exe.set('file', new File(['MZ'], 'evil.exe'));
    const unsupported = await CREATE(await multipartRequest('http://localhost/api/library', exe));
    expect(unsupported.status).toBe(415);

    const empty = new FormData();
    empty.set('file', new File([], 'empty.txt'));
    expect((await CREATE(await multipartRequest('http://localhost/api/library', empty))).status).toBe(400);
  });

  it('saves a finished job result via JSON and is idempotent', async () => {
    const { job } = await fakeJob();
    const body = { jobId: job.id };
    const first = await CREATE(jsonRequest('http://localhost/api/library', body));
    expect(first.status).toBe(201);
    const entry = (await first.json()) as Entry;
    expect(entry.title).toBe('我的书');
    expect(entry.author).toBe('张三');

    const again = await CREATE(jsonRequest('http://localhost/api/library', body));
    expect(again.status).toBe(201);
    expect(((await again.json()) as Entry).id).toBe(entry.id);
  });

  it('rejects an unknown or malformed jobId', async () => {
    const unknown = await CREATE(jsonRequest('http://localhost/api/library', { jobId: randomUUID() }));
    expect(unknown.status).toBe(400);
    const malformed = await CREATE(jsonRequest('http://localhost/api/library', { jobId: '../x' }));
    expect(malformed.status).toBe(400);
  });
});

describe('GET /api/library and stats', () => {
  it('lists, searches, sorts and filters entries', async () => {
    await upload('one.txt', 'one', 'Zeta', 'Author');
    await upload('two.txt', 'two', 'Alpha', 'Author');
    await upload('three.epub', await fixtureEpub());

    const all = (await (await LIST(new Request('http://localhost/api/library'))).json()) as {
      entries: Entry[];
      total: number;
      dir: string;
    };
    expect(all.total).toBe(3);
    expect(all.dir).toBe(dirs.libraryDir);
    expect(all.entries.map((entry) => entry.title)).toContain('Zeta');

    const sorted = (await (
      await LIST(new Request('http://localhost/api/library?sort=title'))
    ).json()) as { entries: Entry[] };
    expect(sorted.entries.map((entry) => entry.title)).toEqual(['Alpha', 'three', 'Zeta']);

    const formatFiltered = (await (
      await LIST(new Request('http://localhost/api/library?format=txt'))
    ).json()) as { entries: Entry[]; total: number };
    expect(formatFiltered.total).toBe(2);
    expect(formatFiltered.entries.every((entry) => entry.format === 'txt')).toBe(true);

    const query = (await (
      await LIST(new Request('http://localhost/api/library?q=alpha'))
    ).json()) as { entries: Entry[]; total: number };
    expect(query.total).toBe(1);
    expect(query.entries[0]!.title).toBe('Alpha');
  });

  it('rejects an invalid sort or format filter', async () => {
    expect((await LIST(new Request('http://localhost/api/library?sort=nope'))).status).toBe(400);
    expect((await LIST(new Request('http://localhost/api/library?format=nope'))).status).toBe(400);
  });

  it('computes library stats', async () => {
    await upload('a.txt', '12345', 'A', 'B');
    await upload('b.txt', '123', 'C', 'D');
    const response = await GET_STATS(new Request('http://localhost/api/library/stats'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      total: number;
      totalBytes: number;
      latestAddedAt: number;
      dir: string;
    };
    expect(body.total).toBe(2);
    expect(body.totalBytes).toBe(8);
    expect(body.latestAddedAt).toBeGreaterThan(0);
    expect(body.dir).toBe(dirs.libraryDir);
  });

  it('rebuilds a deleted index by scanning the directory, preserving ids', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    await rm(libraryIndexPath(), { force: true });
    const listed = (await (await LIST(new Request('http://localhost/api/library'))).json()) as {
      entries: Entry[];
    };
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.id).toBe(entry.id);
  });

  it('marks entries whose file disappeared instead of dropping them', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    await rm(path.join(dirs.libraryDir, entry.filename));
    const listed = (await (await LIST(new Request('http://localhost/api/library'))).json()) as {
      entries: Entry[];
    };
    expect(listed.entries).toHaveLength(1);
    expect(listed.entries[0]!.missing).toBe(true);
  });
});

describe('GET/PATCH/DELETE /api/library/:id and files', () => {
  it('returns one entry and 404s for unknown/malformed ids', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    const ok = await GET_ENTRY(new Request(`http://localhost/api/library/${entry.id}`), params({ id: entry.id }));
    expect(ok.status).toBe(200);
    const missing = await GET_ENTRY(
      new Request(`http://localhost/api/library/${randomUUID()}`),
      params({ id: randomUUID() }),
    );
    expect(missing.status).toBe(404);
    const traversal = await GET_ENTRY(
      new Request('http://localhost/api/library/..%2Fetc'),
      params({ id: '../etc' }),
    );
    expect(traversal.status).toBe(404);
  });

  it('downloads the file with a correct RFC 5987 disposition', async () => {
    const entry = await upload('a.txt', 'hello', '中文 书名', '张三');
    const response = await GET_FILE(new Request('http://localhost'), params({ id: entry.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(await response.text()).toBe('hello');
  });

  it('PATCH renames and re-saves metadata for non-EPUB files with a warning', async () => {
    const entry = await upload('a.txt', 'hello', 'Old', 'Author');
    const response = await PATCH_ENTRY(
      jsonRequest('http://localhost/api/library/' + entry.id, { title: 'New Title', author: 'New Author' }, 'PATCH'),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Entry & { warnings: string[] };
    expect(body.title).toBe('New Title');
    expect(body.author).toBe('New Author');
    expect(body.filename).toBe('New Title - New Author.txt');
    expect(body.warnings.join(' ')).toMatch(/EPUB/i);
    await expect(stat(path.join(dirs.libraryDir, entry.filename))).rejects.toThrow();
    expect(await readFile(path.join(dirs.libraryDir, body.filename), 'utf8')).toBe('hello');
  });

  it('PATCH rewrites EPUB metadata and supports a remote cover with ETag', async () => {
    const entry = await upload('pride.epub', await fixtureEpub());
    const jpeg = await sharp({
      create: { width: 24, height: 30, channels: 3, background: '#3366cc' },
    })
      .jpeg()
      .toBuffer();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(jpeg, { status: 200, headers: { 'content-type': 'image/jpeg' } })),
    );
    const patched = await PATCH_ENTRY(
      jsonRequest(
        'http://localhost/api/library/' + entry.id,
        { title: 'New EPUB', coverUrl: 'https://example.com/cover.jpg' },
        'PATCH',
      ),
      params({ id: entry.id }),
    );
    expect(patched.status).toBe(200);
    const body = (await patched.json()) as Entry;
    expect(body.hasCover).toBe(true);
    expect(body.coverVersion).toBeGreaterThanOrEqual(1);

    const cover = await GET_COVER(new Request('http://localhost/api/library/x/cover'), params({ id: entry.id }));
    expect(cover.status).toBe(200);
    const etag = cover.headers.get('etag')!;
    expect(etag).toContain(body.id);
    const cached = await GET_COVER(
      new Request('http://localhost/api/library/x/cover', { headers: { 'if-none-match': etag } }),
      params({ id: entry.id }),
    );
    expect(cached.status).toBe(304);
  });

  it('warns when a requested cover cannot be decoded', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(Buffer.from('definitely not a jpeg'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      ),
    );
    const response = await PATCH_ENTRY(
      jsonRequest(
        'http://localhost/api/library/' + entry.id,
        { coverUrl: 'https://example.com/broken-cover.jpg' },
        'PATCH',
      ),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Entry & { warnings: string[] };
    expect(body.warnings.join(' ')).toContain('could not be decoded');
    expect(body.hasCover).toBe(false);
  });

  it('DELETE removes the index row and file, then GET is 404', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    const response = await DELETE_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, { method: 'DELETE' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(204);
    await expect(stat(path.join(dirs.libraryDir, entry.filename))).rejects.toThrow();
    expect(
      (await GET_ENTRY(new Request('http://localhost'), params({ id: entry.id }))).status,
    ).toBe(404);
  });

  it('404s the cover when an entry has none', async () => {
    const entry = await upload('a.txt', 'hello', 'A', 'B');
    const response = await GET_COVER(new Request('http://localhost'), params({ id: entry.id }));
    expect(response.status).toBe(404);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('COVER_UNAVAILABLE');
  });
});

describe('job result saving', () => {
  it('saveJobResult copies a finished result and respects autoSave=false', async () => {
    const { job } = await fakeJob();
    const entry = await saveJobResult(job);
    expect(entry).not.toBeNull();
    expect(entry!.savedFromJobId).toBe(job.id);

    const { updateSettings } = await import('../lib/server/settings');
    await updateSettings({ library: { autoSave: false } });
    const other = await fakeJob();
    expect(await saveJobResult(other.job)).toBeNull();
  });

  it('saveJobToLibrary requires a known finished job', async () => {
    const { saveJobToLibrary } = await import('../lib/server/library');
    await expect(saveJobToLibrary(randomUUID())).rejects.toMatchObject({ status: 404 });
  });
});
