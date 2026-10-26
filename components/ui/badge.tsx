import type { HTMLAttributes } from 'react';
import { cn } from './cn';

type Tone = 'moss' | 'paper' | 'clay' | 'muted';

const tones: Record<Tone, string> = {
  moss: 'border-moss-500/30 bg-moss-500/10 text-moss-400',
  paper: 'border-paper/20 bg-paper/5 text-paper-dim',
  clay: 'border-clay/40 bg-clay/10 text-clay',
  muted: 'border-transparent bg-ink-700/60 text-paper-dim',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  mono?: boolean;
}

export function Badge({ tone = 'paper', mono, className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs leading-5',
        mono && 'font-mono tabular-nums',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
