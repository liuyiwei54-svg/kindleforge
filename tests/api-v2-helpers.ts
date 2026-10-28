/**
 * Shared helpers for the v2 API tests. Every test gets its own temp data
 * directory so the real ~/.kindleforge and ~/KindleForge are never touched.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setStateDirsForTests } from '../lib/server/state';
import { resetSettingsForTests } from '../lib/server/settings';

export interface TestDirs {
  root: string;
  dataDir: string;
  libraryDir: string;
  cleanup: () => Promise<void>;
}

export async function makeDirs(): Promise<TestDirs> {
  const root = await mkdtemp(path.join(tmpdir(), 'kf-api-v2-'));
  const dataDir = path.join(root, 'data');
  const libraryDir = path.join(root, 'library');
  setStateDirsForTests({ dataDir, libraryDir });
  resetSettingsForTests();
  return {
    root,
    dataDir,
    libraryDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function multipartRequest(
  url: string,
  form: FormData,
  method = 'POST',
): Promise<Request> {
  const encoded = new Response(form);
  const contentType = encoded.headers.get('content-type') ?? '';
  const data = await encoded.arrayBuffer();
  return new Request(url, {
    method,
    headers: { 'content-type': contentType, 'content-length': String(data.byteLength) },
    body: data,
  });
}

export function jsonRequest(url: string, body: unknown, method = 'POST'): Request {
  const text = JSON.stringify(body);
  return new Request(url, {
    method,
    headers: {
      'content-type': 'application/json',
      'content-length': String(Buffer.byteLength(text)),
    },
    body: text,
  });
}

export function params<T extends Record<string, string>>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

export async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T;
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value), 'utf8');
}

/** A valid (tiny) EPUB used when a test only needs a real file on disk. */
export async function fixtureEpub(): Promise<Buffer> {
  return readFile(path.join(process.cwd(), 'tests', 'fixtures', 'pride.epub'));
}
