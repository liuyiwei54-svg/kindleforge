/**
 * Isomorphic byte / text / HTML helpers shared by every reader, writer and the
 * orchestrator. Must never import `node:*` — the exact same code runs inside the
 * browser Web Worker that powers local (zero-upload) conversion.
 */

import type { FormatId } from './types';
import { FORMAT_INFO } from './formats';

/* ------------------------------------------------------------------ bytes -- */

export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function startsWithBytes(data: Uint8Array, prefix: ArrayLike<number>, at = 0): boolean {
  if (data.length < at + prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (data[at + i] !== prefix[i]) return false;
  }
  return true;
}

/** Search for a latin1/ascii needle; used for cheap magic-number sniffing. */
export function indexOfAscii(data: Uint8Array, needle: string, from = 0): number {
  const n = needle.length;
  if (n === 0) return -1;
  const last = data.length - n;
  outer: for (let i = Math.max(0, from); i <= last; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (data[i + j] !== needle.charCodeAt(j)) continue outer;
      if (j === n - 1) return i;
    }
  }
  return -1;
}

export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(data: Uint8Array): string {
  return new TextDecoder('utf-8').decode(data);
}

export function bytesToBase64(data: Uint8Array): string {
  // btoa exists in browsers and in Node >= 16, so this is isomorphic.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = clean.length % 4 === 0 ? clean : clean + '='.repeat(4 - (clean.length % 4));
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.length);
  copy.set(data);
  return copy.buffer;
}

/* ------------------------------------------------------------------- ids --- */

export function uuid(): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;
  const bytes = new Uint8Array(16);
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** URL/filename safe slug. Keeps CJK, drops punctuation and path separators. */
export function slugify(input: string, fallback = 'book'): string {
  const slug = input
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug || fallback;
}

/** `First Last` -> `Last, First` (OPF file-as). CJK names are left untouched. */
export function fileAsName(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  if (/\p{Script=Han}/u.test(trimmed)) return trimmed;
  const parts = trimmed.split(' ');
  if (parts.length < 2) return trimmed;
  const last = parts.pop() as string;
  return `${last}, ${parts.join(' ')}`;
}

/**
 * Import an optional / Node-only dependency in a way that neither webpack nor
 * Vite tries to bundle it: the same engine runs in the browser, where `sharp`
 * and `node-unrar-js` must simply be absent. Returns null when unavailable.
 */
export async function optionalImport<T>(specifier: string): Promise<T | null> {
  // 1. `new Function` hides the module from every bundler. It works in Node, but
  //    fails inside vm-based runners ("dynamic import callback was not specified").
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const dynamicImport = new Function('s', 'return import(s)') as (s: string) => Promise<T>;
    return await dynamicImport(specifier);
  } catch {
    /* fall through */
  }
  // 2. A variable specifier that bundlers are told to ignore: resolved by Node
  //    (or Vite in tests) at runtime, never inlined into the browser bundle.
  try {
    const spec = specifier;
    return (await import(/* webpackIgnore: true */ /* @vite-ignore */ spec)) as T;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ text --- */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  shy: '\u00ad',
  zwj: '\u200d',
  zwnj: '\u200c',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  ldquo: '\u201c',
  rdquo: '\u201d',
  lsquo: '\u2018',
  rsquo: '\u2019',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bull: '\u2022',
  middot: '\u00b7',
  dagger: '\u2020',
  sect: '\u00a7',
  para: '\u00b6',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  deg: '\u00b0',
  plusmn: '\u00b1',
  times: '\u00d7',
  divide: '\u00f7',
  frac12: '\u00bd',
  frac14: '\u00bc',
  frac34: '\u00be',
  sup2: '\u00b2',
  sup3: '\u00b3',
  micro: '\u00b5',
  euro: '\u20ac',
  pound: '\u00a3',
  yen: '\u00a5',
  cent: '\u00a2',
  iexcl: '\u00a1',
  iquest: '\u00bf',
  prime: '\u2032',
  Prime: '\u2033',
  larr: '\u2190',
  rarr: '\u2192',
  harr: '\u2194',
  le: '\u2264',
  ge: '\u2265',
  ne: '\u2260',
  infin: '\u221e',
  check: '\u2713',
  hearts: '\u2665',
};

