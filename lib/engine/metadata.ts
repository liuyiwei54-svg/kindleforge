/**
 * Filename → book metadata guessing, plus the shared types for EPUB metadata
 * rewriting. Pure function, no `node:*` imports: the same guesses are used by
 * the browser library page and the server.
 *
 * The rules here are deliberately conservative: a wrong author is worse than no
 * author, so every pattern also reports a confidence the UI can threshold.
 */

export interface GuessedMetadata {
  title: string;
  author?: string;
  isbn?: string;
  /** 0..1 — how sure we are about the split (not about the book's identity). */
  confidence: number;
}

/** Fields the API may patch on an EPUB package document. */
export interface EpubMetadataPatch {
  title?: string;
  /** Single author (most common). */
  author?: string;
  /** Multiple authors; takes precedence over `author` when non-empty. */
  authors?: string[];
  language?: string;
  publisher?: string;
  description?: string;
  /** ISBN-10 or ISBN-13, with or without dashes. */
  isbn?: string;
  /** Raw identifier override, e.g. `urn:uuid:...` or `urn:isbn:...`. */
  identifier?: string;
  /** ISO date (`2024-05-01`) or a bare year (`2024`). */
  date?: string;
  subjects?: string[];
}

export interface EpubCoverPatch {
  data: Uint8Array;
  /** Defaults to `image/jpeg`. */
  mediaType?: string;
  /** Optional file name hint (extension is taken from the media type). */
  filename?: string;
}

export interface ApplyEpubMetadataResult {
  data: Uint8Array;
  warnings: string[];
  /** Which fields were actually written (empty when nothing changed). */
  changed: string[];
  cover?: {
    /** Path of the cover picture inside the package. */
    imagePath: string;
    /** Path of the cover XHTML page inside the package. */
    pagePath: string;
    mediaType: string;
  };
}

/* ------------------------------------------------------------------- ISBN -- */

/** Remove dashes/spaces, uppercase the check character, keep only ISBN chars. */
export function compactIsbn(raw: string): string {
  return raw.replace(/[^0-9Xx]/g, '').toUpperCase();
}

function isbn10Valid(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const ch = isbn[i];
    const digit = ch === 'X' ? 10 : Number(ch);
    sum += (10 - i) * digit;
  }
  return sum % 11 === 0;
}

function isbn13Valid(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i += 1) {
    sum += (i % 2 === 0 ? 1 : 3) * Number(isbn[i]);
  }
  return sum % 10 === 0;
}

/** Returns the canonical digits (ISBN-10 keeps `X`) or null when invalid. */
export function normalizeIsbn(raw: string): string | null {
  if (!raw) return null;
  const compact = compactIsbn(raw);
  if (compact.length === 10) return isbn10Valid(compact) ? compact : null;
  if (compact.length === 13) return isbn13Valid(compact) ? compact : null;
  return null;
}

export function isValidIsbn(raw: string): boolean {
  return normalizeIsbn(raw) !== null;
}

/**
 * Find the first valid ISBN inside arbitrary text (filename, subtitle, …).
 *
 * The candidate is a run of digits/dashes/spaces; `normalizeIsbn` then decides.
 * If the run swallowed a following number (`978… 2024`), trailing groups are
 * dropped one by one and retried, so we never miss a valid ISBN because of a
 * greedy match.
 */
export function extractIsbn(text: string): string | null {
  if (!text) return null;
  const re = /\d[\d\s-]{8,18}[\dXx]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let candidate = match[0].trim();
    for (let attempt = 0; attempt < 4 && candidate; attempt += 1) {
      const normalized = normalizeIsbn(candidate);
      if (normalized) return normalized;
      const cut = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('-'));
      if (cut <= 0) break;
      candidate = candidate.slice(0, cut).trim();
    }
  }
  return null;
}

/** Render a normalized ISBN the way OPF wants it. */
export function isbnToUrn(isbn: string): string {
  const normalized = normalizeIsbn(isbn) ?? compactIsbn(isbn);
  return `urn:isbn:${normalized}`;
}

/* --------------------------------------------------------------- guessing -- */

const CJK_SURNAMES =
  '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍却璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';

