import { CheckCircle2, Leaf, Lock, RefreshCcw, Server, ShieldCheck, TerminalSquare } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { Section } from '@/components/site/section';
import { getDict, localePath, type Locale } from '@/lib/i18n';

const ZERO_ICONS = [Server, RefreshCcw, ShieldCheck, Lock];

export function GreenPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const page = dict.greenPage;

  return (
    <>
      <Header locale={locale} path="/green" />
      <main id="main">
        <Section id="green-hero" dense headingLevel={1} eyebrow={page.hero.eyebrow} title={page.hero.title} sub={page.hero.sub}>
          <div className="grid gap-3 sm:grid-cols-3">
            {[page.zeroTitle, page.compareTitle, page.selfHostTitle].map((title, index) => {
              const Icon = [Lock, Leaf, Server][index] ?? Leaf;
              return (
                <div key={title} className="flex items-center gap-2 rounded-2xl border border-paper/12 bg-ink-900/50 px-4 py-3">
                  <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-moss-500" />
                  <span className="text-xs text-paper-dim">{title}</span>
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="zero-retention" dense title={page.zeroTitle} sub={page.zeroIntro}>
          <div className="grid gap-3 sm:grid-cols-2">
            {page.zeroItems.map((item, index) => {
              const Icon = ZERO_ICONS[index] ?? Lock;
              return (
                <div key={item.title} className="rounded-2xl border border-paper/12 bg-ink-900/50 p-5">
                  <Icon aria-hidden="true" className="h-5 w-5 text-moss-500" />
                  <h3 className="mt-3 font-serif text-lg text-paper">{item.title}</h3>
                  <p className="mt-2 text-xs leading-6 text-paper-dim">{item.body}</p>
                </div>
              );
            })}
          </div>
        </Section>

        <Section id="verify" dense title={page.verifyTitle}>
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[20px] border border-moss-500/25 bg-moss-500/[0.05] p-5">
              <h3 className="font-serif text-lg text-paper">{page.verifyTitle}</h3>
              <ul className="mt-3 space-y-2.5">
                {page.verify.map((item) => (
                  <li key={item} className="flex gap-2 text-xs leading-6 text-paper-dim">
                    <CheckCircle2 aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-moss-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="overflow-hidden rounded-[20px] border border-paper/12 bg-ink-900/40">
              <div className="border-b border-paper/10 px-4 py-3">
                <h3 className="font-serif text-base text-paper">{page.compareTitle}</h3>
                <p className="mt-1 text-[11px] leading-5 text-paper-dim/60">{page.compareNote}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] border-collapse text-left text-xs">
                  <caption className="sr-only">{page.compareTitle}</caption>
                  <thead>
                    <tr className="border-b border-paper/10 text-[10px] tracking-wider text-paper-dim/60 uppercase">
                      <th scope="col" className="px-4 py-2 font-medium">{page.compareColumns.label}</th>
                      <th scope="col" className="px-4 py-2 font-medium">{page.compareColumns.cloud}</th>
                      <th scope="col" className="px-4 py-2 font-medium text-moss-400">{page.compareColumns.local}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.compareRows.map((row) => (
                      <tr key={row.label} className="border-t border-paper/8 align-top">
                        <th scope="row" className="px-4 py-2.5 font-normal text-paper">{row.label}</th>
                        <td className="px-4 py-2.5 text-paper-dim/70">{row.cloud}</td>
                        <td className="bg-moss-500/[0.04] px-4 py-2.5 text-paper-dim">{row.local}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </Section>

        <Section id="self-host" dense title={page.selfHostTitle} sub={page.selfHostBody}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
                <TerminalSquare aria-hidden="true" className="h-4 w-4 text-moss-500" />
                {page.selfHostTitle}
              </h3>
              <CodeBlock code={page.commands.join('\n')} labels={dict.code} className="mt-3" />
              <p className="mt-2 text-[11px] leading-5 text-paper-dim/60">{page.selfHostNote}</p>
            </div>

            <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
                <Leaf aria-hidden="true" className="h-4 w-4 text-moss-500" />
                {page.energyTitle}
              </h3>
              <p className="mt-3 text-xs leading-6 text-paper-dim">{page.energyBody}</p>
            </div>
          </div>
        </Section>

        <Section id="no-tracking" dense title={page.noTrackTitle}>
          <div className="rounded-[20px] border border-paper/12 bg-ink-900/40 p-5">
            <p className="max-w-3xl text-sm leading-7 text-paper-dim">{page.noTrackBody}</p>
            <ButtonLink href={localePath(locale, '/convert')} variant="secondary" size="sm" className="mt-4">
              {page.cta}
            </ButtonLink>
          </div>
        </Section>
      </main>
      <Footer locale={locale} />
    </>
  );
}
