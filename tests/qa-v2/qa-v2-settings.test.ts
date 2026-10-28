/**
 * QA (independent) — v2 settings: encryption at rest, permissions, restart
 * persistence, password semantics, validation, and cross-origin abuse.
 *
 * These tests call the real route handlers and touch the real filesystem, but
 * only under a throw-away KF_DATA_DIR (setStateDirsForTests), never ~/.kindleforge.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, stat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GET as GET_SETTINGS,
  PUT as PUT_SETTINGS,
} from '../../app/api/settings/route';
import { POST as TEST_SMTP } from '../../app/api/settings/test/route';
import {
  getSmtpPassword,
  resetSettingsForTests,
  settingsPath,
  secretKeyPath,
  SECRET_PREFIX,
} from '../../lib/server/settings';
import { dataRoot } from '../../lib/server/state';
import { jsonRequest, makeDirs, type TestDirs } from '../api-v2-helpers';

const execFileAsync = promisify(execFile);

const PASSWORD = 'correct horse ŝecret-测试';

let dirs: TestDirs;

beforeEach(async () => {
  dirs = await makeDirs();
});

afterEach(async () => {
  await dirs.cleanup();
});

async function put(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return PUT_SETTINGS(jsonRequest('http://localhost/api/settings', body, 'PUT'));
}

async function putRaw(text: string, contentType = 'application/json'): Promise<Response> {
  return PUT_SETTINGS(
    new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: {
        'content-type': contentType,
        'content-length': String(Buffer.byteLength(text)),
      },
      body: text,
    }),
  );
}

async function savedSmtp(): Promise<Record<string, unknown>> {
  const raw = JSON.parse(await readFile(settingsPath(), 'utf8')) as {
    send: { smtp: Record<string, unknown> };
  };
  return raw.send.smtp;
}

describe('settings at rest', () => {
  it('stores the SMTP password encrypted (enc:v1:), never in plaintext', async () => {
    const response = await put({
      send: {
        smtp: {
          host: 'smtp.example.com',
          port: 465,
          secure: true,
          user: 'me@example.com',
          from: 'me@example.com',
          password: PASSWORD,
        },
      },
    });
    expect(response.status).toBe(200);

    const text = await readFile(settingsPath(), 'utf8');
    expect(text).not.toContain(PASSWORD);
    expect(text).toContain(SECRET_PREFIX);
    expect(await savedSmtp()).toMatchObject({ host: 'smtp.example.com', port: 465 });
    expect(JSON.stringify(await savedSmtp())).toContain(SECRET_PREFIX);

    // 0600 settings / 0600 key / 0700 data dir.
    expect((await stat(settingsPath())).mode & 0o777).toBe(0o600);
    const keyInfo = await stat(secretKeyPath());
    expect(keyInfo.mode & 0o777).toBe(0o600);
    expect(keyInfo.size).toBe(32);
    expect((await stat(dataRoot())).mode & 0o777).toBe(0o700);
    expect(await getSmtpPassword()).toBe(PASSWORD);
  });

  it('GET never returns the password, only hasPassword', async () => {
    await put({
      send: { smtp: { host: 'h', port: 587, user: 'u', from: 'u@example.com', password: PASSWORD } },
    });
    const response = await GET_SETTINGS();
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(SECRET_PREFIX);
    expect(text).not.toContain('password');
    const body = JSON.parse(text) as { send: { smtp: { hasPassword: boolean } } };
    expect(body.send.smtp.hasPassword).toBe(true);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('keeps the old password when the field is omitted or empty', async () => {
    await put({ send: { smtp: { password: PASSWORD } } });
    await put({ send: { smtp: { host: 'smtp.new.example', password: '' } } });
    await put({ send: { smtp: { port: 2525 } } });
    expect(await getSmtpPassword()).toBe(PASSWORD);
    const body = (await (await GET_SETTINGS()).json()) as {
      send: { smtp: { hasPassword: boolean; host: string; port: number } };
    };
    expect(body.send.smtp).toMatchObject({ hasPassword: true, host: 'smtp.new.example', port: 2525 });
  });

  it('clearPassword removes the password for real', async () => {
    await put({ send: { smtp: { password: PASSWORD } } });
    await put({ send: { smtp: { clearPassword: true } } });
    expect(await getSmtpPassword()).toBeNull();
    const saved = JSON.stringify(await savedSmtp());
    expect(saved).not.toContain(SECRET_PREFIX);
    expect(saved).not.toContain('password');
    const body = (await (await GET_SETTINGS()).json()) as { send: { smtp: { hasPassword: boolean } } };
    expect(body.send.smtp.hasPassword).toBe(false);
  });

  it('survives a true process restart: new process reads disk and decrypts', async () => {
    await put({
      send: {
        kindleEmail: 'reader@kindle.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'me@example.com',
          from: 'me@example.com',
          password: PASSWORD,
        },
      },
    });
    // A separate node/tsx process = an actual restart, not a cache reset.
    const script = path.join(tmpdir(), `kf-qa-v2-restart-${process.pid}.ts`);
    await writeFile(
      script,
      [
        "import { getSettings, getSmtpPassword } from " + JSON.stringify(path.join(process.cwd(), 'lib/server/settings')),
        '(async () => {',
        '  const publicSettings = await getSettings();',
        '  const password = await getSmtpPassword();',
        '  process.stdout.write(JSON.stringify({',
        '    hasPassword: publicSettings.send.smtp.hasPassword,',
        '    kindleEmail: publicSettings.send.kindleEmail,',
        '    passwordMatches: password === process.env.KF_EXPECTED_PASSWORD,',
        '  }));',
        '})();',
      ].join('\n'),
      'utf8',
    );
    try {
      const { stdout } = await execFileAsync(
        path.join(process.cwd(), 'node_modules', '.bin', 'tsx'),
        [script],
        {
          env: {
            ...process.env,
            KF_DATA_DIR: dirs.dataDir,
            KF_LIBRARY_DIR: dirs.libraryDir,
            KF_EXPECTED_PASSWORD: PASSWORD,
          },
          timeout: 60_000,
        },
      );
      const result = JSON.parse(stdout) as {
        hasPassword: boolean;
        kindleEmail: string;
        passwordMatches: boolean;
      };
      expect(result).toEqual({
        hasPassword: true,
        kindleEmail: 'reader@kindle.com',
        passwordMatches: true,
      });
    } finally {
      await rm(script, { force: true });
    }
  }, 60_000);

  it('rejects invalid Kindle addresses and bad ports with 400 + bilingual hint', async () => {
    for (const kindleEmail of ['reader@kindle.co', 'reader@gmail.com', 'not-an-email']) {
      const response = await put({ send: { kindleEmail } });
      expect(response.status).toBe(400);
      const body = (await response.json()) as { error: { code: string; hint: { zh: string; en: string } } };
      expect(body.error.code).toBe('SETTINGS_INVALID');
      expect(body.error.hint.zh.length).toBeGreaterThan(4);
      expect(body.error.hint.en.length).toBeGreaterThan(4);
    }
    expect((await put({ send: { smtp: { port: 70000 } } })).status).toBe(400);
    expect((await put({ send: { smtp: { port: 0 } } })).status).toBe(400);
    // The schema clamps rather than rejects: 500 -> 50 (MAX_SEND_LIMIT_MB).
    expect((await put({ send: { maxAttachmentMb: 500 } })).status).toBe(200);
    const clamped = (await (await GET_SETTINGS()).json()) as { send: { maxAttachmentMb: number } };
    expect(clamped.send.maxAttachmentMb).toBe(50);
  });

  it('rejects a relative library.dir and an unwritable one with 507', async () => {
    expect((await put({ library: { dir: 'relative/library' } })).status).toBe(400);

    const notADir = path.join(dirs.root, 'plain-file');
    await writeFile(notADir, 'x', 'utf8');
    const before = await readFile(settingsPath(), 'utf8');
    const response = await put({ library: { dir: notADir } });
    expect(response.status).toBe(507);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'LIBRARY_UNWRITABLE',
    );
    // The failed write must not corrupt or mutate the file.
    expect(await readFile(settingsPath(), 'utf8')).toBe(before);
  });

  it('serialises concurrent PUTs and always leaves valid JSON', async () => {
    const writes = Array.from({ length: 16 }, (_, index) =>
      PUT_SETTINGS(
        jsonRequest('http://localhost/api/settings', {
          send: { smtp: { host: `smtp-${index}.example.com` } },
        }, 'PUT'),
      ),
    );
    const responses = await Promise.all(writes);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const disk = JSON.parse(await readFile(settingsPath(), 'utf8')) as {
      send: { smtp: { host: string } };
    };
    expect(disk.send.smtp.host).toMatch(/^smtp-\d+\.example\.com$/);
  });

  it('ignores unknown keys instead of accepting arbitrary settings', async () => {
    const response = await put({ telemetry: { enabled: true }, send: { runCommand: 'rm -rf /' } });
    expect(response.status).toBe(200);
    const disk = JSON.parse(await readFile(settingsPath(), 'utf8')) as Record<string, unknown>;
    expect(disk).not.toHaveProperty('telemetry');
    expect(JSON.stringify(disk)).not.toContain('runCommand');
  });
});

describe('settings test endpoint', () => {
  it('always answers 200 with a diagnostic body (never leaks the password)', async () => {
    await put({
      send: {
        smtp: {
          host: '127.0.0.1',
          port: 1,
          secure: false,
          user: 'u@example.com',
          from: 'u@example.com',
          password: PASSWORD,
        },
      },
    });
    const response = await TEST_SMTP(
      new Request('http://localhost/api/settings/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ smtp: { host: '127.0.0.1', port: 1, password: PASSWORD } }),
      }),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    const body = JSON.parse(text) as { ok: boolean; code?: string; hint?: string };
    expect(body.ok).toBe(false);
    expect(body.code).toBe('MAIL_UNREACHABLE');
    expect(body.hint).toBeTruthy();
  }, 20_000);
});

describe('cross-origin abuse (CSRF / DNS rebinding)', () => {
  it('refuses a cross-site text/plain PUT to /api/settings', async () => {
    // Materialise the file so the negative check can prove it was not written.
    await GET_SETTINGS();
    const body = JSON.stringify({ send: { smtp: { host: 'attacker.example' } } });
    const response = await PUT_SETTINGS(
      new Request('http://127.0.0.1:3100/api/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'text/plain',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          'content-length': String(Buffer.byteLength(body)),
        },
        body,
      }),
    );
    expect(response.status).toBe(403);
    // A rejected write must not create or modify settings.json.
    let host = '';
    try {
      const disk = JSON.parse(await readFile(settingsPath(), 'utf8')) as {
        send: { smtp: { host: string } };
      };
      host = disk.send.smtp.host;
    } catch {
      host = '';
    }
    expect(host).not.toBe('attacker.example');
  });

  it('refuses a PUT whose Host header was rebound to another domain', async () => {
    const body = JSON.stringify({ send: { smtp: { host: 'attacker.example' } } });
    const response = await PUT_SETTINGS(
      new Request('http://rebind.evil.example/api/settings', {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          host: 'rebind.evil.example',
          'content-length': String(Buffer.byteLength(body)),
        },
        body,
      }),
    );
    expect(response.status).toBe(403);
  });
});
