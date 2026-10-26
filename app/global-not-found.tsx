import './globals.css';
import { buttonClass } from '@/components/ui/button';
import { getDict } from '@/lib/i18n';

/**
 * 404 for unmatched URLs when multiple root layouts are in play (Next.js
 * `global-not-found` convention). It has no locale segment to read from, so it
 * speaks both languages and links to both homes.
 */
export default function GlobalNotFound() {
  const zh = getDict('zh');
  const en = getDict('en');

  return (
    <html lang="zh-CN">
      <head>
        <link rel="icon" href="/brand/favicon.svg" type="image/svg+xml" />
      </head>
      <body className="min-h-dvh bg-ink-950 text-paper antialiased">
        <main id="main" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-5 py-16 sm:px-8">
          <p className="font-mono text-xs tracking-[0.3em] text-moss-500 uppercase">404</p>
          <h1 className="mt-4 font-serif text-3xl leading-tight text-paper sm:text-4xl">{zh.notFound.title}</h1>
          <p className="mt-1 font-serif text-xl text-paper-dim">{en.notFound.title}</p>
          <p className="mt-4 max-w-xl text-sm leading-7 text-paper-dim">{zh.notFound.body}</p>
          <p className="mt-1 max-w-xl text-sm leading-7 text-paper-dim/80">{en.notFound.body}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/" className={buttonClass('primary', 'md')}>
              {zh.notFound.home}
            </a>
            <a href="/en" className={buttonClass('secondary', 'md')}>
              {en.notFound.home}
            </a>
            <a href="/convert" className={buttonClass('ghost', 'md')}>
              {zh.notFound.converter}
            </a>
            <a href="/en/convert" className={buttonClass('ghost', 'md')}>
              {en.notFound.converter}
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
