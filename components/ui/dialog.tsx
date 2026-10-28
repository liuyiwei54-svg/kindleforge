'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from './cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
  closeLabel: string;
  className?: string;
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Minimal modal: portal, focus trap, Escape to close, focus restoration.
 * No dependency — the project deliberately ships its own primitives.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = 'md', closeLabel, className }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const focusFirst = () => {
      const list = panel ? [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
      (list.find((element) => element.offsetParent !== null) ?? list[0])?.focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const list = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const titleId = 'dialog-title';
  const descriptionId = description ? 'dialog-description' : undefined;

  return createPortal(
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-ink-950/80 p-4 backdrop-blur-sm sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeRef.current();
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          className={cn(
            'relative w-full overflow-hidden rounded-[24px] border border-paper/15 bg-ink-900 shadow-[0_24px_80px_rgba(0,0,0,0.55)]',
            size === 'lg' ? 'max-w-2xl' : 'max-w-lg',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-paper/10 px-5 py-4 sm:px-6">
            <div>
              <h2 id={titleId} className="font-serif text-xl tracking-tight text-paper">
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className="mt-1 text-xs leading-5 text-paper-dim">
                  {description}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => closeRef.current()}
              aria-label={closeLabel}
              className="rounded-full p-1.5 text-paper-dim transition-colors hover:bg-paper/5 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>

          <div className="max-h-[min(70vh,40rem)] overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

          {footer ? (
            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-paper/10 bg-ink-950/40 px-5 py-4 sm:px-6">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
