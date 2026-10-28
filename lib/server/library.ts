/**
 * Local library: files live in `settings.library.dir` (user-visible, default
 * ~/KindleForge); the index, covers and the rest of KindleForge state live in
 * KF_DATA_DIR (default ~/.kindleforge).
 *
 * The index is only a cache: if it is missing/corrupt, or the library directory
 * changed, it is rebuilt by scanning the directory. Stable ids are derived from
 * the file name + mtime + size, so a rebuilt index keeps the same id for an
 * untouched file. Entries whose file vanished are marked `missing`, never
 * silently dropped.
 */
import { randomBytes } from 'node:crypto';
import {
  chmod,
  copyFile,
  readFile,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import JSZip from 'jszip';
import sharp from 'sharp';
import { z } from 'zod';
import type { FormatId } from '../engine/types';
import { FORMAT_INFO } from '../engine/formats';
import { assertPublicHttpUrl } from './net';
import { imageRequestHeaders } from './metadata/http';
import type {
  LibraryEntry,
  LibraryList,
  MetadataPatch,
} from '../shared/types';
import {
  badRequest,
  coverUnavailable,
  libraryFileGone,
  libraryIo,
  libraryNotFound,
  notFound,
  resultNotReady,
  revealUnsupported,
  ApiError,
} from './errors';
import { getJobStore, type Job } from './jobs';
import { getSettings } from './settings';
import {
  COVER_JPEG_QUALITY,
  COVER_MAX_BYTES,
  COVER_MAX_EDGE,
} from './settings-defaults';
import { jobDirPath, MAX_UPLOAD_BYTES } from './storage';
import {
  atomicWriteJson,
  byteLength,
  dataRoot,
  ensureDir,
  isEntryId,
  newEntryId,
  readJsonFile,
  resolveInside,
  resolveRealFileInside,
  sanitizeNamePart,
  sha1,
  withLock,
} from './state';
import { guessForFilename } from './metadata';

export const LIBRARY_FILENAME = 'library.json';
const INDEX_VERSION = 1;

export interface LibraryStats {
  total: number;
  totalBytes: number;
  latestAddedAt: number | null;
  dir: string;
}

export interface LibraryQuery {
  q?: string;
  sort?: 'added' | 'title' | 'author' | 'size';
  format?: FormatId;
}

export interface PatchResult {
  entry: LibraryEntry;
  warnings: string[];
}

interface DiskLibrary {
  version: number;
  dir: string;
  entries: LibraryEntry[];
}

interface LoadedLibrary {
  dir: string;
  entries: LibraryEntry[];
  changed: boolean;
}

const metadataPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    author: z.string().trim().max(120).optional(),
    isbn: z.string().trim().max(32).optional(),
    publisher: z.string().trim().max(200).optional(),
    language: z.string().trim().max(32).optional(),
    description: z.string().trim().max(4000).optional(),
    coverUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => /^https?:\/\//i.test(value), { message: 'coverUrl must be http(s)' })
      .optional(),
  })
  .strict();

export function libraryIndexPath(): string {
  return path.join(dataRoot(), LIBRARY_FILENAME);
}

function coversDir(): string {
  return path.join(dataRoot(), 'covers');
}

function coverPath(id: string): string {
  return path.join(coversDir(), `${id}.jpg`);
}

async function readSettingsDir(): Promise<string> {
  const settings = await getSettings();
  return settings.library.dir;
}

function formatFromName(name: string): FormatId | null {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (!ext) return null;
  for (const info of Object.values(FORMAT_INFO)) {
    if (info.ext.includes(ext)) return info.id;
  }
  return null;
}

function extensionFor(format: FormatId): string {
  return FORMAT_INFO[format]?.ext[0] ?? format;
}

function mimeFor(format: FormatId): string {
  return FORMAT_INFO[format]?.mime ?? 'application/octet-stream';
}

function sortEntries(entries: LibraryEntry[], sort: LibraryQuery['sort']): LibraryEntry[] {
  const copy = [...entries];
  switch (sort) {
    case 'title':
      return copy.sort(
        (a, b) => a.title.localeCompare(b.title, 'zh-Hans') || a.author.localeCompare(b.author, 'zh-Hans'),
      );
    case 'author':
      return copy.sort(
        (a, b) => a.author.localeCompare(b.author, 'zh-Hans') || a.title.localeCompare(b.title, 'zh-Hans'),
      );
    case 'size':
      return copy.sort((a, b) => b.size - a.size);
    case 'added':
    default:
      return copy.sort((a, b) => b.addedAt - a.addedAt || b.updatedAt - a.updatedAt);
  }
}

