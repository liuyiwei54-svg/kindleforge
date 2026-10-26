/**
 * Server configuration — the single place env vars are read.
 *
 * Everything is optional; every value is validated (integer, sensible bounds).
 * Invalid input never crashes the server: it falls back to the default (or
 * clamps to the nearest bound) and logs one warning, so a typo in
 * docker-compose.yml cannot take the instance down.
 *
 * The values are snapshotted at module load. In Next, env changes require a
 * restart (which is true for every server runtime that caches config).
 */
import type { BilingualHint } from './errors';

export interface ServerConfig {
  /** Hard upload cap in bytes (multipart pre-check + actual file size). */
  maxUploadBytes: number;
  /** Retention after a job reaches done/error. */
  jobTtlMs: number;
  /** Conversions that may run concurrently. */
  maxConcurrency: number;
  /** Per-IP conversions per hour for remote addresses (trusted proxy mode). */
  rateLimitPerHour: number;
  /** Per-IP conversions per hour for loopback (trusted proxy mode). */
  rateLimitLocalPerHour: number;
  /** Hard per-conversion timeout. */
  convertTimeoutMs: number;
  /** Boot sweep: orphan job dirs older than this are deleted. */
  orphanMaxAgeMs: number;
  /** Refuse uploads when the temp volume has less free space than this. */
  minFreeBytes: number;
  /**
   * Trust `X-Forwarded-For` / `X-Real-IP` from a reverse proxy.
   * Default false: headers are ignored and every client shares one bucket, so a
   * spoofed header cannot create unlimited identities. Enable only when the app
   * sits behind a proxy you control that overwrites those headers.
   */
  trustProxy: boolean;
}

export const CONFIG_DEFAULTS: ServerConfig = {
  maxUploadBytes: 200 * 1024 * 1024, // 200MB
  jobTtlMs: 10 * 60 * 1000, // 10 minutes
  maxConcurrency: 2,
  rateLimitPerHour: 20,
  rateLimitLocalPerHour: 200,
  convertTimeoutMs: 5 * 60 * 1000, // 5 minutes
  orphanMaxAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  minFreeBytes: 2 * 1024 * 1024 * 1024, // 2GB
  trustProxy: false,
};

export type NumericConfigKey = Exclude<keyof ServerConfig, 'trustProxy'>;

export const CONFIG_LIMITS: Record<NumericConfigKey, { min: number; max: number }> = {
  maxUploadBytes: { min: 1024 * 1024, max: 2 * 1024 * 1024 * 1024 },
  jobTtlMs: { min: 10_000, max: 24 * 60 * 60 * 1000 },
  maxConcurrency: { min: 1, max: 16 },
  rateLimitPerHour: { min: 1, max: 10_000 },
  rateLimitLocalPerHour: { min: 1, max: 100_000 },
  convertTimeoutMs: { min: 10_000, max: 60 * 60 * 1000 },
  orphanMaxAgeMs: { min: 60 * 60 * 1000, max: 30 * 24 * 60 * 60 * 1000 },
  minFreeBytes: { min: 0, max: 1024 * 1024 * 1024 * 1024 },
};

export const CONFIG_ENV_KEYS: Record<keyof ServerConfig, string> = {
  maxUploadBytes: 'KF_MAX_UPLOAD_BYTES',
  jobTtlMs: 'KF_JOB_TTL_MS',
  maxConcurrency: 'KF_MAX_CONCURRENCY',
  rateLimitPerHour: 'KF_RATE_LIMIT_PER_HOUR',
  rateLimitLocalPerHour: 'KF_RATE_LIMIT_LOCAL_PER_HOUR',
  convertTimeoutMs: 'KF_CONVERT_TIMEOUT_MS',
  orphanMaxAgeMs: 'KF_ORPHAN_MAX_AGE_MS',
  minFreeBytes: 'KF_MIN_FREE_BYTES',
  trustProxy: 'KF_TRUST_PROXY',
};

export interface ReadConfigOptions {
  /** Set false in tests to keep output clean. */
  warn?: boolean;
}

function parseInteger(
  env: EnvLike,
  name: NumericConfigKey,
  warn: boolean,
): number {
  const key = CONFIG_ENV_KEYS[name];
  const fallback = CONFIG_DEFAULTS[name];
  const limits = CONFIG_LIMITS[name];
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    if (warn) {
      console.warn(`[config] ${key}="${raw}" is not a non-negative integer; using default ${fallback}`);
    }
    return fallback;
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    if (warn) console.warn(`[config] ${key}="${raw}" is out of range; using default ${fallback}`);
    return fallback;
  }
  if (value < limits.min) {
    if (warn) console.warn(`[config] ${key}=${value} below minimum ${limits.min}; clamping`);
    return limits.min;
  }
  if (value > limits.max) {
    if (warn) console.warn(`[config] ${key}=${value} above maximum ${limits.max}; clamping`);
    return limits.max;
  }
  return value;
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'y']);
const FALSY = new Set(['0', 'false', 'no', 'off', 'n']);

function parseBoolean(env: EnvLike, name: 'trustProxy', warn: boolean): boolean {
  const key = CONFIG_ENV_KEYS[name];
  const fallback = CONFIG_DEFAULTS[name];
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  if (warn) {
    console.warn(`[config] ${key}="${raw}" is not a boolean; using default ${fallback}`);
  }
  return fallback;
}

/** Pure config reader (unit-testable). */
export type EnvLike = Record<string, string | undefined>;

export function readServerConfig(
  env: EnvLike = process.env,
  options: ReadConfigOptions = {},
): ServerConfig {
  const warn = options.warn !== false;
  return {
    maxUploadBytes: parseInteger(env, 'maxUploadBytes', warn),
    jobTtlMs: parseInteger(env, 'jobTtlMs', warn),
    maxConcurrency: parseInteger(env, 'maxConcurrency', warn),
    rateLimitPerHour: parseInteger(env, 'rateLimitPerHour', warn),
    rateLimitLocalPerHour: parseInteger(env, 'rateLimitLocalPerHour', warn),
    convertTimeoutMs: parseInteger(env, 'convertTimeoutMs', warn),
    orphanMaxAgeMs: parseInteger(env, 'orphanMaxAgeMs', warn),
    minFreeBytes: parseInteger(env, 'minFreeBytes', warn),
    trustProxy: parseBoolean(env, 'trustProxy', warn),
  };
}

/** Effective configuration for this process. */
export const config: ServerConfig = readServerConfig();

export function megabytes(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(bytes % (1024 ** 2) === 0 ? 0 : 1)} MB`;
}

export function humanBytes(bytes: number): string {
  if (bytes >= 1024 ** 3 && bytes % (1024 ** 3) === 0) return `${bytes / 1024 ** 3} GB`;
  return megabytes(bytes);
}

export function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(ms % 60_000 === 0 ? 0 : 1)} min`;
}

export function humanDuration(ms: number): string {
  if (ms >= 3_600_000 && ms % 3_600_000 === 0) return `${ms / 3_600_000} h`;
  return minutes(ms);
}

/** Human-readable hint used when an upload exceeds the configured cap. */
export function uploadLimitHint(): BilingualHint {
  return {
    zh: `文件超过 ${megabytes(config.maxUploadBytes)} 上限。请压缩后重试，或先用 calibre 拆分。`,
    en: `Files are limited to ${megabytes(config.maxUploadBytes)}. Compress the file or split it first.`,
  };
}
