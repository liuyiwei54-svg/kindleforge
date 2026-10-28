'use client';

import { AlertTriangle, ArrowUpRight, Check, Download, HardDrive, Loader2, Mail, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { formatBytes } from '@/lib/client/estimate';
import { libraryEmlUrl } from '@/lib/client/library';
import type { ConversionOutput, FileItem, LibraryAction } from '@/lib/client/types';
import { fill } from '@/lib/i18n/fill';
import { localePath, type Locale } from '@/lib/i18n/paths';
import type { Dict } from '@/lib/i18n/types';

export function ResultCard({
  item,
  result,
  labels,
  library,
  smtpConfigured,
  locale,
  resultCopy,
  sendCopy,
  onDownload,
  onSave,
  onSend,
}: {
  item: FileItem;
  result: ConversionOutput;
  labels: { download: string; engine: string; warnings: string; localBadge: string };
  library: LibraryAction;
  smtpConfigured: boolean;
  locale: Locale;
  resultCopy: Dict['convert']['result'];
  sendCopy: Dict['library']['send'];
  onDownload: () => void;
  onSave: () => void;
  onSend: () => void;
}) {
  const saved = library.state === 'saved' || library.state === 'sending' || library.state === 'sent';
  const saving = library.state === 'saving';
  const sending = library.state === 'sending';
  const sent = library.state === 'sent';
  const busy = saving || sending;
  const error = library.state === 'error' ? library.hint : undefined;
  const notice = library.state !== 'error' ? library.hint : undefined;

  return (
    <div className="mt-3 rounded-2xl border border-moss-500/25 bg-moss-500/[0.06] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-paper" title={result.filename}>
            {result.filename}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-dim/80">
            <span>{formatBytes(result.size)}</span>
            <span aria-hidden="true">·</span>
            <span>
              {labels.engine}: {result.engine}
            </span>
            {item.mode === 'local' ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 text-moss-400">
                  <HardDrive aria-hidden="true" className="h-3 w-3" />
                  {labels.localBadge}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <Button size="sm" onClick={onDownload} className="shrink-0">
          <Download aria-hidden="true" className="h-4 w-4" />
          {labels.download}
        </Button>
      </div>

      {item.metadata?.title ? (
        <p className="mt-2 text-[11px] text-moss-400/90">
          {fill(resultCopy.metaApplied, { title: item.metadata.title })}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onSave} disabled={busy || saved} className="gap-1.5">
          {saving ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : saved ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Save aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {saving ? resultCopy.saving : saved ? resultCopy.saved : resultCopy.save}
        </Button>

        <Button variant="secondary" size="sm" onClick={onSend} disabled={busy || sent} className="gap-1.5">
          {sending ? (
            <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
          ) : sent ? (
            <Check aria-hidden="true" className="h-3.5 w-3.5" />
          ) : (
            <Mail aria-hidden="true" className="h-3.5 w-3.5" />
          )}
          {sending ? resultCopy.sending : sent ? sendCopy.sentGeneric : resultCopy.send}
        </Button>

        {library.entryId ? (
          <a
            href={localePath(locale, '/library')}
            className="inline-flex items-center gap-1 rounded-full px-2 py-1.5 text-[11px] text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
          >
            {resultCopy.openLibrary}
            <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
          </a>
        ) : null}

        {library.entryId && !smtpConfigured ? (
          <a
            href={libraryEmlUrl(library.entryId)}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border border-paper/20 px-2.5 py-1.5 text-[11px] text-paper-dim',
              'transition-colors hover:border-paper/35 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
            )}
          >
            <Mail aria-hidden="true" className="h-3 w-3" />
            {sendCopy.eml}
          </a>
        ) : null}
      </div>

      {!smtpConfigured ? (
        <p className="mt-2 text-[11px] leading-5 text-paper-dim/80">
          {resultCopy.needSetup} ·{' '}
          <button type="button" onClick={onSend} className="text-moss-400 underline-offset-4 hover:underline">
            {sendCopy.setupCta}
          </button>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 rounded-xl border border-clay/30 bg-clay/[0.08] px-2.5 py-2 text-[11px] leading-5 text-clay">
          {error}
        </p>
      ) : notice ? (
        <p role="status" className="mt-2 rounded-xl border border-paper/15 bg-ink-950/40 px-2.5 py-2 text-[11px] leading-5 text-paper-dim">
          {notice}
        </p>
      ) : null}

      {result.warnings.length > 0 ? (
        <div className="mt-3 rounded-xl border border-clay/25 bg-clay/[0.06] p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium text-clay">
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
            {labels.warnings}
          </p>
          <ul className="mt-1 space-y-1 pl-5 text-[11px] leading-5 text-paper-dim">
            {result.warnings.map((warning) => (
              <li key={warning} className="list-disc">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