function normalizeEntry(raw: unknown): LibraryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const entry = raw as Partial<LibraryEntry>;
  if (!isEntryId(entry.id) || typeof entry.filename !== 'string') return null;
  if (typeof entry.format !== 'string' || !(entry.format in FORMAT_INFO)) return null;
  if (!entry.filename.trim()) return null;
  const now = Date.now();
  return {
    id: entry.id,
    filename: entry.filename,
    title: typeof entry.title === 'string' && entry.title.trim() ? entry.title : 'Untitled',
    author: typeof entry.author === 'string' ? entry.author : '',
    format: entry.format as FormatId,
    size: typeof entry.size === 'number' && entry.size >= 0 ? entry.size : 0,
    addedAt: typeof entry.addedAt === 'number' ? entry.addedAt : now,
    updatedAt: typeof entry.updatedAt === 'number' ? entry.updatedAt : now,
    ...(typeof entry.sourceName === 'string' ? { sourceName: entry.sourceName } : {}),
    ...(typeof entry.sourceFormat === 'string' && entry.sourceFormat in FORMAT_INFO
      ? { sourceFormat: entry.sourceFormat as FormatId }
      : {}),
    ...(typeof entry.engine === 'string' ? { engine: entry.engine } : {}),
    ...(typeof entry.isbn === 'string' ? { isbn: entry.isbn } : {}),
    ...(typeof entry.publisher === 'string' ? { publisher: entry.publisher } : {}),
    ...(typeof entry.language === 'string' ? { language: entry.language } : {}),
    ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    hasCover: entry.hasCover === true,
    ...(typeof entry.coverVersion === 'number' ? { coverVersion: entry.coverVersion } : {}),
    ...(typeof entry.savedFromJobId === 'string' ? { savedFromJobId: entry.savedFromJobId } : {}),
    ...(typeof entry.sendCount === 'number' ? { sendCount: entry.sendCount } : {}),
    ...(typeof entry.lastSentAt === 'number' ? { lastSentAt: entry.lastSentAt } : {}),
    ...(typeof entry.lastSendOk === 'boolean' ? { lastSendOk: entry.lastSendOk } : {}),
    ...(entry.missing === true ? { missing: true } : {}),
  };
}

/* ---------------------------------------------------------------- EPUB -- */

