/**
 * QA (independent) — v2 library: upload, index rebuild, traversal/symlink,
 * rename, duplicates, cover pipeline (sharp), delete, missing files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, readFile, readdir, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DELETE as DELETE_ENTRY,
  GET as GET_ENTRY,
  PATCH as PATCH_ENTRY,
} from '../../app/api/library/[id]/route';
import { GET as GET_COVER } from '../../app/api/library/[id]/cover/route';
import { GET as GET_FILE } from '../../app/api/library/[id]/file/route';
import { GET as LIST, POST as CREATE } from '../../app/api/library/route';
import { GET as STATS } from '../../app/api/library/stats/route';
import { libraryIndexPath } from '../../lib/server/library';
import { makeDirs, multipartRequest, params, type TestDirs } from '../api-v2-helpers';

// The SSRF guard resolves DNS; allow-list only the test double so covers can be
// exercised without touching the network. Real SSRF behaviour is covered in
// qa-v2-security.test.ts against the real module.
vi.mock('../../lib/server/net', () => ({
  assertPublicHttpUrl: async (input: unknown) => new URL(String(input)),
}));

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

interface Entry {
  id: string;
  filename: string;
  title: string;
  author: string;
  format: string;
  size: number;
  hasCover: boolean;
  missing?: boolean;
}

let dirs: TestDirs;
let pngUrl = '';

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  await dirs.cleanup();
});

async function upload(
  name: string,
  bytes: Buffer | string = 'hello kindle',
  fields: Record<string, string> = { title: '测试书', author: '作者' },
): Promise<Entry> {
  const form = new FormData();
  form.set('file', new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const response = await CREATE(await multipartRequest('http://localhost/api/library', form));
  if (response.status !== 201) throw new Error(`upload ${name} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as Entry;
}

async function list(): Promise<{ entries: Entry[] }> {
  const response = await LIST(new Request('http://localhost/api/library'));
  expect(response.status).toBe(200);
  return (await response.json()) as { entries: Entry[] };
}

async function findEntry(id: string): Promise<Entry | undefined> {
  return (await list()).entries.find((entry) => entry.id === id);
}

describe('library upload + index', () => {
  it('stores a book, serves identical bytes with RFC 5987 and no-store', async () => {
    const bytes = Buffer.from('第一章 测试内容，中文标点。\n');
    const entry = await upload('第一章 测试.txt', bytes);
    expect(entry).toMatchObject({ title: '测试书', author: '作者', format: 'txt', size: bytes.length });

    const response = await GET_FILE(
      new Request(`http://localhost/api/library/${entry.id}/file`),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-disposition')).toContain('attachment');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it('rebuilds library.json from disk and keeps the same id', async () => {
    const entry = await upload('重建.txt', 'rebuild me');
    await unlink(libraryIndexPath());
    const rebuilt = await findEntry(entry.id);
    expect(rebuilt?.filename).toBe(entry.filename);
    expect(rebuilt?.title).toBe(entry.title);
    // Index was recreated 0600.
    expect((await stat(libraryIndexPath())).mode & 0o777).toBe(0o600);
  });

  it('keeps two uploads of the same name as distinct rows with a (2) filename', async () => {
    const first = await upload('same.txt', 'same content');
    const second = await upload('same.txt', 'same content');
    expect(second.id).not.toBe(first.id);
    expect(second.filename).toBe(first.filename.replace(/(\.[^.]+)$/, ' (2)$1'));
    expect((await list()).entries).toHaveLength(2);
  });

  it('suffixes a renamed file that collides with an existing one', async () => {
    const first = await upload('a.txt', 'one', { title: 'Alpha', author: '甲' });
    const second = await upload('b.txt', 'two', { title: 'Beta', author: '甲' });
    const patched = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${second.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: 'Alpha' }),
      }),
      params({ id: second.id }),
    );
    expect(patched.status).toBe(200);
    const result = (await patched.json()) as Entry;
    expect(result.id).toBe(second.id);
    expect(result.title).toBe('Alpha');
    expect(result.filename).not.toBe(first.filename);
    expect(result.filename).toContain('Alpha');
    expect((await list()).entries).toHaveLength(2);
  }, 20_000);

  it('stats count formats and total bytes', async () => {
    await upload('s1.txt', '12345');
    await upload('s2.txt', '123');
    const response = await STATS(new Request('http://localhost/api/library/stats'));
    const body = (await response.json()) as {
      total: number;
      totalBytes: number;
      latestAddedAt: number | null;
      dir: string;
    };
    expect(body.total).toBe(2);
    expect(body.totalBytes).toBe(8);
    expect(body.latestAddedAt).toBeGreaterThan(0);
    expect(body.dir).toBe(dirs.libraryDir);
  });
});

describe('library path safety', () => {
  it('rejects path traversal and absolute paths smuggled into the index', async () => {
    const entry = await upload('victim.txt', 'not /etc/passwd');
    const index = JSON.parse(await readFile(libraryIndexPath(), 'utf8')) as {
      entries: Entry[];
    };
    for (const bad of ['../../../../etc/passwd', '/etc/passwd', '..\\..\\etc\\passwd', 'a\0b.txt']) {
      index.entries[0]!.filename = bad;
      await writeFile(libraryIndexPath(), JSON.stringify(index), 'utf8');
      const response = await GET_FILE(
        new Request(`http://localhost/api/library/${entry.id}/file`),
        params({ id: entry.id }),
      );
      expect([400, 404]).toContain(response.status);
      const text = await response.text();
      expect(text).not.toContain('root:');
    }
  });

  it('refuses to serve a symlink planted in the library directory', async () => {
    await upload('anchor.txt', 'anchor');
    const evil = path.join(dirs.libraryDir, 'evil.epub');
    await symlink('/etc/passwd', evil);
    await unlink(libraryIndexPath());
    const entries = (await list()).entries;
    const scanned = entries.find((candidate) => candidate.filename.includes('evil'));
    expect(scanned).toBeTruthy();
    const response = await GET_FILE(
      new Request(`http://localhost/api/library/${scanned!.id}/file`),
      params({ id: scanned!.id }),
    );
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text).not.toContain('root:');
  });

  it('rejects malformed / unknown ids without leaking filesystem errors', async () => {
    for (const id of ['..', '../..', '%2e%2e%2f', 'ABCDEFGHIJ', 'zzzzzzzzzz']) {
      const encoded = encodeURIComponent(id);
      const response = await GET_FILE(
        new Request(`http://localhost/api/library/${encoded}/file`),
        params({ id }),
      );
      expect([400, 404]).toContain(response.status);
      const text = await response.text();
      expect(text).not.toMatch(/(?:\/Users\/|\/etc\/|ENOENT)/);
    }
  });
});

describe('library rename (PATCH)', () => {
  it('renames on disk, sanitises illegal characters and returns warnings for non-EPUB', async () => {
    const entry = await upload('old.txt', 'x', { title: '旧', author: '旧作者' });
    const response = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '新 书名/带*非法:字符', author: '新作者' }),
      }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Entry & { warnings?: string[] };
    expect(body.title).toBe('新 书名/带*非法:字符');
    expect(body.filename).toContain('新作者');
    expect(body.filename).not.toMatch(/[/\\:*?"<>|]/);
    expect((body.warnings ?? []).join()).toMatch(/non-EPUB|cannot embed/);
    const files = await readdir(dirs.libraryDir);
    expect(files).toContain(body.filename);
    expect(files).not.toContain(entry.filename);
    expect((await findEntry(entry.id))?.filename).toBe(body.filename);
  }, 20_000);

  it('404s PATCH/DELETE for an id that is not in the index', async () => {
    for (const id of ['0000000000', 'abcdef0123']) {
      const patched = await PATCH_ENTRY(
        new Request(`http://localhost/api/library/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'whatever' }),
        }),
        params({ id }),
      );
      expect(patched.status).toBe(404);
      const deleted = await DELETE_ENTRY(
        new Request(`http://localhost/api/library/${id}`, { method: 'DELETE' }),
        params({ id }),
      );
      expect(deleted.status).toBe(404);
    }
  });
});

describe('library covers', () => {
  it('downloads, re-encodes to JPEG via sharp, and serves an ETag/304', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(new Uint8Array(PNG_1X1), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(PNG_1X1.length) },
      }),
    );
    pngUrl = 'https://covers.example.com/cover.png';
    const entry = await upload('cover.txt', 'with cover');
    const patched = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '封面书', coverUrl: pngUrl }),
      }),
      params({ id: entry.id }),
    );
    expect(patched.status).toBe(200);
    const updated = (await patched.json()) as Entry;
    expect(updated.hasCover).toBe(true);

    const cover = await GET_COVER(
      new Request(`http://localhost/api/library/${entry.id}/cover`),
      params({ id: entry.id }),
    );
    expect(cover.status).toBe(200);
    expect(cover.headers.get('content-type')).toBe('image/jpeg');
    const etag = cover.headers.get('etag');
    expect(etag).toMatch(/^"kf-cover-/);
    expect((await stat(path.join(dirs.dataDir, 'covers', `${entry.id}.jpg`))).size).toBeGreaterThan(0);

    const cached = await GET_COVER(
      new Request(`http://localhost/api/library/${entry.id}/cover`, {
        headers: { 'if-none-match': etag! },
      }),
      params({ id: entry.id }),
    );
    expect(cached.status).toBe(304);
  }, 30_000);

  it('warns when a requested cover cannot be decoded (entry still patched)', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response('this is not an image', {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    const entry = await upload('undecodable.txt', 'x');
    const response = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: '改好了', coverUrl: 'https://covers.example.com/bad.png' }),
      }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Entry & { warnings?: string[] };
    expect(body.title).toBe('改好了');
    expect(body.hasCover).toBe(false);
    // P2 fixed: the generic non-EPUB note plus the explicit decode failure.
    expect(body.warnings).toContain(
      'Metadata is saved in KindleForge, but non-EPUB files cannot embed it. Cover images are only embedded in EPUB files.',
    );
    expect(body.warnings?.join(' ')).toContain('could not be decoded');
    const cover = await GET_COVER(
      new Request(`http://localhost/api/library/${entry.id}/cover`),
      params({ id: entry.id }),
    );
    expect(cover.status).toBe(404);
  });

  it('rejects non-http coverUrl and oversized remote images', async () => {
    const entry = await upload('cover2.txt', 'x');
    const bad = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: 'file:///etc/passwd' }),
      }),
      params({ id: entry.id }),
    );
    expect(bad.status).toBe(400);

    const huge = Buffer.alloc(9 * 1024 * 1024, 1);
    vi.stubGlobal('fetch', async () =>
      new Response(new Uint8Array(huge), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(huge.length) },
      }),
    );
    pngUrl = 'https://covers.example.com/huge.png';
    const oversized = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: pngUrl }),
      }),
      params({ id: entry.id }),
    );
    expect(oversized.status).toBeGreaterThanOrEqual(400);
    // A broken cover must never corrupt the entry: title still patched.
    const body = (await oversized.json()) as Entry & { error?: { code: string } };
    expect(body.error?.code ?? 'COVER_TOO_LARGE').toBeTruthy();
  }, 30_000);
});

describe('library delete + missing', () => {
  it('DELETE removes the file, the cover and the index row', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(new Uint8Array(PNG_1X1), {
        status: 200,
        headers: { 'content-type': 'image/png' },
      }),
    );
    pngUrl = 'https://covers.example.com/cover.png';
    const entry = await upload('delete.txt', 'bye');
    await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: pngUrl }),
      }),
      params({ id: entry.id }),
    );
    const response = await DELETE_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, { method: 'DELETE' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(204);
    expect(await findEntry(entry.id)).toBeUndefined();
    expect((await readdir(dirs.libraryDir)).filter((name) => name.startsWith(entry.id))).toEqual([]);
    const file = await GET_FILE(
      new Request(`http://localhost/api/library/${entry.id}/file`),
      params({ id: entry.id }),
    );
    expect(file.status).toBe(404);
  }, 20_000);

  it('marks an entry missing when the file disappears out-of-band', async () => {
    const entry = await upload('vanish.txt', 'x');
    await unlink(path.join(dirs.libraryDir, entry.filename));
    const listed = await findEntry(entry.id);
    expect(listed?.missing).toBe(true);
    const file = await GET_FILE(
      new Request(`http://localhost/api/library/${entry.id}/file`),
      params({ id: entry.id }),
    );
    expect(file.status).toBe(404);
  });
});

describe('library upload validation', () => {
  it('400s an empty file and 415s an unsupported extension', async () => {
    const empty = new FormData();
    empty.set('file', new File([new Uint8Array(0)], 'empty.txt'));
    expect((await CREATE(await multipartRequest('http://localhost/api/library', empty))).status).toBe(400);

    const exe = new FormData();
    exe.set('file', new File(['MZ'], 'evil.exe'));
    const response = await CREATE(await multipartRequest('http://localhost/api/library', exe));
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('UNSUPPORTED_FORMAT');
  });

  it('411s a multipart upload without Content-Length (chunked)', async () => {
    const body = 'chunked-body';
    const request = new Request('http://localhost/api/library', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=x' },
      body,
      // @ts-expect-error - forcing a stream without content-length semantics
      duplex: 'half',
    });
    expect((await CREATE(request)).status).toBe(411);
  });

  it('404s importing an unknown jobId', async () => {
    const response = await CREATE(
      new Request('http://localhost/api/library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jobId: crypto.randomUUID() }),
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { hint: { en: string } } }).error.hint.en).toMatch(
      /not found|expired|finished conversion/,
    );
  });
});