/** Decode HTML entities (numeric + a small named table). Unknown stays literal. */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, body: string) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const code = parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      // Control characters are never valid in XHTML; drop them.
      if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/\n/g, ' ');
}

export function normalizeSpace(text: string): string {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

export function truncate(text: string, max: number, ellipsis = '…'): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - ellipsis.length)).trimEnd() + ellipsis;
}

/** Hard limit used for meta description / TOC labels. */
export function truncateText(text: string, max: number): string {
  const clean = normalizeSpace(text);
  return truncate(clean, max);
}

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/gu;

export function countCjkChars(text: string): number {
  const m = text.match(CJK_RE);
  return m ? m.length : 0;
}

/**
 * Chinese is usually counted in characters, latin in words. We keep a single
 * number for the "words" stat so the UI can show one comparable figure.
 */
export function countWords(text: string): number {
  const cjk = countCjkChars(text);
  const latin = text.replace(CJK_RE, ' ').match(/[A-Za-z0-9\u00c0-\u024f][A-Za-z0-9'\u00c0-\u024f-]*/g);
  return cjk + (latin ? latin.length : 0);
}

export function readingMinutes(words: number): number {
  // ~350 units / minute for mixed CN/EN prose on e-ink.
  return Math.max(1, Math.round(words / 350));
}

export type LanguageHint = 'zh' | 'en' | 'ja' | 'ko' | 'ru' | 'und';

export function detectLanguage(text: string): LanguageHint {
  const sample = text.slice(0, 8000);
  if (!sample.trim()) return 'und';
  const han = countCjkChars(sample);
  const kana = (sample.match(/[\u3040-\u30ff]/g) ?? []).length;
  const hangul = (sample.match(/[\uac00-\ud7af]/g) ?? []).length;
  const cyrillic = (sample.match(/[\u0400-\u04ff]/g) ?? []).length;
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length;
  const total = Math.max(1, sample.length);
  if (kana / total > 0.02) return 'ja';
  if (hangul / total > 0.02) return 'ko';
  if (han / total > 0.05) return 'zh';
  if (cyrillic / total > 0.1) return 'ru';
  if (latin / total > 0.1) return 'en';
  return 'und';
}

export function languageTag(hint: LanguageHint | string | undefined, fallback = 'zh-CN'): string {
  if (!hint) return fallback;
  const lower = hint.trim().toLowerCase();
  if (!/^[a-z]{2}(-[a-z0-9]{2,8})*$/.test(lower)) return fallback;
  if (lower === 'zh') return 'zh-CN';
  if (lower === 'en') return 'en';
  // BCP 47 casing: language lower, script Titlecase, region UPPER.
  return lower
    .split('-')
    .map((part, i) =>
      i === 0 ? part : part.length === 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1),
    )
    .join('-');
}

/* -------------------------------------------------------------- encoding --- */

export interface DecodedText {
  text: string;
  encoding: string;
  warnings: string[];
}

const COMMON_HAN =
  '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感';
const TRAD_ONLY = '這國說時會為對學們個來後裡發經動過還沒樣現當開點進種問題實現電話機認識請謝讓給帶張邊門問';
const SIMP_ONLY = '这国说时会为对学们个来后里发经动过还没样现当开点进种问题实现电话机认识请谢让给带张边门问';

function hanFrequencyScore(text: string): number {
  let hits = 0;
  let han = 0;
  for (const ch of text) {
    if (ch >= '\u4e00' && ch <= '\u9fff') {
      han += 1;
      if (COMMON_HAN.includes(ch)) hits += 1;
    }
  }
  if (han === 0) return 0;
  return hits / han;
}

function decodeWith(label: string, data: Uint8Array, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(data);
  } catch {
    return null;
  }
}

/**
 * BOM → strict UTF-8 → GB18030 → Big5 → Shift_JIS.
 *
 * The three CJK legacy encodings are mutually "decodable" (every Big5 byte pair
 * is also a legal GB18030 pair), so validity alone cannot decide. We score the
 * decoded result by how many of the ~110 most frequent Han characters it
 * contains: the correct decoder produces prose, the wrong one produces a flat
 * distribution of rare glyphs. This is the same trick `chardet` uses, minus the
 * 200KB of tables.
 */