interface EpubInfo {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  isbn?: string;
  cover?: Buffer;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstTag(text: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(text);
  if (!match) return undefined;
  const value = decodeXmlText(match[1] ?? '');
  return value || undefined;
}

async function findOpfPath(zip: JSZip): Promise<string | null> {
  const container = zip.file('META-INF/container.xml');
  if (container) {
    const xml = await container.async('string');
    const match = /<rootfile\b[^>]*\bfull-path\s*=\s*["']([^"']+)["']/i.exec(xml);
    if (match) return decodeXmlText(match[1]);
  }
  const candidate = Object.keys(zip.files).find((name) => /\.opf$/i.test(name));
  return candidate ?? null;
}

async function readEpubInfo(bytes: Uint8Array): Promise<EpubInfo> {
  try {
    const zip = await JSZip.loadAsync(bytes);
    const opfPath = await findOpfPath(zip);
    if (!opfPath) return {};
    const opfFile = zip.file(opfPath);
    if (!opfFile) return {};
    const opf = await opfFile.async('string');
    const metadata = /<metadata\b[^>]*>([\s\S]*?)<\/metadata>/i.exec(opf)?.[1] ?? opf;
    const creators = [...metadata.matchAll(/<dc:creator\b[^>]*>([\s\S]*?)<\/dc:creator>/gi)]
      .map((match) => decodeXmlText(match[1] ?? ''))
      .filter(Boolean);
    const identifiers = [...metadata.matchAll(/<dc:identifier\b[^>]*>([\s\S]*?)<\/dc:identifier>/gi)]
      .map((match) => decodeXmlText(match[1] ?? ''))
      .filter(Boolean);
    let isbn: string | undefined;
    for (const identifier of identifiers) {
      const digits = identifier.replace(/^(?:urn:)?(?:isbn:)?/i, '').replace(/[\s-]/g, '').toUpperCase();
      if (/^\d{13}$/.test(digits) || /^\d{9}[\dX]$/.test(digits)) {
        isbn = digits;
        break;
      }
    }

    // Cover: OPF3 properties="cover-image" wins, then the legacy meta name=cover.
    let cover: Buffer | undefined;
    try {
      const manifest = /<manifest\b[^>]*>([\s\S]*?)<\/manifest>/i.exec(opf)?.[1] ?? '';
      const items = [...manifest.matchAll(/<item\b([^>]*)\/?>/gi)].map((match) => match[1] ?? '');
      const attr = (attrs: string, name: string): string | undefined => {
        const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs);
        return match ? decodeXmlText(match[1]) : undefined;
      };
      const coverMeta = /<meta\b[^>]*\bname\s*=\s*["']cover["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i.exec(
        metadata,
      )?.[1];
      const coverItem =
        items.find((attrs) => /\bproperties\s*=\s*["'][^"']*cover-image/i.test(attrs)) ??
        (coverMeta ? items.find((attrs) => attr(attrs, 'id') === coverMeta) : undefined);
      const href = coverItem ? attr(coverItem, 'href') : undefined;
      if (href) {
        const dir = path.posix.dirname(opfPath);
        const imagePath = path.posix.normalize(path.posix.join(dir, decodeURIComponent(href.split('#')[0] ?? href)));
        if (!imagePath.startsWith('..')) {
          const file =
            zip.file(imagePath) ??
            Object.keys(zip.files)
              .filter((name) => name.toLowerCase() === imagePath.toLowerCase())
              .map((name) => zip.file(name))[0];
          if (file) cover = Buffer.from(await file.async('uint8array'));
        }
      }
    } catch {
      // A missing/broken cover must not break metadata extraction.
    }

    const info: EpubInfo = {};
    const title = firstTag(metadata, 'dc:title');
    if (title) info.title = title;
    if (creators.length) info.author = creators.join(', ');
    const language = firstTag(metadata, 'dc:language');
    if (language) info.language = language;
    const publisher = firstTag(metadata, 'dc:publisher');
    if (publisher) info.publisher = publisher;
    const description = firstTag(metadata, 'dc:description');
    if (description) info.description = description.slice(0, 4000);
    if (isbn) info.isbn = isbn;
    if (cover) info.cover = cover;
    return info;
  } catch {
    return {};
  }
}

async function normalizeCover(input: Buffer): Promise<Buffer> {
  return sharp(input, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({
      width: COVER_MAX_EDGE,
      height: COVER_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: COVER_JPEG_QUALITY })
    .toBuffer();
}

interface CoverSaveResult {
  hasCover: boolean;
  coverVersion: number;
  failed: boolean;
}

async function saveCover(id: string, data: Buffer): Promise<CoverSaveResult> {
  if (data.length === 0 || data.length > COVER_MAX_BYTES) return { hasCover: false, coverVersion: 0, failed: false };
  try {
    const jpeg = await normalizeCover(data);
    await ensureDir(coversDir(), 0o700);
    const target = coverPath(id);
    const temporary = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    await writeFile(temporary, jpeg, { mode: 0o600, flag: 'wx' });
    await rename(temporary, target);
    return { hasCover: true, coverVersion: 1, failed: false };
  } catch {
    return { hasCover: false, coverVersion: 0, failed: true };
  }
}

/* ------------------------------------------------------------- filename -- */

function fitBase(title: string, author: string, format: FormatId): string {
  const extension = extensionFor(format);
  const titlePart = sanitizeNamePart(title, 80) || 'Untitled';
  const authorPart = sanitizeNamePart(author, 40);
  let base = authorPart ? `${titlePart} - ${authorPart}` : titlePart;
  while (byteLength(`${base}.${extension}`) > 120 && base.length > 1) {
    base = base.slice(0, -1).trimEnd();
  }
  return `${base || 'Untitled'}.${extension}`;
}

async function uniqueFilename(dir: string, desired: string): Promise<string> {
  const extension = path.extname(desired);
  const stem = desired.slice(0, desired.length - extension.length);
  let candidate = desired;
  for (let index = 2; index < 1000; index += 1) {
    try {
      await stat(path.join(dir, candidate));
      candidate = `${stem} (${index})${extension}`;
    } catch {
      return candidate;
    }
  }
  throw libraryIo();
}

async function pingDirectory(dir: string): Promise<void> {
  try {
    await ensureDir(dir, 0o755);
  } catch {
    throw new ApiError('LIBRARY_UNWRITABLE', 507, 'Library directory is not writable.', {
      zh: '书库目录不可写，请检查权限或磁盘空间。',
      en: 'The library directory is not writable. Check permissions or free space.',
    });
  }
}

/* ---------------------------------------------------------------- index -- */

async function scanLibrary(dir: string): Promise<LibraryEntry[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const entries: LibraryEntry[] = [];
  for (const filename of names.sort()) {
    if (filename.startsWith('.')) continue;
    const filePath = path.join(dir, filename);
    try {
      const stats = await stat(filePath);
      if (!stats.isFile() || stats.size === 0) continue;
      const format = formatFromName(filename);
      if (!format) continue;
      const guessed = await guessForFilename(filename);
      const addedAt =
        Number.isFinite(stats.birthtimeMs) && stats.birthtimeMs > 0
          ? Math.round(stats.birthtimeMs)
          : Math.round(stats.mtimeMs);
      const id = sha1(`${filename}|${Math.round(stats.mtimeMs)}|${stats.size}`).slice(0, 10);
      const entry: LibraryEntry = {
        id,
        filename,
        title: guessed.title || filename.replace(/\.[^.]+$/, ''),
        author: guessed.author ?? '',
        format,
        size: stats.size,
        addedAt,
        updatedAt: Math.round(stats.mtimeMs),
        hasCover: false,
        ...(guessed.isbn ? { isbn: guessed.isbn } : {}),
      };
      // Duplicate stable ids are possible only for files with identical
      // name/mtime/size, i.e. practically never; keep the index valid anyway.
      if (entries.some((existing) => existing.id === entry.id)) {
        entry.id = newEntryId();
      }
      entries.push(entry);
    } catch {
      // Ignore files that disappear while scanning.
    }
  }
  return entries;
}

async function rebuildLocked(dir: string): Promise<LoadedLibrary> {
  const entries = await scanLibrary(dir);
  return { dir, entries, changed: true };
}

async function saveIndexLocked(dir: string, entries: LibraryEntry[]): Promise<void> {
  const disk: DiskLibrary = { version: INDEX_VERSION, dir, entries };
  await ensureDir(dataRoot(), 0o700);
  try {
    await atomicWriteJson(libraryIndexPath(), disk, 0o600);
  } catch {
    throw libraryIo();
  }
}

async function loadIndexLocked(): Promise<LoadedLibrary> {
  const dir = await readSettingsDir();
  let disk: DiskLibrary | null = null;
  try {
    disk = await readJsonFile<DiskLibrary>(libraryIndexPath());
  } catch {
    disk = null;
  }

  if (
    !disk ||
    disk.version !== INDEX_VERSION ||
    typeof disk.dir !== 'string' ||
    !Array.isArray(disk.entries) ||
    disk.dir !== dir
  ) {
    if (disk && typeof disk === 'object') {
      // Keep a copy of an unreadable/old index for debugging, never resurrect it.
      try {
        await rename(libraryIndexPath(), `${libraryIndexPath()}.bak-${Date.now()}`);
      } catch {
        // noop
      }
    }
    const rebuilt = await rebuildLocked(dir);
    await saveIndexLocked(dir, rebuilt.entries);
    return rebuilt;
  }

  let changed = false;
  const entries: LibraryEntry[] = [];
  for (const raw of disk.entries) {
    const entry = normalizeEntry(raw);
    if (!entry) {
      changed = true;
      continue;
    }
    try {
      const stats = await stat(path.join(dir, entry.filename));
      if (!stats.isFile()) throw new Error('not a file');
      if (entry.missing) {
        delete entry.missing;
        changed = true;
      }
      if (entry.size !== stats.size) {
        entry.size = stats.size;
        changed = true;
      }
    } catch {
      if (!entry.missing) {
        entry.missing = true;
        changed = true;
      }
    }
    entries.push(entry);
  }
  if (changed) await saveIndexLocked(dir, entries);
  return { dir, entries, changed };
}

/* --------------------------------------------------------------- create -- */

interface InsertOptions {
  sourcePath?: string;
  data?: Uint8Array;
  originalName: string;
  format: FormatId;
  title?: string;
  author?: string;
  sourceName?: string;
  sourceFormat?: FormatId;
  engine?: string;
  savedFromJobId?: string;
}

async function insertLocked(options: InsertOptions): Promise<LibraryEntry> {
  const dir = await readSettingsDir();
  await pingDirectory(dir);
  // Resolve the index before the new file becomes visible, otherwise the
  // rebuild-on-missing-index scan would pick up the half-inserted file and
  // the append below would create a duplicate row.
  const loaded = await loadIndexLocked();

  const guessed = await guessForFilename(options.sourceName || options.originalName);
  let title = (options.title ?? '').trim() || guessed.title;
  let author = (options.author ?? '').trim() || guessed.author;
  let epubInfo: EpubInfo = {};
  if (options.format === 'epub') {
    try {
      const epubBytes = options.data ?? (options.sourcePath ? await readFile(options.sourcePath) : undefined);
      if (epubBytes) epubInfo = await readEpubInfo(epubBytes);
    } catch {
      epubInfo = {};
    }
  }
  if (!title.trim() && epubInfo.title) title = epubInfo.title;
  if (!author.trim() && epubInfo.author) author = epubInfo.author;
  title = title.trim() || options.originalName.replace(/\.[^.]+$/, '') || 'Untitled';
  author = author.trim();

  const filename = await uniqueFilename(dir, fitBase(title, author, options.format));
  const targetPath = path.join(dir, filename);
  const temporary = path.join(dir, `.kf-${newEntryId()}-${randomBytes(4).toString('hex')}.tmp`);

  try {
    if (options.data) {
      await writeFile(temporary, options.data, { mode: 0o600, flag: 'wx' });
    } else if (options.sourcePath) {
      await copyFile(options.sourcePath, temporary);
      await chmod(temporary, 0o600);
    } else {
      throw libraryIo();
    }
    await rename(temporary, targetPath);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw libraryIo();
  }

  const stats = await stat(targetPath);
  const now = Date.now();
  // Stable across an index rebuild: filename + mtime + size.
  let id = sha1(`${filename}|${Math.round(stats.mtimeMs)}|${stats.size}`).slice(0, 10);
  if (loaded.entries.some((existing) => existing.id === id)) id = newEntryId();
  const cover = epubInfo.cover
    ? await saveCover(id, epubInfo.cover)
    : { hasCover: false, coverVersion: 0, failed: false };
  const entry: LibraryEntry = {
    id,
    filename,
    title,
    author,
    format: options.format,
    size: stats.size,
    addedAt: now,
    updatedAt: now,
    ...(options.sourceName ? { sourceName: path.basename(options.sourceName) } : {}),
    ...(options.sourceFormat ? { sourceFormat: options.sourceFormat } : {}),
    ...(options.engine ? { engine: options.engine } : {}),
    ...(epubInfo.isbn || guessed.isbn
      ? { isbn: epubInfo.isbn ?? guessed.isbn }
      : {}),
    ...(epubInfo.publisher ? { publisher: epubInfo.publisher } : {}),
    ...(epubInfo.language ? { language: epubInfo.language } : {}),
    ...(epubInfo.description ? { description: epubInfo.description } : {}),
    hasCover: cover.hasCover,
    ...(cover.hasCover ? { coverVersion: cover.coverVersion } : {}),
    ...(options.savedFromJobId ? { savedFromJobId: options.savedFromJobId } : {}),
  };

  try {
    await saveIndexLocked(loaded.dir, [...loaded.entries, entry]);
  } catch (error) {
    await unlink(targetPath).catch(() => undefined);
    await unlink(coverPath(id)).catch(() => undefined);
    if (error instanceof ApiError) throw error;
    throw libraryIo();
  }
  return entry;
}

async function insertJobLocked(job: Job): Promise<LibraryEntry> {
  const loaded = await loadIndexLocked();
  const existing = loaded.entries.find((entry) => entry.savedFromJobId === job.id);
  if (existing) return existing;
  if (job.status !== 'done' || !job.resultPath) throw resultNotReady();
  const source = resolveInside(jobDirPath(job.id), job.resultPath);
  return insertLocked({
    sourcePath: source,
    originalName: job.resultName ?? job.resultPath,
    format: job.target,
    sourceName: job.source.name,
    sourceFormat: job.source.format,
    engine: job.engine,
    savedFromJobId: job.id,
  });
}

/** Auto-save path: null when the user disabled library.autoSave. */
export async function saveJobResult(job: Job): Promise<LibraryEntry | null> {
  const settings = await getSettings();
  if (!settings.library.autoSave) return null;
  return withLock('library', () => insertJobLocked(job));
}

/** Manual save from the result card; works even when auto-save is off. */
export async function saveJobToLibrary(jobId: string): Promise<LibraryEntry> {
  const job = getJobStore().get(jobId);
  if (!job) throw notFound();
  if (job.status !== 'done' || !job.resultPath) throw resultNotReady();
  return withLock('library', () => insertJobLocked(job));
}

export interface UploadInput {
  data: Uint8Array;
  filename: string;
  title?: string;
  author?: string;
}

/** Save bytes uploaded by the browser (local Worker result). */
export async function saveUpload(input: UploadInput): Promise<LibraryEntry> {
  if (input.data.length === 0) throw badRequest('The uploaded file is empty.');
  if (input.data.length > MAX_UPLOAD_BYTES) {
    throw new ApiError('TOO_LARGE', 413, 'The uploaded file is too large.', {
      zh: '文件超过 200 MB 上限。',
      en: 'The uploaded file exceeds the 200 MB limit.',
    });
  }
  const format = formatFromName(input.filename);
  if (!format) {
    throw new ApiError('UNSUPPORTED_FORMAT', 415, 'Unsupported library file format.', {
      zh: '不支持的书籍格式。',
      en: 'This file format is not supported by the library.',
    });
  }
  return withLock('library', () =>
    insertLocked({
      data: input.data,
      originalName: input.filename,
      format,
      ...(input.title ? { title: input.title } : {}),
      ...(input.author ? { author: input.author } : {}),
    }),
  );
}

/* ----------------------------------------------------------------- read -- */

export async function listLibrary(query: LibraryQuery = {}): Promise<LibraryList> {
  const loaded = await withLock('library', () => loadIndexLocked());
  const needle = (query.q ?? '').trim().toLowerCase();
  let entries = loaded.entries;
  if (needle) {
    entries = entries.filter((entry) =>
      [entry.title, entry.author, entry.filename].some((value) =>
        value.toLowerCase().includes(needle),
      ),
    );
  }
  if (query.format) entries = entries.filter((entry) => entry.format === query.format);
  entries = sortEntries(entries, query.sort);
  return { entries, total: entries.length, dir: loaded.dir };
}

export async function getLibraryEntry(id: string): Promise<LibraryEntry> {
  if (!isEntryId(id)) throw libraryNotFound();
  const loaded = await withLock('library', () => loadIndexLocked());
  const entry = loaded.entries.find((item) => item.id === id);
  if (!entry) throw libraryNotFound();
  return entry;
}

export async function libraryStats(): Promise<LibraryStats> {
  const loaded = await withLock('library', () => loadIndexLocked());
  let totalBytes = 0;
  let latestAddedAt: number | null = null;
  for (const entry of loaded.entries) {
    totalBytes += entry.size;
    if (latestAddedAt === null || entry.addedAt > latestAddedAt) latestAddedAt = entry.addedAt;
  }
  return { total: loaded.entries.length, totalBytes, latestAddedAt, dir: loaded.dir };
}

export async function libraryFilePath(
  id: string,
): Promise<{ path: string; filename: string; mime: string; size: number; entry: LibraryEntry }> {
  const entry = await getLibraryEntry(id);
  const dir = await readSettingsDir();
  let realPath: string;
  try {
    realPath = await resolveRealFileInside(dir, entry.filename);
    const stats = await stat(realPath);
    if (!stats.isFile()) throw new Error('not a file');
    return { path: realPath, filename: entry.filename, mime: mimeFor(entry.format), size: stats.size, entry };
  } catch {
    throw libraryFileGone();
  }
}

export async function libraryCoverFile(
  id: string,
): Promise<{ data: Buffer; etag: string }> {
  if (!isEntryId(id)) throw coverUnavailable();
  const entry = await getLibraryEntry(id);
  if (!entry.hasCover) throw coverUnavailable();
  try {
    const data = await readFile(coverPath(id));
    const version = entry.coverVersion ?? 1;
    return { data, etag: `"kf-cover-${id}-${version}"` };
  } catch {
    throw coverUnavailable();
  }
}

/** Record a send attempt on the index (called by the mailer). */
export async function recordSendResult(
  id: string,
  result: { at: number; ok: boolean; messageId?: string },
): Promise<void> {
  await withLock('library', async () => {
    const loaded = await loadIndexLocked();
    const entry = loaded.entries.find((item) => item.id === id);
    if (!entry) return;
    entry.sendCount = (entry.sendCount ?? 0) + 1;
    entry.lastSentAt = result.at;
    entry.lastSendOk = result.ok;
    await saveIndexLocked(loaded.dir, loaded.entries);
  });
}

/* ---------------------------------------------------------------- patch -- */

const COVER_REDIRECT_LIMIT = 3;

function coverFailure(): never {
  throw new ApiError('COVER_UNAVAILABLE', 422, 'Could not download the cover image.', {
    zh: '封面下载失败，请检查图片地址或网络。',
    en: 'The cover image could not be downloaded. Check the URL and your connection.',
  });
}

function coverTooLarge(): never {
  throw badRequest('The cover image is larger than 8 MB.', {
    zh: '封面图片不能超过 8 MB。',
    en: 'The cover image must be 8 MB or smaller.',
  });
}

/**
 * Downloads a cover while treating the URL as hostile input:
 *  - every hop (including redirects) must be http(s) and resolve to a public IP
 *  - redirects are manual, so a public URL cannot bounce to localhost
 *  - the body is streamed and capped at 8 MB even without Content-Length
 */
async function downloadCover(url: string): Promise<Buffer> {
  let current = await assertPublicHttpUrl(url);
  let response: Response | null = null;
  for (let hop = 0; hop <= COVER_REDIRECT_LIMIT; hop += 1) {
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: imageRequestHeaders(current),
      });
    } catch {
      coverFailure();
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (hop === COVER_REDIRECT_LIMIT) coverFailure();
      const location = response.headers.get('location');
      if (!location) coverFailure();
      try {
        current = await assertPublicHttpUrl(new URL(location, current));
      } catch {
        coverFailure();
      }
      continue;
    }
    break;
  }
  if (!response || !response.ok) coverFailure();

  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > COVER_MAX_BYTES) coverTooLarge();

