/**
 * Small HTTP helpers shared by the metadata providers and the cover proxy.
 *
 * Douban has no public API. Its suggestion endpoint and image CDN both reject
 * obvious bot clients (the CDN returns 418 without a book-page Referer), so
 * requests for that provider deliberately mimic a desktop browser. No cookie,
 * account or file data is ever attached.
 */
export const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const DOUBAN_REFERER = 'https://book.douban.com/';

export function isDoubanHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'douban.com' || host.endsWith('.douban.com') || host === 'doubanio.com' || host.endsWith('.doubanio.com');
}

/** Headers for one cover/image URL; non-Douban hosts keep the plain agent. */
export function imageRequestHeaders(url: URL): Record<string, string> {
  const headers: Record<string, string> = {
    accept: 'image/avif,image/webp,image/jpeg,image/png,image/gif',
    'user-agent': DESKTOP_CHROME_UA,
  };
  if (isDoubanHost(url.hostname)) {
    headers.referer = DOUBAN_REFERER;
  }
  return headers;
}

/** Combine an external abort signal with a per-request timeout signal. */
export function withTimeoutSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  return AbortSignal.any([external, timeout]);
}
