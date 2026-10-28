/**
 * Persistent local settings (v2).
 *
 * File layout (all under KF_DATA_DIR, default ~/.kindleforge):
 *   settings.json  0600 — library / metadata / send preferences
 *   .secret.key    0600 — 32 random bytes, AES-256-GCM key
 *
 * The SMTP password is stored as `enc:v1:<base64(iv|tag|ciphertext)>` and is
 * never returned by the API. `GET /api/settings` only exposes `hasPassword`.
 *
 * The cache is process-wide so a restart (or `resetSettingsForTests()`)
 * re-reads the file; every successful write replaces the cache immediately.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { z } from 'zod';
import type {
  MetadataProvider,
  Settings,
  SettingsPatch,
} from '../shared/types';
import {
  DEFAULT_PROVIDERS,
  DEFAULT_SEND_LIMIT_MB,
  MAX_SEND_LIMIT_MB,
} from './settings-defaults';
import { ApiError, settingsInvalid, settingsIo } from './errors';
import {
  atomicWriteJson,
  chmodPrivate,
  dataRoot,
  defaultLibraryRoot,
  ensureDir,
  expandHome,
  readJsonFile,
  withLock,
} from './state';

export const SETTINGS_FILENAME = 'settings.json';
export const SECRET_FILENAME = '.secret.key';
export const SECRET_PREFIX = 'enc:v1:';
const SECRET_KEY_BYTES = 32;
const IV_BYTES = 12;

/* ------------------------------------------------------------------ */
/* Disk shape                                                          */
/* ------------------------------------------------------------------ */

export interface DiskSmtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  /** `enc:v1:...`; absent/empty when no password is saved. */
  password?: string;
}

export interface DiskSettings {
  version: 1;
  library: { dir: string; autoSave: boolean };
  metadata: {
    enabled: boolean;
    providers: MetadataProvider[];
    language: 'auto' | 'zh' | 'en';
  };
  send: {
    smtp: DiskSmtp;
    kindleEmail: string;
    maxAttachmentMb: number;
  };
}

export function settingsPath(): string {
  return join(dataRoot(), SETTINGS_FILENAME);
}

export function secretKeyPath(): string {
  return join(dataRoot(), SECRET_FILENAME);
}

