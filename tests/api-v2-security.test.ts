import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../middleware';
import { evaluateRequestOrigin } from '../lib/server/origin';
import { readFile, stat, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { GET as GET_ENTRY, PATCH as PATCH_ENTRY } from '../app/api/library/[id]/route';
import { GET as GET_FILE } from '../app/api/library/[id]/file/route';
import { POST as POST_CREATE } from '../app/api/library/route';
import { POST as REVEAL } from '../app/api/library/[id]/reveal/route';
import { updateSettings, secretKeyPath, settingsPath } from '../lib/server/settings';
import { assertPublicHttpUrl, isPublicAddress } from '../lib/server/net';
import type { LibraryEntry } from '../lib/shared/types';
import {
  jsonRequest,
  makeDirs,
  multipartRequest,
  params,
  type TestDirs,
} from './api-v2-helpers';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await dirs.cleanup();
});

async function upload(name = 'book.txt', content = 'hello'): Promise<LibraryEntry> {
  const form = new FormData();
  form.set('file', new File([content], name));
  const response = await POST_CREATE(await multipartRequest('http://localhost/api/library', form));
  expect(response.status).toBe(201);
  return (await response.json()) as LibraryEntry;
}

describe('private address guard', () => {
  it('recognizes public and private IPv4/IPv6 literals', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2001:4860:4860::8888', '2001::6817:7cbd']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
    for (const address of [
      '127.0.0.1',
      '127.10.0.1',
      '10.0.0.1',
      '172.16.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      '::',
      'fc00::1',
      'fd12::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('rejects localhost, private IPs and credentials before any fetch', async () => {
    for (const url of [
      'http://localhost/x',
      'http://book.local/x',
      'http://127.0.0.1/x',
      'http://10.1.2.3/x',
      'http://[::1]/x',
      'http://user:pass@example.com/x',
      'file:///etc/passwd',
    ]) {
      await expect(assertPublicHttpUrl(url), url).rejects.toMatchObject({ status: 400 });
    }
    await expect(assertPublicHttpUrl('https://93.184.216.34/cover.jpg')).resolves.toBeInstanceOf(URL);
  });
});

describe('library id hardening', () => {
  const badIds = ['../', '%2e%2e', '..%2f..', '/etc/passwd', '0123456789'];

  it('returns 4xx for traversal / absolute / unknown ids on every route', async () => {
    for (const id of badIds) {
      const entry = await GET_ENTRY(new Request('http://localhost'), params({ id }));
      expect(entry.status, `entry ${id}`).toBe(404);
      const file = await GET_FILE(new Request('http://localhost'), params({ id }));
      expect(file.status, `file ${id}`).toBe(404);
    }
  });

  it('refuses to serve a library file replaced by a symlink', async () => {
    const entry = await upload('symlink.txt');
    const filePath = path.join(dirs.libraryDir, entry.filename);
    await unlink(filePath);
    await symlink('/etc/passwd', filePath);
    const response = await GET_FILE(new Request('http://localhost'), params({ id: entry.id }));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain('root:');
  });
});

describe('cover URL SSRF and limits', () => {
  it('rejects localhost/private cover URLs without making a request', async () => {
    const entry = await upload();
    const fetchMock = vi.fn(async () => new Response('nope'));
    vi.stubGlobal('fetch', fetchMock);
    for (const coverUrl of ['http://127.0.0.1:8080/x.jpg', 'http://[::1]/x.jpg', 'http://169.254.169.254/latest/meta-data/']) {
      const response = await PATCH_ENTRY(
        jsonRequest(`http://localhost/api/library/${entry.id}`, { coverUrl }, 'PATCH'),
        params({ id: entry.id }),
      );
      expect(response.status, coverUrl).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a public URL that redirects to a private address', async () => {
    const entry = await upload();
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://10.0.0.1/cover.jpg' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await PATCH_ENTRY(
      jsonRequest(
        'http://localhost/api/library/' + entry.id,
        { coverUrl: 'https://93.184.216.34/cover.jpg' },
        'PATCH',
      ),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'COVER_UNAVAILABLE',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caps a chunked cover body at 8 MB', async () => {
    const entry = await upload();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const chunk = new Uint8Array(9 * 1024 * 1024);
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          { status: 200, headers: { 'content-type': 'image/jpeg' } },
        );
      }),
    );
    const response = await PATCH_ENTRY(
      jsonRequest(
        'http://localhost/api/library/' + entry.id,
        { coverUrl: 'https://93.184.216.34/huge.jpg' },
        'PATCH',
      ),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('BAD_REQUEST');
  });
});

describe('reveal', () => {
  it('returns 501 on non-darwin platforms without spawning a shell', async () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      const entry = await upload();
      const response = await REVEAL(
        new Request('http://localhost/api/library/x/reveal', { method: 'POST' }),
        params({ id: entry.id }),
      );
      expect(response.status).toBe(501);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        'REVEAL_UNSUPPORTED',
      );
    } finally {
      Object.defineProperty(process, 'platform', original);
    }
  });
});

describe('secret file hygiene', () => {
  it('creates settings.json and .secret.key with 0600 from the first write', async () => {
    await updateSettings({
      send: {
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'u@example.com',
          from: 'u@example.com',
          password: 'super-secret',
        },
      },
    });
    const [settingsInfo, keyInfo] = await Promise.all([stat(settingsPath()), stat(secretKeyPath())]);
    expect(settingsInfo.mode & 0o777).toBe(0o600);
    expect(keyInfo.mode & 0o777).toBe(0o600);
    expect(keyInfo.size).toBe(32);

    const disk = await readFile(settingsPath(), 'utf8');
    expect(disk).not.toContain('super-secret');
    expect(disk).toContain('enc:v1:');
    expect(disk.includes('super-secret')).toBe(false);
  });
});

describe('Host / Origin guard for /api/**', () => {
  function call(headers: Record<string, string>): NextRequest {
    return new NextRequest(new URL('http://127.0.0.1:3100/api/settings'), { headers });
  }

  it('rejects a spoofed Host even when the URL points at localhost', async () => {
    const response = middleware(call({ host: 'evil.com' }));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN_HOST');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects a cross-site Origin', async () => {
    const response = middleware(call({ host: '127.0.0.1:3100', origin: 'https://evil.com' }));
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'FORBIDDEN_ORIGIN',
    );
  });

  it('accepts localhost Host and same-origin Origin', () => {
    for (const host of ['127.0.0.1:3100', 'localhost:3100', '[::1]:3100']) {
      expect(middleware(call({ host })).status).toBe(200);
      expect(
        middleware(call({ host, origin: `http://${host}` })).status,
      ).toBe(200);
    }
  });

  it('ignores X-Forwarded-Host and requires Host', () => {
    expect(
      middleware(call({ host: '127.0.0.1:3100', 'x-forwarded-host': 'evil.com' })).status,
    ).toBe(200);
    expect(middleware(call({ 'x-forwarded-host': '127.0.0.1:3100' })).status).toBe(403);
  });

  it('supports KF_ALLOWED_HOSTS additions', () => {
    const env = { ...process.env, KF_ALLOWED_HOSTS: 'myhost:3100,other' };
    expect(evaluateRequestOrigin(new Headers({ host: 'myhost:3100' }), env).ok).toBe(true);
    expect(evaluateRequestOrigin(new Headers({ host: 'other:3100' }), env).ok).toBe(true);
    expect(evaluateRequestOrigin(new Headers({ host: 'myhost:3101' }), env).ok).toBe(false);
  });
});
