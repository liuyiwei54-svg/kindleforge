/**
 * QA (independent) — v2 Send-to-Kindle over a real local SMTP server, plus the
 * .eml draft: subject/attachment bytes, error mapping, send-log, limits.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { POST as CREATE } from '../../app/api/library/route';
import { GET as GET_ENTRY } from '../../app/api/library/[id]/route';
import { POST as SEND } from '../../app/api/library/[id]/send/route';
import { GET as EML } from '../../app/api/library/[id]/eml/route';
import { resetSettingsForTests, updateSettings } from '../../lib/server/settings';
import { dataRoot } from '../../lib/server/state';
import { makeDirs, multipartRequest, params, type TestDirs } from '../api-v2-helpers';

const require = createRequire(import.meta.url);
const { SMTPServer } = require('smtp-server') as {
  SMTPServer: new (options: Record<string, unknown>) => {
    listen: (port: number, host: string, callback: () => void) => void;
    close: (callback?: () => void) => void;
    server: {
      address: () => AddressInfo;
      on: (event: string, handler: (error: Error) => void) => void;
    };
  };
};

interface Entry {
  id: string;
  filename: string;
  format: string;
  sendCount?: number;
  lastSendOk?: boolean;
  lastSentAt?: number;
}

let dirs: TestDirs;
let server: InstanceType<typeof SMTPServer> | null = null;
let received: Buffer[] = [];
const PASSWORD = 'smtp-secret-不告诉你';

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

function startServer(options: Record<string, unknown> = {}): Promise<number> {
  return new Promise((resolve, reject) => {
    const instance = new SMTPServer({
      authOptional: true,
      disabledCommands: ['STARTTLS'],
      onAuth(_auth: unknown, _session: unknown, callback: (error: Error | null, user?: { user: string }) => void) {
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
      ...options,
    });
    instance.listen(0, '127.0.0.1', () => {
      server = instance;
      resolve(instance.server.address().port);
    });
    instance.server.on('error', reject);
  });
}

async function configure(port: number, maxAttachmentMb = 25): Promise<void> {
  await updateSettings({
    send: {
      kindleEmail: 'reader@kindle.com',
      maxAttachmentMb,
      smtp: {
        host: '127.0.0.1',
        port,
        secure: false,
        user: 'sender@example.com',
        from: 'sender@example.com',
        password: PASSWORD,
      },
    },
  });
  await resetSettingsForTests();
}

async function upload(name: string, bytes: Buffer | string, title = '测试书'): Promise<Entry> {
  const form = new FormData();
  form.set('file', new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes)], name));
  form.set('title', title);
  form.set('author', '作者');
  const response = await CREATE(await multipartRequest('http://localhost/api/library', form));
  if (response.status !== 201) throw new Error(`upload ${name} -> ${response.status} ${await response.text()}`);
  return (await response.json()) as Entry;
}

function send(id: string): Promise<Response> {
  return SEND(new Request(`http://localhost/api/library/${id}/send`, { method: 'POST' }), params({ id }));
}

async function sendLog(): Promise<Array<Record<string, unknown>>> {
  return JSON.parse(await readFile(path.join(dataRoot(), 'send-log.json'), 'utf8')) as Array<
    Record<string, unknown>
  >;
}

describe('Send to Kindle (SMTP)', () => {
  it('delivers a whitelisted file with 《》subject and exact attachment bytes', async () => {
    const port = await startServer();
    await configure(port);
    const marker = Buffer.from('第一章 中文正文 UNIQUE-MARKER-42\n'.repeat(20), 'utf8');
    const entry = await upload('第一章 测试.txt', marker);
    const response = await send(entry.id);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; messageId?: string };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBeTruthy();
    expect(received).toHaveLength(1);

    const raw = received[0]!.toString('utf8');
    const subjectMatch = /^Subject: =\?UTF-8\?B\?([^?]+)\?=/m.exec(raw);
    expect(subjectMatch).toBeTruthy();
    const subject = Buffer.from(subjectMatch![1]!, 'base64').toString('utf8');
    expect(subject).toContain('《测试书》');
    const encoded = marker.toString('base64').replace(/(.{60})/g, '$1\r\n');
    expect(raw.replace(/\s+/g, '')).toContain(encoded.replace(/\s+/g, '').slice(0, 120));

    const refreshed = (await (await GET_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`),
      params({ id: entry.id }),
    )).json()) as Entry;
    expect(refreshed.sendCount).toBe(1);
    expect(refreshed.lastSendOk).toBe(true);
    expect(refreshed.lastSentAt).toBeGreaterThan(0);
    expect(await sendLog()).toHaveLength(1);
  }, 60_000);

  it('maps AUTH failures to 502 MAIL_AUTH without leaking the password', async () => {
    const port = await startServer({
      onAuth(
        _auth: unknown,
        _session: unknown,
        callback: (error: Error | null) => void,
      ) {
        callback(Object.assign(new Error('Authentication credentials invalid'), { responseCode: 535 }));
      },
    });
    await configure(port);
    const entry = await upload('auth.txt', 'x');
    const response = await send(entry.id);
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).not.toContain(PASSWORD);
    const body = JSON.parse(text) as { error: { code: string; hint: { zh: string; en: string } } };
    expect(body.error.code).toBe('MAIL_AUTH');
    expect(body.error.hint.zh).toBeTruthy();
    expect(body.error.hint.en).toBeTruthy();
    const log = await sendLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ ok: false, code: 'MAIL_AUTH' });
    expect(JSON.stringify(log)).not.toContain(PASSWORD);
  }, 60_000);

  it('maps an unreachable SMTP server to 504 MAIL_UNREACHABLE', async () => {
    await configure(1);
    const entry = await upload('refused.txt', 'x');
    const response = await send(entry.id);
    expect(response.status).toBe(504);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('MAIL_UNREACHABLE');
  }, 60_000);

  it('400s when no Kindle address is configured and 415s mobi/azw3', async () => {
    const entry = await upload('no-recipient.txt', 'x');
    const response = await send(entry.id);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'MAIL_RECIPIENT_INVALID',
    );

    const port = await startServer();
    await configure(port);
    const mobi = await upload('book.mobi', 'fake mobi bytes');
    const rejected = await send(mobi.id);
    expect(rejected.status).toBe(415);
    expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe(
      'UNSUPPORTED_SEND_FORMAT',
    );
  }, 60_000);

  it('413s an attachment above the configured limit', async () => {
    const port = await startServer();
    await configure(port, 1);
    const big = await upload('big.txt', Buffer.alloc(1.5 * 1024 * 1024, 0x41));
    const response = await send(big.id);
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      'ATTACHMENT_TOO_LARGE',
    );
    expect(received).toHaveLength(0);
  }, 60_000);

  it('logs concurrent sends without dropping an entry', async () => {
    const port = await startServer();
    await configure(port);
    const entry = await upload('race.txt', 'race');
    const responses = await Promise.all([send(entry.id), send(entry.id), send(entry.id)]);
    const statuses = await Promise.all(responses.map(async (response) => response.status));
    expect(statuses).toEqual([200, 200, 200]);
    const log = await sendLog();
    // appendSendLog is a non-atomic read-modify-write (AUDIT-V2 P2): under real
    // concurrency a row can be lost, so exactly-once is not asserted yet.
    // P2 fixed: appendSendLog now takes the send-log lock, so all three land.
    expect(log.length).toBe(3);
    expect(new Set(log.map((row) => row.messageId)).size).toBe(3);
    const refreshed = (await (await GET_ENTRY(
      new Request(`http://localhost/api/library/${entry.id}`),
      params({ id: entry.id }),
    )).json()) as Entry;
    expect(refreshed.sendCount).toBe(3);
  }, 90_000);
});

describe('.eml draft', () => {
  it('serves a parseable message/rfc822 with the attachment and RFC 5987 filename', async () => {
    const bytes = Buffer.from('EML-MARKER-中文内容\n');
    const entry = await upload('第一章 测试.txt', bytes);
    const response = await EML(
      new Request(`http://localhost/api/library/${entry.id}/eml`),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('message/rfc822');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-disposition')).toContain("filename*=UTF-8''");

    const raw = Buffer.from(await response.arrayBuffer()).toString('utf8');
    expect(raw).toMatch(/^Content-Type: multipart\/mixed/m);
    expect(raw).toContain('Content-Disposition: attachment');
    expect(raw).not.toContain(PASSWORD);
    const flat = raw.replace(/\s+/g, '');
    const encoded = bytes.toString('base64').replace(/\s+/g, '');
    expect(flat).toContain(encoded.slice(0, 80));
  });

  it('does not need SMTP settings at all', async () => {
    const entry = await upload('draft.txt', 'draft');
    const response = await EML(
      new Request(`http://localhost/api/library/${entry.id}/eml`),
      params({ id: entry.id }),
    );
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).toMatch(/^Content-Type: multipart\/mixed/m);
    expect(raw).toContain('Content-Disposition: attachment');
  });
});
