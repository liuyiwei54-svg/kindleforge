import type { Capability, DeviceProfile, FormatId, FormatInfo } from './types';

export const FORMAT_INFO: Record<FormatId, FormatInfo> = {
  epub: {
    id: 'epub',
    name: 'EPUB',
    ext: ['epub'],
    mime: 'application/epub+zip',
    kind: 'ebook',
    direction: 'both',
    zh: 'EPUB 电子书',
    en: 'EPUB eBook',
    blurb: {
      zh: '开放标准、可重排，Kindle 与几乎所有阅读器都支持。',
      en: 'The open, reflowable standard — accepted by Kindle and nearly every reader.',
    },
    kindle: 'native',
  },
  mobi: {
    id: 'mobi',
    name: 'MOBI',
    ext: ['mobi'],
    mime: 'application/x-mobipocket-ebook',
    kind: 'ebook',
    direction: 'both',
    zh: 'MOBI 电子书',
    en: 'MOBI eBook',
    blurb: {
      zh: '老款 Kindle 的经典格式，兼容性最好。',
      en: 'The classic format for older Kindles — maximum compatibility.',
    },
    kindle: 'native',
  },
  azw: {
    id: 'azw',
    name: 'AZW',
    ext: ['azw'],
    mime: 'application/vnd.amazon.ebook',
    kind: 'ebook',
    direction: 'input',
    zh: 'AZW 电子书',
    en: 'AZW eBook',
    blurb: {
      zh: '第一代 Kindle 格式，可转换为通用格式长期保存。',
      en: 'First-generation Kindle format — convert it to something future-proof.',
    },
    kindle: 'native',
  },
  azw3: {
    id: 'azw3',
    name: 'AZW3',
    ext: ['azw3'],
    mime: 'application/vnd.amazon.ebook',
    kind: 'ebook',
    direction: 'both',
    zh: 'AZW3 (KF8) 电子书',
    en: 'AZW3 (KF8) eBook',
    blurb: {
      zh: 'Kindle 的现代格式，排版、字体与目录支持更好。',
      en: "Kindle's modern format with far better typography, fonts and TOC.",
    },
    kindle: 'native',
  },
  pdf: {
    id: 'pdf',
    name: 'PDF',
    ext: ['pdf'],
    mime: 'application/pdf',
    kind: 'document',
    direction: 'both',
    zh: 'PDF 文档',
    en: 'PDF document',
    blurb: {
      zh: '版式固定。会为 Kindle 重新排版成可调字号的版本。',
      en: 'Fixed layout. We reflow it into a resizable Kindle edition.',
    },
    kindle: 'native',
  },
  txt: {
    id: 'txt',
    name: 'TXT',
    ext: ['txt'],
    mime: 'text/plain',
    kind: 'text',
    direction: 'both',
    zh: '纯文本',
    en: 'Plain text',
    blurb: {
      zh: '最通用也最不容易损坏的格式，自动识别章节与编码。',
      en: 'The most durable format — we detect chapters and encodings for you.',
    },
    kindle: 'native',
  },
  md: {
    id: 'md',
    name: 'Markdown',
    ext: ['md', 'markdown'],
    mime: 'text/markdown',
    kind: 'text',
    direction: 'input',
    zh: 'Markdown',
    en: 'Markdown',
    blurb: {
      zh: '写作与笔记格式，标题层级会自动变成目录。',
      en: 'Your writing format — heading levels become a real table of contents.',
    },
    kindle: 'converted',
  },
  html: {
    id: 'html',
    name: 'HTML',
    ext: ['html', 'htm', 'xhtml'],
    mime: 'text/html',
    kind: 'text',
    direction: 'both',
    zh: 'HTML 网页',
    en: 'HTML page',
    blurb: {
      zh: '保存的网页与文档，转成 Kindle 可读的干净排版。',
      en: 'Saved pages and docs, cleaned up into Kindle-ready prose.',
    },
    kindle: 'converted',
  },
  docx: {
    id: 'docx',
    name: 'DOCX',
    ext: ['docx'],
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    direction: 'both',
    zh: 'Word 文档',
    en: 'Word document',
    blurb: {
      zh: '保留标题、粗体、列表与图片，去掉 Word 的冗余样式。',
      en: 'Keeps headings, bold, lists and images — drops Word’s style noise.',
    },
    kindle: 'converted',
  },
  rtf: {
    id: 'rtf',
    name: 'RTF',
    ext: ['rtf'],
    mime: 'application/rtf',
    kind: 'document',
    direction: 'input',
    zh: 'RTF 富文本',
    en: 'RTF rich text',
    blurb: {
      zh: '老式富文本，先规范化为 EPUB 再送到 Kindle。',
      en: 'Legacy rich text — normalised to EPUB before it reaches Kindle.',
    },
    kindle: 'converted',
  },
  fb2: {
    id: 'fb2',
    name: 'FB2',
    ext: ['fb2'],
    mime: 'application/x-fictionbook+xml',
    kind: 'ebook',
    direction: 'input',
    zh: 'FictionBook (FB2)',
    en: 'FictionBook (FB2)',
    blurb: {
      zh: '东欧流行的 XML 电子书，目录与脚注可以完整保留。',
      en: 'The XML ebook popular in Eastern Europe — TOC and footnotes intact.',
    },
    kindle: 'converted',
  },
  cbz: {
    id: 'cbz',
    name: 'CBZ',
    ext: ['cbz'],
    mime: 'application/vnd.comicbook+zip',
    kind: 'comic',
    direction: 'both',
    zh: 'CBZ 漫画',
    en: 'CBZ comic',
    blurb: {
      zh: '图片压缩包。为 Kindle 做成整页漫画，支持从右到左。',
      en: 'An image archive — turned into full-page manga with right-to-left flow.',
    },
    kindle: 'converted',
  },
  odt: {
    id: 'odt',
    name: 'ODT',
    ext: ['odt'],
    mime: 'application/vnd.oasis.opendocument.text',
    kind: 'document',
    direction: 'input',
    zh: 'ODT 文档',
    en: 'ODT document',
    blurb: {
      zh: 'LibreOffice / OpenOffice 写作格式，样式与目录可以保留。',
      en: 'LibreOffice’s writing format — styles and outline survive the trip.',
    },
    kindle: 'converted',
  },
  image: {
    id: 'image',
    name: '图片',
    ext: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tif', 'tiff'],
    mime: 'image/jpeg',
    kind: 'image',
    direction: 'input',
    zh: '图片 / 图集',
    en: 'Image / image set',
    blurb: {
      zh: '单张图片或图集，做成整页图册（摄影、字帖、漫画页）。',
      en: 'A single picture or a set — turned into a full-page Kindle art book.',
    },
    kindle: 'converted',
  },
  cbr: {
    id: 'cbr',
    name: 'CBR',
    ext: ['cbr'],
    mime: 'application/vnd.comicbook-rar',
    kind: 'comic',
    direction: 'input',
    zh: 'CBR 漫画',
    en: 'CBR comic',
    blurb: {
      zh: 'RAR 图片压缩包，解包后与 CBZ 流程一致。',
      en: 'A RAR image archive — unpacked, then treated exactly like CBZ.',
    },
    kindle: 'converted',
  },
};