export function detectTextEncoding(data: Uint8Array): DecodedText {
  const warnings: string[] = [];

  if (startsWithBytes(data, [0xef, 0xbb, 0xbf])) {
    return { text: new TextDecoder('utf-8').decode(data.subarray(3)), encoding: 'utf-8', warnings };
  }
  if (startsWithBytes(data, [0xff, 0xfe])) {
    return { text: new TextDecoder('utf-16le').decode(data.subarray(2)), encoding: 'utf-16le', warnings };
  }
  if (startsWithBytes(data, [0xfe, 0xff])) {
    return { text: new TextDecoder('utf-16be').decode(data.subarray(2)), encoding: 'utf-16be', warnings };
  }

  const strictUtf8 = decodeWith('utf-8', data, true);
  if (strictUtf8 !== null) {
    return { text: strictUtf8, encoding: 'utf-8', warnings };
  }

  const sample = data.subarray(0, Math.min(data.length, 400_000));
  const candidates: Array<{ encoding: string; text: string; score: number }> = [];

  const gb = decodeWith('gb18030', sample);
  if (gb !== null) {
    const score = hanFrequencyScore(gb) + simpleBonus(gb, SIMP_ONLY) * 0.5;
    candidates.push({ encoding: 'gb18030', text: gb, score });
  }
  const big5 = decodeWith('big5', sample);
  if (big5 !== null) {
    const score = hanFrequencyScore(big5) + simpleBonus(big5, TRAD_ONLY) * 0.5;
    candidates.push({ encoding: 'big5', text: big5, score });
  }
  const sjis = decodeWith('shift_jis', sample);
  if (sjis !== null) {
    const kana = (sjis.match(/[\u3040-\u30ff]/g) ?? []).length;
    const score = hanFrequencyScore(sjis) + (kana / Math.max(1, sample.length)) * 8;
    candidates.push({ encoding: 'shift_jis', text: sjis, score });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (best && best.score >= 0.12) {
    if (best.encoding !== 'utf-8') {
      warnings.push(`文本按 ${best.encoding.toUpperCase()} 解码（未检测到 UTF-8 BOM）`);
    }
    return { text: best.text, encoding: best.encoding, warnings };
  }

  // Nothing scored well: fall back to lenient UTF-8 so the user still sees text.
  const loose = decodeWith('utf-8', data) ?? gb ?? '';
  warnings.push('文本编码无法确定，已按 UTF-8 尽力解码，可能出现乱码');
  return { text: loose, encoding: 'utf-8', warnings };
}

function simpleBonus(text: string, charset: string): number {
  let hits = 0;
  for (const ch of text) {
    if (charset.includes(ch)) hits += 1;
  }
  const han = countCjkChars(text);
  return han === 0 ? 0 : hits / han;
}

/* ------------------------------------------------------------ paragraphs --- */

/** Split on blank lines, then join hard-wrapped lines inside one paragraph. */
export function splitParagraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const paragraphs: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    let joined = '';
    for (const line of buffer) {
      const piece = line.trim();
      if (!piece) continue;
      if (!joined) {
        joined = piece;
        continue;
      }
      // A Chinese novel hard-wrapped at ~40 chars must NOT gain spaces; latin
      // prose hard-wrapped at ~80 chars must.
      const prev = joined[joined.length - 1] ?? '';
      const next = piece[0] ?? '';
      const cjkBoundary = /\p{Script=Han}/u.test(prev) && /\p{Script=Han}/u.test(next);
      joined += cjkBoundary ? piece : ` ${piece}`;
    }
    if (joined) paragraphs.push(joined);
    buffer = [];
  };

  for (const line of lines) {
    if (line.trim() === '') flush();
    else buffer.push(line);
  }
  flush();
  return paragraphs;
}

