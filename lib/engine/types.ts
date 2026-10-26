/**
 * KindleForge — core conversion contracts.
 *
 * IMPORTANT: everything under lib/engine/{model,readers,writers,util}.ts must stay
 * isomorphic (no `node:*` imports, no `fs`), because the same code powers the
 * in-browser "local mode" and the server worker. Node-only adapters live in
 * lib/engine/node/.
 */

export type FormatId =
  | 'epub'
  | 'mobi'
  | 'azw'
  | 'azw3'
  | 'pdf'
  | 'txt'
  | 'md'
  | 'html'
  | 'docx'
  | 'rtf'
  | 'fb2'
  | 'cbz'
  | 'cbr'
  | 'odt'
  /** Pseudo-format: a single picture (jpg/png/webp/gif) or a folder of them. */
  | 'image';

/** Formats a Kindle device can open natively (the product's north star). */
export const KINDLE_NATIVE: FormatId[] = ['epub', 'mobi', 'azw3', 'pdf', 'txt'];

export type DeviceId = 'paperwhite' | 'oasis' | 'scribe' | 'basic' | 'app';

export interface DeviceProfile {
  id: DeviceId;
  /** Preferred output format for this device. */
  format: FormatId;
  screen: { width: number; height: number; dpi: number };
  /** Safe content area in CSS px @ 1600px viewport approximation. */
  label: { zh: string; en: string };
  hint: { zh: string; en: string };
}

export interface BookMeta {
  title: string;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  subjects?: string[];
  /** Resource path (inside the book) of the cover image. */
  coverPath?: string;
  /** ISO date; used for dc:date / dcterms:modified. */
  date?: string;
  sourceFormat?: FormatId;
}

export interface Chapter {
  /** Stable, file-name-safe id, e.g. "chapter-003". */
  id: string;
  title: string;
  /** Sanitised XHTML fragment (body-level elements only, no <html>). */
  html: string;
  /** Reading-order weight for TOC nesting (0 = top level). */
  level?: number;
}

export interface Resource {
  /** Normalised path inside the book, e.g. "images/cover.jpg". */
  path: string;
  data: Uint8Array;
  mediaType: string;
}

/** The format-agnostic intermediate representation every reader produces. */
export interface Book {
  meta: BookMeta;
  chapters: Chapter[];
  resources: Resource[];
  /** Fixed-layout (comics / picture books). */
  fixedLayout?: boolean;
  sourceFormat: FormatId;
}

export interface KindleOptions {
  /** Device preset that drives margins / font size hints. */
  device?: DeviceId;
  /** Kindle-friendly typography for CJK & latin text. */
  typography?: {
    /** First-line indent, in em. 0 disables. */
    indent?: number;
    /** Paragraph spacing in em. */
    paragraphSpacing?: number;
    lineHeight?: number;
    /** Justify body text (Kindle default is left-aligned for latin). */
    justify?: boolean;
    /** Hyphenation for latin text. */
    hyphenate?: boolean;
    /** Font family: serif / sans / publisher default. */
    fontFamily?: 'serif' | 'sans' | 'default';
    /** Base font size in px (Kindle honours % on top). */
    fontSize?: number;
  };
  /** Generate nav.xhtml + NCX + landmarks. */
  toc?: boolean;
  /** Keep/replace cover; false strips the cover page. */
  cover?: boolean;
  /** Manga / comic right-to-left page turn. */
  mangaMode?: boolean;
  /** Split one file per top-level heading instead of one big chapter. */
  splitChapters?: boolean;
  /** Run OCR on scanned PDFs/images (server only). */
  ocr?: boolean;
  /** Target language for OCR, ISO 639-1. */
  ocrLanguage?: string;
  /** Trim / resize images for e-ink screens (server only). */
  optimizeImages?: boolean;
  /** Metadata overrides. */
  metadata?: Partial<Pick<BookMeta, 'title' | 'author' | 'language' | 'publisher' | 'description'>>;
}

export interface ConvertRequest {
  target: FormatId;
  options?: KindleOptions;
}

export interface ConverterInput {
  name: string;
  data: Uint8Array;
}

export interface ConversionResult {
  data: Uint8Array;
  filename: string;
  mime: string;
  /** Diagnostics worth showing to the user (lost layout, fallback engine, ...). */
  warnings: string[];
  /** Which code path did the work: builtin | calibre | pandoc | ocr. */
  engine: string;
  durationMs: number;
  book?: Pick<BookMeta, 'title' | 'author' | 'language'> & { chapters?: number; images?: number };
}

export type EngineId = 'builtin' | 'calibre' | 'pandoc';

export interface Capability {
  from: FormatId;
  to: FormatId;
  engine: EngineId;
  /** True when the conversion can run fully in the browser (no upload). */
  local: boolean;
  /** Human readable quality note. */
  quality: 'high' | 'medium' | 'lossy';
  note?: { zh: string; en: string };
}

export interface FormatInfo {
  id: FormatId;
  name: string;
  ext: string[];
  mime: string;
  kind: 'ebook' | 'document' | 'text' | 'comic' | 'image';
  direction: 'input' | 'output' | 'both';
  zh: string;
  en: string;
  /** Short one-liner for SEO pages. */
  blurb: { zh: string; en: string };
  /** Kindle support level. */
  kindle: 'native' | 'converted' | 'none';
}

export class ConversionError extends Error {
  code:
    | 'UNSUPPORTED_PAIR'
    | 'ENGINE_MISSING'
    | 'INVALID_FILE'
    | 'DRM'
    | 'TOO_LARGE'
    | 'TIMEOUT'
    | 'INTERNAL';
  hint?: { zh: string; en: string };

  constructor(
    code: ConversionError['code'],
    message: string,
    hint?: { zh: string; en: string },
  ) {
    super(message);
    this.name = 'ConversionError';
    this.code = code;
    this.hint = hint;
  }
}