export const INPUT_FORMATS: FormatId[] = ['epub', 'mobi', 'azw', 'azw3', 'pdf', 'docx', 'odt', 'txt', 'md', 'html', 'rtf', 'fb2', 'cbz', 'cbr', 'image'];
export const OUTPUT_FORMATS: FormatId[] = ['epub', 'mobi', 'azw3', 'pdf', 'txt', 'docx', 'html'];

export const DEVICES: DeviceProfile[] = [
  {
    id: 'paperwhite',
    format: 'azw3',
    screen: { width: 1236, height: 1648, dpi: 300 },
    label: { zh: 'Kindle Paperwhite', en: 'Kindle Paperwhite' },
    hint: { zh: 'AZW3 · 6.8 英寸 · 300ppi', en: 'AZW3 · 6.8" · 300ppi' },
  },
  {
    id: 'oasis',
    format: 'azw3',
    screen: { width: 1264, height: 1680, dpi: 300 },
    label: { zh: 'Kindle Oasis', en: 'Kindle Oasis' },
    hint: { zh: 'AZW3 · 7 英寸 · 实体翻页键', en: 'AZW3 · 7" · page-turn buttons' },
  },
  {
    id: 'scribe',
    format: 'pdf',
    screen: { width: 1860, height: 2480, dpi: 300 },
    label: { zh: 'Kindle Scribe', en: 'Kindle Scribe' },
    hint: { zh: 'PDF · 10.2 英寸 · 手写批注', en: 'PDF · 10.2" · stylus notes' },
  },
  {
    id: 'basic',
    format: 'mobi',
    screen: { width: 600, height: 800, dpi: 167 },
    label: { zh: '入门款 Kindle', en: 'Kindle (basic)' },
    hint: { zh: 'MOBI · 老设备最稳妥', en: 'MOBI · safest for old devices' },
  },
  {
    id: 'app',
    format: 'epub',
    screen: { width: 0, height: 0, dpi: 0 },
    label: { zh: 'Kindle App / 其他阅读器', en: 'Kindle App / other readers' },
    hint: { zh: 'EPUB · 手机、平板、Kobo', en: 'EPUB · phones, tablets, Kobo' },
  },
];

