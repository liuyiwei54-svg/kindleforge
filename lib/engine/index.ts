/**
 * KindleForge conversion engine — the only public entry point.
 *
 * Isomorphic by design: this file (and everything it imports) runs in a browser
 * Web Worker for the zero-upload path (`canRunLocally`), and in the Node worker.
 * Anything that needs a process (calibre, pandoc, Tesseract, sharp, RAR) is
 * injected through `EngineHost` or imported opaquely inside a reader.
 *
 * Orchestration rules:
 * 1. builtin reader → Book → builtin writer, when the matrix says `builtin`.
 * 2. targets a Kindle only opens through calibre (MOBI/AZW3/PDF/DOCX):
 *    - calibre-native input (EPUB/MOBI/AZW/PDF/RTF/ODT) goes straight in
 *    - everything else is rebuilt as our EPUB first, so our typography applies
 * 3. no engine available → ConversionError('ENGINE_MISSING') with a real hint.
 */

import type {
  Book,
  Capability,
  ConversionResult,
  ConvertRequest,
  ConverterInput,
  FormatId,
  KindleOptions,
} from './types';
import { ConversionError } from './types';
import { FORMAT_INFO, capabilities, getDevice } from './formats';
import { bookSummary, bookWarnings, guessTitleFromFilename } from './model';
import { hasReader, readerFor } from './readers';
import { hasWriter, writerFor } from './writers';
import { writeEpub } from './writers/epub';
import {
  cleanBaseName,
  formatFromExtension,
  utf8Encode,
  normalizeResourcePath,
  startsWithBytes,
} from './util';

/* ------------------------------------------------------------------ host --- */

export interface CalibreRunRequest {
  data: Uint8Array;
  /** Extension of `data`, e.g. "epub", "mobi", "pdf". */
  fromExt: string;
  target: FormatId;
  options?: KindleOptions;
  filename?: string;
}

export interface CalibreRunner {
  available: boolean;
  run(request: CalibreRunRequest): Promise<{ data: Uint8Array; warnings: string[] }>;
}

export interface PandocRunner {
  available: boolean;
  run?(
    input: ConverterInput,
    target: FormatId,
  ): Promise<{ data: Uint8Array; warnings: string[] }>;
}

export interface TesseractRunner {
  available: boolean;
  /**
   * OCR a PDF (render pages first) or a single picture. `kind` defaults to
   * 'image'; PDFs need pdftoppm under the hood.
   */
  ocr?(
    data: Uint8Array,
    language?: string,
    kind?: 'pdf' | 'image',
  ): Promise<{ text: string; warnings: string[] }>;
}

/**
 * Server capabilities injected by the caller. The browser passes nothing, which
 * is exactly why local mode works offline.
 */
export interface EngineHost {
  calibre?: CalibreRunner;
  pandoc?: PandocRunner;
  tesseract?: TesseractRunner;
}

/* -------------------------------------------------------------- helpers ---- */

const MAX_INPUT_BYTES = 200 * 1024 * 1024;

/** Formats whose fidelity calibre preserves better than our own readers. */
const CALIBRE_NATIVE_INPUTS: ReadonlySet<FormatId> = new Set<FormatId>([
  'epub',
  'mobi',
  'azw',
  'azw3',
  'pdf',
  'rtf',
  'odt',
]);

const ZIP_MAGIC = [0x50, 0x4b];

function asciiSlice(data: Uint8Array, start: number, end: number): string {
  const slice = data.subarray(Math.max(0, start), Math.min(data.length, end));
  let out = '';
  for (let i = 0; i < slice.length; i += 1) {
    if (slice[i] === 0) out += '\u0000';
    else if (slice[i] < 0x80) out += String.fromCharCode(slice[i]);
    else out += '\u00ff';
  }
  return out;
}

function looksLikeText(data: Uint8Array): boolean {
  const sample = data.subarray(0, Math.min(data.length, 8192));
  if (sample.length === 0) return false;
  if (startsWithBytes(sample, [0xff, 0xfe]) || startsWithBytes(sample, [0xfe, 0xff])) return true;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const byte = sample[i];
    if (byte === 0 || (byte < 0x09 && byte !== 0) || (byte >= 0x0e && byte < 0x20)) control += 1;
  }
  return control / sample.length < 0.02;
}

/**
 * Magic number first, extension second. ZIP containers are ambiguous (EPUB /
 * DOCX / ODT / CBZ share the header) so we look for the marker files that make
 * each one identifiable, then fall back to the extension.
 */
