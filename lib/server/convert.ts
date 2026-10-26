/**
 * Server-side engine orchestration.
 *
 * lib/engine is isomorphic and owned by the engine agent; this module is the
 * only place that dynamically imports it plus the Node-only adapters. If the
 * node host cannot be built (calibre missing, adapter throws), builtin paths
 * still run — a missing optional engine must never break TXT/MD/HTML → EPUB.
 */
import { FORMAT_INFO, formatOfFilename } from '../engine/formats';
import type {
  ConversionResult,
  ConverterInput,
  ConvertRequest,
  FormatId,
  KindleOptions,
} from '../engine/types';
import { ConversionError } from '../engine/types';
import type { JobOutput } from './jobs';
import { engineAvailability } from './engines';
import { safeBaseName, safeFileName, writeJobFile } from './storage';

interface EngineModule {
  convert(input: ConverterInput, req: ConvertRequest, host?: unknown): Promise<ConversionResult>;
  detectFormat?: (name: string, data: Uint8Array) => FormatId | null;
  engineStatus?: (host?: unknown) => Promise<{
    calibre: boolean;
    pandoc: boolean;
    tesseract: boolean;
  }>;
}

let engineModule: EngineModule | null = null;
let engineLoad: Promise<EngineModule | null> | null = null;

/** Load the isomorphic engine. Resolves null while the engine is not built. */
export async function loadEngine(): Promise<EngineModule | null> {
  if (engineModule) return engineModule;
  if (!engineLoad) {
    engineLoad = (async () => {
      try {
        // @ts-ignore — module is provided by the engine agent (docs/CONTRACT.md §3).
        const mod: unknown = await import('../engine/index');
        if (mod && typeof (mod as EngineModule).convert === 'function') {
          return mod as EngineModule;
        }
        return null;
      } catch {
        return null;
      }
    })();
  }
  const loaded = await engineLoad;
  engineLoad = null; // allow a retry if the module appears later (dev/HMR)
  if (loaded) engineModule = loaded;
  return loaded;
}

/* ------------------------------------------------------------------ */
/* Node host (optional: calibre / pandoc / tesseract)                  */
/* ------------------------------------------------------------------ */

interface HostCache {
  at: number;
  host: unknown;
}

const HOST_TTL_MS = 30_000;
let hostCache: HostCache | null = null;

/**
 * Build the server host. The engine's factory probes every binary; failures
 * are swallowed so the builtin engine keeps working.
 */
export async function getEngineHost(): Promise<unknown | undefined> {
  if (hostCache && Date.now() - hostCache.at < HOST_TTL_MS) return hostCache.host;

  let host: unknown | undefined;
  try {
    // @ts-ignore — module is provided by the engine agent (lib/engine/node/host.ts).
    const hostModule: Record<string, unknown> = await import('../engine/node/host');
    const factory = hostModule.createEngineHost;
    if (typeof factory === 'function') {
      host = await (factory as (opts?: unknown) => Promise<unknown>)();
    }
  } catch {
    host = undefined;
  }

  // Fallback: build just the calibre slice if the aggregate host factory is absent.
  if (!host) {
    try {
      // @ts-ignore — module is provided by the engine agent (lib/engine/node/calibre.ts).
      const calibreModule: Record<string, unknown> = await import('../engine/node/calibre');
      const calibreHost = calibreModule.calibreHost;
      if (typeof calibreHost === 'function') {
        const slice = await (calibreHost as () => Promise<unknown>)();
        if (slice) host = { calibre: slice };
      }
    } catch {
      host = undefined;
    }
  }

  if (host) hostCache = { at: Date.now(), host };
  return host;
}

/** Test hook: forget the loaded engine module and probed host. */
export function resetEngineCachesForTests(): void {
  engineModule = null;
  engineLoad = null;
  hostCache = null;
}

/* ------------------------------------------------------------------ */
/* Format detection                                                    */
/* ------------------------------------------------------------------ */

function decodeText(data: Uint8Array, limit = 4096): string | null {
  try {
    const slice = data.subarray(0, Math.min(data.length, limit));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(slice);
    return text;
  } catch {
    return null;
  }
}

