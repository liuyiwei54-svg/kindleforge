import { ChevronDown } from 'lucide-react';
import { Section } from '@/components/site/section';
import { getDict, type Locale } from '@/lib/i18n';

export function Faq({
  locale,
  items,
  title,
}: {
  locale: Locale;
  items?: { q: string; a: string }[];
  title?: string;
}) {
  const dict = getDict(locale);
  const list = items ?? dict.faq.items;

  return (
    <Section id="faq" eyebrow={dict.faq.eyebrow} title={title ?? dict.faq.title}>
      <div className="divide-y divide-paper/10 rounded-[20px] border border-paper/12 bg-ink-900/40">
        {list.map((item) => (
          <details key={item.q} className="group px-5 py-4 sm:px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-lg focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
              <span className="font-serif text-base text-paper sm:text-lg">{item.q}</span>
              <ChevronDown
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-paper-dim transition-transform duration-200 group-open:rotate-180"
              />
            </summary>
            <p className="mt-3 max-w-3xl pr-8 text-sm leading-7 text-paper-dim">{item.a}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}