export function getDevice(id?: string): DeviceProfile {
  return DEVICES.find((d) => d.id === id) ?? DEVICES[0];
}

/**
 * Declarative conversion matrix. `engine` is the *preferred* implementation;
 * orchestration may chain builtin readers → EPUB → calibre.
 */
const MATRIX: Array<[FormatId, FormatId, Capability['engine'], Capability['quality'], boolean]> = [
  // native / local-first paths
  ['txt', 'epub', 'builtin', 'high', true],
  ['md', 'epub', 'builtin', 'high', true],
  ['html', 'epub', 'builtin', 'high', true],
  ['epub', 'epub', 'builtin', 'high', true],
  ['epub', 'txt', 'builtin', 'high', true],
  ['epub', 'html', 'builtin', 'high', true],
  ['txt', 'html', 'builtin', 'high', true],
  ['md', 'html', 'builtin', 'high', true],
  ['epub', 'pdf', 'calibre', 'medium', false],
  ['docx', 'epub', 'builtin', 'high', false],
  ['fb2', 'epub', 'builtin', 'high', false],
  ['cbz', 'epub', 'builtin', 'high', false],
  ['cbr', 'epub', 'builtin', 'high', false],
  // kindle targets from our own readers (chain through EPUB)
  ['txt', 'mobi', 'calibre', 'high', false],
  ['txt', 'azw3', 'calibre', 'high', false],
  ['txt', 'pdf', 'calibre', 'medium', false],
  ['txt', 'docx', 'calibre', 'medium', false],
  ['md', 'mobi', 'calibre', 'high', false],
  ['md', 'azw3', 'calibre', 'high', false],
  ['md', 'pdf', 'calibre', 'medium', false],
  ['md', 'docx', 'calibre', 'medium', false],
  ['html', 'mobi', 'calibre', 'high', false],
  ['html', 'azw3', 'calibre', 'high', false],
  ['html', 'pdf', 'calibre', 'medium', false],
  ['html', 'txt', 'builtin', 'high', false],
  ['html', 'docx', 'calibre', 'medium', false],
  ['docx', 'mobi', 'calibre', 'high', false],
  ['docx', 'azw3', 'calibre', 'high', false],
  ['docx', 'pdf', 'calibre', 'medium', false],
  ['docx', 'txt', 'builtin', 'medium', false],
  ['docx', 'html', 'builtin', 'high', false],
  ['fb2', 'mobi', 'calibre', 'high', false],
  ['fb2', 'azw3', 'calibre', 'high', false],
  ['fb2', 'pdf', 'calibre', 'medium', false],
  ['fb2', 'txt', 'builtin', 'medium', false],
  ['cbz', 'pdf', 'calibre', 'high', false],
  ['cbz', 'mobi', 'calibre', 'medium', false],
  ['cbr', 'pdf', 'calibre', 'high', false],
  ['cbr', 'mobi', 'calibre', 'medium', false],
  ['image', 'epub', 'builtin', 'high', false],
  ['image', 'pdf', 'calibre', 'high', false],
  ['image', 'mobi', 'calibre', 'medium', false],
  ['odt', 'epub', 'calibre', 'high', false],
  ['odt', 'mobi', 'calibre', 'high', false],
  ['odt', 'azw3', 'calibre', 'high', false],
  ['odt', 'pdf', 'calibre', 'medium', false],
  ['odt', 'txt', 'calibre', 'high', false],
  ['odt', 'docx', 'calibre', 'medium', false],
  // calibre-native inputs
  ['epub', 'mobi', 'calibre', 'high', false],
  ['epub', 'azw3', 'calibre', 'high', false],
  ['epub', 'docx', 'calibre', 'medium', false],
  ['mobi', 'epub', 'calibre', 'high', false],
  ['mobi', 'azw3', 'calibre', 'high', false],
  ['mobi', 'pdf', 'calibre', 'medium', false],
  ['mobi', 'txt', 'calibre', 'high', false],
  ['mobi', 'docx', 'calibre', 'medium', false],
  ['azw', 'epub', 'calibre', 'high', false],
  ['azw', 'azw3', 'calibre', 'high', false],
  ['azw', 'pdf', 'calibre', 'medium', false],
  ['azw', 'txt', 'calibre', 'high', false],
  ['azw3', 'epub', 'calibre', 'high', false],
  ['azw3', 'mobi', 'calibre', 'high', false],
  ['azw3', 'pdf', 'calibre', 'medium', false],
  ['azw3', 'txt', 'calibre', 'high', false],
  ['azw3', 'docx', 'calibre', 'medium', false],
  ['pdf', 'epub', 'calibre', 'medium', false],
  ['pdf', 'mobi', 'calibre', 'medium', false],
  ['pdf', 'azw3', 'calibre', 'medium', false],
  ['pdf', 'txt', 'calibre', 'medium', false],
  ['pdf', 'docx', 'calibre', 'medium', false],
  ['rtf', 'epub', 'calibre', 'high', false],
  ['rtf', 'mobi', 'calibre', 'high', false],
  ['rtf', 'azw3', 'calibre', 'high', false],
  ['rtf', 'pdf', 'calibre', 'medium', false],
  ['rtf', 'txt', 'calibre', 'high', false],
];