export function isSceneBreak(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  return /^(?:\*{3,}|-{3,}|—{3,}|_{3,}|#{3,}|={3,}|~{3,}|[◇◆※·•]{3,}|\*\s+\*\s+\*(?:\s+\*)*|(?:[—–]\s*){3,})$/.test(t);
}

/* -------------------------------------------------------------- chapters --- */

export interface ChapterHeading {
  title: string;
  level: number;
  /** `heading` means it looked like a real chapter heading. */
  kind: 'chapter';
}

const CJK_NUM = '零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾';

const CHAPTER_PATTERNS: Array<{ re: RegExp; level: number }> = [
  // 第一章 / 第12回 / 第三卷 标题
  { re: new RegExp(`^第\\s*[${CJK_NUM}0-9]+\\s*[章回节卷篇部集]\\s*[、：:．.·\\-—]?\\s*(.{0,48})$`), level: 0 },
  // Chapter 12 / CHAPTER XII / CHAPTERXIII. (bad kerning splits)
  { re: /^Chapter\s*([0-9]{1,4}|[IVXLCDM]{1,8})\b[\s:：.—-]*(.{0,64})$/i, level: 0 },
  // 序章 / 楔子 / 前言 / 后记 / 尾声 / 番外
  { re: /^(序章|楔子|序言|引言|前言|引子|后记|尾声|终章|结局|番外[一二三四五六七八九十0-9]*|附录[一二三四五六七八九十0-9A-Za-z]*|作者的话|致谢)(?:[\s:：、．.·\-—]*(.{0,48}))?$/, level: 0 },
  // Prologue / Epilogue
  { re: /^(Prologue|Epilogue|Introduction|Preface|Foreword|Afterword|Appendix(?:\s+[A-Z0-9]+)?)[\s:：.—-]*(.{0,64})$/i, level: 0 },
];

/** Returns a heading when `line` looks like a chapter marker, else null. */
export function detectChapterHeading(line: string): ChapterHeading | null {
  const raw = line.trim();
  if (!raw || raw.length > 100) return null;
  // A punctuation-heavy sentence is prose, not a heading.
  if (/[，。！？；,.!?;]$/.test(raw) && raw.length > 24) return null;

  for (const { re, level } of CHAPTER_PATTERNS) {
    const m = re.exec(raw);
    if (!m) continue;
    let title = raw.replace(/\s+/g, ' ').trim();
    // "CHAPTERXXVII." comes from kerning-split headings; restore the space.
    title = title.replace(/^(chapter)(?=[0-9ivxlcdm])/i, '$1 ');
    return { title, level, kind: 'chapter' };
  }

  // Bare numbered section like "一、" / "1、" is too ambiguous for TXT, but a
  // short line of the form "001 标题" is a common scan artifact — keep only when
  // the rest of the line looks like a title (no sentence punctuation).
  return null;
}

/* ------------------------------------------------------------------- html -- */

export interface HtmlToken {
  type: 'text' | 'open' | 'close' | 'self';
  name: string;
  attrs: string;
  text?: string;
}

export function tokenizeHtml(input: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const len = input.length;
  let i = 0;
  let textStart = 0;

  const pushText = (end: number) => {
    if (end > textStart) {
      tokens.push({ type: 'text', name: '', attrs: '', text: input.slice(textStart, end) });
    }
  };

  while (i < len) {
    const lt = input.indexOf('<', i);
    if (lt === -1) break;

    if (input.startsWith('<!--', lt)) {
      pushText(lt);
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? len : end + 3;
      textStart = i;
      continue;
    }
    if (input.startsWith('<![CDATA[', lt)) {
      pushText(lt);
      const end = input.indexOf(']]>', lt + 9);
      const cdata = input.slice(lt + 9, end === -1 ? len : end);
      if (cdata) tokens.push({ type: 'text', name: '', attrs: '', text: cdata });
      i = end === -1 ? len : end + 3;
      textStart = i;
      continue;
    }
    if (input.startsWith('<!', lt) || input.startsWith('<?', lt)) {
      pushText(lt);
      const end = input.indexOf('>', lt + 2);
      i = end === -1 ? len : end + 1;
      textStart = i;
      continue;
    }

    const isClose = input[lt + 1] === '/';
    let p = lt + (isClose ? 2 : 1);
    const nameStart = p;
    while (p < len && /[a-zA-Z0-9:_-]/.test(input[p])) p += 1;
    const name = input.slice(nameStart, p).toLowerCase();
    if (!name) {
      // A stray '<' — treat it as text.
      i = lt + 1;
      continue;
    }

    // Scan to the closing '>' honouring quoted attribute values.
    let q: string | null = null;
    let end = -1;
    for (let j = p; j < len; j += 1) {
      const ch = input[j];
      if (q) {
        if (ch === q) q = null;
      } else if (ch === '"' || ch === "'") {
        q = ch;
      } else if (ch === '>') {
        end = j;
        break;
      }
    }
    if (end === -1) break;

    pushText(lt);
    const attrs = input.slice(p, end).replace(/\/\s*$/, '');
    const selfClosing = /\/\s*$/.test(input.slice(p, end));
    tokens.push({
      type: isClose ? 'close' : selfClosing ? 'self' : 'open',
      name,
      attrs: attrs.trim(),
    });
    i = end + 1;
    textStart = i;
  }

  pushText(len);
  return tokens;
}

function parseAttributes(attrs: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const re = /([a-zA-Z_:][\w.:-]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attrs))) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    out.push([name, decodeEntities(value)]);
  }
  return out;
}

