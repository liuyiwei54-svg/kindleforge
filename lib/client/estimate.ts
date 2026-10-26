import type { FormatId } from '@/lib/engine/types';

const TEXTUAL: ReadonlySet<FormatId> = new Set<FormatId>(['txt', 'md', 'html', 'fb2']);
const TEXTUAL_COMIC: ReadonlySet<FormatId> = new Set<FormatId>(['cbz', 'cbr']);

/**
 * Rough reading-time estimate. Deliberately coarse: we only know the file size,
 * not the language mix, so this is labelled "approx" in the UI.
 */
export function estimateReadingMinutes(from: FormatId, sizeBytes: number): number | null {
  if (!TEXTUAL.has(from) || sizeBytes <= 0) return null;
  const approxChars = sizeBytes / 1.9;
  return Math.max(1, Math.round(approxChars / 380));
}

export function isComic(format: FormatId): boolean {
  return TEXTUAL_COMIC.has(format);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/** 200MB hard limit from the contract. */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
