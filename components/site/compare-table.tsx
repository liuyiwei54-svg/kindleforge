import { Check, Minus } from 'lucide-react';
import { Section } from '@/components/site/section';
import { getDict, type Locale } from '@/lib/i18n';

export function CompareTable({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <Section id="compare" eyebrow={dict.compare.eyebrow} title={dict.compare.title} sub={dict.compare.sub}>
      <div className="overflow-x-auto rounded-[20px] border border-paper/12 bg-ink-900/40">
        <table className="w-full min-w-[720px] border-collapse text-left">
          <caption className="sr-only">{dict.compare.title}</caption>
          <thead>
            <tr className="border-b border-paper/12">
              <th scope="col" className="w-28 px-4 py-3 text-[11px] font-medium tracking-wider text-paper-dim/70 uppercase">
                {dict.compare.columns.dimension}
              </th>
              <th scope="col" className="w-[42%] border-x border-moss-500/15 bg-moss-500/[0.05] px-4 py-3 text-sm font-medium text-moss-400">
                {dict.compare.columns.us}
              </th>
              <th scope="col" className="px-4 py-3 text-sm font-medium text-paper-dim">
                {dict.compare.columns.them}
              </th>
            </tr>
          </thead>
          <tbody>
            {dict.compare.rows.map((row) => (
              <tr key={row.key} className="border-t border-paper/10 align-top">
                <th scope="row" className="px-4 py-5 font-serif text-base font-normal text-paper">
                  {row.dim}
                </th>
                <td className="border-x border-moss-500/15 bg-moss-500/[0.04] px-4 py-5">
                  <ul className="space-y-2">
                    {row.us.map((item) => (
                      <li key={item} className="flex gap-2 text-xs leading-6 text-paper-dim">
                        <Check aria-hidden="true" className="mt-1.5 h-3.5 w-3.5 shrink-0 text-moss-500" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="px-4 py-5">
                  <p className="flex gap-2 text-xs leading-6 text-paper-dim/80">
                    <Minus aria-hidden="true" className="mt-1.5 h-3.5 w-3.5 shrink-0 text-paper-dim/40" />
                    <span>{row.them}</span>
                  </p>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 max-w-3xl text-[11px] leading-5 text-paper-dim/60">{dict.compare.footNote}</p>
      <p className="mt-3 max-w-3xl border-l-2 border-moss-500/40 pl-3 text-xs leading-6 text-paper-dim">{dict.compare.honest}</p>
    </Section>
  );
}
