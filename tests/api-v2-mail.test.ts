import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { POST as CREATE } from '../app/api/library/route';
import { GET as GET_ENTRY } from '../app/api/library/[id]/route';
import { POST as SEND } from '../app/api/library/[id]/send/route';
import { GET as EML } from '../app/api/library/[id]/eml/route';
import { updateSettings } from '../lib/server/settings';
import { dataRoot } from '../lib/server/state';
import {
  makeDirs,
  multipartRequest,
  params,
  readJson,
  type TestDirs,
} from './api-v2-helpers';

const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server') as {
  SMTPServer: new (options: Record<string, unknown>) => {
    listen: (port: number, host: string, callback: () => void) => void;
    close: (callback?: () => void) => void;
    server: { address: () => AddressInfo; on: (event: string, handler: (error: Error) => void) => void };
  };
};

interface Entry {
  id: string;
  filename: string;
  format: string;
  sendCount?: number;
}

let dirs: TestDirs;
let server: InstanceType<typeof SMTPServer> | null = null;
let received: Buffer[] = [];

beforeEach(async () => {
  dirs = await makeDirs();
  received = [];
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  await dirs.cleanup();
});

async function upload(name: string, bytes: string): Promise<Entry> {
  const form = new FormData();
  form.set('file', new File([bytes], name));
  form.set('title', '测试书');
  form.set('author', '作者');
  const response = await CREATE(await multipartRequest('http://localhost/api/library', form));
  expect(response.status).toBe(201);
  return (await response.json()) as Entry;
}

async function smtpConfig(port: number): Promise<void> {
  await updateSettings({
    send: {
      kindleEmail: 'reader@kindle.com',
      maxAttachmentMb: 25,
      smtp: {
        host: '127.0.0.1',
        port,
        secure: false,
        user: 'sender@example.com',
        from: 'sender@example.com',
        password: 'secret',
      },
    },
  });
}

function startServer(overrides: Record<string, unknown> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const instance = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth(
        _auth: unknown,
        _session: unknown,
        callback: (error: Error | null, user?: { user: string }) => void,
      ) {
        callback(null, { user: 'sender' });
      },
      onData(stream: NodeJS.ReadableStream, _session: unknown, callback: (error: Error | null) => void) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => {
          received.push(Buffer.concat(chunks));
          callback(null);
        });
        stream.on('error', (error: Error) => callback(error));
      },
      ...overrides,
    });
    instance.listen(0, '127.0.0.1', () => {
      server = instance;
      resolve(instance.server.address().port);
    });
    instance.server.on('error', reject);
  });
}

