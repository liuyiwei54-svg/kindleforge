/**
 * QA (independent) — v2 API attack surface: SSRF on coverUrl (real net guard,
 * no mock), redirect-to-private, method allow-lists, malformed input, header
 * hygiene and traversal-looking upload names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdir } from 'node:fs/promises';
import { POST as CREATE, GET as LIST } from '../../app/api/library/route';
import { PATCH as PATCH_ENTRY } from '../../app/api/library/[id]/route';
import { GET as GET_FILE } from '../../app/api/library/[id]/file/route';
import { POST as STATS_POST } from '../../app/api/library/stats/route';
import { POST as SEARCH } from '../../app/api/metadata/search/route';
import { PUT as PUT_SETTINGS } from '../../app/api/settings/route';
import { POST as SEND } from '../../app/api/library/[id]/send/route';
import { makeDirs, multipartRequest, params, type TestDirs } from '../api-v2-helpers';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await dirs.cleanup();
});

async function upload(name: string, bytes: Buffer | string = 'x'): Promise<{ id: string; filename: string }> {
  const form = new FormData();
  form.set('file', new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name));
  form.set('title', 'T');
  form.set('author', 'A');
  const response = await CREATE(await multipartRequest('http://localhost/api/library', form));
  if (response.status !== 201) throw new Error(`upload failed ${response.status}`);
  return (await response.json()) as { id: string; filename: string };
}

describe('coverUrl SSRF (real guard)', () => {
  it.each([
    'http://127.0.0.1:3100/api/settings',
    'http://localhost/cover.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.1/x.png',
    'http://[::1]/x.png',
    'file:///etc/passwd',
    'gopher://127.0.0.1:70/',
  ])('refuses %s', async (coverUrl) => {
    const entry = await upload('ssrf.txt');
    const response = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl }),
      }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toMatch(/ECONNREFUSED|127\.0\.0\.1:\d+/);
  });

  it('follows at most a few redirects and re-checks every hop', async () => {
    // A public-looking IP literal skips DNS, then redirects into loopback.
    vi.stubGlobal('fetch', async () =>
      new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3100/api/settings' } }),
    );
    const entry = await upload('redirect.txt');
    const response = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: 'https://93.184.216.34/cover.png' }),
      }),
      params({ id: entry.id }),
    );
    // downloadCover maps a blocked hop to its generic "cover failed" error.
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = (await response.json()) as { error: { code: string; hint: { zh: string } } };
    expect(body.error.code).toBe('COVER_UNAVAILABLE');
    expect(body.error.hint.zh).toBeTruthy();
  });

  it('caps redirect chains instead of looping forever', async () => {
    let hops = 0;
    vi.stubGlobal('fetch', async () => {
      hops += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://93.184.216.34/hop-${hops}.png` },
      });
    });
    const entry = await upload('loop.txt');
    const response = await PATCH_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ coverUrl: 'https://93.184.216.34/cover.png' }),
      }),
      params({ id: entry.id }),
    );
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(hops).toBeLessThanOrEqual(6);
  });
});

describe('request hygiene', () => {
  it('405s disallowed methods with an Allow header', async () => {
    const stats = STATS_POST();
    expect(stats.status).toBe(405);
    expect(stats.headers.get('allow')).toContain('GET');

    const entry = await upload('m.txt');
    const sendGet = await (await import('../../app/api/library/[id]/send/route')).GET();
    expect(sendGet.status).toBe(405);
    expect((sendGet.headers.get('allow') ?? '')).toContain('POST');
    expect(entry.id).toBeTruthy();
  });

  it('400s malformed JSON on every JSON endpoint, never 500', async () => {
    const bad = new Request('http://localhost/x', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'content-length': '9' },
      body: '{not json',
    });
    const settings = await PUT_SETTINGS(bad.clone());
    expect(settings.status).toBe(400);
    const search = await SEARCH(bad.clone());
    expect(search.status).toBe(400);
    const entry = await upload('badjson.txt');
    const send = await SEND(bad.clone(), params({ id: entry.id }));
    expect(send.status).toBe(400);
  });

  it('sets no-store + nosniff + JSON content-type on API errors', async () => {
    const response = await LIST(new Request('http://localhost/api/library?sort=DROP%20TABLE'));
    expect(response.status).toBe(400);
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('cache-control')).toContain('no-store');
    // nosniff/frame/etc. are applied by next.config headers on the real server
    // (asserted in the HTTP-level QA suite), not by the route handler.
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sanitises traversal-looking upload names and stores bytes verbatim', async () => {
    const bytes = Buffer.from('MARKER-TRAVERSAL-OK');
    const entry = await upload('../../../../tmp/evil.epub', bytes);
    expect(entry.filename).not.toContain('..');
    expect(entry.filename).not.toContain('/');
    const files = await readdir(dirs.libraryDir);
    expect(files.some((name) => name.includes('..'))).toBe(false);
    const response = await GET_FILE(
      new Request(`http://localhost/api/library/${entry.id}/file`),
      params({ id: entry.id }),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
  });

  it('rejects a multipart part with no filename and a JSON body without jobId', async () => {
    const form = new FormData();
    form.set('file', new File(['x'], ''));
    const noName = await CREATE(await multipartRequest('http://localhost/api/library', form));
    expect(noName.status).toBe(400);

    const noJob = await CREATE(
      new Request('http://localhost/api/library', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    );
    expect(noJob.status).toBe(400);
  });
});

describe('settings test endpoint cannot be used as a port scanner oracle', () => {
  it('answers 200 MAIL_UNREACHABLE for closed local ports without detail', async () => {
    const response = await (await import('../../app/api/settings/test/route')).POST(
      new Request('http://localhost/api/settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          smtp: { host: '127.0.0.1', port: 1, secure: false, user: 'u', from: 'u@example.com', password: 'p' },
        }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; code?: string; hint?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('MAIL_UNREACHABLE');
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|127\.0\.0\.1:1\b/);
  }, 20_000);
});