const EN_GIVEN_NAMES = new Set(
  (
    'jane john james mary robert michael william david richard joseph thomas charles ' +
    'christopher daniel matthew anthony mark donald steven paul andrew joshua kenneth ' +
    'kevin brian george edward ronald timothy jason jeffrey ryan jacob gary nicholas ' +
    'eric jonathan stephen larry justin scott brandon benjamin samuel gregory alexander ' +
    'frank patrick raymond jack dennis jerry tyler aaron jose adam nathan henry douglas ' +
    'zachary peter kyle walter ethan jeremy harold keith christian roger noah gerald ' +
    'carl terry sean austin arthur lawrence jesse dylan bryan joe jordan billy bruce ' +
    'albert willie gabriel logan alan juan wayne roy ralph randy eugene vincent russell ' +
    'elijah louis bobby philip johnny virginia emily emma olivia sophia isabella charlotte ' +
    'amelia harper evelyn abigail ella elizabeth camila luna sophie'
  ).split(/\s+/),
);

const AUTHOR_MARKERS = /(著|编著|主编|作者|著者|编|编译|选集|文集)$/u;

function stripAuthorMarkers(value: string): string {
  return value
    .replace(/\s*[（(](?:著|编著|主编|作者|编|译)[）)]\s*$/u, '')
    .replace(AUTHOR_MARKERS, '')
    .trim();
}

/** 0..1 estimate that a string is a person's name (Chinese or latin). */
export function authorNameScore(value: string): number {
  const text = value.trim();
  if (!text || text.length > 40) return 0;
  if (/[，。！？；：,.!?;:、|]/.test(text)) return 0;
  if (/^《.*》$/.test(text)) return 0;

  let score = 0;
  const cjk = /^[\u4e00-\u9fff·]{2,12}$/u.test(text);
  if (cjk) {
    score += 0.45;
    if (!text.includes('·') && CJK_SURNAMES.includes(text[0])) score += 0.3;
    if (text.includes('·')) score += 0.2; // transliterated foreign name
  }
  if (/(著|编著|主编|作者|著者|编译)$/u.test(text)) score += 0.45;
  const latinWords = text.split(/\s+/);
  const hasStopword = latinWords.some((word) =>
    /^(?:the|a|an|of|and|or|to|in|on|for|with|at|by|from|into|over|under|after|before)$/i.test(word),
  );
  if (!hasStopword && /^[A-Z][\p{L}'.-]+(?:\s+[\p{L}.'-]+){1,3}$/u.test(text)) score += 0.45;
  const firstToken = text.split(/\s+/)[0]?.toLowerCase() ?? '';
  if (EN_GIVEN_NAMES.has(firstToken)) score += 0.25;
  if (/\b(?:jr|sr|iii|phd|md)\.?$/i.test(text)) score += 0.05;
  return Math.max(0, Math.min(1, score));
}

/** 0..1 estimate that a string is a book title. */
export function titleLikelihood(value: string): number {
  const text = value.trim();
  if (!text) return 0;
  let score = 0;
  if (text.length >= 6) score += 0.2;
  if (text.length >= 12) score += 0.2;
  if (/\s/.test(text) && text.length > 10) score += 0.15;
  if (/[：:，,。!?！？]/u.test(text)) score += 0.3;
  if (/[《》]/u.test(text)) score += 0.5;
  if (/\d/.test(text)) score += 0.1;
  if (/(?:第[一二三四五六七八九十百千\d]+[卷册部章节]|vol\.?|volume|part\s+\d)/iu.test(text)) {
    score += 0.1;
  }
  if (authorNameScore(text) >= 0.8 && text.length <= 18) score -= 0.5;
  return Math.max(0, Math.min(1, score));
}

const SITE_NOISE =
  /[[(（【]\s*(?:www\.|https?:\/\/|z-?lib|libgen|annas?|archive\.org|epub|pdf|mobi|azw3?)[^\])）】]*[\])）】]/giu;
const FORMAT_SUFFIX = /[._\-\s]+(?:epub|pdf|mobi|azw3?|txt|docx?|fb2)\s*$/i;

function cleanRawFilename(filename: string): string {
  let name = (filename.split('/').pop() ?? filename).replace(/\.[^.]+$/, '');
  name = name.replace(/_+/g, ' ');
  name = name.replace(SITE_NOISE, ' ');
  name = name.replace(/\s*\[[^\]]*\]\s*$/g, (match) => (/[a-z]{2,}\./i.test(match) ? ' ' : match));
  name = name.replace(/[（(]\s*(?:z-?lib|libgen|annas?|www\.[^)）]*)[)）]/giu, ' ');
  name = name.replace(FORMAT_SUFFIX, '');
  name = name.replace(/[ \t\u3000]+/g, ' ').trim();
  name = name.replace(/^[\s._\-–—]+|[\s._\-–—]+$/g, '');
  return name;
}

