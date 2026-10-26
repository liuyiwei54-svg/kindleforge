/**
 * Zero-retention temp storage.
 *
 * Layout:  <os.tmpdir()>/kindleforge/<jobId>/{input.<ext>,output.<ext>}
 * - root and every job dir are 0700, files 0600
 * - job ids are UUIDs, and every resolved path is re-checked to live inside
 *   its job dir, so `../` in an id or a filename can never escape
 * - nothing is written to a database; the job store sweeps everything at TTL
 */
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  statfs,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve, sep } from 'node:path';
import { config } from './config';
import { ApiError, insufficientStorage } from './errors';

export const TMP_ROOT = join(tmpdir(), 'kindleforge');

export const MAX_UPLOAD_BYTES = config.maxUploadBytes;
/** Never accept an upload when the temp volume has less free than this. */
export const MIN_FREE_BYTES = config.minFreeBytes;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNSAFE_CHARS_RE = /[\u0000-\u001f\u007f<>:"/\\|?*]/g;

export function isJobId(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

function rootPath(): string {
  return resolve(TMP_ROOT);
}

/** Resolve a job directory, rejecting anything that is not a plain UUID. */
export function jobDirPath(id: string): string {
  if (!isJobId(id)) throw new ApiError('NOT_FOUND', 404, 'Job not found.');
  const root = rootPath();
  const dir = resolve(root, id);
  if (dir === root || !dir.startsWith(root + sep)) throw new ApiError('NOT_FOUND', 404, 'Job not found.');
  return dir;
}

/** Make a user-supplied filename safe: no separators, no control chars, no dotfiles. */
export function safeFileName(name: string, fallback = 'file'): string {
  const base = typeof name === 'string' ? name : '';
  const flattened = base.replace(/\\/g, '/');
  const last = flattened.split('/').pop() ?? '';
  const cleaned = last
    .normalize('NFC')
    .replace(UNSAFE_CHARS_RE, '')
    .replace(/^\.+/, '')
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > 120 ? cleaned.slice(0, 120) : cleaned;
}

export function safeBaseName(original: string, fallback = 'book'): string {
  const base = safeFileName(basename(original.replace(/\\/g, '/')), fallback);
  const withoutExt = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  return withoutExt || fallback;
}

/**
 * Readable ASCII fallback for the Content-Disposition `filename=` slot.
 * Latin names pass through; a pure-CJK name becomes `book-<shortid>.<ext>`
 * instead of a row of underscores, while the real name stays in filename*.
 */
export function asciiFallbackName(filename: string): string {
  const extension = extname(filename);
  const ext = extension.replace(/^\./, '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
  const stem = basename(filename, extension);
  const cleaned = stem
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '-')
    .replace(/[^A-Za-z0-9._ -]/g, '')
    .trim()
    .replace(/[\s._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const suffix = ext ? `.${ext}` : '';
  if (/[A-Za-z]/.test(cleaned)) return `${cleaned}${suffix}`;
  const id = createHash('sha1').update(filename).digest('hex').slice(0, 8);
  return `book-${id}${suffix || '.bin'}`;
}

/** RFC 5987/6266 header value with a working Content-Disposition for CJK names. */
export function buildContentDisposition(filename: string): string {
  const printable = asciiFallbackName(filename).replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${printable}"; filename*=UTF-8''${encoded}`;
}

export async function ensureTmpRoot(): Promise<string> {
  const root = rootPath();
  await mkdir(root, { recursive: true, mode: 0o700 });
  // mkdir's mode is subject to umask; make the guarantee explicit.
  await chmod(root, 0o700).catch(() => undefined);
  return root;
}

export async function createJobDir(id: string, mode = 0o700): Promise<string> {
  const dir = jobDirPath(id);
  await ensureTmpRoot();
  await mkdir(dir, { recursive: true, mode });
  await chmod(dir, mode).catch(() => undefined);
  return dir;
}

function assertInside(dir: string, target: string): void {
  if (target === dir || !target.startsWith(dir + sep)) {
    throw new ApiError('BAD_REQUEST', 400, 'Unsafe file path.');
  }
}

export async function writeJobFile(
  id: string,
  name: string,
  data: Uint8Array | string,
): Promise<string> {
  const dir = await createJobDir(id);
  const safe = safeFileName(name, 'file');
  const target = resolve(dir, safe);
  assertInside(dir, target);
  await writeFile(target, data, { mode: 0o600 });
  // Explicit chmod again: umask can strip bits from the mode passed to open(2).
  await chmod(target, 0o600).catch(() => undefined);
  return safe;
}

export async function readJobFile(id: string, name: string): Promise<Buffer> {
  const dir = jobDirPath(id);
  const target = resolve(dir, safeFileName(name, 'file'));
  assertInside(dir, target);
  return readFile(target);
}

export async function statJobFile(
  id: string,
  name: string,
): Promise<{ size: number; path: string }> {
  const dir = jobDirPath(id);
  const target = resolve(dir, safeFileName(name, 'file'));
  assertInside(dir, target);
  const info = await stat(target);
  return { size: info.size, path: target };
}

export async function removeJobFile(id: string, name: string): Promise<void> {
  try {
    const dir = jobDirPath(id);
    const target = resolve(dir, safeFileName(name, 'file'));
    assertInside(dir, target);
    await unlink(target);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || (error instanceof ApiError && error.status === 404)) return;
    throw error;
  }
}

/** Recursively delete one job directory. Safe to call twice. */
export async function deleteJobDir(id: string): Promise<boolean> {
  if (!isJobId(id)) return false;
  const dir = jobDirPath(id);
  const existed = existsSync(dir);
  await rm(dir, { recursive: true, force: true, maxRetries: 2 });
  return existed;
}

/** Remove the whole temp root — used on SIGINT/SIGTERM. */
export async function deleteTmpRoot(): Promise<void> {
  await rm(rootPath(), { recursive: true, force: true, maxRetries: 2 });
}

/** Summary of the boot sweep (no filenames are logged, only counts). */
export interface OrphanSweepResult {
  scanned: number;
  removed: string[];
  kept: number;
}

/**
 * Delete stale job directories left behind by a hard crash (the normal path is
 * the JobStore TTL sweep). Runs once at boot.
 *
 * Safety: only direct children of `os.tmpdir()/kindleforge` are considered,
 * every resolved path must stay inside that root, symlinks are skipped, and
 * job ids currently active in the store can be protected via `activeIds`.
 */
export async function sweepOrphanJobDirs(
  maxAgeMs = config.orphanMaxAgeMs,
  now = Date.now(),
  activeIds: Iterable<string> = [],
): Promise<OrphanSweepResult> {
  const root = resolve(TMP_ROOT);
  if (!existsSync(root)) return { scanned: 0, removed: [], kept: 0 };
  await ensureTmpRoot();

  const active = new Set(activeIds);
  const removed: string[] = [];
  let kept = 0;

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return { scanned: 0, removed: [], kept: 0 };
  }

  for (const entry of entries) {
    const target = resolve(root, entry.name);
    if (target === root || !target.startsWith(root + sep)) {
      kept += 1;
      continue;
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      kept += 1;
      continue;
    }
    if (active.has(entry.name)) {
      kept += 1;
      continue;
    }
    try {
      const info = await lstat(target);
      if (!info.isDirectory()) {
        kept += 1;
        continue;
      }
      if (now - info.mtimeMs <= maxAgeMs) {
        kept += 1;
        continue;
      }
      await rm(target, { recursive: true, force: true, maxRetries: 2 });
      removed.push(entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      kept += 1;
    }
  }

  return { scanned: entries.length, removed, kept };
}

export function deleteTmpRootSync(): void {
  try {
    rmSync(rootPath(), { recursive: true, force: true, maxRetries: 2 });
  } catch {
    /* process is exiting; best effort */
  }
}

/** Free bytes on the volume that holds the temp directory. */
export async function freeBytes(dir = tmpdir()): Promise<number> {
  for (const candidate of [dir, tmpdir()]) {
    try {
      const info = await statfs(candidate);
      return Number(info.bavail) * Number(info.bsize);
    } catch {
      // The temp root may not exist yet — fall back to its parent volume.
    }
  }
  return Number.POSITIVE_INFINITY;
}

/** Reject uploads early when the temp volume is below the 2GB floor. */
export async function assertFreeSpace(extraBytes = 0): Promise<void> {
  await ensureTmpRoot();
  const free = await freeBytes(TMP_ROOT);
  if (free < MIN_FREE_BYTES + extraBytes) throw insufficientStorage(free);
}