  const reader = response.body?.getReader();
  if (!reader) coverFailure();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > COVER_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        coverTooLarge();
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  if (total === 0) coverFailure();
  return Buffer.concat(chunks);
}

async function rewriteEpubMetadata(
  filePath: string,
  patch: {
    title: string;
    author: string;
    isbn?: string;
    publisher?: string;
    language?: string;
    description?: string;
  },
  cover?: Buffer,
): Promise<string[]> {
  const bytes = await readFile(filePath);
  const { applyEpubMetadata } = await import('../engine/node/epub-meta');
  const metadata = {
    title: patch.title,
    ...(patch.author ? { author: patch.author } : {}),
    ...(patch.language ? { language: patch.language } : {}),
    ...(patch.publisher ? { publisher: patch.publisher } : {}),
    ...(patch.description ? { description: patch.description } : {}),
    ...(patch.isbn ? { isbn: patch.isbn } : {}),
  };
  try {
    const result = await applyEpubMetadata(
      new Uint8Array(bytes),
      metadata,
      cover ? { data: new Uint8Array(cover), mediaType: 'image/jpeg' } : undefined,
    );
    const temporary = `${filePath}.tmp-${randomBytes(4).toString('hex')}`;
    await writeFile(temporary, result.data, { mode: 0o600, flag: 'wx' });
    await rename(temporary, filePath);
    return result.warnings;
  } catch {
    throw new ApiError('LIBRARY_IO', 422, 'Could not rewrite EPUB metadata.', {
      zh: '无法写入 EPUB 元数据，文件可能结构不完整。',
      en: 'The EPUB metadata could not be rewritten; the file may be malformed.',
    });
  }
}

