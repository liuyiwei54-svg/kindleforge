/**
 * CSS shared by the EPUB and HTML writers.
 *
 * Rules are chosen for e-ink first:
 * - no fixed font sizes (Kindle's Aa menu must keep working) — only `em` / `%`
 * - CJK body text justifies well, latin often does not, so it is an option
 * - `break-before: page` on h1 is supported by KF8 and Kobo
 * - hyphenation is off by default: Kindle's engine hyphenates Chinese badly
 */

import type { KindleOptions } from '../types';
import { getDevice } from '../formats';

export interface ResolvedTypography {
  indent: number;
  paragraphSpacing: number;
  lineHeight: number;
  justify: boolean;
  hyphenate: boolean;
  fontFamily: 'serif' | 'sans' | 'default';
  fontSizePercent: number | null;
}

export function resolveTypography(options: KindleOptions = {}): ResolvedTypography {
  const t = options.typography ?? {};
  const device = options.device ? getDevice(options.device) : undefined;
  // Scribe is a large screen: a slightly smaller relative size reads better.
  const base = t.fontSize ?? (device?.id === 'scribe' ? 18 : 16);
  return {
    indent: Math.max(0, t.indent ?? 2),
    paragraphSpacing: Math.max(0, t.paragraphSpacing ?? 0),
    lineHeight: Math.min(2.4, Math.max(1.2, t.lineHeight ?? 1.7)),
    justify: t.justify ?? true,
    hyphenate: t.hyphenate ?? false,
    fontFamily: t.fontFamily ?? 'serif',
    fontSizePercent: t.fontSize ? Math.round((base / 16) * 100) : null,
  };
}

export function typographyCss(options: KindleOptions = {}): string {
  const t = resolveTypography(options);
  const rules: string[] = [];

  const body: string[] = [
    `line-height: ${t.lineHeight}`,
    `text-align: ${t.justify ? 'justify' : 'left'}`,
    'margin: 0',
    'padding: 0',
  ];
  if (t.fontFamily === 'serif') body.push('font-family: serif');
  else if (t.fontFamily === 'sans') body.push('font-family: sans-serif');
  if (t.hyphenate) {
    body.push('hyphens: auto', '-webkit-hyphens: auto', 'hyphenate-limit-chars: 6 3 3');
  } else {
    // Off by default: Kindle hyphenates CJK into nonsense.
    body.push('hyphens: none', '-webkit-hyphens: none');
  }
  if (t.fontSizePercent) body.push(`font-size: ${t.fontSizePercent}%`);
  rules.push(`body { ${body.join('; ')} }`);

  const paragraph: string[] = ['margin: 0'];
  paragraph.push(`text-indent: ${t.indent}em`);
  if (t.paragraphSpacing > 0) paragraph.push(`margin-bottom: ${t.paragraphSpacing}em`);
  paragraph.push('widows: 2', 'orphans: 2');
  rules.push(`p { ${paragraph.join('; ')} }`);

  if (t.indent === 0 && t.paragraphSpacing === 0) {
    // Without an indent, paragraphs need some air or they merge visually.
    rules.push('p + p { margin-top: 0.6em }');
  }

  return rules.join('\n');
}

/** Core book stylesheet. Kept small: every byte ships to the device. */
export function bookCss(options: KindleOptions = {}): string {
  return `@charset "utf-8";

html, body { margin: 0; padding: 0; }

${typographyCss(options)}

h1, h2, h3, h4, h5, h6 {
  text-indent: 0;
  font-weight: bold;
  line-height: 1.3;
  page-break-after: avoid;
  break-after: avoid;
}

h1 {
  font-size: 1.5em;
  margin: 1.4em 0 1em;
  page-break-before: always;
  break-before: page;
}

h2 { font-size: 1.25em; margin: 1.2em 0 0.6em; }
h3 { font-size: 1.1em; margin: 1em 0 0.5em; }
h4, h5, h6 { font-size: 1em; margin: 0.9em 0 0.4em; }

blockquote {
  margin: 0.8em 1.2em;
  padding: 0;
  font-style: italic;
  text-indent: 0;
}

blockquote p { text-indent: 0; }

ul, ol { margin: 0.8em 0 0.8em 1.4em; padding: 0; }
li { text-indent: 0; margin: 0.2em 0; }

img { max-width: 100%; height: auto; }
figure { margin: 0.8em 0; padding: 0; text-align: center; }
figcaption { font-size: 0.9em; text-indent: 0; margin-top: 0.3em; }

table {
  border-collapse: collapse;
  margin: 0.8em 0;
  width: 100%;
  font-size: 0.95em;
}
caption { font-weight: bold; text-align: left; padding-bottom: 0.3em; }
th, td { border: 1px solid #999; padding: 0.2em 0.35em; text-indent: 0; vertical-align: top; }
th { background-color: #f0f0f0; }

hr {
  border: 0;
  margin: 1.2em 0;
  text-align: center;
}
hr:after { content: "* * *"; letter-spacing: 0.4em; }

pre, code, kbd, samp {
  font-family: monospace;
  font-size: 0.9em;
  text-indent: 0;
}
pre { white-space: pre-wrap; word-wrap: break-word; overflow-wrap: break-word; }
pre code { white-space: inherit; }

a { color: inherit; text-decoration: underline; }

sup, sub { line-height: 0; font-size: 0.75em; }

/* Title page generated when the source has no cover picture. */
.title-page { margin-top: 22%; text-align: center; }
.title-page h1 {
  page-break-before: auto;
  break-before: auto;
  font-size: 2em;
  margin: 0 0 1.2em;
  text-indent: 0;
}
.title-page .author { font-size: 1.15em; text-indent: 0; margin: 0 0 2em; }
.title-page .imprint { font-size: 0.85em; text-indent: 0; margin-top: 3em; color: #666; }

/* Fixed layout (comics, picture books). */
.fixed, .fixed body { margin: 0; padding: 0; }
.page { margin: 0; padding: 0; text-align: center; page-break-after: always; break-after: page; }
.page:last-child { page-break-after: auto; break-after: auto; }
.page img { width: 100%; height: auto; max-width: none; }

.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }

.chapter { margin: 0; padding: 0; }
`;
}

/** Manga/epigraph templates need the reading direction in CSS as well. */
export function directionCss(mangaMode: boolean): string {
  return mangaMode ? 'html { direction: ltr; }\n' : '';
}
