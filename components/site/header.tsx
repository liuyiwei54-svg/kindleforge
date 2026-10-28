import { Github, Languages, Menu } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { getDict, localePath, switchLocalePath, type Locale } from '@/lib/i18n';

/**
 * Brand mark, inlined from public/brand/logo-mark.svg so it can inherit the
 * current text colour without a network request.
 */
function BrandMark() {
  return (
    <span aria-hidden="true" className="relative grid h-8 w-8 place-items-center rounded-[10px] border border-moss-500/30 bg-moss-500/10 text-paper">
      <svg viewBox="0 0 32 32" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={3.1} strokeLinecap="round">
        <path d="M9.2 5.2v21.6" />
        <path d="M9.2 16.1c4.4-1 9.9-4.6 13.6-10.1" />
        <path d="M9.2 16.1c4.8 1.2 10.3 5.2 14.6 10.4" />
        <path className="fill-moss-500 stroke-none" d="M26.6 1.6l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z" />
      </svg>
    </span>
  );
}

export function Header({ locale, path = '/' }: { locale: Locale; path?: string }) {
  const dict = getDict(locale);
  const { href: langHref, locale: otherLocale } = switchLocalePath(locale, path);
  const home = localePath(locale, '/');
  const links = [
    { href: localePath(locale, '/convert'), label: dict.nav.converter },
    { href: localePath(locale, '/library'), label: dict.nav.library },
    { href: `${home === '/' ? '' : home}/#formats`, label: dict.nav.formats },
    { href: localePath(locale, '/green'), label: dict.nav.green },
    { href: localePath(locale, '/docs'), label: dict.nav.docs },
    { href: localePath(locale, '/settings'), label: dict.nav.settings },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-paper/10 bg-ink-950/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href={home} aria-label={dict.nav.brandHome} className="inline-flex items-center gap-2.5 rounded-full focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 focus-visible:outline-none">
          <BrandMark />
          <span className="font-serif text-lg leading-none tracking-tight text-paper">KindleForge</span>
          <Badge tone="moss" className="max-sm:hidden">
            {locale === 'zh' ? '本地优先' : 'local-first'}
          </Badge>
        </Link>

        <nav aria-label={locale === 'zh' ? '主导航' : 'Main navigation'} className="hidden items-center gap-1 lg:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 text-sm text-paper-dim transition-colors hover:bg-paper/5 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/"
            target="_blank"
            rel="noreferrer noopener"
            aria-label={dict.nav.githubLabel}
            title={dict.nav.githubLabel}
            className="rounded-full p-2 text-paper-dim transition-colors hover:bg-paper/5 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
          >
            <Github aria-hidden="true" className="h-4.5 w-4.5" />
          </a>
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={langHref}
            hrefLang={otherLocale === 'en' ? 'en' : 'zh-CN'}
            aria-label={dict.nav.langSwitchLabel}
            className={buttonClass('secondary', 'sm', 'gap-1.5')}
          >
            <Languages aria-hidden="true" className="h-3.5 w-3.5" />
            {dict.nav.langSwitch}
          </Link>

          <details className="group relative lg:hidden">
            <summary className="inline-flex cursor-pointer list-none items-center justify-center rounded-full border border-paper/20 p-2 text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <Menu aria-hidden="true" className="h-4.5 w-4.5" />
              <span className="sr-only">{dict.nav.menu}</span>
            </summary>
            <nav
              aria-label={locale === 'zh' ? '移动端导航' : 'Mobile navigation'}
              className="absolute top-full right-0 z-50 mt-2 w-56 rounded-2xl border border-paper/15 bg-ink-900 p-2 shadow-xl"
            >
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block rounded-xl px-3 py-2.5 text-sm text-paper-dim transition-colors hover:bg-paper/5 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  {link.label}
                </Link>
              ))}
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer noopener"
                aria-label={dict.nav.githubLabel}
                className="mt-1 flex items-center gap-2 rounded-xl border-t border-paper/10 px-3 py-2.5 text-sm text-paper-dim transition-colors hover:bg-paper/5 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              >
                <Github aria-hidden="true" className="h-4 w-4" />
                {dict.nav.github}
              </a>
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}
