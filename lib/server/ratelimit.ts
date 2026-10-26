/**
 * Per-IP sliding-window rate limiting + request concurrency guard.
 *
 * Defaults: 20 conversions/hour per IP, 3 concurrent uploads.
 * Loopback (only knowable when a trusted proxy supplies it) gets 200/hour and
 * 8 concurrent so development and batch uploads are not punished.
 *
 * Identity: `X-Forwarded-For` is attacker-controlled unless a reverse proxy
 * overwrites it, so by default (KF_TRUST_PROXY=false) headers are IGNORED and
 * every caller shares one bucket. Set KF_TRUST_PROXY=true only behind a proxy
 * you control. This closes the "spoof a fresh XFF per request" bypass.
 *
 * The concurrency slot covers *request handling* (multipart read + enqueue),
 * not the queued conversion itself — the JobStore has its own worker limit.
 */
import { config } from './config';
import { rateLimited } from './errors';

const WINDOW_MS = 60 * 60 * 1000;

export interface LimitPair {
  limit: number;
  concurrency: number;
}

export const DEFAULT_LIMITS: LimitPair = { limit: config.rateLimitPerHour, concurrency: 3 };
export const LOCAL_LIMITS: LimitPair = { limit: config.rateLimitLocalPerHour, concurrency: 8 };

interface Bucket {
  hits: number[];
  active: number;
}

let buckets = new Map<string, Bucket>();
let defaultLimits: LimitPair = { ...DEFAULT_LIMITS };
let localLimits: LimitPair = { ...LOCAL_LIMITS };
let trustProxyOverride: boolean | undefined;

export function resetRateLimitsForTests(): void {
  buckets = new Map();
  defaultLimits = { ...DEFAULT_LIMITS };
  localLimits = { ...LOCAL_LIMITS };
  trustProxyOverride = undefined;
}

/** Test hook: override KF_TRUST_PROXY without reloading the module. */
export function setTrustProxyForTests(value: boolean | undefined): void {
  trustProxyOverride = value;
}

/** Narrow the limits (tests only). */
export function configureRateLimitsForTests(overrides: {
  default?: Partial<LimitPair>;
  local?: Partial<LimitPair>;
}): void {
  if (overrides.default) defaultLimits = { ...defaultLimits, ...overrides.default };
  if (overrides.local) localLimits = { ...localLimits, ...overrides.local };
}

/**
 * Best-effort client address. Behind a reverse proxy x-forwarded-for is the
 * only source; on a bare dev server we fall back to loopback so the local
 * development bucket applies.
 */
export function clientIp(request: Request): string {
  const trustHeader = trustProxyOverride ?? config.trustProxy;
  if (!trustHeader) {
    // No trustworthy peer address is exposed through the Web Request API, so
    // all direct callers share one bucket. Spoofing a header changes nothing.
    return 'direct';
  }
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const cf = request.headers.get('cf-connecting-ip')?.trim();
  if (cf) return cf;
  return 'unknown';
}

export function isLocalAddress(ip: string): boolean {
  if (!ip) return false;
  if (ip === '::1' || ip === 'localhost' || ip === '::ffff:127.0.0.1') return true;
  return ip === '127.0.0.1' || ip.startsWith('127.') || ip.startsWith('::ffff:127.');
}

function limitsFor(ip: string): LimitPair {
  // Direct mode is the self-hosted single-tenant case: keep the relaxed local
  // bucket (200/h, 8 concurrent). Spoofed XFF still cannot create new buckets.
  if (ip === 'direct' || isLocalAddress(ip)) return localLimits;
  return defaultLimits;
}

function scopeFor(ip: string): 'direct' | 'local' | 'ip' {
  if (ip === 'direct') return 'direct';
  return isLocalAddress(ip) ? 'local' : 'ip';
}

function pruneBucket(bucket: Bucket, now: number): void {
  const cutoff = now - WINDOW_MS;
  if (bucket.hits.length > 0 && bucket.hits[0] < cutoff) {
    bucket.hits = bucket.hits.filter((hit) => hit >= cutoff);
  }
}

function bucketsSizeGuard(now: number): void {
  if (buckets.size < 2048) return;
  for (const [ip, bucket] of buckets) {
    pruneBucket(bucket, now);
    if (bucket.hits.length === 0 && bucket.active === 0) buckets.delete(ip);
  }
}

export interface RateLimitGrant {
  ip: string;
  release: () => void;
}

/**
 * Check the hourly window, then reserve a concurrency slot. Throws a 429
 * ApiError (with Retry-After) when the caller must back off.
 */
export function guardRequest(request: Request): RateLimitGrant {
  const ip = clientIp(request);
  const limits = limitsFor(ip);
  const now = Date.now();
  bucketsSizeGuard(now);

  let bucket = buckets.get(ip);
  if (!bucket) {
    bucket = { hits: [], active: 0 };
    buckets.set(ip, bucket);
  }
  pruneBucket(bucket, now);

  if (bucket.hits.length >= limits.limit) {
    const oldest = bucket.hits[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    throw rateLimited(retryAfter, 'window', { limit: limits.limit, scope: scopeFor(ip) });
  }
  if (bucket.active >= limits.concurrency) {
    throw rateLimited(2, 'concurrency', { limit: limits.limit, scope: scopeFor(ip) });
  }

  bucket.hits.push(now);
  bucket.active += 1;

  let released = false;
  return {
    ip,
    release: () => {
      if (released) return;
      released = true;
      const current = buckets.get(ip);
      if (current) current.active = Math.max(0, current.active - 1);
    },
  };
}
