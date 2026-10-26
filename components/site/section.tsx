import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export function Section({
  id,
  eyebrow,
  title,
  sub,
  children,
  className,
  headingLevel = 2,
  dense = false,
}: {
  id?: string;
  eyebrow?: string;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 1 | 2 | 3;
  dense?: boolean;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const Heading = headingLevel === 1 ? 'h1' : headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section id={id} aria-labelledby={headingId} className={cn('mx-auto w-full max-w-6xl px-5 sm:px-8', dense ? 'py-8 md:py-10' : 'py-14 md:py-20', className)}>
      <header className="mb-8 max-w-3xl md:mb-12">
        {eyebrow ? (
          <p className="mb-3 font-mono text-[0.7rem] tracking-[0.28em] text-moss-500 uppercase">{eyebrow}</p>
        ) : null}
        <Heading id={headingId} className="font-serif text-2xl leading-snug text-paper sm:text-3xl md:text-4xl">
          {title}
        </Heading>
        {sub ? <p className="mt-4 max-w-2xl text-sm leading-7 text-paper-dim sm:text-base">{sub}</p> : null}
      </header>
      {children}
    </section>
  );
}
