'use client';

import { AlertTriangle, ArrowRight, BookOpen, FileText, Image as ImageIcon, Loader2, RotateCcw, Server, ShieldCheck, Wand2, X } from 'lucide-react';
import type { Dict } from '@/lib/i18n/types';
import { FORMAT_INFO } from '@/lib/engine/formats';
import { formatName } from '@/lib/i18n/formats';
import type { Locale } from '@/lib/i18n/paths';
import type { FormatId } from '@/lib/engine/types';
import { estimateReadingMinutes, formatBytes } from '@/lib/client/estimate';
import type { FileItem, LibraryAction } from '@/lib/client/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fill } from '@/lib/i18n/fill';
import { ProgressBar } from './progress';
import { ResultCard } from './result-card';

function FormatIcon({ kind }: { kind: string }) {
  const className = 'h-4 w-4';
  if (kind === 'comic' || kind === 'image') return <ImageIcon aria-hidden="true" className={className} />;
  if (kind === 'ebook') return <BookOpen aria-hidden="true" className={className} />;
  return <FileText aria-hidden="true" className={className} />;
}

const ACTIVE: ReadonlySet<FileItem['status']> = new Set(['preparing', 'uploading', 'running', 'local']);

export function FileCard({
  item,
  target,
  dict,
  locale,
  onRemove,
  onCancel,
  onDownload,
  onRetry,
  onAutoFill,
  onSave,
  onSend,
  library,
  libraryCopy,
  smtpConfigured,
  disabled,
}: {
  item: FileItem;
  target: FormatId;
  dict: Dict['convert'];
  locale: Locale;
  onRemove: () => void;
  onCancel: () => void;
  onDownload: () => void;
  onRetry: () => void;
  onAutoFill: () => void;
  onSave: () => void;
  onSend: () => void;
  library: LibraryAction;
  libraryCopy: Dict['library'];
  smtpConfigured: boolean;
  disabled: boolean;
}) {
  const from = FORMAT_INFO[item.from];
  const fromName = formatName(item.from, locale);
  const toName = formatName(target, locale);
  const minutes = estimateReadingMinutes(item.from, item.size);
  const active = ACTIVE.has(item.status);
  const progressLabel = fill(dict.aria.fileProgress, { name: item.name });

  return (
    <article className="rounded-2xl border border-paper/12 bg-ink-900/60 p-3.5 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-paper/15 bg-paper/5 text-paper-dim">
          <FormatIcon kind={from.kind} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-sm font-medium text-paper" title={item.name}>
              {item.name}
            </h3>
            <button
              type="button"
              onClick={onRemove}
              disabled={disabled || active}
              aria-label={fill(dict.files.remove, { name: item.name })}
              className="shrink-0 rounded-full p-1 text-paper-dim transition-colors hover:bg-paper/10 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none disabled:opacity-30"
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-paper-dim/80">
            <Badge tone="paper" mono>
              {fromName}
            </Badge>
            <ArrowRight aria-hidden="true" className="h-3 w-3" />
            <Badge tone="moss" mono>
              {toName}
            </Badge>
            <span aria-hidden="true">·</span>
            <span>{formatBytes(item.size)}</span>
            {minutes ? (
              <>
                <span aria-hidden="true">·</span>
                <span title={dict.files.estimate}>{fill(dict.files.estimateValue, { minutes })}</span>
              </>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge
              tone={item.status === 'error' ? 'clay' : item.status === 'done' ? 'moss' : 'paper'}
              className="gap-1"
            >
              {active ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : null}
              {item.status === 'done' && <ShieldCheck aria-hidden="true" className="h-3 w-3" />}
              {dict.status[item.status]}
            </Badge>
            {item.mode ? (
              <Badge tone={item.mode === 'local' ? 'moss' : 'paper'} className="gap-1">
                {item.mode === 'local' ? (
                  <ShieldCheck aria-hidden="true" className="h-3 w-3" />
                ) : (
                  <Server aria-hidden="true" className="h-3 w-3" />
                )}
                {item.mode === 'local' ? dict.localBadge : dict.serverBadge}
              </Badge>
            ) : null}
          </div>

          {item.metadata?.title ? (
            <p className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-moss-400/90">
              <Badge tone="moss" mono>
                {dict.metadata.applied}
              </Badge>
              <span>
                {item.metadata.author
                  ? fill(dict.metadata.summary, { title: item.metadata.title, author: item.metadata.author })
                  : fill(dict.metadata.summaryNoAuthor, { title: item.metadata.title })}
              </span>
              {item.status !== 'done' ? (
                <button
                  type="button"
                  onClick={onAutoFill}
                  disabled={disabled}
                  className="rounded-full px-1.5 py-0.5 text-paper-dim underline-offset-4 transition-colors hover:text-paper hover:underline focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none disabled:opacity-40"
                >
                  {dict.metadata.button}
                </button>
              ) : null}
            </p>
          ) : item.status !== 'done' && !active ? (
            <Button variant="ghost" size="sm" className="mt-1.5" onClick={onAutoFill} disabled={disabled}>
              <Wand2 aria-hidden="true" className="h-3.5 w-3.5" />
              {dict.metadata.button}
            </Button>
          ) : null}

          {active ? (
            <div className="mt-3 flex items-center gap-3">
              <ProgressBar
                value={item.progress}
                label={progressLabel}
                indeterminate={item.status === 'local'}
                className="flex-1"
              />
              <span className="w-9 shrink-0 text-right font-mono text-[11px] text-paper-dim tabular-nums">
                {item.status === 'local' ? '—' : `${Math.round(item.progress)}%`}
              </span>
              <Button size="sm" variant="ghost" onClick={onCancel} aria-label={`${dict.cancel} · ${item.name}`}>
                {dict.cancel}
              </Button>
            </div>
          ) : null}

          {item.notice ? (
            <p className="mt-2 rounded-xl border border-clay/25 bg-clay/[0.06] px-2.5 py-2 text-[11px] leading-5 text-clay">
              {item.notice}
            </p>
          ) : null}

          {item.error ? (
            <div role="alert" className="mt-3 rounded-xl border border-clay/35 bg-clay/[0.08] p-2.5">
              <p className="flex items-center gap-1.5 text-xs font-medium text-clay">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                {dict.errorTitle} · <span className="font-mono">{item.error.code}</span>
              </p>
              <p className="mt-1 text-xs leading-5 text-paper">{item.error.message}</p>
              <p className="mt-1 text-[11px] leading-5 text-paper-dim">
                <span className="text-paper-dim/70">{dict.errorHint}：</span>
                {item.error.hint}
              </p>
              <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry} disabled={disabled}>
                <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                {dict.retry}
              </Button>
            </div>
          ) : null}

          {item.status === 'done' && item.result ? (
            <ResultCard
              item={item}
              result={item.result}
              labels={{
                download: dict.download,
                engine: dict.engine,
                warnings: dict.warnings,
                localBadge: dict.localBadge,
              }}
              onDownload={onDownload}
              onSave={onSave}
              onSend={onSend}
              library={library}
              smtpConfigured={smtpConfigured}
              locale={locale}
              resultCopy={dict.result}
              sendCopy={libraryCopy.send}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
