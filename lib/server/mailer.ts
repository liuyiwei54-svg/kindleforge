/**
 * Send to Kindle (SMTP) and .eml drafts.
 *
 * Amazon accepts EPUB/PDF/DOCX/TXT only; the recipient must be an @kindle.com
 * (or legacy @free.kindle.com) address. SMTP failures are mapped to the MAIL_*
 * error codes the UI knows how to explain. Passwords never appear in errors,
 * logs, or API responses.
 */
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer';
import { z } from 'zod';
import type { LibraryEntry, SendLogEntry, SendResult } from '../shared/types';
import {
  attachmentTooLarge,
  mailAuth,
  mailRecipientInvalid,
  mailUnreachable,
  smtpNotConfigured,
  unsupportedSendFormat,
} from './errors';
import {
  libraryFilePath,
  recordSendResult,
} from './library';
import { getSettings, getSmtpPassword } from './settings';
import type { Settings } from '../shared/types';
import {
  SEND_FORMATS,
  SEND_LOG_LIMIT,
  DEFAULT_SEND_LIMIT_MB,
  MAX_SEND_LIMIT_MB,
} from './settings-defaults';
import { asciiFallbackName } from './storage';
import {
  atomicWriteJson,
  dataRoot,
  ensureDir,
  readJsonFile,
  withLock,
} from './state';
import { FORMAT_INFO } from '../engine/formats';

export const SEND_LOG_FILENAME = 'send-log.json';

export interface SmtpTestResult {
  ok: boolean;
  code?: string;
  message: string;
  hint?: string;
}

const smtpOverrideSchema = z
  .object({
    host: z.string().trim().max(255).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    user: z.string().trim().max(255).optional(),
    from: z.string().trim().max(255).optional(),
    password: z.string().max(512).optional(),
  })
  .strict();

export const smtpTestSchema = z
  .object({ smtp: smtpOverrideSchema.optional() })
  .strict()
  .or(smtpOverrideSchema);

type SmtpTestInput = z.infer<typeof smtpTestSchema>;

interface ResolvedSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  password: string;
}

function isEmailLike(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.trim());
}

function extractAddress(value: string): string {
  const match = /<([^<>\s]+@[^<>\s]+)>/.exec(value);
  return (match?.[1] ?? value).trim();
}

function normalizeRecipient(value: string): string | null {
  const address = extractAddress(value).toLowerCase();
  if (!/^[^@\s]+@(?:free\.)?kindle\.com$/.test(address)) return null;
  return address;
}

function attachmentLimitBytes(settings: Settings): number {
  const mb = Math.min(
    MAX_SEND_LIMIT_MB,
    Math.max(1, Math.round(settings.send.maxAttachmentMb || DEFAULT_SEND_LIMIT_MB)),
  );
  return mb * 1024 * 1024;
}

function smtpConfig(settings: Settings, password: string | null | undefined): ResolvedSmtp | null {
  const { host, port, user, from } = settings.send.smtp;
  if (!host.trim() || !port || !user.trim() || !from.trim() || !password) return null;
  return {
    host: host.trim(),
    port,
    secure: settings.send.smtp.secure || port === 465,
    user: user.trim(),
    from: from.trim(),
    password,
  };
}

function createTransport(config: ResolvedSmtp): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: 'TLSv1.2' },
    logger: false,
    debug: false,
  });
}

function smtpCode(error: unknown): string {
  const value = error as { code?: unknown; responseCode?: unknown };
  const code = typeof value.code === 'string' ? value.code : '';
  const responseCode = typeof value.responseCode === 'number' ? value.responseCode : 0;
  if (code === 'EAUTH' || responseCode === 535 || responseCode === 534) return 'MAIL_AUTH';
  return 'MAIL_UNREACHABLE';
}

function connectivityDetail(error: unknown): string | undefined {
  const value = error as { code?: unknown; message?: unknown };
  if (typeof value.code === 'string' && value.code) return value.code;
  if (typeof value.message === 'string' && value.message) return value.message.split('\n')[0]?.slice(0, 160);
  return undefined;
}

function diagnosticHint(code: string): string {
  if (code === 'MAIL_AUTH') {
    return 'SMTP login failed. Use an app-specific password / authorization code from your mail provider. / SMTP 登录失败：请使用邮箱服务商提供的应用专用密码或授权码。';
  }
  return 'Could not reach the SMTP server. Check host/port (465 secure, 587 STARTTLS) and your network. / 无法连接 SMTP 服务器：检查服务器、端口（465/587）与网络。';
}

