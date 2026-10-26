import { capabilities, pairSlug, parsePairSlug } from '@/lib/engine/formats';
import type { Capability, FormatId } from '@/lib/engine/types';

export interface StaticPair {
  from: FormatId;
  to: FormatId;
  slug: string;
  engine: Capability['engine'];
  local: boolean;
  quality: Capability['quality'];
  note?: { zh: string; en: string };
}

function toStatic(capability: Capability): StaticPair {
  return {
    from: capability.from,
    to: capability.to,
    slug: pairSlug(capability.from, capability.to),
    engine: capability.engine,
    local: capability.local,
    quality: capability.quality,
    note: capability.note,
  };
}

let cache: StaticPair[] | null = null;

/** Every pair the engine declares — used for generateStaticParams and sitemap. */
export function getStaticPairs(): StaticPair[] {
  if (cache) return cache;
  const seen = new Set<string>();
  const pairs: StaticPair[] = [];
  for (const capability of capabilities()) {
    // A self-pair (epub → epub) passes the file through; it is not a product page.
    if (capability.from === capability.to) continue;
    const slug = pairSlug(capability.from, capability.to);
    if (seen.has(slug)) continue;
    seen.add(slug);
    pairs.push(toStatic(capability));
  }
  cache = pairs;
  return pairs;
}

export function getStaticPair(slug: string): StaticPair | null {
  const parsed = parsePairSlug(slug);
  if (!parsed) return null;
  if (parsed.from === parsed.to) return null;
  const capability = capabilities().find((pair) => pair.from === parsed.from && pair.to === parsed.to);
  return capability ? toStatic(capability) : null;
}

/** Same input or same output, keeping the list short and relevant. */
export function relatedPairs(pair: StaticPair, limit = 8): StaticPair[] {
  return getStaticPairs()
    .filter((entry) => entry.slug !== pair.slug && (entry.from === pair.from || entry.to === pair.to))
    .slice(0, limit);
}
