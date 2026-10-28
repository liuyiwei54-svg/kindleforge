/**
 * Metadata search orchestration: local filename guess + Google Books /
 * Open Library, cached on disk for 30 days so repeated lookups stay offline.
 *
 * The public API never learns about provider errors individually: if every
 * enabled provider fails the result is `{ ok:false, reason:'offline' }` and the
 * UI falls back to manual editing. A single provider failing while another
 * works is silent (best-effort).
 */
import path from 'node:path';
import { z } from 'zod';
import type {
  MetadataCandidate,
  MetadataProvider,
  MetadataSearchResult,
} from '../../shared/types';
import { badRequest } from '../errors';
import { getSettings } from '../settings';
import {
  DEFAULT_PROVIDERS,
  METADATA_CACHE_TTL_MS,
  METADATA_TOTAL_TIMEOUT_MS,
} from '../settings-defaults';
import { atomicWriteJson, dataRoot, ensureDir, readJsonFile, removeIfExists, sha1 } from '../state';
import { boundedGuess, guessFromFilename, type FilenameGuess } from './guess';
import { PROVIDERS } from './providers';

export const metadataSearchSchema = z
  .object({
    q: z.string().trim().max(300).optional(),
    title: z.string().trim().max(200).optional(),
    author: z.string().trim().max(120).optional(),
    isbn: z.string().trim().max(32).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(value.q) ||
      Boolean(value.title) ||
      Boolean(value.author) ||
      Boolean(value.isbn),
    { message: 'Provide at least one of q, title, author, isbn.' },
  );

export type MetadataSearchInput = z.infer<typeof metadataSearchSchema>;

function normalizeQueryIsbn(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const digits = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(digits) || /^\d{9}[\dX]$/.test(digits)) return digits;
  throw badRequest('Invalid ISBN.', {
    zh: 'ISBN 必须是 10 位或 13 位数字。',
    en: 'An ISBN must be 10 or 13 digits (the last 10-digit character may be X).',
  });
}

function buildQuery(input: MetadataSearchInput): {
  query: string;
  parts: Record<string, string>;
} {
  const isbn = normalizeQueryIsbn(input.isbn);
  if (isbn) {
    return { query: isbn, parts: { isbn } };
  }
  const parts: Record<string, string> = {};
  const title = input.title ?? '';
  const author = input.author ?? '';
  if (title) parts.title = title;
  if (author) parts.author = author;
  if (!title && !author && input.q) parts.q = input.q;
  const query = [parts.title, parts.author, parts.q]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .trim();
  if (!query) {
    throw badRequest('Metadata search needs a title, author, or ISBN.', {
      zh: '请提供书名、作者或 ISBN 再搜索。',
      en: 'Provide a title, author, or ISBN to search.',
    });
  }
  return { query, parts };
}

function cacheKey(parts: Record<string, string>, providers: MetadataProvider[]): string {
  // Stable JSON: keys are inserted in a fixed order by buildQuery.
  return sha1(JSON.stringify({ parts, providers }));
}


interface CacheEntry {
  at: string;
  candidates: MetadataCandidate[];
}

async function readCache(key: string): Promise<MetadataCandidate[] | null> {
  const file = path.join(dataRoot(), 'cache', 'metadata', `${key}.json`);
  try {
    const entry = await readJsonFile<CacheEntry>(file);
    if (!entry || typeof entry.at !== 'string' || !Array.isArray(entry.candidates)) return null;
    const age = Date.now() - Date.parse(entry.at);
    if (!Number.isFinite(age) || age < 0 || age > METADATA_CACHE_TTL_MS) return null;
    return entry.candidates;
  } catch {
    return null;
  }
}

async function writeCache(key: string, candidates: MetadataCandidate[]): Promise<void> {
  if (candidates.length === 0) return;
  const dir = path.join(dataRoot(), 'cache', 'metadata');
  try {
    await ensureDir(dir, 0o700);
    const entry: CacheEntry = { at: new Date().toISOString(), candidates };
    await atomicWriteJson(path.join(dir, `${key}.json`), entry, 0o600);
  } catch {
    // Cache is an optimization; never fail the search because of it.
  }
}

