import type { Metadata, Viewport } from 'next';
import '../globals.css';
import { getDict } from '@/lib/i18n';
import { SITE_URL } from '@/lib/i18n/seo';

const dict = getDict('zh');

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: dict.meta.home.title,
    template: '%s · KindleForge',
  },
  description: dict.meta.home.description,
  applicationName: 'KindleForge',
  keywords: [
    'epub 转 mobi',
    'mobi 转 epub',
    'pdf 转 epub',
    'kindle 转换器',
    '电子书转换',
    'azw3',
    'calibre online',
    '本地转换',
  ],
  authors: [{ name: 'KindleForge' }],
  creator: 'KindleForge',
  publisher: 'KindleForge',
  robots: { index: true, follow: true },
  icons: {
    icon: '/brand/favicon.svg',
    shortcut: '/brand/favicon.svg',
    apple: '/brand/favicon.svg',
  },
  alternates: {
    canonical: '/',
    languages: { 'zh-CN': '/', en: '/en', 'x-default': '/' },
  },
  openGraph: {
    type: 'website',
    locale: 'zh_CN',
    alternateLocale: 'en_US',
    siteName: 'KindleForge',
    title: dict.meta.home.title,
    description: dict.meta.home.description,
    url: '/',
    images: [{ url: '/og/kindleforge.png', width: 1200, height: 630, alt: dict.meta.ogAlt }],
  },
  twitter: {
    card: 'summary_large_image',
    title: dict.meta.home.title,
    description: dict.meta.home.description,
    images: ['/og/kindleforge.png'],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#070b09',
};

export default function ZhRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-ink-950 text-paper antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-moss-500 focus:px-4 focus:py-2 focus:text-sm focus:text-ink-950"
        >
          {dict.nav.skip}
        </a>
        {children}
      </body>
    </html>
  );
}
