import { ButtonLink } from '@/components/ui/button';
import { getDict, type Locale } from '@/lib/i18n';

export function NotFoundPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  return (
    <main id="main" className="mx-auto flex min-h-[70vh] w-full max-w-3xl flex-col justify-center px-5 py-16 sm:px-8">
      <p className="font-mono text-xs tracking-[0.3em] text-moss-500 uppercase">404</p>
      <h1 className="mt-4 font-serif text-3xl leading-tight text-paper sm:text-4xl">{dict.notFound.title}</h1>
      <p className="mt-4 max-w-xl text-sm leading-7 text-paper-dim">{dict.notFound.body}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <ButtonLink href={locale === 'zh' ? '/' : '/en'}>{dict.notFound.home}</ButtonLink>
        <ButtonLink href={locale === 'zh' ? '/convert' : '/en/convert'} variant="secondary">
          {dict.notFound.converter}
        </ButtonLink>
      </div>
    </main>
  );
}