const QUALITY_NOTES: Partial<Record<`${FormatId}>${FormatId}`, { zh: string; en: string }>> = {
  'pdf>epub': {
    zh: '扫描版 PDF 建议开启 OCR；排版会重排为可调字号。',
    en: 'Enable OCR for scans; layout is reflowed so text can resize.',
  },
  'epub>pdf': {
    zh: 'PDF 版式固定，适合 Scribe 批注或打印。',
    en: 'PDF is fixed layout — great for Scribe annotation or printing.',
  },
  'cbz>epub': {
    zh: '整页漫画模式，建议在 Scribe 或 Paperwhite 上横屏阅读。',
    en: 'Full-page manga mode; best read in landscape on Scribe/Paperwhite.',
  },
  'docx>epub': {
    zh: '标题样式会转为目录，图片自动压缩到适合 e-ink 的尺寸。',
    en: 'Heading styles become the TOC; images are optimised for e-ink.',
  },
};

export function capabilities(available?: { calibre: boolean }): Capability[] {
  const calibreOk = available?.calibre ?? true;
  return MATRIX.map(([from, to, engine, quality, local]) => ({
    from,
    to,
    engine,
    local,
    quality,
    note: QUALITY_NOTES[`${from}>${to}`],
  })).filter((c) => c.engine !== 'calibre' || calibreOk);
}

export function outputsFor(from: FormatId, available?: { calibre: boolean }): Capability[] {
  return capabilities(available).filter((c) => c.from === from);
}

export function formatOfFilename(name: string): FormatId | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const info of Object.values(FORMAT_INFO)) {
    if (info.ext.includes(ext)) return info.id;
  }
  return null;
}

export const POPULAR_PAIRS: Array<{ from: FormatId; to: FormatId }> = [
  { from: 'epub', to: 'mobi' },
  { from: 'epub', to: 'azw3' },
  { from: 'pdf', to: 'epub' },
  { from: 'docx', to: 'epub' },
  { from: 'txt', to: 'epub' },
  { from: 'mobi', to: 'epub' },
  { from: 'azw3', to: 'epub' },
  { from: 'pdf', to: 'txt' },
  { from: 'cbz', to: 'epub' },
  { from: 'md', to: 'epub' },
  { from: 'epub', to: 'pdf' },
  { from: 'html', to: 'epub' },
];

export function pairSlug(from: FormatId, to: FormatId): string {
  return `${from}-to-${to}`;
}

export function parsePairSlug(slug: string): { from: FormatId; to: FormatId } | null {
  const m = /^([a-z0-9]+)-to-([a-z0-9]+)$/.exec(slug);
  if (!m) return null;
  const from = m[1] as FormatId;
  const to = m[2] as FormatId;
  if (!(from in FORMAT_INFO) || !(to in FORMAT_INFO)) return null;
  return { from, to };
}
