import { capabilities, FORMAT_INFO } from '@/lib/engine/formats';
import type { Capability, FormatId } from '@/lib/engine/types';
import type { FormatCapabilities } from './types';

const KNOWN = new Set<string>(Object.keys(FORMAT_INFO));

function isCapability(value: unknown): value is Capability {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.from === 'string' &&
    typeof row.to === 'string' &&
    KNOWN.has(row.from) &&
    KNOWN.has(row.to) &&
    typeof row.engine === 'string' &&
    typeof row.local === 'boolean' &&
    (row.quality === 'high' || row.quality === 'medium' || row.quality === 'lossy')
  );
}

/** Always returns something usable: the API response if valid, else the built-in matrix. */
export async function loadCapabilities(signal?: AbortSignal): Promise<FormatCapabilities> {
  try {
    const response = await fetch('/api/formats', { cache: 'no-store', signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`formats ${response.status}`);
    const payload: unknown = await response.json();
    if (!payload || typeof payload !== 'object') throw new Error('formats payload');
    const record = payload as Record<string, unknown>;
    // Prefer the server's availablePairs (filtered by installed engines, e.g. no
    // Calibre on a self-hosted box) over the full theoretical matrix.
    const rawAvailable = record.availablePairs;
    const rawPairs = record.pairs;
    const available = Array.isArray(rawAvailable) ? rawAvailable.filter(isCapability) : [];
    const all = Array.isArray(rawPairs) ? rawPairs.filter(isCapability) : [];
    const pairs = available.length > 0 ? available : all;
    if (pairs.length === 0) throw new Error('formats empty');
    const engines =
      record.engines && typeof record.engines === 'object'
        ? (record.engines as { calibre?: boolean; pandoc?: boolean; tesseract?: boolean })
        : undefined;
    return {
      pairs,
      source: 'api',
      engines: engines
        ? {
            calibre: Boolean(engines.calibre),
            pandoc: Boolean(engines.pandoc),
            tesseract: Boolean(engines.tesseract),
          }
        : undefined,
    };
  } catch {
    return { pairs: capabilities(), source: 'builtin' };
  }
}

export function pairOf(pairs: Capability[], from: FormatId, to: FormatId): Capability | undefined {
  return pairs.find((pair) => pair.from === from && pair.to === to);
}

export function outputsFor(pairs: Capability[], from: FormatId): Capability[] {
  return pairs.filter((pair) => pair.from === from);
}

/** Output formats every loaded input can produce, in the canonical output order. */
export function sharedOutputs(pairs: Capability[], inputs: FormatId[]): FormatId[] {
  if (inputs.length === 0) return [];
  const first = outputsFor(pairs, inputs[0]).map((pair) => pair.to);
  return first.filter((to) => inputs.every((from) => Boolean(pairOf(pairs, from, to))));
}

export function isLocalPair(pairs: Capability[], from: FormatId, to: FormatId): boolean {
  return pairOf(pairs, from, to)?.local === true;
}
