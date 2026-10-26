import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/client/api';
import { describeError, isAbortError } from '../lib/client/errors';
import { estimateReadingMinutes, formatBytes, MAX_FILE_BYTES } from '../lib/client/estimate';
import { timeAgo } from '../lib/client/recent';
import zh from '../lib/i18n/zh';

describe('error copy', () => {
  it('maps known API codes to the localized dictionary copy', () => {
    const copy = describeError(new ApiError('DRM', 'server text'), zh.errors);
    expect(copy.code).toBe('DRM');
    expect(copy.message).toBe(zh.errors.DRM.message);
    expect(copy.hint).toBe(zh.errors.DRM.hint);
  });

  it('treats fetch TypeErrors as NETWORK and everything else as INTERNAL', () => {
    expect(describeError(new TypeError('fetch failed'), zh.errors).code).toBe('NETWORK');
    expect(describeError(new Error('boom'), zh.errors).code).toBe('INTERNAL');
    expect(describeError(new ApiError('SOMETHING_NEW'), zh.errors).code).toBe('SOMETHING_NEW');
  });

  it('recognises abort errors', () => {
    expect(isAbortError(new DOMException('Aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('Aborted'))).toBe(false);
  });
});

describe('formatting and estimates', () => {
  it('formats byte sizes without inventing precision', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.00 KB');
    expect(formatBytes(200 * 1024 * 1024)).toBe('200 MB');
    expect(formatBytes(-1)).toBe('—');
  });

  it('estimates reading time only for text inputs', () => {
    expect(estimateReadingMinutes('epub', 10_000)).toBeNull();
    expect(estimateReadingMinutes('txt', 0)).toBeNull();
    const minutes = estimateReadingMinutes('txt', 100_000);
    expect(minutes).not.toBeNull();
    expect(minutes as number).toBeGreaterThanOrEqual(1);
    expect(MAX_FILE_BYTES).toBe(200 * 1024 * 1024);
  });

  it('renders relative times with the provided labels', () => {
    const labels = { justNow: 'just now', minutesAgo: '{n} min ago', hoursAgo: '{n} h ago' };
    expect(timeAgo(Date.now(), labels, Date.now())).toBe('just now');
    expect(timeAgo(Date.now() - 5 * 60_000, labels, Date.now())).toBe('5 min ago');
    expect(timeAgo(Date.now() - 3 * 3_600_000, labels, Date.now())).toBe('3 h ago');
  });
});