/**
 * Test the SMTP connection. Never throws for connection/auth failures: the
 * endpoint contract is always HTTP 200 with a diagnostic body.
 */
export async function testSmtpConnection(input: unknown): Promise<SmtpTestResult> {
  const parsed = smtpTestSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      code: 'SETTINGS_INVALID',
      message: 'The SMTP test payload is invalid.',
      hint: 'Check the SMTP host, port, and account fields. / 请检查 SMTP 服务器、端口与账号填写。',
    };
  }
  const settings = await getSettings();
  const override = (
    ('smtp' in parsed.data ? (parsed.data as { smtp?: z.infer<typeof smtpOverrideSchema> }).smtp : parsed.data) ??
    {}
  ) as z.infer<typeof smtpOverrideSchema>;
  const saved = smtpConfig(settings, await getSmtpPassword());
  const password = override.password || saved?.password || '';
  const merged: ResolvedSmtp = {
    host: override.host ?? saved?.host ?? settings.send.smtp.host.trim(),
    port: override.port ?? saved?.port ?? settings.send.smtp.port,
    secure:
      override.secure ??
      saved?.secure ??
      (settings.send.smtp.secure || settings.send.smtp.port === 465),
    user: override.user ?? saved?.user ?? settings.send.smtp.user.trim(),
    from: override.from ?? saved?.from ?? settings.send.smtp.from.trim(),
    password,
  };
  if (!merged.host || !merged.port || !merged.user || !merged.from || !merged.password) {
    return {
      ok: false,
      code: 'SMTP_NOT_CONFIGURED',
      message: 'SMTP is not fully configured.',
      hint: 'Fill in host, port, account, sender address, and password first (or download an .eml draft instead). / 请先填写服务器、端口、账号、发件地址与密码，或改用 .eml 草稿。',
    };
  }
  if (!isEmailLike(extractAddress(merged.from))) {
    return {
      ok: false,
      code: 'SETTINGS_INVALID',
      message: 'The sender address is not a valid e-mail address.',
      hint: 'Set a real From address in Settings. / 请在设置里填写真实的发件邮箱。',
    };
  }

  const transporter = createTransport(merged);
  try {
    await transporter.verify();
    return { ok: true, message: 'SMTP connection succeeded. / SMTP 连接成功。' };
  } catch (error) {
    const code = smtpCode(error);
    return {
      ok: false,
      code,
      message:
        code === 'MAIL_AUTH'
          ? 'SMTP authentication failed.'
          : 'Could not reach the SMTP server.',
      hint: diagnosticHint(code),
    };
  } finally {
    transporter.close();
  }
}

function mailBody(entry: LibraryEntry): string {
  const title = entry.title || 'KindleForge book';
  return [
    `《${title}》`,
    '',
    'Sent with KindleForge — a local ebook converter and library.',
    '',
    'Important: add this sender address to Amazon\'s "Approved Personal Document E-mail List"',
    'at Manage Your Content and Devices → Preferences → Personal Document Settings.',
    'Otherwise Amazon may silently discard the attachment.',
    '',
    '由 KindleForge（本地电子书转换与书库）发送。请把发件地址加入亚马逊「已批准的个人文档电子邮件列表」，',
    '否则附件可能被亚马逊静默丢弃。',
  ].join('\n');
}

function subjectFor(entry: LibraryEntry): string {
  return `《${(entry.title || 'KindleForge').replace(/[\r\n]+/g, ' ').slice(0, 160)}》`;
}

interface MailAttachment {
  filename: string;
  content: Uint8Array;
  contentType: string;
}

async function prepareAttachment(entry: LibraryEntry): Promise<MailAttachment> {
  if (!SEND_FORMATS.includes(entry.format)) throw unsupportedSendFormat(entry.format);
  const resolved = await libraryFilePath(entry.id);
  const limit = attachmentLimitBytes(await getSettings());
  if (resolved.size > limit) throw attachmentTooLarge(resolved.size, limit);
  const { readFile } = await import('node:fs/promises');
  return {
    filename: asciiFallbackName(entry.filename),
    content: new Uint8Array(await readFile(resolved.path)),
    contentType: FORMAT_INFO[entry.format]?.mime ?? 'application/octet-stream',
  };
}

