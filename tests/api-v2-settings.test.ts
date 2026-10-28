import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import { GET, PUT } from '../app/api/settings/route';
import { POST as TEST_SMTP } from '../app/api/settings/test/route';
import {
  getSettings,
  getSmtpPassword,
  resetSettingsForTests,
  secretKeyPath,
  settingsPath,
} from '../lib/server/settings';
import { jsonRequest, makeDirs, readJson, type TestDirs } from './api-v2-helpers';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  await dirs.cleanup();
});

describe('GET/PUT /api/settings', () => {
  it('returns safe defaults pointing at the configured library dir', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    const body = (await response.json()) as Record<string, unknown> & {
      library: { dir: string; autoSave: boolean };
      send: { smtp: Record<string, unknown> };
    };
    expect(body.library.dir).toBe(dirs.libraryDir);
    expect(body.library.autoSave).toBe(true);
    expect(body.send.smtp).toMatchObject({ port: 587, secure: false, hasPassword: false });
    expect(body.send.smtp).not.toHaveProperty('password');
    expect(body.metadata).toMatchObject({ enabled: true, providers: ['douban', 'google', 'openlibrary'] });
  });

  it('applies a partial patch and returns the full Settings object', async () => {
    const response = await PUT(
      jsonRequest('http://localhost/api/settings', {
        library: { autoSave: false },
        metadata: { language: 'zh' },
        send: { kindleEmail: 'reader@kindle.com', maxAttachmentMb: 40 },
      }, 'PUT'),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      library: { autoSave: boolean };
      metadata: { language: string; enabled: boolean };
      send: { kindleEmail: string; maxAttachmentMb: number; smtp: { host: string } };
    };
    expect(body.library.autoSave).toBe(false);
    expect(body.metadata.language).toBe('zh');
    expect(body.metadata.enabled).toBe(true);
    expect(body.send.kindleEmail).toBe('reader@kindle.com');
    expect(body.send.maxAttachmentMb).toBe(40);
    expect(body.send.smtp.host).toBe('');
  });

  it('clamps maxAttachmentMb to 50 and rejects an invalid email', async () => {
    const tooBig = await PUT(
      jsonRequest('http://localhost/api/settings', { send: { maxAttachmentMb: 500 } }, 'PUT'),
    );
    expect(tooBig.status).toBe(200);
    expect(((await tooBig.json()) as { send: { maxAttachmentMb: number } }).send.maxAttachmentMb).toBe(50);

    const invalid = await PUT(
      jsonRequest('http://localhost/api/settings', { send: { kindleEmail: 'not-an-email' } }, 'PUT'),
    );
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe('SETTINGS_INVALID');
  });

  it('stores the SMTP password encrypted and never returns it', async () => {
    const saved = await PUT(
      jsonRequest(
        'http://localhost/api/settings',
        {
          send: {
            smtp: {
              host: 'smtp.example.com',
              port: 587,
              secure: false,
              user: 'me@example.com',
              from: 'me@example.com',
              password: 'super-secret',
            },
          },
        },
        'PUT',
      ),
    );
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as { send: { smtp: Record<string, unknown> } };
    expect(body.send.smtp.hasPassword).toBe(true);
    expect(JSON.stringify(body)).not.toContain('super-secret');

    const raw = await readFile(settingsPath(), 'utf8');
    expect(raw).not.toContain('super-secret');
    expect(raw).toContain('enc:v1:');
    expect(await getSmtpPassword()).toBe('super-secret');

    const key = await stat(secretKeyPath());
    expect(key.size).toBe(32);
    expect(key.mode & 0o777).toBe(0o600);
  });

  it('keeps the old password when the patch omits or empties it, and clears on demand', async () => {
    await PUT(
      jsonRequest(
        'http://localhost/api/settings',
        { send: { smtp: { host: 'smtp.example.com', user: 'u', from: 'u@example.com', password: 'first' } } },
        'PUT',
      ),
    );
    await PUT(
      jsonRequest(
        'http://localhost/api/settings',
        { send: { smtp: { host: 'smtp.example.com', user: 'u', from: 'u@example.com', password: '' } } },
        'PUT',
      ),
    );
    expect(await getSmtpPassword()).toBe('first');

    const cleared = await PUT(
      jsonRequest('http://localhost/api/settings', { send: { smtp: { clearPassword: true } } }, 'PUT'),
    );
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as { send: { smtp: { hasPassword: boolean } } }).send.smtp.hasPassword).toBe(
      false,
    );
    expect(await getSmtpPassword()).toBeNull();
  });

  it('rejects an unwritable library directory with LIBRARY_UNWRITABLE', async () => {
    const response = await PUT(
      jsonRequest('http://localhost/api/settings', { library: { dir: '/dev/null/nope' } }, 'PUT'),
    );
    expect(response.status).toBe(507);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'LIBRARY_UNWRITABLE',
    );
  });

  it('accepts a new library dir and updates the default for subsequent reads', async () => {
    const next = `${dirs.root}/other-library`;
    const response = await PUT(
      jsonRequest('http://localhost/api/settings', { library: { dir: next } }, 'PUT'),
    );
    expect(response.status).toBe(200);
    expect((await response.json() as { library: { dir: string } }).library.dir).toBe(next);
    expect((await getSettings()).library.dir).toBe(next);
  });

  it('rejects malformed JSON and non-GET/PUT methods', async () => {
    const bad = await PUT(
      new Request('http://localhost/api/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'content-length': '3' },
        body: '{x}',
      }),
    );
    expect(bad.status).toBe(400);
    const { POST } = await import('../app/api/settings/route');
    expect((await POST()).status).toBe(405);
  });

  it('persists settings across a cache reset (restart simulation)', async () => {
    await PUT(
      jsonRequest('http://localhost/api/settings', { send: { kindleEmail: 'persist@kindle.com' } }, 'PUT'),
    );
    resetSettingsForTests();
    const reread = await GET();
    const body = (await reread.json()) as {
      send: { kindleEmail: string; smtp: { hasPassword: boolean } };
    };
    expect(body.send.kindleEmail).toBe('persist@kindle.com');
    expect(body.send.smtp.hasPassword).toBe(false);

    const disk = await readJson<{ send: { smtp: { password?: string } } }>(settingsPath());
    expect(disk.send.smtp.password).toBeUndefined();
  });
});

describe('POST /api/settings/test', () => {
  it('answers 200 with a diagnostic when SMTP is not configured', async () => {
    const response = await TEST_SMTP(new Request('http://localhost/api/settings/test', { method: 'POST' }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; code?: string; hint?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('SMTP_NOT_CONFIGURED');
    expect(body.hint).toBeTruthy();
  });

  it('reports MAIL_UNREACHABLE for a refused connection without a 5xx', async () => {
    await PUT(
      jsonRequest(
        'http://localhost/api/settings',
        {
          send: {
            smtp: {
              host: '127.0.0.1',
              port: 1,
              secure: false,
              user: 'u@example.com',
              from: 'u@example.com',
              password: 'x',
            },
          },
        },
        'PUT',
      ),
    );
    const response = await TEST_SMTP(
      new Request('http://localhost/api/settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': '2' },
        body: '{}',
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; code?: string; message: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('MAIL_UNREACHABLE');
    expect(body.message).toBeTruthy();
  });
});
