import { ChevronDown } from 'lucide-react';
import type { SelectHTMLAttributes } from 'react';
import { cn } from './cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  /** Visually hide the label but keep it for screen readers. */
  hideLabel?: boolean;
  hint?: string;
  wrapperClassName?: string;
}

export function Select({ label, hideLabel, hint, className, wrapperClassName, id, ...props }: SelectProps) {
  const selectId = id ?? `select-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const hintId = hint ? `${selectId}-hint` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      <label htmlFor={selectId} className={cn(hideLabel ? 'sr-only' : 'text-sm font-medium text-paper-dim')}>
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          aria-describedby={hintId}
          className={cn(
            'w-full appearance-none rounded-full border border-paper/20 bg-ink-900 py-2.5 pr-10 pl-4 text-sm text-paper',
            'transition-colors duration-200 hover:border-paper/35 focus-visible:border-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
          {...props}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-paper-dim"
        />
      </div>
      {hint ? (
        <p id={hintId} className="text-xs leading-5 text-paper-dim/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
