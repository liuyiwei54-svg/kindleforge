import { Leaf, Lock, Server, TerminalSquare } from 'lucide-react';
import { ButtonLink } from '@/components/ui/button';
import { CodeBlock } from '@/components/ui/code-block';
import { Section } from '@/components/site/section';
import { getDict, localePath, type Locale } from '@/lib/i18n';

const ICONS = [Lock, Leaf, Server];

export function GreenSection({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <Section id="green" eyebrow={dict.green.eyebrow} title={dict.green.title} sub={dict.green.sub}>
      <div className="grid gap-3 md:grid-cols-3">
        {dict.green.cards.map((card, index) => {
          const Icon = ICONS[index] ?? Leaf;
          return (
            <div key={card.title} className="rounded-2xl border border-paper/12 bg-ink-900/50 p-5">
              <Icon aria-hidden="true" className="h-5 w-5 text-moss-500" />
              <h3 className="mt-3 font-serif text-lg text-paper">{card.title}</h3>
              <p className="mt-2 text-xs leading-6 text-paper-dim">{card.body}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
          <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
            <TerminalSquare aria-hidden="true" className="h-4 w-4 text-moss-500" />
            {dict.green.selfHost.title}
          </h3>
          <p className="mt-2 text-xs leading-6 text-paper-dim">{dict.green.selfHost.body}</p>
          <CodeBlock code={dict.green.selfHost.commands.join('\n')} labels={dict.code} className="mt-3" />
          <p className="mt-2 text-[11px] leading-5 text-paper-dim/60">{dict.green.selfHost.note}</p>
        </div>

        <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
          <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
            <Leaf aria-hidden="true" className="h-4 w-4 text-moss-500" />
            {dict.green.energy.title}
          </h3>
          <p className="mt-2 text-xs leading-6 text-paper-dim">{dict.green.energy.body}</p>
          <ButtonLink href={localePath(locale, '/green')} variant="secondary" size="sm" className="mt-4">
            {dict.green.cta}
          </ButtonLink>
        </div>
      </div>
    </Section>
  );
}
