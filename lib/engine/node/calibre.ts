/**
 * Calibre bridge (Node only — never import this from isomorphic code).
 *
 * `ebook-convert` is the only way to produce MOBI/AZW3/PDF/DOCX/KF8 output that
 * a Kindle will open without complaints. We keep the invocation as small as
 * possible: one input, one output, Kindle profile, our typography as extra CSS,
 * and a hard 180s timeout.
 */

import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CalibreRunRequest, CalibreRunner } from '../index';
import type { FormatId, KindleOptions } from '../types';
import { ConversionError } from '../types';
import { bookCss } from '../writers/styles';
import { redactEngineOutput } from './redact';
import { ensureEpubToc } from './epub-toc';

const MAC_CALIBRE = '/Applications/calibre.app/Contents/MacOS/ebook-convert';
export const DEFAULT_TIMEOUT_MS = 180_000;

let cachedBinary: string | null | undefined;

async function which(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    const probe = spawn(process.platform === 'win32' ? 'where' : 'which', [command], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let out = '';
    probe.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString();
    });
    probe.on('error', () => resolve(null));
    probe.on('close', (code) => {
      const first = out
        .split('\n')
        .map((line) => line.trim())
        .find(Boolean);
      resolve(code === 0 && first ? first : null);
    });
  });
}

/** Locate ebook-convert: app bundle first, then PATH. Cached per process. */
export async function findCalibre(): Promise<string | null> {
  if (cachedBinary !== undefined) return cachedBinary;
  cachedBinary = null;
  try {
    await access(MAC_CALIBRE, constants.X_OK);
    cachedBinary = MAC_CALIBRE;
    return cachedBinary;
  } catch {
    /* not the macOS bundle */
  }
  const fromPath = await which('ebook-convert');
  if (fromPath) cachedBinary = fromPath;
  return cachedBinary;
}

export function resetCalibreCache(): void {
  cachedBinary = undefined;
}

const TARGET_EXT: Partial<Record<FormatId, string>> = {
  epub: 'epub',
  mobi: 'mobi',
  azw3: 'azw3',
  pdf: 'pdf',
  txt: 'txt',
  docx: 'docx',
  html: 'htmlz',
  odt: 'odt',
};

export interface BuildArgsInput {
  inputPath: string;
  outputPath: string;
  target: FormatId;
  options?: KindleOptions;
}

/**
 * Options differ per output plugin; passing an unsupported flag makes calibre
 * exit with "No such option", so each target gets only what it understands.
 */
export function buildCalibreArgs({ inputPath, outputPath, target, options }: BuildArgsInput): string[] {
  const args: string[] = [inputPath, outputPath];
  const metadata = options?.metadata;
  const isEpubLike = target === 'epub' || target === 'mobi' || target === 'azw3' || target === 'pdf';

  if (isEpubLike) {
    args.push('--output-profile', 'kindle');
    args.push('--embed-all-fonts');
    args.push('--extra-css', kindleCss(options));
  }

  if (target === 'epub') {
    args.push('--epub-version', '3');
    // Restore the TOC hierarchy calibre loses for PDF/ODT/RTF input.
    args.push('--level1-toc', '//h:h1', '--level2-toc', '//h:h2');
  }
  if (target === 'mobi') {
    // Both MOBI and the KF8 part: old Kindles read one, new ones the other.
    args.push('--mobi-file-type', 'both');
  }
  if (target === 'pdf') {
    args.push('--paper-size', 'a5');
    args.push('--pdf-page-margin-left', '20');
    args.push('--pdf-page-margin-right', '20');
    args.push('--pdf-page-margin-top', '20');
    args.push('--pdf-page-margin-bottom', '20');
  }

  if (metadata?.title) args.push('--title', metadata.title);
  if (metadata?.author) args.push('--authors', metadata.author);
  if (metadata?.language) args.push('--language', metadata.language);
  if (metadata?.publisher) args.push('--publisher', metadata.publisher);

  return args;
}