export async function patchLibraryEntry(id: string, input: unknown): Promise<PatchResult> {
  const parsed = metadataPatchSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid metadata patch.');
  }
  const patch = parsed.data as MetadataPatch;
  if (Object.keys(patch).length === 0) throw badRequest('The metadata patch is empty.');
  if (patch.isbn !== undefined && patch.isbn !== '') {
    const digits = patch.isbn.replace(/[\s-]/g, '').toUpperCase();
    if (!/^\d{13}$/.test(digits) && !/^\d{9}[\dX]$/.test(digits)) {
      throw badRequest('Invalid ISBN.', {
        zh: 'ISBN 必须是 10 位或 13 位。',
        en: 'The ISBN must have 10 or 13 digits.',
      });
    }
  }

  return withLock('library', async () => {
    const loaded = await loadIndexLocked();
    const entry = loaded.entries.find((item) => item.id === id);
    if (!entry) throw libraryNotFound();
    const dir = loaded.dir;
    let currentPath: string;
    try {
      currentPath = await resolveRealFileInside(dir, entry.filename);
    } catch {
      throw libraryFileGone();
    }

    const title = (patch.title ?? entry.title).trim() || entry.title;
    const author = patch.author !== undefined ? patch.author.trim() : entry.author;
    const cover = patch.coverUrl ? await downloadCover(patch.coverUrl) : undefined;

    const next: LibraryEntry = {
      ...entry,
      title,
      author,
      ...(patch.isbn !== undefined ? { isbn: patch.isbn || undefined } : {}),
      ...(patch.publisher !== undefined ? { publisher: patch.publisher || undefined } : {}),
      ...(patch.language !== undefined ? { language: patch.language || undefined } : {}),
      ...(patch.description !== undefined ? { description: patch.description || undefined } : {}),
      updatedAt: Date.now(),
    };

    const warnings: string[] = [];
    if (entry.format === 'epub') {
      const rewriteWarnings = await rewriteEpubMetadata(
        currentPath,
        {
          title,
          author,
          ...(next.isbn ? { isbn: next.isbn } : {}),
          ...(next.publisher ? { publisher: next.publisher } : {}),
          ...(next.language ? { language: next.language } : {}),
          ...(next.description ? { description: next.description } : {}),
        },
        cover,
      );
      warnings.push(...rewriteWarnings);
    } else {
      const metadataChanged = [
        'title',
        'author',
        'isbn',
        'publisher',
        'language',
        'description',
      ].some((key) => (patch as Record<string, unknown>)[key] !== undefined);
      if (metadataChanged) {
        warnings.push(
          'Metadata is saved in KindleForge, but non-EPUB files cannot embed it. Cover images are only embedded in EPUB files.',
        );
      } else if (cover) {
        warnings.push('Cover images are only embedded in EPUB files; this entry keeps its cover separately.');
      }
    }

    if (cover) {
      const saved = await saveCover(id, cover);
      if (saved.hasCover) {
        next.hasCover = true;
        next.coverVersion = (entry.coverVersion ?? 0) + 1;
      } else if (saved.failed) {
        warnings.push(
          'The cover image could not be decoded; the book was updated without a new cover. / 封面图片无法解码，书籍已更新但未替换封面。',
        );
      }
    }

    const nextFilename = fitBase(title, author, entry.format);
    if (nextFilename !== entry.filename) {
      const unique = await uniqueFilename(dir, nextFilename);
      try {
        await rename(currentPath, path.join(dir, unique));
      } catch {
        throw libraryIo();
      }
      next.filename = unique;
    }

    const entries = loaded.entries.map((item) => (item.id === id ? next : item));
    await saveIndexLocked(dir, entries);
    return { entry: next, warnings };
  });
}