const VOID_TAGS = new Set(['br', 'hr', 'img', 'col', 'area', 'wbr']);

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark',
  'blockquote', 'q', 'cite', 'sub', 'sup', 'small', 'abbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'colgroup', 'col',
  'pre', 'code', 'kbd', 'samp', 'var',
  'a', 'img', 'figure', 'figcaption', 'ruby', 'rt', 'rp', 'span',
]);

/** Tags whose *content* is never useful in an ebook. */
const DROP_CONTENT_TAGS = new Set([
  'script', 'style', 'head', 'title', 'meta', 'link', 'base', 'noscript',
  'iframe', 'object', 'embed', 'applet', 'svg', 'math', 'template',
  'canvas', 'video', 'audio', 'source', 'track', 'form', 'input', 'button',
  'select', 'option', 'optgroup', 'textarea', 'nav', 'aside', 'footer', 'header',
  'dialog', 'menu', 'picture',
]);

const BLOCK_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'ul', 'ol', 'li', 'pre',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'figure', 'hr',
  'dl', 'dt', 'dd',
]);

const AUTO_CLOSE_ON_OPEN: Record<string, string[]> = {
  p: ['p'],
  li: ['li', 'p'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  h1: ['p'],
  h2: ['p'],
  h3: ['p'],
  h4: ['p'],
  h5: ['p'],
  h6: ['p'],
};

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colspan', 'rowspan', 'align']),
  th: new Set(['colspan', 'rowspan', 'align', 'scope']),
  ol: new Set(['start', 'type']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  abbr: new Set(['title']),
};

function isSafeUrl(url: string): boolean {
  const cleaned = url.replace(/[\u0000-\u0020]/g, '').toLowerCase();
  if (cleaned.startsWith('javascript:') || cleaned.startsWith('vbscript:')) return false;
  if (cleaned.startsWith('data:')) return false;
  return true;
}

export interface SanitizeOptions {
  /** Extra tags to keep (on top of the default whitelist). */
  extraTags?: string[];
  /** Extra tags to drop with their content. */
  dropContent?: string[];
  /**
   * Rewrite an image src. Return the new src, or null to drop the <img>.
   * Called before any output escaping.
   */
  resolveImage?: (src: string, alt: string) => string | null;
  /** Called for every `src` that got dropped (remote image, missing file…). */
  onImageDropped?: (src: string, reason: string) => void;
  /** Keep anchor tags and their href (default true). */
  keepLinks?: boolean;
}

export interface SanitizeResult {
  html: string;
  droppedImages: number;
}

/**
 * Whitelist sanitiser. Guarantees well-formed, XHTML-safe body markup: balanced
 * tags, no script/style/nav, no `on*` handlers, no `javascript:` URLs.
 */
export function sanitizeHtml(input: string, options: SanitizeOptions = {}): SanitizeResult {
  const allowed = new Set(ALLOWED_TAGS);
  for (const tag of options.extraTags ?? []) allowed.add(tag);
  const dropContent = new Set(DROP_CONTENT_TAGS);
  for (const tag of options.dropContent ?? []) dropContent.add(tag);

  const out: string[] = [];
  const stack: string[] = [];
  let droppedImages = 0;

  const closeTop = () => {
    const tag = stack.pop();
    if (tag) out.push(`</${tag}>`);
  };

  const open = (name: string, attrs: Array<[string, string]>, selfClosing: boolean) => {
    // Auto-close an implicitly-closed previous sibling (<p><p> etc.).
    const closers = AUTO_CLOSE_ON_OPEN[name];
    if (closers && stack.length > 0 && closers.includes(stack[stack.length - 1])) {
      closeTop();
    }
    if (BLOCK_TAGS.has(name) && stack.length > 0 && stack[stack.length - 1] === 'p') {
      closeTop();
    }

    const rendered: string[] = [];
    const allowedForTag = ALLOWED_ATTRS[name];
    for (const [attr, value] of attrs) {
      if (attr.startsWith('on')) continue;
      if (attr === 'style' || attr === 'class' || attr === 'id') continue;
      if (name === 'img') {
        if (!allowedForTag?.has(attr)) continue;
      } else if (!allowedForTag?.has(attr)) {
        continue;
      }
      if (attr === 'href') {
        if (options.keepLinks === false) continue;
        if (!isSafeUrl(value) || value.trim() === '') continue;
      }
      if (attr === 'src' && !isSafeUrl(value)) continue;
      if ((attr === 'width' || attr === 'height') && !/^\d{1,5}$/.test(value.trim())) continue;
      rendered.push(`${attr}="${escapeAttr(value)}"`);
    }

    if (name === 'img') {
      const src = attrs.find(([a]) => a === 'src')?.[1] ?? '';
      const alt = attrs.find(([a]) => a === 'alt')?.[1] ?? '';
      // A `resolveImage` hook must never be able to launder javascript: URLs,
      // but inline images are legitimate in DOCX/HTML input.
      const safeImageSrc = isSafeUrl(src) || /^data:image\//i.test(src.trim());
      if (!src || !safeImageSrc) {
        droppedImages += 1;
        options.onImageDropped?.(src, 'unsafe-src');
        return;
      }
      const resolved = options.resolveImage ? options.resolveImage(src, alt) : src;
      if (!resolved) {
        droppedImages += 1;
        options.onImageDropped?.(src, 'unresolved');
        return;
      }
      const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : ' alt=""';
      out.push(`<img src="${escapeAttr(resolved)}"${altAttr}/>`);
      return;
    }

    // An anchor without a surviving href is noise in an ebook.
    if (name === 'a' && !rendered.some((r) => r.startsWith('href='))) return;

    const attrText = rendered.length > 0 ? ` ${rendered.join(' ')}` : '';
    if (VOID_TAGS.has(name)) {
      out.push(`<${name}${attrText}/>`);
      return;
    }
    out.push(`<${name}${attrText}>`);
    if (selfClosing) out.push(`</${name}>`);
    else stack.push(name);
  };

  const tokens = tokenizeHtml(input);
  let dropName: string | null = null;
  let dropDepth = 0;
  // Tracks a whitespace run that was collapsed away at an inline boundary, so
  // `<b>Hello</b> world` keeps its space but `<p>Hello</p> world` does not.
  let pendingSpace = false;

  for (const tok of tokens) {
    if (dropName) {
      if (tok.type === 'open' && tok.name === dropName) dropDepth += 1;
      else if (tok.type === 'close' && tok.name === dropName) {
        dropDepth -= 1;
        if (dropDepth === 0) dropName = null;
      }
      continue;
    }

    if (tok.type === 'text') {
      const raw = tok.text ?? '';
      if (!raw) continue;
      const inPre = stack.includes('pre');
      const decoded = decodeEntities(raw);
      if (inPre) {
        out.push(escapeHtml(decoded));
        continue;
      }
      const collapsed = decoded.replace(/[ \t\r\n]+/g, ' ');
      const text = collapsed.trim();
      if (!text) {
        if (out.length > 0) pendingSpace = true;
        continue;
      }
      if ((pendingSpace || /^\s/.test(collapsed)) && out.length > 0) out.push(' ');
      out.push(escapeHtml(text));
      pendingSpace = /\s$/.test(collapsed);
      continue;
    }

    if (tok.type === 'open' || tok.type === 'self') {
      const name = tok.name;
      if (dropContent.has(name)) {
        if (tok.type === 'open' && !VOID_TAGS.has(name)) {
          dropName = name;
          dropDepth = 1;
        }
        continue;
      }
      if (!allowed.has(name)) continue;
      const isBlock = BLOCK_TAGS.has(name) || name === 'br';
      if (isBlock) {
        pendingSpace = false;
      } else if (pendingSpace && out.length > 0) {
        // Put the space before the inline tag rather than inside it.
        out.push(' ');
        pendingSpace = false;
      }
      open(name, parseAttributes(tok.attrs), tok.type === 'self');
      continue;
    }

    if (tok.type === 'close') {
      const name = tok.name;
      if (!allowed.has(name) || VOID_TAGS.has(name)) continue;
      if (BLOCK_TAGS.has(name)) pendingSpace = false;
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue;
      while (stack.length > idx) closeTop();
      continue;
    }
  }

  while (stack.length > 0) closeTop();

  let html = out.join('');
  // Collapse the noise every WYSIWYG leaves behind.
  html = html
    .replace(/<p>\s*(<br\/>)*\s*<\/p>/g, '')
    .replace(/(<br\/>\s*){3,}/g, '<br/><br/>')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return { html, droppedImages };
}

/** Text-only view of an HTML fragment (used by the TXT writer and stats). */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|figure|figcaption)>/gi, '\n')
    .replace(/<hr\s*\/?>/gi, '\n\n***\n\n')
    .replace(/<li[^>]*>/gi, '\n• ');
  const stripped = withBreaks.replace(/<[^>]+>/g, '');
  return decodeEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function stripTags(html: string): string {
  return htmlToText(html);
}

