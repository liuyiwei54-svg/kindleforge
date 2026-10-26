/**
 * OCR bridge (Node only, optional): pdftoppm renders pages at 300dpi, tesseract
 * reads them, and ISO language codes are translated to tessdata pack names.
 *
 * Only used when the user explicitly asks for OCR on a scan — it is slow
 * (seconds per page) and never lossless.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversionError } from '../types';
import { redactEngineOutput } from './redact';

const OCR_TIMEOUT_MS = 120_000;
const DEFAULT_LANGS = 'chi_sim+eng';

let cachedTesseract: string | null | undefined;
let cachedPdftoppm: string | null | undefined;
let cachedLanguages: string[] | null = null;

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

export async function findTesseract(): Promise<string | null> {
  if (cachedTesseract !== undefined) return cachedTesseract;
  cachedTesseract = await which('tesseract');
  return cachedTesseract;
}

export async function findPdftoppm(): Promise<string | null> {
  if (cachedPdftoppm !== undefined) return cachedPdftoppm;
  cachedPdftoppm = await which('pdftoppm');
  return cachedPdftoppm;
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runProcess(binary: string, args: string[], timeoutMs = OCR_TIMEOUT_MS): Promise<RunResult> {
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
      stdout = (stdout + chunk.toString()).slice(-200_000);
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

/** Language packs actually installed, cached per process. */
export async function tesseractLanguages(): Promise<string[]> {
  if (cachedLanguages) return cachedLanguages;
  const tesseract = await findTesseract();
  if (!tesseract) return [];
  const result = await runProcess(tesseract, ['--list-langs']);
  const languages = result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^List of/i.test(line));
  cachedLanguages = languages;
  return languages;
}

/**
 * ISO 639-1 / 639-2 / BCP 47 → tessdata pack name. Unknown values pass through so
 * power users can still ask for `chi_sim+eng` directly.
 */
const TESSERACT_ALIASES: Record<string, string> = {
  zh: 'chi_sim',
  'zh-cn': 'chi_sim',
  'zh-hans': 'chi_sim',
  'zh-sg': 'chi_sim',
  zho: 'chi_sim',
  chi: 'chi_sim',
  cmn: 'chi_sim',
  chinese: 'chi_sim',
  'zh-tw': 'chi_tra',
  'zh-hk': 'chi_tra',
  'zh-hant': 'chi_tra',
  chi_tra: 'chi_tra',
  'chi-tra': 'chi_tra',
  en: 'eng',
  eng: 'eng',
  english: 'eng',
  ja: 'jpn',
  jpn: 'jpn',
  japanese: 'jpn',
  ko: 'kor',
  kor: 'kor',
  korean: 'kor',
  fr: 'fra',
  fra: 'fra',
  fre: 'fra',
  de: 'deu',
  deu: 'deu',
  ger: 'deu',
  es: 'spa',
  spa: 'spa',
  ru: 'rus',
  rus: 'rus',
  it: 'ita',
  ita: 'ita',
  pt: 'por',
  por: 'por',
  ar: 'ara',
  ara: 'ara',
  auto: DEFAULT_LANGS,
};

export interface ResolvedOcrLanguage {
  language: string;
  warnings: string[];
}

function fallbackLanguage(available: string[]): string {
  const usable = available.filter((lang) => lang !== 'osd');
  if (usable.length === 0) return DEFAULT_LANGS;
  const preferred = ['chi_sim', 'eng'].filter((lang) => usable.includes(lang));
  return preferred.length > 0 ? preferred.join('+') : usable[0];
}

/**
 * Translate a request into installed packs. Never fails: when nothing matches we
 * fall back to the installed default and say so, instead of letting tesseract
 * exit with a cryptic "Failed loading language".
 */
export async function resolveOcrLanguage(requested?: string): Promise<ResolvedOcrLanguage> {
  const available = await tesseractLanguages();
  const requestedLabel = requested?.trim() ?? '';
  const parts = requestedLabel
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  const mapped = parts.map((part) => TESSERACT_ALIASES[part.toLowerCase()] ?? part);

  // No language requested (or `auto`): silently take the installed default.
  // The user did not ask for anything we could not deliver, so no warning.
  const isAuto = mapped.length === 0 || mapped.every((name) => name === DEFAULT_LANGS || name === 'auto');
  if (isAuto) {
    return {
      language: available.length > 0 ? fallbackLanguage(available) : DEFAULT_LANGS,
      warnings: [],
    };
  }

  if (available.length === 0) {
    // Probing failed (tesseract missing): hand the request through unchanged.
    return { language: mapped.join('+'), warnings: [] };
  }

  const usable = mapped.filter((name) => available.includes(name));
  if (usable.length > 0) {
    if (usable.length < mapped.length) {
      const missing = mapped.filter((name) => !available.includes(name));
      return {
        language: usable.join('+'),
        warnings: [
          `OCR 语言包缺失，已跳过 ${missing.join(', ')}（missing tessdata: ${missing.join(', ')}）；可用：${available.join(', ')}`,
        ],
      };
    }
    return { language: usable.join('+'), warnings: [] };
  }

  // Traditional Chinese without chi_tra: simplified is the closest relative.
  if (mapped.includes('chi_tra') && available.includes('chi_sim')) {
    return {
      language: 'chi_sim',
      warnings: [
        `OCR 语言包 chi_tra 没有安装，已回退 chi_sim（chi_tra missing, falling back to chi_sim）；可用语言：${available.join(', ')}`,
      ],
    };
  }

  const fallback = fallbackLanguage(available);
  return {
    language: fallback,
    warnings: [
      `OCR 语言「${requestedLabel}」没有安装，已改用 ${fallback}（OCR language unavailable, using ${fallback}）；可用语言：${available.join(', ')}`,
    ],
  };
}

