import type { Metadata } from 'next';
import { localePath, type Locale } from './index';

export const SITE_URL = 'https://kindleforge.app';

/**
 * Canonical + hreflang for a path that exists in both locales.
 * Pass the locale-independent path, e.g. `/convert/epub-to-mobi`.
 */
export function alternatesFor(locale: Locale, path: string): Metadata['alternates'] {
  return {
    canonical: localePath(locale, path),
    languages: {
      'zh-CN': localePath('zh', path),
      en: localePath('en', path),
      'x-default': localePath('zh', path),
    },
  };
}

export function pageMetadata(input: {
  locale: Locale;
  path: string;
  title: string;
  description: string;
  type?: 'website' | 'article';
}): Metadata {
  const { locale, path, title, description, type = 'website' } = input;
  return {
    title,
    description,
    alternates: alternatesFor(locale, path),
    openGraph: {
      type,
      url: localePath(locale, path),
      title,
      description,
      locale: locale === 'zh' ? 'zh_CN' : 'en_US',
      alternateLocale: locale === 'zh' ? 'en_US' : 'zh_CN',
      siteName: 'KindleForge',
      images: [{ url: '/og/kindleforge.png', width: 1200, height: 630, alt: 'KindleForge' }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: ['/og/kindleforge.png'],
    },
  };
}
