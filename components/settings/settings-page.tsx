import { Settings2 } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { SettingsView } from '@/components/settings/settings-view';
import { getDict, localePath, type Locale } from '@/lib/i18n';

export function SettingsPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <>
      <Header locale={locale} path="/settings" />
      <main id="main" className="mx-auto w-full max-w-4xl px-5 pt-10 pb-20 sm:px-8 md:pt-14">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="moss">{dict.settings.eyebrow}</Badge>
          <Badge tone="paper">{dict.settings.badge}</Badge>
        </div>

        <h1 className="mt-4 flex items-center gap-2.5 font-serif text-3xl tracking-tight text-paper md:text-4xl">
          <Settings2 aria-hidden="true" className="h-6 w-6 text-moss-500 md:h-7 md:w-7" />
          {dict.settings.title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-paper-dim">{dict.settings.sub}</p>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
          <Link
            href={localePath(locale, '/library')}
            className="text-paper-dim underline-offset-4 transition-colors hover:text-paper hover:underline focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
          >
            ← {dict.library.title}
          </Link>
        </div>

        <SettingsView locale={locale} />
      </main>
      <Footer locale={locale} />
      {/* Keeps the fixed save bar from covering the footer while there are unsaved changes. */}
      <div aria-hidden="true" className="h-28" />
    </>
  );
}
