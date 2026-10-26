import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * CSS-only tooltip: no JS, opens on hover and on keyboard focus within.
 * The panel stays in the accessibility tree, so screen readers can read it.
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={cn('group/tooltip relative inline-flex items-center', className)}>
      {children}
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-max max-w-60 -translate-x-1/2 rounded-xl border border-paper/15 bg-ink-900 px-2.5 py-1.5 text-left text-xs leading-5 text-paper opacity-0 shadow-lg transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100"
      >
        {content}
      </span>
    </span>
  );
}