/** Extract the contents of <body> (or the whole fragment when there is none). */
export function extractBodyHtml(html: string): string {
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  return body ? body[1] : html;
}

/** First useful document title from <title>, og:title or the first <h1>. */
export function extractDocumentTitle(html: string): string | null {
  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (title) {
    const t = normalizeSpace(decodeEntities(title[1]));
    if (t) return t;
  }
  const og = /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (og) {
    const t = normalizeSpace(decodeEntities(og[1]));
    if (t) return t;
  }
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) {
    const t = normalizeSpace(htmlToText(h1[1]));
    if (t) return t;
  }
  return null;
}

/** Grab a named element's inner HTML (article/main/body), nesting-aware. */
export function extractElementHtml(html: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, 'i');
  const m = openRe.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Scan forward tracking nested open/close of the same tag.
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  let depth = 1;
  let t: RegExpExecArray | null;
  while ((t = re.exec(html))) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return html.slice(start);
}

export function extractMetaContent(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(html);
  if (!tag) return null;
  const content = /content=["']([^"']*)["']/i.exec(tag[0]);
  return content ? normalizeSpace(decodeEntities(content[1])) : null;
}

export function paragraphsToHtml(paragraphs: string[]): string {
  return paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n');
}

export function headingHtml(level: number, text: string, anchor?: string): string {
  const lvl = Math.min(6, Math.max(1, Math.round(level)));
  const id = anchor ? ` id="${escapeAttr(anchor)}"` : '';
  return `<h${lvl}${id}>${escapeHtml(text)}</h${lvl}>`;
}

