import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from './cn';

const fieldClass =
  'w-full rounded-xl border border-paper/20 bg-ink-950/60 px-3.5 py-2.5 text-sm text-paper placeholder:text-paper-dim/60 transition-colors duration-200 hover:border-paper/35 focus-visible:border-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export function Input({ label, hideLabel, hint, error, className, wrapperClassName, id, ...props }: InputProps) {
  const inputId = id ?? `input-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const noteId = hint || error ? `${inputId}-note` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      <label htmlFor={inputId} className={cn('text-sm font-medium text-paper-dim', hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        className={cn(fieldClass, error && 'border-clay/60', className)}
        {...props}
      />
      {error ? (
        <p id={noteId} className="text-xs leading-5 text-clay">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-xs leading-5 text-paper-dim/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export function Textarea({ label, hideLabel, hint, error, className, wrapperClassName, id, ...props }: TextareaProps) {
  const inputId = id ?? `textarea-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const noteId = hint || error ? `${inputId}-note` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', wrapperClassName)}>
      <label htmlFor={inputId} className={cn('text-sm font-medium text-paper-dim', hideLabel && 'sr-only')}>
        {label}
      </label>
      <textarea
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={noteId}
        className={cn(fieldClass, 'min-h-24 resize-y leading-6', error && 'border-clay/60', className)}
        {...props}
      />
      {error ? (
        <p id={noteId} className="text-xs leading-5 text-clay">
          {error}
        </p>
      ) : hint ? (
        <p id={noteId} className="text-xs leading-5 text-paper-dim/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
