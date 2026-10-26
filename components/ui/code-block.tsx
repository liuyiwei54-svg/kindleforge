'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { cn } from './cn';

export function CodeBlock({
  code,
  labels,
  className,
}: {
  code: string;
  labels: { copy: string; copied: string };
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className={cn('relative overflow-hidden rounded-xl border border-paper/15 bg-ink-950', className)}>
      <pre className="overflow-x-auto p-4 pr-14 font-mono text-xs leading-6 text-paper-dim">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={copied ? labels.copied : labels.copy}
        className="absolute top-2 right-2 rounded-lg border border-paper/15 bg-ink-900 p-1.5 text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
      >
        {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5 text-moss-400" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
      </button>
      <span aria-live="polite" className="sr-only">
        {copied ? labels.copied : ''}
      </span>
    </div>
  );
}