/* --------------------------------------------------------------- zip/paths -- */

/** Normalise an archive path: percent-decode, drop `..`, strip leading `./`. */
export function normalizeResourcePath(path: string): string {
  let p = path.replace(/\\/g, '/');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep as-is */
  }
  const parts: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join('/');
}

/** Resolve `href` against a directory inside the archive (`''` = archive root). */
export function resolveZipPath(baseDir: string, href: string): string {
  const cleanHref = href.split('#')[0]?.split('?')[0] ?? '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(cleanHref)) return normalizeResourcePath(cleanHref);
  const joined = baseDir ? `${baseDir}/${cleanHref}` : cleanHref;
  return normalizeResourcePath(joined);
}

export function posixDirname(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function posixBasename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function extensionOf(name: string): string {
  const base = posixBasename(name);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/** Explorer-style ordering where page2 < page10. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/* ----------------------------------------------------------------- media --- */

const EXT_MEDIA: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  xhtml: 'application/xhtml+xml',
  css: 'text/css',
  js: 'text/javascript',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  otf: 'font/otf',
  ttf: 'font/ttf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  epub: 'application/epub+zip',
};

export function mediaTypeFromName(name: string): string | null {
  return EXT_MEDIA[extensionOf(name)] ?? null;
}

export function isImageName(name: string): boolean {
  const mt = mediaTypeFromName(name);
  return mt !== null && mt.startsWith('image/');
}

export function mediaTypeFromBytes(data: Uint8Array): string | null {
  if (startsWithBytes(data, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWithBytes(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWithBytes(data, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (startsWithBytes(data, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(data, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (startsWithBytes(data, [0x42, 0x4d])) return 'image/bmp';
  if (startsWithBytes(data, [0x49, 0x49, 0x2a, 0x00]) || startsWithBytes(data, [0x4d, 0x4d, 0x00, 0x2a])) {
    return 'image/tiff';
  }
  return null;
}

export interface ImageSize {
  width: number;
  height: number;
  mediaType: string;
}

/** Pure-JS dimension sniffing (no sharp) so fixed-layout pages get a viewport. */
export function imageSize(data: Uint8Array): ImageSize | null {
  const mediaType = mediaTypeFromBytes(data);
  try {
    if (mediaType === 'image/png' && data.length >= 24) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (data[12] === 0x49 && data[13] === 0x48 && data[14] === 0x44 && data[15] === 0x52) {
        return { width: view.getUint32(16), height: view.getUint32(20), mediaType };
      }
    }
    if (mediaType === 'image/gif' && data.length >= 10) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      return { width: view.getUint16(6, true), height: view.getUint16(8, true), mediaType };
    }
    if (mediaType === 'image/jpeg') {
      let i = 2;
      while (i + 9 < data.length) {
        if (data[i] !== 0xff) {
          i += 1;
          continue;
        }
        const marker = data[i + 1];
        const len = (data[i + 2] << 8) | data[i + 3];
        const isSof =
          marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
        if (isSof) {
          const height = (data[i + 5] << 8) | data[i + 6];
          const width = (data[i + 7] << 8) | data[i + 8];
          return { width, height, mediaType };
        }
        if (len <= 0) break;
        i += 2 + len;
      }
    }
    if (mediaType === 'image/webp' && data.length >= 30) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const chunk = String.fromCharCode(data[12], data[13], data[14], data[15]);
      if (chunk === 'VP8X') {
        const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
        const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
        return { width, height, mediaType };
      }
      if (chunk === 'VP8 ') {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff,
          mediaType,
        };
      }
      if (chunk === 'VP8L') {
        const b = data;
        const width = 1 + (((b[22] & 0x3f) << 8) | b[21]);
        const height = 1 + (((b[24] & 0x0f) << 10) | (b[23] << 2) | ((b[22] & 0xc0) >> 6));
        return { width, height, mediaType };
      }
    }
  } catch {
    return null;
  }
  return null;
}

/* ------------------------------------------------------------- formats ----- */

export function formatFromExtension(name: string): FormatId | null {
  const ext = extensionOf(name);
  if (!ext) return null;
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff', 'bmp'].includes(ext)) return 'image';
  for (const info of Object.values(FORMAT_INFO)) {
    if (info.ext.includes(ext)) return info.id;
  }
  return null;
}

/** "book.epub" -> "book"; strips common scan-site junk. */
export function cleanBaseName(name: string): string {
  const base = stripExtension(name.split('/').pop() ?? name);
  return base
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\([^)]*(?:z-lib|libgen|annas|epub|pdf|mobi|www\.|https?:)[^)]*\)/gi, ' ')
    .replace(/_{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
