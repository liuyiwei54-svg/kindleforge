import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { WorkspaceLoader } from '@/components/convert/workspace-loader';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { Badge } from '@/components/ui/badge';
import { getDict, localePath, type Locale } from '@/lib/i18n';

/**
 * Server-rendered shell for `/convert`. The <h1> lives here so the first HTML
 * response (and no-JS crawlers) always contain it; the client workspace only
 * takes over the interactive part and points its aria-labelledby at this id.
 */
export function ConvertPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <>
      <Header locale={locale} path="/convert" />
      <main id="main" className="min-h-[60vh]">
        <div className="mx-auto w-full max-w-6xl px-5 pt-10 sm:px-8 md:pt-14">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="moss">{locale === 'zh' ? '工作台' : 'Workspace'}</Badge>
                <Badge tone="paper">{dict.convert.privacyBadge}</Badge>
              </div>
              <h1 id="workspace-title" className="mt-3 font-serif text-2xl leading-snug text-paper sm:text-3xl">
                {dict.convert.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-7 text-paper-dim">{dict.convert.sub}</p>
            </div>
            <Link
              href={localePath(locale, '/')}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {dict.convert.backHome}
            </Link>
          </div>
        </div>

        <WorkspaceLoader locale={locale} dict={dict.convert} errors={dict.errors} standalone />
      </main>
      <Footer locale={locale} />
    </>
  );
}