function defaultDiskSettings(): DiskSettings {
  return {
    version: 1,
    library: { dir: defaultLibraryRoot(), autoSave: true },
    metadata: {
      enabled: true,
      providers: [...DEFAULT_PROVIDERS],
      language: 'auto',
    },
    send: {
      smtp: { host: '', port: 587, secure: false, user: '', from: '' },
      kindleEmail: '',
      maxAttachmentMb: DEFAULT_SEND_LIMIT_MB,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Normalisation (defensive: the file may have been hand-edited)       */
/* ------------------------------------------------------------------ */

function str(value: unknown, fallback = '', max = 1024): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeMailbox(value: unknown, fallback = ''): string {
  return str(value, fallback, 320).trim();
}

function normalizeDisk(raw: unknown): DiskSettings {
  const base = defaultDiskSettings();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const library = (r.library ?? {}) as Record<string, unknown>;
  const metadata = (r.metadata ?? {}) as Record<string, unknown>;
  const send = (r.send ?? {}) as Record<string, unknown>;
  const smtp = (send.smtp ?? {}) as Record<string, unknown>;

  const providers = Array.isArray(metadata.providers)
    ? metadata.providers.filter(
        (p): p is MetadataProvider => p === 'douban' || p === 'google' || p === 'openlibrary',
      )
    : base.metadata.providers;
  const uniqueProviders = [...new Set(providers)];

  return {
    version: 1,
    library: {
      dir: str(library.dir, base.library.dir).trim() || base.library.dir,
      autoSave: bool(library.autoSave, base.library.autoSave),
    },
    metadata: {
      enabled: bool(metadata.enabled, base.metadata.enabled),
      providers: uniqueProviders,
      language:
        metadata.language === 'zh' || metadata.language === 'en'
          ? metadata.language
          : 'auto',
    },
    send: {
      smtp: {
        host: str(smtp.host, '', 255).trim(),
        port: int(smtp.port, 587, 1, 65535),
        secure: bool(smtp.secure, false),
        user: str(smtp.user, '', 320).trim(),
        from: str(smtp.from, '', 320).trim(),
        ...(typeof smtp.password === 'string' && smtp.password.trim()
          ? { password: smtp.password.trim() }
          : {}),
      },
      kindleEmail: normalizeMailbox(send.kindleEmail),
      maxAttachmentMb: int(
        send.maxAttachmentMb,
        DEFAULT_SEND_LIMIT_MB,
        1,
        MAX_SEND_LIMIT_MB,
      ),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Encryption                                                          */
/* ------------------------------------------------------------------ */

async function ensureSecretKey(): Promise<Buffer> {
  const file = secretKeyPath();
  try {
    const existing = await readFile(file);
    if (existing.length === SECRET_KEY_BYTES) {
      await chmodPrivate(file);
      return existing;
    }
  } catch {
    /* create below */
  }
  await ensureDir(dataRoot(), 0o700);
  const key = randomBytes(SECRET_KEY_BYTES);
  try {
    await writeFile(file, key, { mode: 0o600, flag: 'wx' });
    await chmodPrivate(file);
    return key;
  } catch (error) {
    // Another request may have created it between read and write.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      const existing = await readFile(file);
      if (existing.length === SECRET_KEY_BYTES) {
        await chmodPrivate(file);
        return existing;
      }
    }
    throw settingsIo();
  }
}

export function encryptWithKey(plain: string, key: Uint8Array): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${SECRET_PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptWithKey(token: string, key: Uint8Array): string {
  if (!token.startsWith(SECRET_PREFIX)) throw new Error('SECRET_FORMAT');
  const payload = Buffer.from(token.slice(SECRET_PREFIX.length), 'base64');
  if (payload.length <= IV_BYTES + 16) throw new Error('SECRET_TRUNCATED');
  const iv = payload.subarray(0, IV_BYTES);
  const tag = payload.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = payload.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/* ------------------------------------------------------------------ */
/* Load / save                                                         */
/* ------------------------------------------------------------------ */

let cached: DiskSettings | null = null;
let loadPromise: Promise<DiskSettings> | null = null;

async function readFromDisk(): Promise<DiskSettings> {
  await ensureDir(dataRoot(), 0o700);
  const file = settingsPath();
  let info: Awaited<ReturnType<typeof stat>> | null = null;
  try {
    info = await stat(file);
  } catch {
    info = null;
  }
  if (!info) {
    const fresh = defaultDiskSettings();
    await atomicWriteJson(file, fresh, 0o600);
    await chmodPrivate(file);
    return fresh;
  }
  await chmodPrivate(file);
  const raw = await readJsonFile<unknown>(file);
  if (raw === null) {
    // Corrupt JSON: keep a backup (best effort) and fall back to defaults.
    try {
      const backup = `${file}.corrupt-${Date.now()}`;
      await writeFile(backup, await readFile(file), { mode: 0o600 });
    } catch {
      /* ignore */
    }
    const fresh = defaultDiskSettings();
    await atomicWriteJson(file, fresh, 0o600);
    return fresh;
  }
  return normalizeDisk(raw);
}

/** Load (once) the internal settings, including the encrypted password. */
export async function loadDiskSettings(): Promise<DiskSettings> {
  if (cached) return cached;
  if (!loadPromise) {
    loadPromise = readFromDisk()
      .then((settings) => {
        cached = settings;
        return settings;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  return loadPromise;
}

function toPublic(disk: DiskSettings): Settings {
  return {
    version: 1,
    library: { ...disk.library },
    metadata: { ...disk.metadata, providers: [...disk.metadata.providers] },
    send: {
      smtp: {
        host: disk.send.smtp.host,
        port: disk.send.smtp.port,
        secure: disk.send.smtp.secure,
        user: disk.send.smtp.user,
        from: disk.send.smtp.from,
        hasPassword: Boolean(disk.send.smtp.password),
      },
      kindleEmail: disk.send.kindleEmail,
      maxAttachmentMb: disk.send.maxAttachmentMb,
    },
  };
}

/** Public settings — never contains the password (plain or encrypted). */
export async function getSettings(): Promise<Settings> {
  return toPublic(await loadDiskSettings());
}

/**
 * Decrypted SMTP password for the mailer. Returns null when none is saved or
 * the ciphertext/key no longer match (e.g. the key file was replaced).
 */
export async function getSmtpPassword(): Promise<string | null> {
  const disk = await loadDiskSettings();
  const token = disk.send.smtp.password;
  if (!token) return null;
  try {
    const key = await ensureSecretKey();
    return decryptWithKey(token, key);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const KINDLE_RECIPIENT_RE = /^[^\s@]+@(?:kindle\.com|free\.kindle\.com)$/i;
const MAILBOX_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MailboxSchema = z.string().trim().max(320);

const SettingsPatchSchema = z
  .object({
    library: z
      .object({
        dir: z.string().trim().min(1).max(1024).optional(),
        autoSave: z.boolean().optional(),
      })
      .optional(),
    metadata: z
      .object({
        enabled: z.boolean().optional(),
        providers: z.array(z.enum(['douban', 'google', 'openlibrary'])).max(3).optional(),
        language: z.enum(['auto', 'zh', 'en']).optional(),
      })
      .optional(),
    send: z
      .object({
        smtp: z
          .object({
            host: z.string().trim().max(255).optional(),
            port: z.coerce.number().int().min(1).max(65535).optional(),
            secure: z.boolean().optional(),
            user: z.string().trim().max(320).optional(),
            from: MailboxSchema.optional(),
            password: z.string().max(512).optional(),
            clearPassword: z.boolean().optional(),
            // Tolerated for clients that echo a GET /api/settings object back.
            hasPassword: z.boolean().optional(),
          })
          .optional(),
        kindleEmail: MailboxSchema.optional(),
        maxAttachmentMb: z.preprocess(
          (value) => (typeof value === 'number' ? Math.min(MAX_SEND_LIMIT_MB, Math.max(1, Math.round(value))) : value),
          z.coerce.number().int().min(1).max(MAX_SEND_LIMIT_MB),
        ).optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    const email = value.send?.kindleEmail;
    if (email && !KINDLE_RECIPIENT_RE.test(email)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['send', 'kindleEmail'],
        message: 'Kindle e-mail must end with @kindle.com or @free.kindle.com',
      });
    }
    const from = value.send?.smtp?.from;
    if (from && !MAILBOX_RE.test(from)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['send', 'smtp', 'from'],
        message: 'From address is not a valid e-mail address',
      });
    }
    if (value.metadata?.providers && value.metadata.providers.length === 0) {
      // Allowed: metadata lookup is effectively disabled, UI shows a hint.
    }
  });

export type ValidatedSettingsPatch = z.infer<typeof SettingsPatchSchema>;

export function validateSettingsPatch(input: unknown): ValidatedSettingsPatch {
  const parsed = SettingsPatchSchema.safeParse(input ?? {});
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path.join('.') || 'settings';
    throw settingsInvalid(`Invalid settings at "${path}": ${first?.message ?? 'bad value'}`);
  }
  return parsed.data;
}

/** Ensure a library directory exists and is writable; throws ApiError 507. */
export async function ensureLibraryDirWritable(input: string): Promise<string> {
  const expanded = expandHome(input);
  if (!isAbsolute(expanded) || expanded.includes('\0')) {
    throw settingsInvalid('library.dir must be an absolute directory path');
  }
  const dir = resolve(expanded);
  try {
    await ensureDir(dir, 0o755);
    const probe = join(dir, `.kindleforge-write-test-${randomBytes(3).toString('hex')}`);
    await writeFile(probe, 'ok', { mode: 0o600, flag: 'wx' });
    const { rm } = await import('node:fs/promises');
    await rm(probe, { force: true });
    return dir;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('LIBRARY_UNWRITABLE', 507, 'Library directory is not writable.', {
      zh: '书库目录不存在或不可写。请换一个目录，或检查权限/磁盘空间。',
      en: 'The library directory does not exist or is not writable. Pick another folder or check permissions/disk space.',
    });
  }
}

/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */

async function saveDisk(next: DiskSettings): Promise<void> {
  try {
    await atomicWriteJson(settingsPath(), next, 0o600);
    await chmodPrivate(settingsPath());
  } catch {
    throw settingsIo();
  }
}

/**
 * Apply a partial update. Semantics:
 *  - omitted or empty `smtp.password` keeps the previous password
 *  - `clearPassword: true` removes it
 *  - non-empty `smtp.password` replaces it (encrypted at rest)
 */
export async function updateSettings(input: unknown): Promise<Settings> {
  const patch = validateSettingsPatch(input);
  return withLock('settings', async () => {
    const current = await loadDiskSettings();
    const next: DiskSettings = {
      version: 1,
      library: { ...current.library },
      metadata: { ...current.metadata, providers: [...current.metadata.providers] },
      send: {
        ...current.send,
        smtp: { ...current.send.smtp },
      },
    };

    if (patch.library) {
      if (patch.library.dir !== undefined) {
        next.library.dir = await ensureLibraryDirWritable(patch.library.dir);
      }
      if (patch.library.autoSave !== undefined) next.library.autoSave = patch.library.autoSave;
    }
    if (patch.metadata) {
      if (patch.metadata.enabled !== undefined) next.metadata.enabled = patch.metadata.enabled;
      if (patch.metadata.providers !== undefined) {
        next.metadata.providers = [...new Set(patch.metadata.providers)];
      }
      if (patch.metadata.language !== undefined) next.metadata.language = patch.metadata.language;
    }
    if (patch.send) {
      const smtpPatch = patch.send.smtp;
      if (smtpPatch) {
        if (smtpPatch.host !== undefined) next.send.smtp.host = smtpPatch.host;
        if (smtpPatch.port !== undefined) next.send.smtp.port = smtpPatch.port;
        if (smtpPatch.secure !== undefined) next.send.smtp.secure = smtpPatch.secure;
        if (smtpPatch.user !== undefined) next.send.smtp.user = smtpPatch.user;
        if (smtpPatch.from !== undefined) next.send.smtp.from = smtpPatch.from;
        if (smtpPatch.clearPassword === true) {
          delete next.send.smtp.password;
        } else if (typeof smtpPatch.password === 'string' && smtpPatch.password.length > 0) {
          const key = await ensureSecretKey();
          next.send.smtp.password = encryptWithKey(smtpPatch.password, key);
        }
      }
      if (patch.send.kindleEmail !== undefined) next.send.kindleEmail = patch.send.kindleEmail;
      if (patch.send.maxAttachmentMb !== undefined) {
        next.send.maxAttachmentMb = patch.send.maxAttachmentMb;
      }
    }

    await saveDisk(next);
    cached = next;
    return toPublic(next);
  });
}

/** Test hook: forget the in-memory settings so the next read hits the disk. */
export function resetSettingsForTests(): void {
  cached = null;
  loadPromise = null;
}
