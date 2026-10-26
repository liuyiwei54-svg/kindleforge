import type { MetadataRoute } from 'next';
import { getStaticPairs } from '@/components/site/pair-data';
import { localePath, type Locale } from '@/lib/i18n/paths';
import { SITE_URL } from '@/lib/i18n/seo';

const LOCALES: Locale[] = ['zh', 'en'];

const STATIC_PATHS: Array<{ path: string; priority: number; changeFrequency: 'daily' | 'weekly' | 'monthly' }> = [
  { path: '/', priority: 1, changeFrequency: 'weekly' },
  { path: '/convert', priority: 0.9, changeFrequency: 'weekly' },
  { path: '/green', priority: 0.7, changeFrequency: 'monthly' },
  { path: '/docs', priority: 0.7, changeFrequency: 'monthly' },
];

function absolute(locale: Locale, path: string): string {
  return `${SITE_URL}${localePath(locale, path)}`;
}

function languages(path: string) {
  return {
    'zh-CN': absolute('zh', path),
    en: absolute('en', path),
    'x-default': absolute('zh', path),
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  const entries: MetadataRoute.Sitemap = [];

  for (const entry of STATIC_PATHS) {
    for (const locale of LOCALES) {
      entries.push({
        url: absolute(locale, entry.path),
        lastModified,
        changeFrequency: entry.changeFrequency,
        priority: entry.priority,
        alternates: { languages: languages(entry.path) },
      });
    }
  }

  for (const pair of getStaticPairs()) {
    const path = `/convert/${pair.slug}`;
    for (const locale of LOCALES) {
      entries.push({
        url: absolute(locale, path),
        lastModified,
        changeFrequency: 'monthly',
        priority: 0.6,
        alternates: { languages: languages(path) },
      });
    }
  }

  return entries;
}