/** A pure number/ISBN run can never be a title or an author. */
function looksLikeIdentifier(value: string): boolean {
  return /^[\d\s-]+[\dXx]?$/.test(value.trim());
}

function tidyTitle(value: string): string {
  return value
    .replace(/^[\s._\-–—]+|[\s._\-–—]+$/g, '')
    .replace(/[ \t\u3000]+/g, ' ')
    .replace(/\s*([，。！？；：、])\s*/gu, '$1')
    .trim();
}

function splitTitleSubtitle(value: string): { base: string; subtitle?: string } {
  // "Sapiens: A Brief History" / "人类简史：从动物到上帝"
  const match = /^(.{2,}?)\s*[：:]\s*(.{2,})$/u.exec(value);
  if (!match) return { base: value };
  return { base: match[1].trim(), subtitle: match[2].trim() };
}

interface Decision {
  title: string;
  author?: string;
  confidence: number;
}

/**
 * Decide which half of an `A - B` name is the author.
 * Names are short, dictionary-shaped, or carry 著/编; titles are longer and
 * often contain punctuation or a volume marker.
 */
export function splitAuthorTitle(left: string, right: string): Decision {
  const leftName = authorNameScore(left);
  const rightName = authorNameScore(right);
  const leftTitle = titleLikelihood(left);
  const rightTitle = titleLikelihood(right);

  if (leftName - rightName >= 0.25) {
    return { title: tidyTitle(right), author: stripAuthorMarkers(left), confidence: 0.72 };
  }
  if (rightName - leftName >= 0.25) {
    return { title: tidyTitle(left), author: stripAuthorMarkers(right), confidence: 0.72 };
  }
  // Ambiguous: the title-ish (usually longer) side wins the title slot.
  if (leftTitle >= rightTitle) {
    return { title: tidyTitle(left), author: stripAuthorMarkers(right), confidence: 0.55 };
  }
  return { title: tidyTitle(right), author: stripAuthorMarkers(left), confidence: 0.55 };
}

/**
 * Guess title/author/ISBN from a filename. Never throws and never returns an
 * empty title: the cleaned filename is the last resort.
 */