function candidateKey(candidate: MetadataCandidate): string {
  return `${candidate.title}::${candidate.author}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

function dedupe(candidates: MetadataCandidate[]): MetadataCandidate[] {
  const seen = new Set<string>();
  const merged: MetadataCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(candidate);
  }
  return merged;
}

function languageRank(candidate: MetadataCandidate, language: 'auto' | 'zh' | 'en'): number {
  if (language === 'auto') return 0;
  if (!candidate.language) return 1;
  const value = candidate.language.toLowerCase();
  const matches =
    language === 'zh' ? value.startsWith('zh') || value === 'chi' : value.startsWith('en');
  return matches ? 0 : 2;
}

/**
 * Guess metadata for a filename. The engine's guesser is authoritative when
 * available; the local heuristic keeps the endpoint working during an engine
 * refactor or in tests that stub the module out.
 */
export async function guessForFilename(filename: string): Promise<FilenameGuess> {
  const local = boundedGuess(guessFromFilename(filename));
  try {
    const mod = (await import('../../engine/metadata')) as unknown as {
      guessMetadata?: (name: string) => { title?: string; author?: string; isbn?: string };
    };
    if (typeof mod.guessMetadata === 'function') {
      const guessed = mod.guessMetadata(filename);
      if (guessed && typeof guessed.title === 'string' && guessed.title.trim()) {
        return {
          title: guessed.title.trim().slice(0, 200),
          author: (guessed.author ?? local.author).trim().slice(0, 120),
          ...(guessed.isbn ? { isbn: guessed.isbn } : local.isbn ? { isbn: local.isbn } : {}),
        };
      }
    }
  } catch {
    // Engine metadata module unavailable — use the local heuristic.
  }
  return local;
}

function offlineHint(): string {
  return 'Metadata providers are unreachable. Edit the details manually. / 元数据服务暂不可达，可手动填写。';
}

function disabledHint(): string {
  return 'Online metadata is disabled in Settings. / 在线元数据已在设置中关闭。';
}

interface ProviderOutcome {
  status: 'fulfilled' | 'rejected';
  candidates?: MetadataCandidate[];
}

/** Wait for a promise, but never longer than `ms`. */
async function waitAtMost<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, ms));
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Run all enabled providers concurrently with an 8 second wall-clock budget.
 * Douban is allowed to finish the search early: when it returns at least one
 * candidate we give the other providers a short grace period, then abort them.
 * This keeps the usable Chinese source responsive even when Google/Open
 * Library are unreachable (common on mainland networks).
 */
async function queryProviders(
  providers: MetadataProvider[],
  query: string,
): Promise<{ succeeded: boolean; candidates: MetadataCandidate[] }> {
  const outcomes = new Map<MetadataProvider, ProviderOutcome>();
  const controller = new AbortController();
  const deadline = Date.now() + METADATA_TOTAL_TIMEOUT_MS;
  const remaining = () => Math.max(0, deadline - Date.now());

  const tasks = new Map<MetadataProvider, Promise<void>>();
  for (const provider of providers) {
    const task = (async () => {
      try {
        const candidates = await PROVIDERS[provider](query, {
          timeoutMs: METADATA_TOTAL_TIMEOUT_MS,
          signal: controller.signal,
        });
        outcomes.set(provider, { status: 'fulfilled', candidates });
      } catch {
        outcomes.set(provider, { status: 'rejected' });
      }
    })();
    tasks.set(provider, task);
  }
  const allDone = Promise.all([...tasks.values()]).then(() => undefined);

  const doubanTask = tasks.get('douban');
  if (doubanTask) {
    await waitAtMost(doubanTask, remaining());
    const douban = outcomes.get('douban');
    const doubanHasResults =
      douban?.status === 'fulfilled' && (douban.candidates?.length ?? 0) > 0;
    const grace = doubanHasResults ? Math.min(300, remaining()) : remaining();
    await waitAtMost(allDone, grace);
  } else {
    await waitAtMost(allDone, remaining());
  }

  // Abort any provider still in flight. Their tasks swallow the rejection.
  controller.abort();
  await waitAtMost(allDone, 100);

  let succeeded = false;
  const candidates: MetadataCandidate[] = [];
  for (const provider of providers) {
    const outcome = outcomes.get(provider);
    if (outcome?.status === 'fulfilled') {
      succeeded = true;
      candidates.push(...(outcome.candidates ?? []));
    }
  }
  return { succeeded, candidates };
}

export async function searchMetadata(input: unknown): Promise<MetadataSearchResult> {
  const parsed = metadataSearchSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw badRequest(issue?.message ?? 'Invalid metadata search.', {
      zh: '搜索参数不合法。',
      en: 'The metadata search request is invalid.',
    });
  }

  const settings = await getSettings();
  const enabledProviders = settings.metadata.providers.filter((provider) =>
    DEFAULT_PROVIDERS.includes(provider),
  );
  if (!settings.metadata.enabled || enabledProviders.length === 0) {
    return {
      ok: false,
      candidates: [],
      cached: false,
      reason: 'disabled',
      hint: disabledHint(),
    };
  }

  const { query, parts } = buildQuery(parsed.data);
  const key = cacheKey(parts, enabledProviders);
  const cached = await readCache(key);
  if (cached) {
    return { ok: true, candidates: cached, cached: true };
  }

  const { succeeded, candidates: fetched } = await queryProviders(enabledProviders, query);

  if (!succeeded) {
    return {
      ok: false,
      candidates: [],
      cached: false,
      reason: 'offline',
      hint: offlineHint(),
    };
  }

  const candidates = dedupe(fetched)
    .map((candidate) => ({
      ...candidate,
      ...(candidate.title ? { title: candidate.title.slice(0, 200) } : {}),
      ...(candidate.author ? { author: candidate.author.slice(0, 300) } : {}),
      ...(candidate.description
        ? { description: candidate.description.slice(0, 4000) }
        : {}),
      ...(candidate.providerUrl ? { providerUrl: candidate.providerUrl.slice(0, 2048) } : {}),
    }))
    .sort(
      (a, b) =>
        languageRank(a, settings.metadata.language) -
          languageRank(b, settings.metadata.language) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 20);

  await writeCache(key, candidates);
  return {
    ok: true,
    candidates,
    cached: false,
    ...(candidates.length === 0 ? { reason: 'empty' as const } : {}),
  };
}

/** Remove the metadata cache directory (tests). */
export async function clearMetadataCacheForTests(): Promise<void> {
  const dir = path.join(dataRoot(), 'cache', 'metadata');
  await removeIfExists(dir);
}
