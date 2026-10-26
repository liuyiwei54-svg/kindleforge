/**
 * Real, cheap engine probing for /api/health + /api/formats.
 *
 * We deliberately do not depend on lib/engine being present: the health check
 * must still answer while the engine module is being built. Each binary is
 * resolved from PATH plus the usual macOS app-bundle locations, then asked for
 * its version. Results are cached for 5s so health checks are not a fork bomb.
 */
import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type EngineId = 'calibre' | 'pandoc' | 'tesseract';

export interface EngineDetail {
  id: EngineId;
  bin: string;
  available: boolean;
  version?: string;
  /** What this engine unlocks, bilingual. */
  purpose: { zh: string; en: string };
  /** Copy-pasteable install command(s) for this platform. */
  install: string[];
}

export interface EngineAvailability {
  calibre: boolean;
  pandoc: boolean;
  tesseract: boolean;
}

const CACHE_MS = 5_000;
const PROBE_TIMEOUT_MS = 2_500;

let cache: { at: number; details: EngineDetail[] } | null = null;
let inflight: Promise<EngineDetail[]> | null = null;

const HOME = homedir();

const CANDIDATES: Record<EngineId, string[]> = {
  calibre: [
    process.env.KINDLEFORGE_CALIBRE ?? '',
    'ebook-convert',
    '/Applications/calibre.app/Contents/MacOS/ebook-convert',
    join(HOME, 'Applications/calibre.app/Contents/MacOS/ebook-convert'),
    '/opt/homebrew/bin/ebook-convert',
    '/usr/local/bin/ebook-convert',
  ].filter(Boolean),
  pandoc: ['pandoc', '/opt/homebrew/bin/pandoc', '/usr/local/bin/pandoc', '/usr/bin/pandoc'],
  tesseract: [
    'tesseract',
    '/opt/homebrew/bin/tesseract',
    '/usr/local/bin/tesseract',
    '/usr/bin/tesseract',
  ],
};

const PURPOSE: Record<EngineId, EngineDetail['purpose']> = {
  calibre: {
    zh: 'MOBI/AZW3/PDF/DOCX 等格式的转换（可选增强）',
    en: 'MOBI/AZW3/PDF/DOCX targets and legacy ebook inputs (optional)',
  },
  pandoc: {
    zh: '部分文档格式的互转（可选增强）',
    en: 'Extra document conversions (optional)',
  },
  tesseract: {
    zh: '扫描版 PDF / 图片 OCR（可选增强）',
    en: 'OCR for scanned PDFs and images (optional)',
  },
};

const INSTALL: Record<EngineId, string[]> = {
  calibre: ['brew install --cask calibre', 'https://calibre-ebook.com/download'],
  pandoc: ['brew install pandoc', 'https://pandoc.org/installing.html'],
  tesseract: ['brew install tesseract tesseract-lang', 'https://tesseract-ocr.github.io/'],
};

function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  );
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
}

export function versionArgs(id: EngineId): string[] {
  if (id === 'tesseract') return ['--version'];
  return ['--version'];
}

async function execVersion(bin: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          resolve(null);
          return;
        }
        const text = `${stdout || ''}\n${stderr || ''}`;
        resolve(firstLine(text) || 'present');
      },
    );
  });
}

async function probeOne(id: EngineId): Promise<EngineDetail> {
  const candidates = CANDIDATES[id];
  const tried = new Set<string>();
  for (const candidate of candidates) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    // For bare names (`pandoc`) let execFile use PATH; for absolute paths require exec bit.
    const absolute = candidate.includes('/');
    if (absolute && !(await isExecutable(candidate))) continue;
    const version = await execVersion(candidate, versionArgs(id));
    if (version) {
      return {
        id,
        bin: candidate,
        available: true,
        version,
        purpose: PURPOSE[id],
        install: INSTALL[id],
      };
    }
  }
  return {
    id,
    bin: candidates[0] ?? id,
    available: false,
    purpose: PURPOSE[id],
    install: INSTALL[id],
  };
}

async function probeAll(): Promise<EngineDetail[]> {
  const ids: EngineId[] = ['calibre', 'pandoc', 'tesseract'];
  return Promise.all(ids.map((id) => probeOne(id)));
}

/** Probe every optional engine. Cached for 5s unless `force` is true. */
export async function probeEngines(force = false): Promise<EngineDetail[]> {
  const now = Date.now();
  if (!force && cache && now - cache.at < CACHE_MS) return cache.details;
  if (!force && inflight) return inflight;
  inflight = probeAll()
    .then((details) => {
      cache = { at: Date.now(), details };
      return details;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export async function engineAvailability(force = false): Promise<EngineAvailability> {
  const details = await probeEngines(force);
  return {
    calibre: details.some((d) => d.id === 'calibre' && d.available),
    pandoc: details.some((d) => d.id === 'pandoc' && d.available),
    tesseract: details.some((d) => d.id === 'tesseract' && d.available),
  };
}

/** Test hook: drop the cache so a mocked PATH/probe is reflected immediately. */
export function resetEngineProbeCache(): void {
  cache = null;
  inflight = null;
}