export function guessMetadata(filename: string): GuessedMetadata {
  const fallbackTitle = tidyTitle(cleanRawFilename(filename)) || '未命名书籍';
  if (!filename || !filename.trim()) {
    return { title: fallbackTitle, confidence: 0.1 };
  }

  let working = cleanRawFilename(filename);

  // 1. ISBN is metadata, never part of the title.
  const isbn = extractIsbn(working);
  if (isbn) {
    const digitPattern = Array.from(isbn)
      .map((digit) => `[\\s-]*${digit}`)
      .join('');
    working = working
      .replace(/isbn\s*[:：]?\s*/giu, ' ')
      .replace(new RegExp(digitPattern, 'gi'), ' ')
      .replace(/^[\s\-–—|,_]+|[\s\-–—|,_]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (!working) {
    return { title: fallbackTitle, ...(isbn ? { isbn } : {}), confidence: isbn ? 0.4 : 0.1 };
  }

  // 2. 《书名》 possibly followed by the author.
  const cjkTitle = /《([^》]{1,80})》\s*(.+)?$/u.exec(working);
  if (cjkTitle) {
    const title = tidyTitle(cjkTitle[1]);
    const rest = tidyTitle(cjkTitle[2] ?? '');
    if (rest && authorNameScore(rest) >= 0.3) {
      return { title, author: stripAuthorMarkers(rest), ...(isbn ? { isbn } : {}), confidence: 0.92 };
    }
    if (rest) {
      // Trailing subtitle text after a 《title》 is usually a translator/series
      // note; keep it out of the title but keep the title intact.
      const extra = splitAuthorTitle(title, rest);
      if (extra.author) {
        return { title: extra.title, author: extra.author, ...(isbn ? { isbn } : {}), confidence: 0.75 };
      }
    }
    return { title, ...(isbn ? { isbn } : {}), confidence: 0.85 };
  }

  // 3. `书名 by 作者` (English) / `书名 by 作者` (Chinese, rare but seen).
  const byMatch = /^(.{2,}?)\s+by\s+(.{2,})$/iu.exec(working);
  if (byMatch) {
    return {
      title: tidyTitle(byMatch[1]),
      author: stripAuthorMarkers(byMatch[2]),
      ...(isbn ? { isbn } : {}),
      confidence: 0.95,
    };
  }

  // 4. `[作者]书名` / `【作者】书名`.
  const bracketPrefix = /^(?:\[([^\]]{1,40})\]|【([^】]{1,40})】)\s*(.{2,})$/u.exec(working);
  if (bracketPrefix) {
    const author = tidyTitle(bracketPrefix[1] ?? bracketPrefix[2] ?? '');
    const rest = tidyTitle(bracketPrefix[3]);
    if (authorNameScore(author) >= 0.3) {
      return { title: rest, author: stripAuthorMarkers(author), ...(isbn ? { isbn } : {}), confidence: 0.85 };
    }
  }

  // 5. `(作者)` / `（作者）` suffix — either an author or a subtitle.
  const paren = /^(.{2,}?)\s*[（(]([^()（）]{1,60})[)）]\s*$/u.exec(working);
  if (paren) {
    const base = tidyTitle(paren[1]);
    const inner = tidyTitle(paren[2]);
    if (authorNameScore(inner) >= 0.45) {
      return { title: base, author: stripAuthorMarkers(inner), ...(isbn ? { isbn } : {}), confidence: 0.8 };
    }
    if (!/^[\d\s.]+$/.test(inner)) {
      // Subtitle/edition note: keep it, losing it would change the title.
      return { title: `${base} (${inner})`, ...(isbn ? { isbn } : {}), confidence: 0.6 };
    }
    return { title: base, ...(isbn ? { isbn } : {}), confidence: 0.55 };
  }

  // 6. Dash-separated `A - B` (also `A | B`, `A – B`).
  const dashParts = working.split(/\s+[-–—|｜]\s*|\s*[-–—|｜]\s+/u).filter((part) => part.trim());
  if (dashParts.length === 2) {
    const decision = splitAuthorTitle(dashParts[0], dashParts[1]);
    return { ...decision, ...(isbn ? { isbn } : {}), confidence: decision.confidence };
  }
  if (dashParts.length === 3) {
    // `Title - Subtitle - Author` (or the reverse): only the name-like end is
    // the author, the rest stays in the title.
    const first = dashParts[0];
    const last = dashParts[2];
    const firstIsName = authorNameScore(first) >= 0.45;
    const lastIsName = authorNameScore(last) >= 0.45;
    if (lastIsName && !firstIsName) {
      return {
        title: tidyTitle(dashParts.slice(0, 2).join(' - ')),
        author: stripAuthorMarkers(last),
        ...(isbn ? { isbn } : {}),
        confidence: 0.7,
      };
    }
    if (firstIsName && !lastIsName) {
      return {
        title: tidyTitle(dashParts.slice(1).join(' - ')),
        author: stripAuthorMarkers(first),
        ...(isbn ? { isbn } : {}),
        confidence: 0.7,
      };
    }
  }

  // 7. Bare `作者_书名` / `书名_作者` (underscores already became spaces, so
  //    only a two-token name on one side is recognisable here).
  const tokens = working.split(/\s+/u).filter(Boolean);
  if (tokens.length === 2) {
    if (looksLikeIdentifier(tokens[0]) && !looksLikeIdentifier(tokens[1])) {
      return { title: tidyTitle(tokens[1]), ...(isbn ? { isbn } : {}), confidence: 0.4 };
    }
    if (looksLikeIdentifier(tokens[1]) && !looksLikeIdentifier(tokens[0])) {
      return { title: tidyTitle(tokens[0]), ...(isbn ? { isbn } : {}), confidence: 0.4 };
    }
    // Only a strong name on one side justifies dropping a token from the title.
    const strongerName = Math.max(authorNameScore(tokens[0]), authorNameScore(tokens[1]));
    if (strongerName >= 0.6) {
      const decision = splitAuthorTitle(tokens[0], tokens[1]);
      if (decision.author && decision.confidence > 0.5) {
        return { ...decision, ...(isbn ? { isbn } : {}), confidence: 0.6 };
      }
    }
  }

  // 8. Last resort: the cleaned name is the title.
  const { base, subtitle } = splitTitleSubtitle(working);
  return {
    title: tidyTitle(subtitle ? `${base}：${subtitle}` : working),
    ...(isbn ? { isbn } : {}),
    confidence: 0.3,
  };
}
