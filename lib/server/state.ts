/**
 * Local state roots for the v2 features (settings, library index, metadata
 * cache, covers, send log).
 *
 * Two directories are involved:
 *   KF_DATA_DIR     (default ~/.kindleforge) — private state, 0700 dir / 0600 files
 *   KF_LIBRARY_DIR  (default ~/KindleForge) — user-visible books, 0755 dir / 0644 files
 *
 * Tests must never touch the real home directory: `setStateDirsForTests()`
 * overrides both roots for the current process. All values are read lazily so
 * an override takes effect without re-importing this module.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

/* ------------------------------------------------------------------ */
/* Roots                                                               */
/* ------------------------------------------------------------------ */

interface TestDirs {
  dataDir?: string;
  libraryDir?: string;
}

const testDirs: TestDirs = {};

/** Expand `~` / `~/x`; leave other values untouched (resolved by callers). */
export function expandHome(input: string): string {
  const value = input.trim();
  if (value === '~') return homedir();
  if (value.startsWith('~/')) return join(homedir(), value.slice(2));
  return value;
}

export function dataRoot(): string {
  if (testDirs.dataDir) return resolve(testDirs.dataDir);
  const fromEnv = process.env.KF_DATA_DIR?.trim();
  return resolve(expandHome(fromEnv || join(homedir(), '.kindleforge')));
}

export function defaultLibraryRoot(): string {
  if (testDirs.libraryDir) return resolve(testDirs.libraryDir);
  const fromEnv = process.env.KF_LIBRARY_DIR?.trim();
  return resolve(expandHome(fromEnv || join(homedir(), 'KindleForge')));
}

/**
 * Override the state roots for tests. Passing an empty object restores the
 * environment/default behaviour. Paths are resolved once at read time.
 */
export function setStateDirsForTests(dirs: TestDirs): void {
  testDirs.dataDir = dirs.dataDir;
  testDirs.libraryDir = dirs.libraryDir;
}

export function getTestDirs(): Readonly<TestDirs> {
  return { ...testDirs };
}

/* ------------------------------------------------------------------ */
/* Filesystem helpers                                                  */
/* ------------------------------------------------------------------ */

export async function ensureDir(dir: string, mode = 0o700): Promise<string> {
  await mkdir(dir, { recursive: true, mode });
  // mkdir honours the umask; force the exact mode for private dirs.
  try {
    const info = await stat(dir);
    if ((info.mode & 0o777) !== mode) await chmod(dir, mode);
  } catch {
    /* best effort: an existing dir owned by us will already be fine */
  }
  return dir;
}

export async function chmodPrivate(file: string, mode = 0o600): Promise<void> {
  try {
    await chmod(file, mode);
  } catch {
    /* best effort */
  }
}

/**
 * Read a JSON file. Returns null when the file is missing, unreadable or not
 * valid JSON — callers decide whether that means "rebuild" or "defaults".
 */
export async function readJsonFile<T>(file: string): Promise<T | null> {
  try {
    const raw = await readFile(file, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Atomic JSON write: temp file in the same directory (0600), fsync-free rename.
 * A crash can leave a stale `.tmp` file but never a truncated index/settings.
 */
export async function atomicWriteJson(
  file: string,
  value: unknown,
  mode = 0o600,
): Promise<void> {
  await ensureDir(dirname(file), 0o700);
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const handle = await open(tmp, 'wx', mode);
  try {
    await handle.writeFile(body, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmodPrivate(tmp, mode);
  await rename(tmp, file);
  await chmodPrivate(file, mode);
}

/** Atomic binary write with a caller-provided temp name pattern. */
export async function atomicWriteFile(
  file: string,
  data: Uint8Array,
  mode = 0o600,
): Promise<void> {
  await ensureDir(dirname(file), 0o700);
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmp, data, { mode });
  await chmodPrivate(tmp, mode);
  await rename(tmp, file);
  await chmodPrivate(file, mode);
}

export async function removeIfExists(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

/** Resolve a relative path below `root`, rejecting any escape (`..`, absolute). */
export function resolveInside(root: string, relative: string): string {
  if (typeof relative !== 'string' || relative.includes('\0')) {
    throw new Error('PATH_INVALID');
  }
  const rootAbs = resolve(root);
  const target = resolve(rootAbs, relative);
  if (target !== rootAbs && !target.startsWith(`${rootAbs}${sep}`)) {
    throw new Error('PATH_ESCAPE');
  }
  return target;
}

export function isInside(root: string, target: string): boolean {
  const rootAbs = resolve(root);
  const abs = resolve(target);
  return abs === rootAbs || abs.startsWith(`${rootAbs}${sep}`);
}

/**
 * Resolve a file that must exist as a regular file (not a symlink) inside
 * `root`. Both the lexical path and the real path are checked, so a symlinked
 * parent or final component cannot escape the library.
 */
export async function resolveRealFileInside(root: string, relative: string): Promise<string> {
  const lexical = resolveInside(root, relative);
  const info = await stat(lexical);
  if (!info.isFile()) throw new Error('NOT_A_FILE');
  const linkInfo = await lstat(lexical);
  if (linkInfo.isSymbolicLink()) throw new Error('SYMLINK_REJECTED');
  const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(lexical)]);
  if (!isInside(rootReal, fileReal)) throw new Error('PATH_ESCAPE');
  return lexical;
}

/* ------------------------------------------------------------------ */
/* In-process mutex                                                    */
/* ------------------------------------------------------------------ */

const tails = new Map<string, Promise<unknown>>();

/**
 * Serialize async work per key (e.g. the library index, settings file).
 * Single-process app: a promise chain is enough; multi-process would need a
 * lock file, explicitly out of scope.
 */
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const quiet = run.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, quiet);
  void quiet.then(() => {
    if (tails.get(key) === quiet) tails.delete(key);
  });
  return run;
}

/* ------------------------------------------------------------------ */
/* Ids, hashes, names                                                  */
/* ------------------------------------------------------------------ */

const ENTRY_ID_RE = /^[a-f0-9]{10}$/;

/** Library ids are exactly 10 lowercase hex chars (crypto.randomBytes(5)). */
export function isEntryId(value: unknown): value is string {
  return typeof value === 'string' && ENTRY_ID_RE.test(value);
}

export function newEntryId(): string {
  return randomBytes(5).toString('hex');
}

export function randomId(): string {
  return randomUUID();
}

/** sha1 hex, used for metadata cache keys and cover ETags. */
export function sha1(input: string | Uint8Array): string {
  const hash = createHash('sha1');
  hash.update(input);
  return hash.digest('hex');
}

/** Strip path separators/control chars and clamp to a sane length. */
export function sanitizeNamePart(input: string, maxLength = 100): string {
  const cleaned = String(input)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[/\\:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.slice(0, maxLength).trim();
}

/** UTF-8 byte length (Node's Buffer.byteLength) without importing Buffer types. */
export function byteLength(input: string): number {
  return Buffer.byteLength(input, 'utf8');
}

export function isAbsolutePath(input: string): boolean {
  return isAbsolute(input);
}
