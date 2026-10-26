export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'zh';

export const HTML_LANG: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
};

/**
 * Locale routing helper with no dictionary imports, so client bundles can use it
 * without pulling both dictionaries in.
 * `localePath('zh', '/convert') === '/convert'`, `localePath('en', '/convert') === '/en/convert'`.
 */
export function localePath(locale: Locale, path = '/'): string {
  const clean = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`;
  if (locale === 'zh') return clean === '' ? '/' : clean;
  return `/en${clean}`;
}

/** The counterpart path in the other locale, for the language switch. Accepts either
 *  a locale-independent path ("/convert") or the current localized one ("/en/convert"). */
export function switchLocalePath(locale: Locale, path: string): { href: string; locale: Locale } {
  const other: Locale = locale === 'zh' ? 'en' : 'zh';
  const bare =
    locale === 'en' ? (path === '/en' ? '/' : path.startsWith('/en/') ? path.slice(3) : path) : path;
  return { href: localePath(other, bare), locale: other };
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}