function mailOptions(
  entry: LibraryEntry,
  from: string,
  to: string,
  attachment: MailAttachment,
): Record<string, unknown> {
  return {
    from,
    to,
    subject: subjectFor(entry),
    text: mailBody(entry),
    attachments: [
      {
        filename: attachment.filename,
        content: Buffer.from(attachment.content),
        contentType: attachment.contentType,
        encoding: 'base64',
      },
    ],
  };
}

async function appendSendLog(entry: LibraryEntry, result: SendLogEntry): Promise<void> {
  const file = path.join(dataRoot(), SEND_LOG_FILENAME);
  try {
    await withLock('send-log', async () => {
      let log: SendLogEntry[] = [];
      try {
        const existing = await readJsonFile<unknown>(file);
        if (Array.isArray(existing)) {
          log = existing.filter((item): item is SendLogEntry => Boolean(item) && typeof item === 'object');
        }
      } catch {
        log = [];
      }
      log.unshift(result);
      await ensureDir(dataRoot(), 0o700);
      await atomicWriteJson(file, log.slice(0, SEND_LOG_LIMIT), 0o600);
    });
  } catch {
    // The send itself already happened; logging must not turn it into a failure.
  }
}

export async function sendToKindle(id: string): Promise<SendResult> {
  const entry = await libraryFilePath(id).then((result) => result.entry);
  const settings = await getSettings();
  const recipient = normalizeRecipient(settings.send.kindleEmail);
  if (!recipient) throw mailRecipientInvalid();
  const password = await getSmtpPassword();
  const config = smtpConfig(settings, password);
  if (!config) throw smtpNotConfigured();
  if (!isEmailLike(extractAddress(config.from))) throw smtpNotConfigured();

  const attachment = await prepareAttachment(entry);
  const transporter = createTransport(config);
  const options = mailOptions(entry, config.from, recipient, attachment);

  try {
    const info = await transporter.sendMail(options);
    const messageId = typeof info.messageId === 'string' ? info.messageId : undefined;
    const now = Date.now();
    await recordSendResult(id, { at: now, ok: true, ...(messageId ? { messageId } : {}) });
    await appendSendLog(entry, {
      entryId: entry.id,
      title: entry.title,
      at: now,
      ok: true,
      ...(messageId ? { messageId } : {}),
    });
    return {
      ok: true,
      message:
        'Sent to your Kindle. Add the sender address to Amazon\'s Approved Personal Document E-mail List, or Amazon may discard it. / 已发送。请把发件地址加入亚马逊已批准列表，否则可能被静默丢弃。',
      ...(messageId ? { messageId } : {}),
    };
  } catch (error) {
    const code = smtpCode(error);
    const now = Date.now();
    await recordSendResult(id, { at: now, ok: false });
    await appendSendLog(entry, {
      entryId: entry.id,
      title: entry.title,
      at: now,
      ok: false,
      code,
    });
    if (code === 'MAIL_AUTH') throw mailAuth();
    throw mailUnreachable(connectivityDetail(error));
  } finally {
    transporter.close();
  }
}

/** Build an .eml draft that the user can open in their mail client. */
export async function buildEml(id: string): Promise<{ data: Buffer; filename: string }> {
  const settings = await getSettings();
  const entry = await libraryFilePath(id).then((result) => result.entry);
  const attachment = await prepareAttachment(entry);
  const recipient = settings.send.kindleEmail.trim()
    ? normalizeRecipient(settings.send.kindleEmail)
    : undefined;
  if (settings.send.kindleEmail.trim() && !recipient) throw mailRecipientInvalid();
  const config = smtpConfig(settings, (await getSmtpPassword()) ?? '');
  const from = config?.from || settings.send.smtp.from.trim() || settings.send.smtp.user.trim();

  const options: Record<string, unknown> = {
    subject: subjectFor(entry),
    text: mailBody(entry),
    attachments: [
      {
        filename: attachment.filename,
        content: Buffer.from(attachment.content),
        contentType: attachment.contentType,
        encoding: 'base64',
      },
    ],
  };
  if (recipient) options.to = recipient;
  if (from && isEmailLike(extractAddress(from))) options.from = from;

  const composer = new MailComposer(options);
  const data = await new Promise<Buffer>((resolvePromise, reject) => {
    composer.compile().build((error, message) => {
      if (error) reject(error);
      else resolvePromise(message);
    });
  });
  const base = (entry.title || 'book').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
  return { data, filename: `${base}.eml` };
}
