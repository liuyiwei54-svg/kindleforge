'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import type { FormatId, FormatInfo } from '@/lib/engine/types';
import type { Dict } from '@/lib/i18n/types';

export interface MatrixOutput {
  to: FormatId;
  name: string;
  local: boolean;
  href: string;
  quality: 'high' | 'medium' | 'lossy';
}

export interface MatrixFormatItem {
  from: FormatId;
  name: string;
  localizedName: string;
  kind: FormatInfo['kind'];
  ext: string[];
  outputs: MatrixOutput[];
}

export interface MatrixPopularItem {
  from: FormatId;
  to: FormatId;
  name: string;
  href: string;
  local: boolean;
}

const KINDS: Array<FormatInfo['kind'] | 'all'> = ['all', 'ebook', 'document', 'text', 'comic', 'image'];

export function FormatMatrix({
  items,
  popular,
  labels,
  workspaceHref,
}: {
  items: MatrixFormatItem[];
  popular: MatrixPopularItem[];
  labels: Dict['matrix'];
  workspaceHref: string;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<FormatInfo['kind'] | 'all'>('all');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false;
      if (!needle) return true;
      const haystack = [
        item.name,
        item.localizedName,
        item.from,
        ...item.ext,
        ...item.outputs.map((output) => `${output.name} ${output.to}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [items, kind, query]);

  const totalOutputs = useMemo(() => items.reduce((sum, item) => sum + item.outputs.length, 0), [items]);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="w-full max-w-md">
          <label htmlFor="format-search" className="text-sm font-medium text-paper-dim">
            {labels.searchLabel}
          </label>
          <div className="relative mt-1.5">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-paper-dim/60" />
            <input
              id="format-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={labels.searchPlaceholder}
              className="w-full rounded-full border border-paper/20 bg-ink-900 py-2.5 pr-4 pl-10 text-sm text-paper placeholder:text-paper-dim/60 focus-visible:border-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-paper-dim">{labels.kindsLabel}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label={labels.kindsLabel}>
            {KINDS.map((entry) => (
              <button
                key={entry}
                type="button"
                aria-pressed={kind === entry}
                onClick={() => setKind(entry)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                  kind === entry
                    ? 'border-moss-500/50 bg-moss-500/10 text-moss-400'
                    : 'border-paper/15 bg-ink-900/60 text-paper-dim hover:border-paper/30 hover:text-paper',
                )}
              >
                {labels.kinds[entry]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {query === '' && kind === 'all' ? (
        <div className="mt-6 rounded-2xl border border-paper/12 bg-ink-800/40 p-4">
          <p className="text-xs font-medium tracking-wider text-paper-dim/70 uppercase">{labels.popular}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {popular.map((pair) => (
              <Link
                key={`${pair.from}-${pair.to}`}
                href={pair.href}
                className="inline-flex items-center gap-1.5 rounded-full border border-paper/15 bg-ink-900 px-2.5 py-1 text-[11px] text-paper-dim transition-colors hover:border-moss-500/40 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              >
                {pair.local ? (
                  <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-moss-500" />
                ) : null}
                {pair.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <p aria-live="polite" className="mt-5 text-[11px] text-paper-dim/60">
        {filtered.length} / {items.length} · {totalOutputs} {labels.outputsLabel}
      </p>

      {filtered.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-paper/12 bg-ink-900/40 p-6 text-center">
          <p className="text-sm text-paper-dim">{labels.noResult}</p>
          <ButtonLink href={workspaceHref} variant="secondary" size="sm" className="mt-3">
            {labels.openWorkspace}
          </ButtonLink>
        </div>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => (
            <article key={item.from} className="rounded-2xl border border-paper/12 bg-ink-900/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-serif text-base text-paper">
                    {item.name}
                    {item.localizedName !== item.name ? (
                      <span className="ml-2 text-[11px] font-normal text-paper-dim/60">{item.localizedName}</span>
                    ) : null}
                  </h3>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-paper-dim/70">
                    {item.ext.map((ext) => `.${ext}`).join(' ')}
                  </p>
                </div>
                <Badge tone="paper" className="shrink-0">
                  {labels.kinds[item.kind]}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.outputs.map((output) => (
                  <Link
                    key={output.to}
                    href={output.href}
                    title={`${item.name} → ${output.name} · ${output.local ? labels.local : labels.server}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                      output.local
                        ? 'border-moss-500/25 bg-moss-500/[0.07] text-paper hover:border-moss-500/60'
                        : 'border-paper/15 bg-ink-900 text-paper-dim hover:border-paper/35 hover:text-paper',
                    )}
                  >
                    <span aria-hidden="true" className={cn('h-1 w-1 rounded-full', output.local ? 'bg-moss-500' : 'bg-paper-dim/40')} />
                    {output.name}
                    <span className="sr-only"> ({output.local ? labels.local : labels.server})</span>
                  </Link>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 text-[10px] leading-5 text-paper-dim/70">{labels.clickHint}</p>
    </div>
  );
}
