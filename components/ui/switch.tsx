'use client';

import { cn } from './cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label; also the accessible name of the switch. */
  label: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onChange, label, description, disabled, className }: SwitchProps) {
  const descriptionId = description ? `switch-${label.replace(/\s+/g, '-')}-desc` : undefined;
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="min-w-0">
        <p className="text-sm text-paper">{label}</p>
        {description ? (
          <p id={descriptionId} className="mt-0.5 text-xs leading-5 text-paper-dim/80">
            {description}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-describedby={descriptionId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200',
          'focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 focus-visible:outline-none',
          checked ? 'border-moss-500/60 bg-moss-500' : 'border-paper/20 bg-ink-700',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'block h-4.5 w-4.5 rounded-full transition-transform duration-200 ease-out',
            checked ? 'translate-x-[22px] bg-ink-950' : 'translate-x-[3px] bg-paper-dim',
          )}
        />
      </button>
    </div>
  );
}