/** Our Kindle typography, flattened for `--extra-css`. */
function kindleCss(options?: KindleOptions): string {
  const css = bookCss(options ?? {});
  return css.replace(/^@charset[^;]+;/m, '').replace(/\s+/g, ' ').trim();
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(binary: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // macOS calibre occasionally wants a window server; it never needs one.
        QT_QPA_PLATFORM: 'offscreen',
      },
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = (stdout + chunk.toString()).slice(-20_000);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-20_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`.trim(), timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/** Keep the useful lines, drop the progress spam, redact absolute paths. */
export function extractWarnings(stderr: string, tempDir: string): string[] {
  const lines = redactEngineOutput(stderr, tempDir)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const interesting = lines.filter(
    (line) =>
      (/warn/i.test(line) || /not supported/i.test(line) || /falling back/i.test(line)) &&
      !/^\s*\d+%/.test(line),
  );
  const warnings = interesting.slice(0, 6).map((line) => `Calibre: ${line.slice(0, 220)}`);
  if (interesting.length > warnings.length) {
    warnings.push(`Calibre 另外还有 ${interesting.length - warnings.length} 条警告（more warnings suppressed）`);
  }
  return warnings;
}

/**
 * Pick the useful end of a traceback, line-aligned, with absolute paths scrubbed.
 * Never slice mid-line: a message starting at "/cli.py", line 427" is worse than
 * no detail at all.
 */
export function summarizeEngineFailure(
  stderr: string,
  stdout: string,
  tempDir: string,
): string {
  const source = stderr.trim() || stdout.trim();
  if (!source) return '';
  const redacted = redactEngineOutput(source, tempDir);
  const lines = redacted
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter(Boolean);
  const interesting = lines.filter((line) =>
    /error|failed|exception|cannot|could not|invalid|unsupported|no such/i.test(line),
  );
  const picked = (interesting.length > 0 ? interesting : lines).slice(-4);
  return picked.join('\n').slice(0, 600);
}

/**
 * Build the user-facing failure from calibre's own words, with paths scrubbed.
 * Exported so the redaction can be tested without spawning calibre.
 */
export function buildCalibreFailure(
  code: number | null,
  stderr: string,
  stdout: string,
  tempDir: string,
): ConversionError {
  const summary = summarizeEngineFailure(stderr, stdout, tempDir);
  const firstLine = summary.split('\n')[0] ?? '';
  return new ConversionError(
    'INTERNAL',
    `Calibre 退出码 ${code ?? 'signal'}${firstLine ? `: ${firstLine.slice(0, 300)}` : ''}`,
    {
      zh: `外部引擎转换失败。请先在 Calibre 里打开原文件确认它无损，再重试。${
        summary ? ` 详情：${summary.slice(-300)}` : ''
      }`,
      en: `The external engine failed. Open the file in Calibre once to check it, then retry.${
        summary ? ` Details: ${summary.slice(-300)}` : ''
      }`,
    },
  );
}

export interface ConvertWithCalibreOptions {
  timeoutMs?: number;
}

export async function convertWithCalibre(
  request: CalibreRunRequest,
  options: ConvertWithCalibreOptions = {},
): Promise<{ data: Uint8Array; warnings: string[] }> {
  const binary = await findCalibre();
  if (!binary) {
    throw new ConversionError('ENGINE_MISSING', '找不到 Calibre 的 ebook-convert。', {
      zh: '请安装 Calibre（https://calibre-ebook.com），或改用 EPUB / TXT / HTML 输出。',
      en: 'Install Calibre (https://calibre-ebook.com), or pick EPUB / TXT / HTML output.',
    });
  }

  const targetExt = TARGET_EXT[request.target] ?? request.target;
  const inputExt = (request.fromExt || 'epub').replace(/^\./, '').toLowerCase() || 'epub';
  const dir = await mkdtemp(join(tmpdir(), 'kindleforge-calibre-'));
  const inputPath = join(dir, `input.${inputExt}`);
  const outputPath = join(dir, `output.${targetExt}`);

  try {
    await writeFile(inputPath, request.data);
    const args = buildCalibreArgs({
      inputPath,
      outputPath,
      target: request.target,
      options: request.options,
    });
    const result = await runProcess(binary, args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    if (result.timedOut) {
      throw new ConversionError('TIMEOUT', `Calibre 超过 ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} 秒未完成。`, {
        zh: '文件可能太大或排版太复杂。请尝试拆分文件，或改为输出 EPUB。',
        en: 'The file may be too large or complex. Split it, or output EPUB instead.',
      });
    }
    if (result.code !== 0) {
      throw buildCalibreFailure(result.code, result.stderr, result.stdout, dir);
    }

    let data = new Uint8Array(await readFile(outputPath));
    if (data.length === 0) {
      throw new ConversionError('INTERNAL', 'Calibre 产出的文件是空的。', {
        zh: '请检查源文件是否包含可读内容。',
        en: 'Check that the source file actually contains readable content.',
      });
    }

    const warnings = extractWarnings(result.stderr, dir);

    // calibre 8 + --epub-version 3 writes nav.xhtml only; old Kindles need NCX.
    if (request.target === 'epub') {
      try {
        const toc = await ensureEpubToc(data);
        data = new Uint8Array(toc.data);
        warnings.push(...toc.warnings);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        warnings.push(`补目录时出错，已按 calibre 原样返回（TOC patch failed）: ${detail.slice(0, 120)}`);
      }
    }

    return { data, warnings };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Callable host object consumed by `convert(input, req, host)`. */
export async function calibreHost(): Promise<CalibreRunner> {
  const binary = await findCalibre();
  return {
    available: binary !== null,
    run: (request: CalibreRunRequest) => convertWithCalibre(request),
  };
}
