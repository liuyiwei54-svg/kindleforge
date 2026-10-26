import { ArrowRight, HardDrive, Server, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { UploadLauncher } from '@/components/convert/upload-launcher';
import { Faq } from '@/components/site/faq';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { Badge } from '@/components/ui/badge';

import { fill, getDict, localePath, type Locale } from '@/lib/i18n';
import { formatDescription, formatName } from '@/lib/i18n/formats';
import { SITE_URL } from '@/lib/i18n/seo';
import type { StaticPair } from './pair-data';

export function PairPage({ locale, pair, related }: { locale: Locale; pair: StaticPair; related: StaticPair[] }) {
  const dict = getDict(locale);
  const fromName = formatName(pair.from, locale);
  const toName = formatName(pair.to, locale);
  const fromDescription = formatDescription(pair.from, locale);
  const toDescription = formatDescription(pair.to, locale);
  const path = `/convert/${pair.slug}`;
  const qualityLabel =
    pair.quality === 'high'
      ? dict.pair.qualityHigh
      : pair.quality === 'medium'
        ? dict.pair.qualityMedium
        : dict.pair.qualityLossy;
  const whereLabel = pair.local ? dict.pair.localWhere : dict.pair.serverWhere;
  const h1 = locale === 'zh' ? `${fromName} 转 ${toName}` : `${fromName} to ${toName}`;
  const intro = fill(dict.pair.intro, { from: fromName, to: toName });
  const steps = dict.pair.steps.map((step) => ({
    title: fill(step.title, { from: fromName, to: toName }),
    body: fill(step.body, { from: fromName, to: toName }),
  }));
  const faqItems = dict.pair.faq.map((item) => ({
    q: fill(item.q, { from: fromName, to: toName }),
    a: fill(item.a, { from: fromName, to: toName }),
  }));

  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };

  const appLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'KindleForge',
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any modern web browser',
    url: `${SITE_URL}${localePath(locale, path)}`,
    description: fill(dict.meta.pairDescription, {
      from: fromName,
      to: toName,
      quality: qualityLabel,
    }),
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: pair.local
      ? ['Runs locally in the browser', 'No upload for plain-text sources', 'Kindle typography presets']
      : ['Server-side conversion', 'Deleted on completion', 'Kindle typography presets'],
  };

  return (
    <>
      <Header locale={locale} path={path} />
      <main id="main">
        <section className="mx-auto w-full max-w-6xl px-5 pt-10 pb-4 sm:px-8 md:pt-14">
          <nav aria-label={locale === 'zh' ? '面包屑' : 'Breadcrumb'} className="flex flex-wrap items-center gap-1.5 text-[11px] text-paper-dim/60">
            <Link href={localePath(locale, '/')} className="transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none">
              KindleForge
            </Link>
            <span aria-hidden="true">/</span>
            <Link href={localePath(locale, '/convert')} className="transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none">
              {dict.nav.converter}
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-paper-dim">{h1}</span>
          </nav>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Badge tone="moss">{dict.pair.badge}</Badge>
            <Badge tone={pair.local ? 'moss' : 'paper'} className="gap-1">
              {pair.local ? <ShieldCheck aria-hidden="true" className="h-3 w-3" /> : <Server aria-hidden="true" className="h-3 w-3" />}
              {pair.local ? dict.pair.localChip : dict.pair.serverChip}
            </Badge>
            <Badge tone="paper">{qualityLabel}</Badge>
          </div>

          <h1 className="mt-4 font-serif text-3xl leading-tight text-paper sm:text-4xl md:text-5xl">
            {fromName} <span className="text-moss-400">{locale === 'zh' ? '转' : 'to'}</span> {toName}
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-7 text-paper-dim sm:text-base">{intro}</p>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-paper-dim/85">
            {fromDescription} · {toDescription}
          </p>

          <div className="mt-7 rounded-[24px] border border-paper/12 bg-ink-900/40 p-4 sm:p-5">
            <UploadLauncher
              locale={locale}
              convertDict={dict.convert}
              errors={dict.errors}
              initialTarget={pair.to}
              dropzone={{
                title: fill(dict.pair.uploadTitle, { from: fromName, to: toName }),
                subtitle: dict.hero.upload.subtitle,
                browse: dict.hero.upload.browse,
                active: dict.hero.upload.active,
                acceptNote: dict.hero.upload.accept,
                badge: pair.local ? dict.pair.localChip : dict.pair.serverChip,
                privacy: dict.hero.upload.privacy,
              }}
              fullConvertLabel={dict.pair.openWorkspace}
            />
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" aria-labelledby="pair-capability">
          <h2 id="pair-capability" className="font-serif text-2xl text-paper">
            {dict.pair.capabilityTitle}
          </h2>
          <dl className="mt-5 grid gap-3 sm:grid-cols-3">
            {[
              { label: dict.pair.capabilityRows.engine, value: pair.engine },
              { label: dict.pair.capabilityRows.where, value: whereLabel },
              { label: dict.pair.capabilityRows.quality, value: qualityLabel },
            ].map((row) => (
              <div key={row.label} className="rounded-2xl border border-paper/12 bg-ink-900/50 p-4">
                <dt className="text-[11px] tracking-wider text-paper-dim/60 uppercase">{row.label}</dt>
                <dd className="mt-1.5 text-sm text-paper">{row.value}</dd>
              </div>
            ))}
          </dl>
          {pair.note ? (
            <p className="mt-3 rounded-2xl border border-moss-500/20 bg-moss-500/[0.05] p-4 text-xs leading-6 text-paper-dim">
              {locale === 'zh' ? pair.note.zh : pair.note.en}
            </p>
          ) : null}

          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {steps.map((step, index) => (
              <div key={step.title} className="rounded-2xl border border-paper/12 bg-ink-900/40 p-5">
                <span className="font-mono text-[11px] text-moss-500">0{index + 1}</span>
                <h3 className="mt-2 font-serif text-lg text-paper">{step.title}</h3>
                <p className="mt-2 text-xs leading-6 text-paper-dim">{step.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3 rounded-2xl border border-paper/12 bg-ink-800/40 p-4">
            <HardDrive aria-hidden="true" className="h-4 w-4 text-moss-500" />
            <p className="text-[11px] leading-5 text-paper-dim">
              {locale === 'zh'
                ? '本地路径 0 字节上传；服务器路径在系统临时目录处理，任务完成或 10 分钟后删除，不落数据库、不写文件名日志。'
                : 'Local paths upload zero bytes; server paths run in the system temp directory and are deleted on completion or after 10 minutes — no database, no file-name logs.'}
            </p>
          </div>
        </section>

        <Faq
          locale={locale}
          items={faqItems}
          title={fill(dict.pair.faqTitle, { from: fromName, to: toName })}
        />

        {related.length > 0 ? (
          <section className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8" aria-labelledby="pair-related">
            <h2 id="pair-related" className="font-serif text-2xl text-paper">
              {dict.pair.related}
            </h2>
            <div className="mt-4 flex flex-wrap gap-2">
              {related.map((entry) => (
                <Link
                  key={entry.slug}
                  href={localePath(locale, `/convert/${entry.slug}`)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-paper/15 bg-ink-900 px-3 py-1.5 text-xs text-paper-dim transition-colors hover:border-moss-500/40 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  {formatName(entry.from, locale)} <ArrowRight aria-hidden="true" className="h-3 w-3" /> {formatName(entry.to, locale)}
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </main>
      <Footer locale={locale} />

      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />
    </>
  );
}
