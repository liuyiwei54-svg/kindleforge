import type { FormatId } from '@/lib/engine/types';
import type { RecentEntry } from './types';

/**
 * P1 history: only the output format, device and timestamp are stored.
 * File names and contents never touch localStorage.
 */
const KEY = 'kindleforge:recent:v1';
const MAX_ENTRIES = 5;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readRecent(): RecentEntry[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is RecentEntry => {
        return Boolean(
          entry &&
            typeof entry === 'object' &&
            typeof (entry as RecentEntry).to === 'string' &&
            typeof (entry as RecentEntry).at === 'number',
        );
      })
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

export function rememberRecent(to: FormatId): RecentEntry[] {
  const entry: RecentEntry = { to, at: Date.now() };
  const next = [entry, ...readRecent()].slice(0, MAX_ENTRIES);
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // private mode / quota — history is optional
  }
  return next;
}

export function clearRecent(): RecentEntry[] {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // ignore
  }
  return [];
}

export function timeAgo(
  at: number,
  labels: { justNow: string; minutesAgo: string; hoursAgo: string },
  now = Date.now(),
): string {
  const delta = Math.max(0, now - at);
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return labels.justNow;
  if (minutes < 60) return labels.minutesAgo.replace('{n}', String(minutes));
  const hours = Math.floor(minutes / 60);
  return labels.hoursAgo.replace('{n}', String(hours));
}
