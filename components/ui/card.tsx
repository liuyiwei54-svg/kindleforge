import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('rounded-[20px] border border-paper/12 bg-ink-800/60 p-6 shadow-[0_1px_0_rgba(244,240,230,0.04)_inset]', className)}
      {...props}
    />
  );
}
