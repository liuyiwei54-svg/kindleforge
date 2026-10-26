import { CheckCircle2, FlaskConical, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Section } from '@/components/site/section';
import { capabilities, FORMAT_INFO, pairSlug } from '@/lib/engine/formats';
import type { FormatId } from '@/lib/engine/types';
import { getDict, localePath, type Locale } from '@/lib/i18n';
import { formatName } from '@/lib/i18n/formats';

const DEMO_PAIRS: Array<[FormatId, FormatId]> = [
  ['txt', 'epub'],
  ['md', 'epub'],
  ['html', 'epub'],
  ['epub', 'txt'],
  ['epub', 'html'],
  ['docx', 'epub'],
  ['pdf', 'epub'],
  ['cbz', 'epub'],
  ['epub', 'mobi'],
];

export function LocalModeSection({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const pairs = capabilities();
  const rows = DEMO_PAIRS.map(([from, to]) => {
    const capability = pairs.find((pair) => pair.from === from && pair.to === to);
    return capability ? { from, to, local: capability.local } : null;
  }).filter((row): row is { from: FormatId; to: FormatId; local: boolean } => row !== null);

  return (
    <Section id="local" eyebrow={dict.localMode.eyebrow} title={dict.localMode.title} sub={dict.localMode.sub}>
      <div className="grid gap-3 md:grid-cols-3">
        {dict.localMode.steps.map((step, index) => (
          <div key={step.title} className="rounded-2xl border border-paper/12 bg-ink-900/50 p-5">
            <span className="font-mono text-[11px] text-moss-500">0{index + 1}</span>
            <h3 className="mt-2 font-serif text-lg text-paper">{step.title}</h3>
            <p className="mt-2 text-xs leading-6 text-paper-dim">{step.body}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <div className="rounded-[20px] border border-moss-500/25 bg-moss-500/[0.05] p-5">
          <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
            <FlaskConical aria-hidden="true" className="h-4 w-4 text-moss-500" />
            {dict.localMode.verifyTitle}
          </h3>
          <ul className="mt-3 space-y-2.5">
            {dict.localMode.verify.map((item) => (
              <li key={item} className="flex gap-2 text-xs leading-6 text-paper-dim">
                <CheckCircle2 aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-moss-500" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <ButtonLink href={localePath(locale, '/green')} variant="secondary" size="sm" className="mt-4">
            {dict.localMode.cta}
          </ButtonLink>
        </div>

        <div className="overflow-hidden rounded-[20px] border border-paper/12 bg-ink-900/40">
          <div className="flex items-center justify-between gap-2 border-b border-paper/10 px-4 py-3">
            <h3 className="font-serif text-base text-paper">{dict.localMode.tableTitle}</h3>
            <Badge tone="moss" className="gap-1">
              <ShieldCheck aria-hidden="true" className="h-3 w-3" />
              0 B
            </Badge>
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <caption className="sr-only">{dict.localMode.tableTitle}</caption>
            <thead>
              <tr className="border-b border-paper/10 text-[10px] tracking-wider text-paper-dim/60 uppercase">
                <th scope="col" className="px-4 py-2 font-medium">{dict.localMode.tableColumns.pair}</th>
                <th scope="col" className="px-4 py-2 font-medium">{dict.localMode.tableColumns.where}</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">{dict.localMode.tableColumns.note}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.from}-${row.to}`} className="border-t border-paper/8">
                  <td className="px-4 py-2.5">
                    <Link
                      href={localePath(locale, `/convert/${pairSlug(row.from, row.to)}`)}
                      className="text-paper underline decoration-paper/20 underline-offset-4 transition-colors hover:decoration-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                    >
                      {formatName(row.from, locale)} → {formatName(row.to, locale)}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={row.local ? 'inline-flex items-center gap-1.5 text-moss-400' : 'text-paper-dim'}>
                      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${row.local ? 'bg-moss-500' : 'bg-paper-dim/40'}`} />
                      {row.local ? dict.localMode.localWhere : dict.localMode.serverWhere}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2.5 text-paper-dim/60 sm:table-cell">
                    {row.local ? dict.localMode.localNote : dict.localMode.serverNote}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-paper/10 px-4 py-3 text-[11px] leading-5 text-paper-dim/60">{dict.localMode.note}</p>
        </div>
      </div>
    </Section>
  );
}
