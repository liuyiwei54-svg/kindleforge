import { BookMarked, HardDrive } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { LibraryView } from '@/components/library/library-view';
import { getDict, localePath, type Locale } from '@/lib/i18n';

export function LibraryPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <>
      <Header locale={locale} path="/library" />
      <main id="main" className="mx-auto w-full max-w-6xl px-5 pt-10 pb-16 sm:px-8 md:pt-14">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="moss">{dict.library.eyebrow}</Badge>
          <Badge tone="paper" className="gap-1.5">
            <HardDrive aria-hidden="true" className="h-3 w-3" />
            {dict.library.badgeLocal}
          </Badge>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2.5 font-serif text-3xl tracking-tight text-paper md:text-4xl">
              <BookMarked aria-hidden="true" className="h-6 w-6 text-moss-500 md:h-7 md:w-7" />
              {dict.library.title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-paper-dim">{dict.library.sub}</p>
          </div>
          <ButtonLink href={localePath(locale, '/convert')} variant="secondary" size="sm">
            {dict.library.newBook}
          </ButtonLink>
        </div>

        <LibraryView locale={locale} />
      </main>
      <Footer locale={locale} />
    </>
  );
}