/* --------------------------------------------------------------- delete -- */

export async function deleteLibraryEntry(id: string): Promise<void> {
  if (!isEntryId(id)) throw libraryNotFound();
  await withLock('library', async () => {
    const loaded = await loadIndexLocked();
    const entry = loaded.entries.find((item) => item.id === id);
    if (!entry) throw libraryNotFound();
    const dir = loaded.dir;
    try {
      const real = await resolveRealFileInside(dir, entry.filename);
      await unlink(real);
    } catch {
      // Already gone: deleting the index row is exactly what the user wants.
    }
    await unlink(coverPath(id)).catch(() => undefined);
    await saveIndexLocked(
      dir,
      loaded.entries.filter((item) => item.id !== id),
    );
  });
}

/* --------------------------------------------------------------- reveal -- */

export async function revealLibraryEntry(id: string): Promise<void> {
  if (process.platform !== 'darwin') throw revealUnsupported();
  const resolved = await libraryFilePath(id);
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('open', ['-R', resolved.path], {
      detached: true,
      stdio: 'ignore',
    });
    child.once('error', () => reject(revealUnsupported()));
    child.once('spawn', () => {
      child.unref();
      resolvePromise();
    });
  });
}

/** Case-insensitive existence check used by tests. */
export async function libraryFileExists(id: string): Promise<boolean> {
  try {
    const resolved = await libraryFilePath(id);
    await stat(resolved.path);
    return true;
  } catch {
    return false;
  }
}

export { coverPath as libraryCoverPathForTests, fitBase as libraryFilenameForTests };
