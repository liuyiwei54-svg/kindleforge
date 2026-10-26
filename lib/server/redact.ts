/**
 * Privacy: error text is user-facing, so never echo absolute server paths.
 *
 * External engines (calibre/pandoc) happily print things like
 *   file:///var/folders/…/kindleforge/<uuid>/input.epub
 * in their stderr. Those leak the server's temp layout, so we collapse any
 * path inside our temp roots to `<job>` before it reaches a job error/warning.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLACEHOLDER = '<job>';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Roots whose absolute paths must never leave the server. */
function sensitiveRoots(): string[] {
  const roots = new Set<string>([join(tmpdir(), 'kindleforge'), tmpdir()]);
  return [...roots].filter((root) => root.length > 1);
}

export function redactServerPaths(text: string): string {
  if (!text) return text;
  let out = text;

  // file:// URLs (calibre prints these for input files).
  out = out.replace(/file:\/\/[^\s"'<>)\]]+/gi, PLACEHOLDER);

  // Paths under the OS temp dir (includes kindleforge/ and kindleforge-calibre-*).
  for (const root of sensitiveRoots()) {
    const pattern = new RegExp(`${escapeRegExp(root)}[^\\s"'<>)\\]]*`, 'g');
    out = out.replace(pattern, PLACEHOLDER);
  }

  // Belt and braces for other layouts / Windows temp.
  out = out.replace(/(?:[A-Za-z]:\\|\/)[^\s"'<>)\]]*kindleforge[^\s"'<>)\]]*/gi, PLACEHOLDER);
  return out;
}

export function redactHint<T extends { zh?: string; en?: string } | undefined>(
  hint: T,
): T {
  if (!hint) return hint;
  return {
    ...hint,
    ...(typeof hint.zh === 'string' ? { zh: redactServerPaths(hint.zh) } : {}),
    ...(typeof hint.en === 'string' ? { en: redactServerPaths(hint.en) } : {}),
  } as T;
}
