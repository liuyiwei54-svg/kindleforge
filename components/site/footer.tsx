import { Github, Leaf } from 'lucide-react';
import Link from 'next/link';
import { getDict, localePath, type Locale } from '@/lib/i18n';

export function Footer({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const columns = [
    {
      title: dict.footer.columns.product,
      links: [
        { href: localePath(locale, '/convert'), label: dict.footer.links.converter },
        { href: localePath(locale, '/library'), label: dict.footer.links.library },
        { href: localePath(locale, '/#formats'), label: dict.footer.links.formats },
        { href: localePath(locale, '/convert/epub-to-mobi'), label: dict.footer.links.pairPages },
      ],
    },
    {
      title: dict.footer.columns.resources,
      links: [
        { href: localePath(locale, '/docs'), label: dict.footer.links.docs },
        { href: localePath(locale, '/settings'), label: dict.footer.links.settings },
        { href: localePath(locale, '/green'), label: dict.footer.links.selfHost },
        { href: localePath(locale, '/green'), label: dict.footer.links.noTracking },
      ],
    },
  ];
  const otherLocaleHref = locale === 'zh' ? '/en' : '/';

  return (
    <footer className="border-t border-paper/10 bg-ink-950">
      <div className="mx-auto w-full max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href={localePath(locale, '/')} className="inline-flex items-center gap-2 rounded-full focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none">
              <span className="font-serif text-lg text-paper">KindleForge</span>
            </Link>
            <p className="mt-3 max-w-xs text-sm leading-6 text-paper-dim">{dict.footer.tagline}</p>
            <p className="mt-4 inline-flex items-center gap-1.5 text-xs text-moss-500">
              <Leaf aria-hidden="true" className="h-3.5 w-3.5" />
              {dict.green.eyebrow}
            </p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="font-mono text-[0.7rem] tracking-[0.24em] text-paper-dim/70 uppercase">{column.title}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <div>
            <h2 className="font-mono text-[0.7rem] tracking-[0.24em] text-paper-dim/70 uppercase">{dict.footer.columns.privacy}</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <Link
                  href={localePath(locale, '/green')}
                  className="text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  {dict.footer.links.green}
                </Link>
              </li>
              <li>
                <Link
                  href={otherLocaleHref}
                  hrefLang={locale === 'zh' ? 'en' : 'zh-CN'}
                  className="text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  {dict.footer.links.language}
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/"
                  target="_blank"
                  rel="noreferrer noopener"
                  aria-label={dict.nav.githubLabel}
                  className="inline-flex items-center gap-1.5 text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  <Github aria-hidden="true" className="h-3.5 w-3.5" />
                  {dict.footer.links.github}
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-paper/10 pt-6 text-xs leading-5 text-paper-dim/70 sm:flex-row sm:items-center sm:justify-between">
          <p>{dict.footer.bottom}</p>
          <p>{dict.footer.built}</p>
        </div>
        <p className="mt-3 text-[11px] leading-5 text-paper-dim/60">{dict.footer.trademark}</p>
      </div>
    </footer>
  );
}
