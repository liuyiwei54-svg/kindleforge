'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

export interface ToastState {
  id: number;
  message: string;
  tone: 'ok' | 'error';
  hint?: string;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((message: string, tone: ToastState['tone'] = 'ok', hint?: string) => {
    setToast({ id: Date.now(), message, tone, hint });
  }, []);

  const hide = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, show, hide };
}

export function ToastRegion({ toast, onDismiss, closeLabel = 'Close notification' }: { toast: ToastState | null; onDismiss: () => void; closeLabel?: string }) {
  if (!toast) return null;
  const Icon = toast.tone === 'error' ? AlertTriangle : CheckCircle2;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-6 z-[60] flex justify-center sm:bottom-8">
      <div
        role={toast.tone === 'error' ? 'alert' : 'status'}
        aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
        className={
          toast.tone === 'error'
            ? 'pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-clay/45 bg-ink-900 px-4 py-3 text-sm text-paper shadow-[0_16px_48px_rgba(0,0,0,0.5)]'
            : 'pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border border-moss-500/40 bg-ink-900 px-4 py-3 text-sm text-paper shadow-[0_16px_48px_rgba(0,0,0,0.5)]'
        }
      >
        <Icon aria-hidden="true" className={toast.tone === 'error' ? 'mt-0.5 h-4 w-4 shrink-0 text-clay' : 'mt-0.5 h-4 w-4 shrink-0 text-moss-500'} />
        <div className="min-w-0">
          <p className="leading-6">{toast.message}</p>
          {toast.hint ? <p className="mt-1 text-xs leading-5 text-paper-dim">{toast.hint}</p> : null}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="ml-2 shrink-0 rounded-full px-1 text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
          aria-label={closeLabel}
        >
          ×
        </button>
      </div>
    </div>
  );
}
