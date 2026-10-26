/**
 * Pandoc bridge (Node only, optional).
 *
 * Used as a *fallback* for document formats our own readers cannot handle
 * (ODT when calibre is missing, DOCX when mammoth fails). Calibre stays the
 * primary engine because it understands Kindle targets.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PandocRunner } from '../index';
import type { FormatId } from '../types';
import { ConversionError } from '../types';
import { redactEngineOutput } from './redact';

const DEFAULT_TIMEOUT_MS = 120_000;
let cachedPandoc: string | null | undefined;

function which(command: string): Promise<string | null> {
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

export async function findPandoc(): Promise<string | null> {
  if (cachedPandoc !== undefined) return cachedPandoc;
  cachedPandoc = await which('pandoc');
  return cachedPandoc;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(binary: string, args: string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
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
      resolve({ code: null, stdout, stderr: error.message, timedOut });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

const PANDOC_TARGETS: Partial<Record<FormatId, string>> = {
  epub: 'epub3',
  html: 'html5',
  docx: 'docx',
  odt: 'odt',
  md: 'markdown',
  txt: 'plain',
};

/**
 * Convert a document with pandoc. Deliberately limited to epub/html/docx:
 * Kindle-native outputs are calibre's job.
 */
export async function convertWithPandoc(input: {
  data: Uint8Array;
  fromExt: string;
  target: FormatId;
  filename?: string;
}): Promise<{ data: Uint8Array; warnings: string[] }> {
  const binary = await findPandoc();
  if (!binary) {
    throw new ConversionError('ENGINE_MISSING', '找不到 pandoc。', {
      zh: '请安装 pandoc（brew install pandoc），或改用内置转换。',
      en: 'Install pandoc (brew install pandoc), or use the built-in converter.',
    });
  }
  const targetFormat = PANDOC_TARGETS[input.target];
  if (!targetFormat) {
    throw new ConversionError('UNSUPPORTED_PAIR', `pandoc 不能输出 ${input.target}。`, {
      zh: `pandoc 备用路径只支持 EPUB / HTML / DOCX。`,
      en: 'The pandoc fallback only produces EPUB / HTML / DOCX.',
    });
  }

  const dir = await mkdtemp(join(tmpdir(), 'kindleforge-pandoc-'));
  const inputPath = join(dir, `input.${input.fromExt.replace(/^\./, '') || 'docx'}`);
  const outputPath = join(dir, `output.${input.target === 'html' ? 'html' : input.target}`);
  try {
    await writeFile(inputPath, input.data);
    const args = [inputPath, '-o', outputPath, '-t', targetFormat, '--standalone', '--extract-media', dir];
    if (input.filename) args.push('--metadata', `title=${input.filename.replace(/\.[^.]+$/, '')}`);
    const result = await runProcess(binary, args, DEFAULT_TIMEOUT_MS);
    if (result.timedOut) {
      throw new ConversionError('TIMEOUT', 'pandoc 转换超时。', {
        zh: '文件可能太大，请拆分后重试。',
        en: 'The file may be too large — split it and retry.',
      });
    }
    if (result.code !== 0) {
      throw new ConversionError('INTERNAL', `pandoc 失败：${redactEngineOutput(result.stderr).slice(-300)}`, {
        zh: '备用引擎转换失败，请尝试重新导出源文件。',
        en: 'The fallback engine failed. Try re-exporting the source file.',
      });
    }
    const data = await readFile(outputPath);
    return {
      data: new Uint8Array(data),
      warnings: [`已使用 pandoc 备用引擎（${targetFormat}）`],
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function pandocHost(): Promise<PandocRunner> {
  const binary = await findPandoc();
  return {
    available: binary !== null,
    run: async (input, target) =>
      convertWithPandoc({
        data: input.data,
        fromExt: input.name.split('.').pop() ?? 'docx',
        target,
        filename: input.name,
      }),
  };
}