describe('POST /api/library/:id/send', () => {
  it('400s MAIL_RECIPIENT_INVALID when no Kindle address is configured', async () => {
    const entry = await upload('book.txt', 'hello');
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'MAIL_RECIPIENT_INVALID',
    );
  });

  it('400s SMTP_NOT_CONFIGURED when a recipient exists but SMTP does not', async () => {
    const entry = await upload('book.txt', 'hello');
    await updateSettings({ send: { kindleEmail: 'reader@kindle.com' } });
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'SMTP_NOT_CONFIGURED',
    );
  });

  it('415s UNSUPPORTED_SEND_FORMAT for mobile formats', async () => {
    const entry = await upload('book.mobi', 'mobi bytes');
    await updateSettings({
      send: {
        kindleEmail: 'reader@kindle.com',
        smtp: {
          host: '127.0.0.1',
          port: 1,
          secure: false,
          user: 'u@example.com',
          from: 'u@example.com',
          password: 'x',
        },
      },
    });
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'UNSUPPORTED_SEND_FORMAT',
    );
  });

  it('413s ATTACHMENT_TOO_LARGE above the configured limit', async () => {
    const entry = await upload('big.txt', 'x'.repeat(1_500_000));
    await updateSettings({
      send: {
        kindleEmail: 'reader@kindle.com',
        maxAttachmentMb: 1,
        smtp: {
          host: '127.0.0.1',
          port: 1,
          secure: false,
          user: 'u@example.com',
          from: 'u@example.com',
          password: 'x',
        },
      },
    });
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'ATTACHMENT_TOO_LARGE',
    );
  });

  it('504s MAIL_UNREACHABLE for a refused SMTP connection', async () => {
    const entry = await upload('book.txt', 'hello');
    await smtpConfig(1);
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(504);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'MAIL_UNREACHABLE',
    );
  });

  it('502s MAIL_AUTH when the SMTP server rejects the login', async () => {
    const port = await new Promise<number>((resolve) => {
      const instance = new SMTPServer({
        authOptional: false,
        disabledCommands: ['STARTTLS'],
        onAuth(
          _auth: unknown,
          _session: unknown,
          callback: (error: Error | null, user?: { user: string }) => void,
        ) {
          callback(new Error('invalid credentials'));
        },
        onData(_stream: unknown, _session: unknown, callback: (error: Error | null) => void) {
          callback(null);
        },
      });
      instance.listen(0, '127.0.0.1', () => {
        server = instance;
        resolve(instance.server.address().port);
      });
    });
    const entry = await upload('book.txt', 'hello');
    await smtpConfig(port);
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe('MAIL_AUTH');
  });

  it('delivers over SMTP, bumps send stats and writes the send log', async () => {
    const port = await startServer();
    const entry = await upload('book.txt', 'hello kindle');
    await smtpConfig(port);
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; message: string; messageId?: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/Kindle/i);

    const updated = (await (
      await GET_ENTRY(new Request('http://localhost'), params({ id: entry.id }))
    ).json()) as Entry & { lastSendOk?: boolean; lastSentAt?: number };
    expect(updated.sendCount).toBe(1);
    expect(updated.lastSendOk).toBe(true);
    expect(updated.lastSentAt).toBeGreaterThan(0);

    const log = await readJson<Array<{ entryId: string; ok: boolean }>>(
      path.join(dataRoot(), 'send-log.json'),
    );
    expect(log[0]).toMatchObject({ entryId: entry.id, ok: true });
    // The log is diagnostic only: no SMTP password, no attachment bytes.
    const logText = JSON.stringify(log);
    expect(logText).not.toContain('secret');
    expect(logText).not.toContain('password');
    expect(logText).not.toContain('aGVsbG8');
    for (const key of Object.keys(log[0]!)) {
      expect(['entryId', 'title', 'at', 'ok', 'code', 'messageId']).toContain(key);
    }

    expect(received).toHaveLength(1);
    const raw = received[0]!.toString('utf8');
    expect(raw).toContain('reader@kindle.com');
    expect(raw.toLowerCase()).toContain('subject:');
  });

  it('keeps both rows in the send log when two sends finish together', async () => {
    const port = await startServer();
    const entry = await upload('book.txt', 'hello concurrency');
    await smtpConfig(port);
    const [first, second] = await Promise.all([
      SEND(new Request('http://localhost/api/library/x/send', { method: 'POST' }), params({ id: entry.id })),
      SEND(new Request('http://localhost/api/library/x/send', { method: 'POST' }), params({ id: entry.id })),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const log = await readJson<Array<{ entryId: string; ok: boolean }>>(
      path.join(dataRoot(), 'send-log.json'),
    );
    expect(log).toHaveLength(2);
    expect(log.every((row) => row.entryId === entry.id && row.ok)).toBe(true);
  });

  it('rejects an unknown entry with 404 before touching SMTP', async () => {
    await updateSettings({ send: { kindleEmail: 'reader@kindle.com' } });
    const response = await SEND(
      new Request('http://localhost/api/library/x/send', { method: 'POST' }),
      params({ id: 'aaaaaaaaaa' }),
    );
    expect(response.status).toBe(404);
  });
});

describe('GET /api/library/:id/eml', () => {
  it('builds an .eml draft with recipient, subject and attachment', async () => {
    const entry = await upload('book.txt', 'hello kindle');
    await updateSettings({
      send: {
        kindleEmail: 'reader@kindle.com',
        smtp: {
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          user: 'sender@example.com',
          from: 'sender@example.com',
          password: 'secret',
        },
      },
    });
    const response = await EML(new Request('http://localhost/api/library/x/eml'), params({ id: entry.id }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('message/rfc822');
    expect(response.headers.get('content-disposition')).toContain('.eml');
    const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
    expect(raw).toContain('To: reader@kindle.com');
    expect(raw).toContain('Subject:');
    expect(raw).toMatch(/book-[0-9a-f]+\.txt/);
  });

  it('omits To when no Kindle address is configured', async () => {
    const entry = await upload('book.txt', 'hello');
    const response = await EML(new Request('http://localhost/api/library/x/eml'), params({ id: entry.id }));
    expect(response.status).toBe(200);
    const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
    expect(raw).not.toContain('To: reader@kindle.com');
  });

  it('sets no-store and a safe filename for a CJK title', async () => {
    const entry = await upload('book.txt', 'hello');
    const response = await EML(new Request('http://localhost/api/library/x/eml'), params({ id: entry.id }));
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");
  });

  it('415s an unsupported format', async () => {
    const entry = await upload('book.mobi', 'mobi');
    const response = await EML(new Request('http://localhost/api/library/x/eml'), params({ id: entry.id }));
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'UNSUPPORTED_SEND_FORMAT',
    );
  });
});