export function detectFormat(name: string, data: Uint8Array): FormatId | null {
  const ext = formatFromExtension(name);

  if (data.length >= 4) {
    if (startsWithBytes(data, ZIP_MAGIC)) {
      const head = asciiSlice(data, 0, Math.min(data.length, 4096));
      const tail = asciiSlice(data, Math.max(0, data.length - 65536), data.length);
      const probe = `${head}\n${tail}`;
      if (probe.includes('mimetypeapplication/epub+zip')) return 'epub';
      if (probe.includes('mimetypeapplication/vnd.oasis.opendocument.text')) return 'odt';
      if (probe.includes('word/document.xml')) return 'docx';
      if (ext === 'epub' || ext === 'docx' || ext === 'odt' || ext === 'cbz') return ext;
      return 'cbz';
    }
    if (startsWithBytes(data, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF
    if (startsWithBytes(data, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'cbr'; // Rar!\x1a\x07
    if (startsWithBytes(data, [0xff, 0xd8, 0xff])) return 'image';
    if (startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image';
    if (startsWithBytes(data, [0x47, 0x49, 0x46, 0x38])) return 'image';
    if (
      startsWithBytes(data, [0x52, 0x49, 0x46, 0x46]) &&
      startsWithBytes(data, [0x57, 0x45, 0x42, 0x50], 8)
    ) {
      return 'image';
    }
    if (startsWithBytes(data, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(data, [0x4d, 0x4d, 0x00, 0x2a])) {
      return 'image';
    }
    if (startsWithBytes(data, [0x7b, 0x5c, 0x72, 0x74, 0x66])) return 'rtf'; // {\rtf
    if (startsWithBytes(data, [0x42, 0x4d])) return 'image'; // BMP

    // PalmDOC / MOBI / AZW / AZW3: "BOOKMOBI" sits at offset 60.
    if (data.length > 68 && asciiSlice(data, 60, 68) === 'BOOKMOBI') {
      if (ext === 'azw3') return 'azw3';
      if (ext === 'azw') return 'azw';
      return 'mobi';
    }

    // FB2 is XML; trust the root element, not the extension.
    if (startsWithBytes(data, [0x3c, 0x3f, 0x78, 0x6d, 0x6c]) || startsWithBytes(data, [0x3c, 0x46])) {
      const probe = asciiSlice(data, 0, Math.min(data.length, 4096));
      if (probe.includes('<FictionBook') || probe.includes('<fictionbook')) return 'fb2';
    }
  }

  const zipFamily =
    ext === 'epub' || ext === 'docx' || ext === 'odt' || ext === 'cbz';
  // A .epub that is not a ZIP is a renamed text file far more often than a
  // damaged book, so trust the bytes and sniff the text flavour.
  if (ext && !zipFamily) return ext;
  if (looksLikeText(data) || zipFamily) {
    const sniffed = sniffTextFormat(data);
    if (sniffed) return sniffed;
  }
  return null;
}

/** Guess between the three text formats we can read. */
function sniffTextFormat(data: Uint8Array): FormatId | null {
  const head = asciiSlice(data, 0, Math.min(data.length, 8192)).toLowerCase();
  if (!head) return null;
  if (head.includes('<!doctype html') || head.includes('<html') || head.includes('<body')) {
    return 'html';
  }
  if (head.includes('<fictionbook')) return 'fb2';
  if (/^\s{0,3}#{1,6}\s+\S/m.test(head) || head.startsWith('---\n')) return 'md';
  if (head.includes('{\\rtf')) return 'rtf';
  return 'txt';
}

export function canRunLocally(from: FormatId, to: FormatId): boolean {
  const capability = capabilities().find((c) => c.from === from && c.to === to);
  return capability?.local === true;
}

export function listPairs(): Capability[] {
  // Calibre is assumed for the capability list; callers can filter by
  // `engineStatus()` when it matters (the API does exactly that).
  return capabilities({ calibre: true });
}

export async function engineStatus(
  host?: EngineHost,
): Promise<{ calibre: boolean; pandoc: boolean; tesseract: boolean }> {
  return {
    calibre: host?.calibre?.available === true,
    pandoc: host?.pandoc?.available === true,
    tesseract: host?.tesseract?.available === true,
  };
}

/* ---------------------------------------------------------------- convert --- */

function fail(code: ConversionError['code'], message: string, zh: string, en: string): never {
  throw new ConversionError(code, message, { zh, en });
}

async function readBook(from: FormatId, input: ConverterInput): Promise<Book> {
  const reader = readerFor(from);
  if (!reader) {
    fail(
      'UNSUPPORTED_PAIR',
      `没有内置读取器：${from}`,
      `暂不支持读取 ${FORMAT_INFO[from].zh}，请换一种输入格式。`,
      `Reading ${FORMAT_INFO[from].en} is not supported yet.`,
    );
  }
  try {
    return await reader(input);
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      'INTERNAL',
      `读取 ${from} 失败：${detail.slice(0, 200)}`,
      '文件解析失败。请确认文件没有损坏，或换一份文件再试。',
      'The file could not be parsed. Check that it is not damaged, or try another file.',
    );
  }
}

async function writeBook(
  to: FormatId,
  book: Book,
  options: KindleOptions,
  warnings: string[],
): Promise<Uint8Array> {
  const writer = writerFor(to);
  if (!writer) {
    fail(
      'UNSUPPORTED_PAIR',
      `没有内置写入器：${to}`,
      `暂不支持输出 ${FORMAT_INFO[to].zh}。`,
      `Writing ${FORMAT_INFO[to].en} is not supported yet.`,
    );
  }
  try {
    const data = await writer(book, options, warnings);
    if (data.length === 0) throw new Error('writer produced no bytes');
    return data;
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      'INTERNAL',
      `生成 ${to} 失败：${detail.slice(0, 200)}`,
      '写文件时出错。这通常是文件内容异常，请尝试换一种输出格式。',
      'Writing the file failed. Try a different output format.',
    );
  }
}

/** Metadata is authoritative from the request, so the summary matches the file. */
function applyMetadataOverrides(book: Book, options: KindleOptions): void {
  const overrides = options.metadata;
  if (!overrides) return;
  for (const key of ['title', 'author', 'language', 'publisher', 'description'] as const) {
    const value = overrides[key];
    if (typeof value === 'string' && value.trim()) book.meta[key] = value.trim();
  }
}

async function runCalibre(
  calibre: CalibreRunner,
  request: CalibreRunRequest,
): Promise<{ data: Uint8Array; warnings: string[] }> {
  let converted: { data: Uint8Array; warnings: string[] };
  try {
    converted = await calibre.run(request);
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      'INTERNAL',
      `Calibre 转换失败：${detail.slice(0, 240)}`,
      '外部引擎执行失败。请把原文件在 Calibre 里直接转换一次，确认文件本身没有问题。',
      'The external engine failed. Try opening the file in Calibre once to confirm it is valid.',
    );
  }
  if (!converted || converted.data.length === 0) {
    fail(
      'INTERNAL',
      'Calibre 没有产出文件。',
      '请确认目标格式与设备组合有效，或换一种输出格式。',
      'No output was produced. Check the target format or pick another one.',
    );
  }
  return converted;
}

function outputExtension(to: FormatId): string {
  return FORMAT_INFO[to].ext[0] ?? to;
}

function safeFilename(input: string, to: FormatId, options: KindleOptions): string {
  const override = options.metadata?.title?.trim();
  const base = cleanBaseName(override && override.length > 0 ? override : input) || 'book';
  const cleaned = base
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
    .replace(/^[. ]+|[. ]+$/g, '');
  return `${cleaned || 'book'}.${outputExtension(to)}`;
}

function dedupe(messages: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const message of messages) {
    const clean = message.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function resultOf(
  data: Uint8Array,
  input: ConverterInput,
  to: FormatId,
  options: KindleOptions,
  engine: string,
  warnings: string[],
  started: number,
  book?: Book,
): ConversionResult {
  const summary = book
    ? bookSummary(book)
    : { title: guessTitleFromFilename(input.name) };
  return {
    data,
    filename: safeFilename(book?.meta.title || input.name, to, options),
    mime: FORMAT_INFO[to].mime,
    warnings: dedupe(warnings),
    engine,
    durationMs: Math.max(0, Date.now() - started),
    book: summary,
  };
}

/** Render/OCR a scan, then reuse the TXT reader so chapter detection applies. */
async function ocrToBook(
  input: ConverterInput,
  from: FormatId,
  host: EngineHost | undefined,
  options: KindleOptions,
  warnings: string[],
): Promise<Book> {
  const tesseract = host?.tesseract;
  if (!tesseract || !tesseract.available || typeof tesseract.ocr !== 'function') {
    fail(
      'ENGINE_MISSING',
      'OCR 需要 Tesseract，但当前环境不可用。',
      '请安装 tesseract 与中文语言包（brew install tesseract tesseract-lang），或关闭 OCR。',
      'Install tesseract with Chinese language data (brew install tesseract tesseract-lang), or turn OCR off.',
    );
  }

  let recognised: { text: string; warnings: string[] };
  try {
    recognised = await tesseract.ocr(input.data, options.ocrLanguage, from === 'pdf' ? 'pdf' : 'image');
  } catch (error) {
    if (error instanceof ConversionError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    fail(
      'INTERNAL',
      `OCR 失败：${detail.slice(0, 200)}`,
      '识别过程出错。请确认文件是扫描件，或改用更清晰的原图。',
      'Recognition failed. Check that the file is a scan, or use a cleaner original.',
    );
  }

  warnings.push(...(recognised.warnings ?? []));
  const text = recognised.text ?? '';
  if (text.trim().length === 0) {
    // Keep tesseract's own words: "Failed loading language" is the difference
    // between a five-minute fix and a mystery.
    const detail = (recognised.warnings ?? [])
      .filter((message) => /OCR|tess|语言|language|error|fail/i.test(message))
      .slice(-2)
      .join(' | ')
      .slice(-500);
    fail(
      'INVALID_FILE',
      `OCR 没有识别出任何文字。${detail ? ` 详情（details）：${detail}` : ''}`,
      `这一页可能几乎是空白，或语言包不匹配。请提高扫描分辨率，或关闭 OCR 直接转换版式。${
        detail ? ` 引擎输出：${detail}` : ''
      }`,
      `Nothing was recognised — the page may be blank or the language pack missing. Try a higher-resolution scan, or turn OCR off.${
        detail ? ` Engine output: ${detail}` : ''
      }`,
    );
  }

  const reader = readerFor('txt');
  if (!reader) {
    fail('INTERNAL', '缺少内置 TXT 读取器。', '内部错误，请联系维护者。', 'Internal error.');
  }
  const title = guessTitleFromFilename(input.name);
  const book = await reader({ name: `${title}.txt`, data: utf8Encode(text) });
  book.sourceFormat = from;
  book.meta.title = title;
  warnings.push(
    `已用 OCR 识别为可重排文本（${text.length} 字符；OCR reflowed ${text.length} characters）`,
  );
  return book;
}

/**
 * Cheap "does this PDF have selectable text?" check. A text PDF always carries
 * /Font dictionaries in its page resources; scans carry only /Image XObjects.
 * We look at the head and tail of the file because object order varies.
 */
export function pdfHasTextLayer(data: Uint8Array): boolean {
  if (data.length < 8) return false;
  const headEnd = Math.min(data.length, 4 * 1024 * 1024);
  const tailStart = Math.max(0, data.length - 2 * 1024 * 1024);
  const head = asciiSlice(data, 0, headEnd);
  if (/\/Font\b/.test(head)) return true;
  if (tailStart > headEnd) {
    const tail = asciiSlice(data, tailStart, data.length);
    if (/\/Font\b/.test(tail)) return true;
  }
  return false;
}

function missingCalibre(): never {
  fail(
    'ENGINE_MISSING',
    '该转换需要 Calibre 的 ebook-convert，但当前环境没有安装。',
    '请安装 Calibre（calibre-ebook.com），或改用 EPUB / TXT / HTML 等内置格式。',
    'Install Calibre (calibre-ebook.com), or choose a built-in target such as EPUB, TXT or HTML.',
  );
}

function unsupported(from: FormatId, to: FormatId): never {
  const available = [...new Set(capabilities({ calibre: true }).filter((c) => c.from === from).map((c) => c.to))];
  const hintList = available.slice(0, 6).join(', ');
  fail(
    'UNSUPPORTED_PAIR',
    `不支持的转换：${from} → ${to}`,
    available.length > 0
      ? `${FORMAT_INFO[from].zh} 可以转换为：${hintList}。`
      : `${FORMAT_INFO[from].zh} 目前不能转换。`,
    available.length > 0
      ? `${FORMAT_INFO[from].en} can be converted to: ${hintList}.`
      : `${FORMAT_INFO[from].en} cannot be converted yet.`,
  );
}

/**
 * Convert one file. Pass `host` on the server to enable calibre (MOBI/AZW3/PDF/
 * DOCX targets) — the browser passes nothing and gets an honest ENGINE_MISSING
 * for those targets instead of a fake success.
 */
export async function convert(
  input: ConverterInput,
  req: ConvertRequest,
  host?: EngineHost,
): Promise<ConversionResult> {
  const started = Date.now();
  const warnings: string[] = [];
  const options: KindleOptions = req.options ?? {};

  if (input.data.length === 0) {
    fail(
      'INVALID_FILE',
      '输入文件为空。',
      '文件是 0 字节，请重新选择。',
      'The file is empty — pick it again.',
    );
  }
  if (input.data.length > MAX_INPUT_BYTES) {
    fail(
      'TOO_LARGE',
      `输入超过 ${Math.round(MAX_INPUT_BYTES / (1024 * 1024))}MB。`,
      '请拆分文件，或使用更小的版本。',
      'Split the file or use a smaller version.',
    );
  }

  const from = detectFormat(input.name, input.data);
  if (!from) {
    fail(
      'INVALID_FILE',
      '无法识别文件格式。',
      '请确认文件扩展名正确，或换一个文件。',
      'We could not recognise the file format. Check the extension or try another file.',
    );
  }

  const to = req.target;
  if (!(to in FORMAT_INFO)) {
    fail('UNSUPPORTED_PAIR', `未知的目标格式：${to}`, '目标格式无效。', 'Unknown target format.');
  }

  const capability = capabilities({ calibre: true }).find((c) => c.from === from && c.to === to);
  if (!capability) unsupported(from, to);

  // Keep a validity check on requested options: an invalid device would
  // otherwise silently change typography.
  if (options.device && getDevice(options.device).id !== options.device) {
    warnings.push(`未知设备预设，已使用默认值（unknown device preset）: ${options.device}`);
    delete options.device;
  }

  // Route 0 — OCR a scan into reflowable text (only when explicitly asked).
  if (options.ocr === true && (from === 'pdf' || from === 'image')) {
    const book = await ocrToBook(input, from, host, options, warnings);
    applyMetadataOverrides(book, options);
    warnings.push(...bookWarnings(book));

    const builtinTarget = to === 'epub' || to === 'html' || to === 'txt';
    if (builtinTarget && hasWriter(to)) {
      const data = await writeBook(to, book, options, warnings);
      return resultOf(data, input, to, options, 'ocr', warnings, started, book);
    }

    const calibre = host?.calibre;
    if (!calibre || !calibre.available || typeof calibre.run !== 'function') missingCalibre();
    const epub = await writeEpub(book, options);
    const converted = await runCalibre(calibre, {
      data: epub,
      fromExt: 'epub',
      target: to,
      options,
      filename: input.name,
    });
    warnings.push(...(converted.warnings ?? []));
    return resultOf(converted.data, input, to, options, 'ocr+calibre', warnings, started, book);
  }

  // Route 1 — fully builtin.
  if (capability.engine === 'builtin') {
    if (!hasReader(from) || !hasWriter(to)) unsupported(from, to);
    const book = await readBook(from, input);
    applyMetadataOverrides(book, options);
    warnings.push(...bookWarnings(book));
    const data = await writeBook(to, book, options, warnings);
    return resultOf(data, input, to, options, 'builtin', warnings, started, book);
  }

  // A scanned PDF has no text layer: calibre will happily produce an image-only
  // DOCX/EPUB. Say so instead of silently shipping a book with 0 words.
  if (from === 'pdf' && options.ocr !== true && !pdfHasTextLayer(input.data)) {
    warnings.push(
      '未检测到文字层，已按图片处理；建议开启 OCR（no text layer detected — treated as images; enable OCR）',
    );
  }

  // Route 2 — calibre.
  const calibre = host?.calibre;
  if (!calibre || !calibre.available || typeof calibre.run !== 'function') missingCalibre();

  let payload = input.data;
  let fromExt = FORMAT_INFO[from].ext[0] ?? from;
  let engine = 'calibre';
  let book: Book | undefined;

  if (!CALIBRE_NATIVE_INPUTS.has(from)) {
    // Rebuild as our own EPUB first: it gives calibre a clean, Kindle-ready
    // document instead of something half-understood.
    book = await readBook(from, input);
    applyMetadataOverrides(book, options);
    warnings.push(...bookWarnings(book));
    payload = await writeEpub(book, options);
    fromExt = 'epub';
    engine = 'builtin+calibre';
  }

  const converted = await runCalibre(calibre, {
    data: payload,
    fromExt,
    target: to,
    options,
    filename: input.name,
  });
  warnings.push(...(converted.warnings ?? []));

  return resultOf(converted.data, input, to, options, engine, warnings, started, book);
}

/* Re-exports used by the API layer / UI without reaching into internals. */
export { FORMAT_INFO, capabilities, getDevice };
export { guessTitleFromFilename } from './model';
export type { Capability, KindleOptions } from './types';

/* v2 metadata helpers. The EPUB rewrite itself is Node-only and lives in
 * `lib/engine/node/epub-meta.ts`; this module only exports the pure parts so the
 * browser bundle stays free of JSZip-based package editing. */
export { extractIsbn, guessMetadata, isbnToUrn, isValidIsbn, normalizeIsbn } from './metadata';
export type {
  ApplyEpubMetadataResult,
  EpubCoverPatch,
  EpubMetadataPatch,
  GuessedMetadata,
} from './metadata';
