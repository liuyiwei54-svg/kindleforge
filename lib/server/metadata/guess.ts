/**
 * Filename → { title, author, isbn } heuristics (v2).
 *
 * This is the offline fallback used when the engine's `guessMetadata()` is not
 * available. It understands:
 *   《三体》                  → title
 *   三体 - 刘慈欣             → title - author (the library's own convention)
 *   刘慈欣 - 三体             → author - title (common Chinese release naming)
 *   [刘慈欣]三体              → [author]title
 *   三体 by 刘慈欣            → title by author
 *   9787536692930             → ISBN extracted, title untouched
 *
 * Ambiguous `A - B` pairs fall back to title-first; a leading 2–4 character
 * Chinese personal name (common surname) flips it to author-first.
 */

export interface FilenameGuess {
  title: string;
  author: string;
  isbn?: string;
}

const EXT_RE =
  /\.(?:epub|mobi|azw3?|pdf|txt|docx|html?|xhtml|md|markdown|fb2|cbz|cbr|odt|rtf|zip)$/i;

const SEPARATORS = /^[\s\-–—_:：·|]+|[\s\-–—_:：·|]+$/g;

const COMMON_SURNAMES = new Set(
  (
    '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'
  ).split(''),
);

function clean(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(SEPARATORS, '')
    .trim();
}

function stripExtension(filename: string): string {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? filename;
  return base.replace(EXT_RE, '').trim();
}

/** Normalize an ISBN to 10/13 digits (10 may end in X); null when invalid. */
export function normalizeIsbn(input: string): string | null {
  const cleaned = input.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{13}$/.test(cleaned)) return cleaned;
  if (/^\d{9}[\dX]$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Extract the first ISBN found in a string. Handles hyphen/space separators.
 * No checksum validation: many filenames carry an ISBN of a different edition.
 */
export function extractIsbn(input: string): string | null {
  const text = input.toUpperCase();
  const isbn13 = text.match(/(?<!\d)97[89](?:[\s-]?\d){10}(?!\d)/);
  if (isbn13) {
    const normalized = normalizeIsbn(isbn13[0]);
    if (normalized) return normalized;
  }
  const isbn10 = text.match(/(?<!\d)\d(?:[\s-]?\d){8}[\s-]?[\dX](?!\d)/);
  if (isbn10) {
    const normalized = normalizeIsbn(isbn10[0]);
    if (normalized && !normalized.startsWith('978') && !normalized.startsWith('979')) {
      return normalized;
    }
  }
  return null;
}

/** Remove an ISBN token (plus its surrounding separators) from a title. */
function stripIsbn(text: string, isbn: string | null): string {
  if (!isbn) return text;
  const compact = text.replace(/[\s-]/g, '');
  if (!compact.includes(isbn)) return text;
  // Remove the raw match rather than rebuilding from normalized digits.
  const re = /(?:97[89](?:[\s-]?\d){10}|(?<!\d)\d(?:[\s-]?\d){8}[\s-]?[\dX])(?!\d)/i;
  return clean(text.replace(re, ' '));
}

function splitBy(text: string, pattern: RegExp): [string, string] | null {
  const match = text.match(pattern);
  if (!match) return null;
  return [clean(match[1] ?? ''), clean(match[2] ?? '')];
}

function looksLikeAuthorName(value: string): boolean {
  const name = value.replace(/^[\[(（【]|[)\]}）】]$/g, '').trim();
  const withoutNationality = name.replace(/^[[(（【][^\])）】]{1,6}[\])）】]/, '').trim();
  if (/^[\u4e00-\u9fa5]{2,4}$/.test(withoutNationality)) {
    return COMMON_SURNAMES.has(withoutNationality[0] ?? '');
  }
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z.]+){1,2}$/.test(withoutNationality);
}

/** Core heuristic (pure, unit-testable). */
export function guessFromFilename(filename: string): FilenameGuess {
  const original = stripExtension(filename) || filename;
  const isbn = extractIsbn(original);
  let working = stripIsbn(original, isbn);
  if (!working) working = original;

  // 《title》 — title may be prefixed/suffixed with an author.
  const brackets = working.match(/^(.*?)《([^》]{1,200})》(.*)$/);
  if (brackets) {
    const before = clean(brackets[1] ?? '');
    const title = clean(brackets[2] ?? '');
    const after = clean(brackets[3] ?? '').replace(/^(?:by|著|编著|主编|译)\s*/i, '');
    const author = after || before;
    return { title: title || original, author, ...(isbn ? { isbn } : {}) };
  }

  // [author] title
  const bracketAuthor = splitBy(working, /^[\[【(（]([^\])】）]{1,80})[\]】)）]\s*(.+)$/);
  if (bracketAuthor && bracketAuthor[1] && bracketAuthor[0]) {
    return { title: bracketAuthor[1], author: bracketAuthor[0], ...(isbn ? { isbn } : {}) };
  }

  // title by author
  const by = splitBy(working, /^(.{1,200}?)\s+by\s+(.{1,120})$/i);
  if (by && by[0]) {
    return {
      title: by[0],
      author: by[1].replace(/(?:著|编著|主编|译)$/u, '').trim(),
      ...(isbn ? { isbn } : {}),
    };
  }

  // A - B
  const dash = splitBy(working, /^(.{1,200}?)\s*[-–—]\s*(.{1,120})$/);
  if (dash && dash[0] && dash[1]) {
    const [left, right] = dash;
    const authorFirst =
      looksLikeAuthorName(left) && !looksLikeAuthorName(right) && right.length >= 2;
    if (authorFirst) {
      return {
        title: right,
        author: left.replace(/(?:著|编著|主编|译)$/u, '').trim(),
        ...(isbn ? { isbn } : {}),
      };
    }
    return {
      title: left,
      author: right.replace(/(?:著|编著|主编|译)$/u, '').trim(),
      ...(isbn ? { isbn } : {}),
    };
  }

  return { title: working || original, author: '', ...(isbn ? { isbn } : {}) };
}

/** Clamp guess lengths so they are safe for filenames and API payloads. */
export function boundedGuess(guess: FilenameGuess): FilenameGuess {
  const title = clean(guess.title).slice(0, 200) || 'Untitled';
  const author = clean(guess.author).slice(0, 120);
  return {
    title,
    author,
    ...(guess.isbn ? { isbn: guess.isbn } : {}),
  };
}