/** Magic-byte fallback used when the engine module is unavailable. */
export function sniffFormat(name: string, data: Uint8Array): FormatId | null {
  const byName = formatOfFilename(name);
  if (byName) return byName;
  if (data.length >= 4 && data[0] === 0x25 && data[1] === 0x50 && data[2] === 0x44 && data[3] === 0x46) {
    return 'pdf';
  }
  if (data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) {
    // A zip we cannot name by extension: EPUB/CBZ/DOCX are ambiguous.
    return null;
  }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image';
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return 'image';
  }
  if (data.length >= 6 && data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image';
  if (
    data.length >= 12 &&
    data[0] === 0x52 &&
    data[1] === 0x49 &&
    data[2] === 0x46 &&
    data[3] === 0x46 &&
    data[8] === 0x57 &&
    data[9] === 0x45 &&
    data[10] === 0x42 &&
    data[11] === 0x50
  ) {
    return 'image';
  }
  const head = decodeText(data, 8192);
  if (head) {
    if (/<FictionBook[\s>]/i.test(head)) return 'fb2';
    if (/<(?:!doctype\s+html|html|head|body)[\s>]/i.test(head)) return 'html';
    if (!head.includes('\u0000')) return 'txt';
  }
  return null;
}

/** detectFormat from the engine when available, otherwise a local sniff. */
export async function detectFormatFor(name: string, data: Uint8Array): Promise<FormatId | null> {
  const engine = await loadEngine();
  if (engine?.detectFormat) {
    try {
      const detected = engine.detectFormat(name, data);
      if (detected) return detected;
    } catch {
      /* fall through to the local sniffer */
    }
  }
  return sniffFormat(name, data);
}

/* ------------------------------------------------------------------ */
/* Conversion                                                          */
/* ------------------------------------------------------------------ */

export interface RunConversionInput {
  jobId: string;
  sourceName: string;
  sourceFormat: FormatId;
  target: FormatId;
  options?: KindleOptions;
  data: Uint8Array;
  onProgress?: (progress: number) => void;
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function outputMime(target: FormatId, fallback?: string): string {
  const base = fallback && fallback.trim() ? fallback.trim() : FORMAT_INFO[target].mime;
  if ((target === 'txt' || target === 'html') && !/charset=/i.test(base)) {
    return `${base}; charset=utf-8`;
  }
  return base;
}

function chooseDownloadName(target: FormatId, sourceName: string, engineName?: string): string {
  const ext = FORMAT_INFO[target].ext[0];
  const candidate = typeof engineName === 'string' ? safeFileName(engineName, '') : '';
  if (candidate && new RegExp(`\\.${ext}$`, 'i').test(candidate)) return candidate;
  return `${safeBaseName(sourceName)}.${ext}`;
}

function engineMissingError(): ConversionError {
  return new ConversionError('ENGINE_MISSING', 'Conversion engine is unavailable on this server.', {
    zh: '内置转换引擎未就绪（部署不完整），请联系管理员。',
    en: 'The built-in conversion engine is unavailable on this deployment.',
  });
}

/**
 * Run one conversion end-to-end and persist the output in the job directory.
 * Progress: 10 (start) → 35 (engine+host ready) → 75 (converted) → 95 (written).
 */
export async function runConversion(input: RunConversionInput): Promise<JobOutput> {
  const startedAt = Date.now();
  const report = (value: number) => input.onProgress?.(Math.max(0, Math.min(99, value)));

  report(10);
  const engine = await loadEngine();
  if (!engine) throw engineMissingError();

  report(35);
  const host = await getEngineHost();
  const request: ConvertRequest = {
    target: input.target,
    ...(input.options ? { options: input.options } : {}),
  };

  const result = await engine.convert(
    { name: input.sourceName, data: input.data },
    request,
    host,
  );
  report(75);

  const bytes = toBytes(result?.data);
  if (!bytes || bytes.byteLength === 0) {
    throw new ConversionError('INTERNAL', 'The conversion engine produced an empty file.', {
      zh: '转换引擎没有产出内容，请换一种源格式或目标格式重试。',
      en: 'The engine produced an empty file. Try a different source or target format.',
    });
  }

  const resultName = chooseDownloadName(input.target, input.sourceName, result.filename);
  const resultPath = await writeJobFile(input.jobId, `output.${FORMAT_INFO[input.target].ext[0]}`, bytes);
  report(95);

  const warnings = Array.isArray(result.warnings)
    ? result.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.length > 0)
    : [];

  return {
    engine: typeof result.engine === 'string' && result.engine ? result.engine : 'builtin',
    warnings,
    durationMs: Math.max(0, Date.now() - startedAt),
    resultPath,
    resultName,
    resultMime: outputMime(input.target, result.mime),
    resultSize: bytes.byteLength,
  };
}

/** Exposed for /api/health fallbacks: engine status through a real host. */
export async function engineStatusWithHost(): Promise<{
  calibre: boolean;
  pandoc: boolean;
  tesseract: boolean;
}> {
  try {
    const engine = await loadEngine();
    const host = await getEngineHost();
    if (engine?.engineStatus) return await engine.engineStatus(host);
  } catch {
    /* fall back to the raw probe */
  }
  return engineAvailability();
}
