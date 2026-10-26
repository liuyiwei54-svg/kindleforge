import { ArrowRight } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { getDict, localePath, type Locale } from '@/lib/i18n';

export function CtaBand({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pt-4 pb-16 sm:px-8 md:pb-24">
      <div className="relative overflow-hidden rounded-[24px] border border-moss-500/25 bg-moss-500/[0.07] px-6 py-10 text-center md:px-12 md:py-14">
        <div aria-hidden="true" className="pointer-events-none absolute -top-20 left-1/2 h-48 w-[28rem] -translate-x-1/2 rounded-full bg-moss-500/10 blur-3xl" />
        <h2 className="relative font-serif text-2xl leading-snug text-paper sm:text-3xl md:text-4xl">{dict.cta.title}</h2>
        <p className="relative mt-3 text-sm text-paper-dim">{dict.cta.sub}</p>
        <div className="relative mt-6 flex flex-wrap items-center justify-center gap-3">
          <ButtonLink href={localePath(locale, '/convert')} size="lg">
            {dict.cta.primary}
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
          </ButtonLink>
          <ButtonLink href={localePath(locale, '/docs')} variant="secondary" size="lg">
            {dict.cta.secondary}
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
