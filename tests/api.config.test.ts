import { describe, expect, it } from 'vitest';
import {
  CONFIG_DEFAULTS,
  CONFIG_ENV_KEYS,
  CONFIG_LIMITS,
  config,
  readServerConfig,
} from '../lib/server/config';
import { DEFAULT_LIMITS, LOCAL_LIMITS } from '../lib/server/ratelimit';
import { MAX_UPLOAD_BYTES, MIN_FREE_BYTES } from '../lib/server/storage';
import { JobStore } from '../lib/server/jobs';

describe('server config', () => {
  it('returns the documented defaults for an empty environment', () => {
    const parsed = readServerConfig({}, { warn: false });
    expect(parsed).toEqual(CONFIG_DEFAULTS);
    expect(parsed.maxUploadBytes).toBe(209_715_200);
    expect(parsed.jobTtlMs).toBe(600_000);
    expect(parsed.maxConcurrency).toBe(2);
    expect(parsed.rateLimitPerHour).toBe(20);
    expect(parsed.rateLimitLocalPerHour).toBe(200);
    expect(parsed.convertTimeoutMs).toBe(300_000);
    expect(parsed.orphanMaxAgeMs).toBe(86_400_000);
    expect(parsed.minFreeBytes).toBe(2 * 1024 ** 3);
    expect(parsed.trustProxy).toBe(false);
  });

  it('reads every supported KF_* override', () => {
    const parsed = readServerConfig(
      {
        KF_MAX_UPLOAD_BYTES: '1048576',
        KF_JOB_TTL_MS: '120000',
        KF_MAX_CONCURRENCY: '4',
        KF_RATE_LIMIT_PER_HOUR: '7',
        KF_RATE_LIMIT_LOCAL_PER_HOUR: '77',
        KF_CONVERT_TIMEOUT_MS: '60000',
        KF_ORPHAN_MAX_AGE_MS: '7200000',
        KF_MIN_FREE_BYTES: '536870912',
        KF_TRUST_PROXY: 'true',
      },
      { warn: false },
    );
    expect(parsed).toEqual({
      maxUploadBytes: 1_048_576,
      jobTtlMs: 120_000,
      maxConcurrency: 4,
      rateLimitPerHour: 7,
      rateLimitLocalPerHour: 77,
      convertTimeoutMs: 60_000,
      orphanMaxAgeMs: 7_200_000,
      minFreeBytes: 536_870_912,
      trustProxy: true,
    });
  });

  it('clamps values outside the allowed bounds', () => {
    const parsed = readServerConfig(
      {
        KF_MAX_UPLOAD_BYTES: String(Number.MAX_SAFE_INTEGER),
        KF_JOB_TTL_MS: '1',
        KF_MAX_CONCURRENCY: '0',
        KF_CONVERT_TIMEOUT_MS: '999999999',
        KF_ORPHAN_MAX_AGE_MS: '1',
      },
      { warn: false },
    );
    expect(parsed.maxUploadBytes).toBe(CONFIG_LIMITS.maxUploadBytes.max);
    expect(parsed.jobTtlMs).toBe(CONFIG_LIMITS.jobTtlMs.min);
    expect(parsed.maxConcurrency).toBe(CONFIG_LIMITS.maxConcurrency.min);
    expect(parsed.convertTimeoutMs).toBe(CONFIG_LIMITS.convertTimeoutMs.max);
    expect(parsed.orphanMaxAgeMs).toBe(CONFIG_LIMITS.orphanMaxAgeMs.min);
  });

  it('falls back to defaults for blank, float, negative and junk values', () => {
    const parsed = readServerConfig(
      {
        KF_MAX_UPLOAD_BYTES: '  ',
        KF_JOB_TTL_MS: '1.5',
        KF_MAX_CONCURRENCY: '-3',
        KF_RATE_LIMIT_PER_HOUR: 'lots',
        KF_CONVERT_TIMEOUT_MS: 'abc123',
      },
      { warn: false },
    );
    expect(parsed.maxUploadBytes).toBe(CONFIG_DEFAULTS.maxUploadBytes);
    expect(parsed.jobTtlMs).toBe(CONFIG_DEFAULTS.jobTtlMs);
    expect(parsed.maxConcurrency).toBe(CONFIG_DEFAULTS.maxConcurrency);
    expect(parsed.rateLimitPerHour).toBe(CONFIG_DEFAULTS.rateLimitPerHour);
    expect(parsed.convertTimeoutMs).toBe(CONFIG_DEFAULTS.convertTimeoutMs);
  });

  it('parses KF_TRUST_PROXY as a boolean and falls back on junk', () => {
    expect(readServerConfig({ KF_TRUST_PROXY: '1' }, { warn: false }).trustProxy).toBe(true);
    expect(readServerConfig({ KF_TRUST_PROXY: 'YES' }, { warn: false }).trustProxy).toBe(true);
    expect(readServerConfig({ KF_TRUST_PROXY: 'off' }, { warn: false }).trustProxy).toBe(false);
    expect(readServerConfig({ KF_TRUST_PROXY: '0' }, { warn: false }).trustProxy).toBe(false);
    expect(readServerConfig({ KF_TRUST_PROXY: 'maybe' }, { warn: false }).trustProxy).toBe(false);
    expect(readServerConfig({}, { warn: false }).trustProxy).toBe(false);
  });

  it('exposes every value through CONFIG_ENV_KEYS', () => {
    const keys = Object.keys(CONFIG_DEFAULTS).sort();
    expect(Object.keys(CONFIG_ENV_KEYS).sort()).toEqual(keys);
    for (const key of Object.values(CONFIG_ENV_KEYS)) expect(key.startsWith('KF_')).toBe(true);
  });

  it('is actually consumed by storage / rate limit / JobStore', () => {
    // Modules snapshot the same effective config (a KF_* env at process start).
    expect(MAX_UPLOAD_BYTES).toBe(config.maxUploadBytes);
    expect(MIN_FREE_BYTES).toBe(config.minFreeBytes);
    expect(DEFAULT_LIMITS.limit).toBe(config.rateLimitPerHour);
    expect(LOCAL_LIMITS.limit).toBe(config.rateLimitLocalPerHour);
    expect(typeof config.trustProxy).toBe('boolean');

    const store = new JobStore();
    expect(store.maxConcurrent).toBe(config.maxConcurrency);
    expect(store.jobTimeoutMs).toBe(config.convertTimeoutMs);
    expect(store.ttlMs).toBe(config.jobTtlMs);
    store.dispose();
  });
});