/** Describe installed packs for an error hint. */
async function languageHint(): Promise<string> {
  const available = await tesseractLanguages();
  return available.length > 0 ? available.join(', ') : DEFAULT_LANGS;
}

async function ocrFile(
  tesseract: string,
  imagePath: string,
  language: string,
): Promise<{ text: string; warnings: string[]; stderr: string }> {
  const result = await runProcess(tesseract, [imagePath, 'stdout', '-l', language, '--psm', '3']);
  const warnings: string[] = [];
  let stderr = '';
  if (result.timedOut) {
    warnings.push(`OCR 超时（timed out）: ${imagePath.split('/').pop()}`);
    stderr = redactEngineOutput(result.stderr);
  } else if (result.code !== 0) {
    stderr = redactEngineOutput(result.stderr).trim();
    if (stderr) warnings.push(`OCR 失败（OCR failed）: ${stderr.slice(0, 320)}`);
  }
  return { text: result.stdout.trim(), warnings, stderr };
}

export async function ocrImage(
  data: Uint8Array,
  requestedLanguage?: string,
): Promise<{ text: string; warnings: string[] }> {
  const tesseract = await findTesseract();
  if (!tesseract) {
    throw new ConversionError('ENGINE_MISSING', '找不到 tesseract。', {
      zh: '请安装 tesseract 与中文语言包（brew install tesseract tesseract-lang）。',
      en: 'Install tesseract with language data (brew install tesseract tesseract-lang).',
    });
  }
  const resolved = await resolveOcrLanguage(requestedLanguage);
  const dir = await mkdtemp(join(tmpdir(), 'kindleforge-ocr-'));
  const imagePath = join(dir, 'page.png');
  try {
    await writeFile(imagePath, data);
    const page = await ocrFile(tesseract, imagePath, resolved.language);
    return { text: page.text, warnings: [...resolved.warnings, ...page.warnings] };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * Render a PDF at 300dpi and OCR every page. Returns plain text with page
 * separators (we do not pretend to reconstruct the original layout).
 */
export async function ocrPdf(
  data: Uint8Array,
  requestedLanguage?: string,
): Promise<{ text: string; warnings: string[] }> {
  const [tesseract, pdftoppm] = await Promise.all([findTesseract(), findPdftoppm()]);
  if (!tesseract || !pdftoppm) {
    throw new ConversionError('ENGINE_MISSING', 'OCR 需要 tesseract 与 pdftoppm。', {
      zh: '请安装 poppler（pdftoppm）与 tesseract 中文语言包。',
      en: 'Install poppler (pdftoppm) and tesseract with Chinese language data.',
    });
  }
  const resolved = await resolveOcrLanguage(requestedLanguage);
  const warnings = [...resolved.warnings];

  const dir = await mkdtemp(join(tmpdir(), 'kindleforge-ocr-'));
  const pdfPath = join(dir, 'input.pdf');
  try {
    await writeFile(pdfPath, data);
    const render = await runProcess(
      pdftoppm,
      ['-r', '300', '-png', pdfPath, join(dir, 'page')],
      180_000,
    );
    if (render.code !== 0) {
      throw new ConversionError('INTERNAL', `PDF 渲染失败：${redactEngineOutput(render.stderr).slice(-200)}`, {
        zh: 'PDF 可能已损坏或受密码保护。',
        en: 'The PDF may be damaged or password-protected.',
      });
    }

    const files = (await readdir(dir))
      .filter((name) => /^page-\d+\.png$/.test(name))
      .sort((a, b) => {
        const na = Number(/(\d+)/.exec(a)?.[1] ?? 0);
        const nb = Number(/(\d+)/.exec(b)?.[1] ?? 0);
        return na - nb;
      });

    if (files.length === 0) {
      throw new ConversionError('INVALID_FILE', 'PDF 没有可 OCR 的页面。', {
        zh: '文件可能是空的。',
        en: 'The PDF has no pages.',
      });
    }

    const pages: string[] = [];
    let lastStderr = '';
    for (const [index, file] of files.entries()) {
      const page = await ocrFile(tesseract, join(dir, file), resolved.language);
      warnings.push(...page.warnings);
      if (page.stderr) lastStderr = page.stderr;
      if (page.text) pages.push(page.text);
      if (index === 0 && !page.text && !lastStderr) {
        warnings.push('第一页没有识别到文字，可能不是扫描版或分辨率太低（no text on page 1）');
      }
    }

    if (pages.length === 0) {
      const available = await languageHint();
      const detail = lastStderr ? ` 详情（details）：${lastStderr.slice(-500)}` : '';
      throw new ConversionError(
        'INVALID_FILE',
        `OCR 没有识别出任何文字（语言 ${resolved.language}）。${detail}`,
        {
          zh: `已安装语言包：${available}。请确认 PDF 是扫描件且文字清晰，也可换用已安装的语言代码重试。${detail}`,
          en: `Installed packs: ${available}. Check that the PDF is a legible scan, or retry with an installed language code.${detail}`,
        },
      );
    }

    return { text: pages.join('\n\n'), warnings };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function tesseractHost(): Promise<{
  available: boolean;
  ocr?: (
    data: Uint8Array,
    language?: string,
    kind?: 'pdf' | 'image',
  ) => Promise<{ text: string; warnings: string[] }>;
}> {
  const available = (await findTesseract()) !== null;
  return {
    available,
    ocr: available
      ? (data: Uint8Array, language?: string, kind: 'pdf' | 'image' = 'image') =>
          kind === 'pdf' ? ocrPdf(data, language) : ocrImage(data, language)
      : undefined,
  };
}

export { DEFAULT_LANGS };
