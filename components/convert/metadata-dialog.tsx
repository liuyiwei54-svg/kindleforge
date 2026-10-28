'use client';

import { BookOpen, Check, Loader2, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/components/ui/cn';
import { guessBookInfo, metadataCoverProxyUrl, searchMetadata } from '@/lib/client/metadata';
import type { FileMetadata } from '@/lib/client/types';
import { fill } from '@/lib/i18n/fill';
import { getDict, type Locale } from '@/lib/i18n';
import type { MetadataCandidate } from '@/lib/shared/types';

function CandidateCover({ url, title, alt }: { url?: string; title: string; alt: string }) {
  const [broken, setBroken] = useState(false);
  const src = url ? metadataCoverProxyUrl(url) : undefined;
  return (
    <span className="grid h-14 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-paper/15 bg-gradient-to-br from-ink-700 via-ink-800 to-ink-950">
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          title={title}
          referrerPolicy="no-referrer"
          loading="lazy"
          className="h-full w-full object-cover"
          onError={() => setBroken(true)}
        />
      ) : (
        <BookOpen aria-hidden="true" className="h-4 w-4 text-paper-dim/50" />
      )}
    </span>
  );
}

export interface AppliedMetadata {
  metadata: FileMetadata;
  isbn?: string;
}

export function MetadataDialog({
  open,
  onClose,
  locale,
  filename,
  initial,
  onApply,
}: {
  open: boolean;
  onClose: () => void;
  locale: Locale;
  filename: string;
  initial?: { metadata?: FileMetadata; isbn?: string };
  onApply: (value: AppliedMetadata) => void;
}) {
  const dict = getDict(locale);
  const copy = dict.metadata;
  const providerNames = dict.settings.metadata;
  const guessed = useRef(guessBookInfo(filename));
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [candidates, setCandidates] = useState<MetadataCandidate[]>([]);
  const [reason, setReason] = useState<'offline' | 'disabled' | 'empty' | 'error' | null>(null);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<MetadataCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(initial?.metadata?.title ?? guessed.current.title);
    setAuthor(initial?.metadata?.author ?? guessed.current.author ?? '');
    setIsbn(initial?.isbn ?? '');
    setCandidates([]);
    setSelected(null);
    setReason(null);
    setError(null);
    setTouched(false);

    const query = guessed.current.title;
    if (!query || /^[a-f0-9-]{16,}$/i.test(query)) return;
    let alive = true;
    setSearching(true);
    searchMetadata({ title: query, author: guessed.current.author })
      .then((result) => {
        if (!alive) return;
        setCandidates(result.candidates);
        if (!result.ok) setReason(result.reason === 'disabled' ? 'disabled' : 'offline');
        else if (result.candidates.length === 0) setReason('empty');
      })
      .catch(() => {
        if (!alive) return;
        setReason('offline');
      })
      .finally(() => {
        if (alive) setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [open, initial?.metadata?.title, initial?.metadata?.author, initial?.isbn]);

  const search = async () => {
    const query = title.trim() || author.trim() || isbn.trim();
    if (!query) return;
    setSearching(true);
    setReason(null);
    setError(null);
    try {
      const result = await searchMetadata({ q: query, isbn: isbn.trim() || undefined });
      setCandidates(result.candidates);
      if (!result.ok) setReason(result.reason === 'disabled' ? 'disabled' : 'offline');
      else if (result.candidates.length === 0) setReason('empty');
    } catch (cause) {
      setCandidates([]);
      setReason('error');
      setError(cause instanceof Error ? cause.message : null);
    } finally {
      setSearching(false);
    }
  };

  const choose = (candidate: MetadataCandidate) => {
    setSelected(candidate);
    setTitle(candidate.title);
    setAuthor(candidate.author ?? '');
    if (candidate.isbn) setIsbn(candidate.isbn);
  };

  const apply = () => {
    setTouched(true);
    if (!title.trim()) {
      setError(copy.titleRequired);
      return;
    }
    onApply({
      metadata: {
        title: title.trim(),
        author: author.trim() || undefined,
        language: selected?.language || undefined,
        publisher: selected?.publisher || undefined,
        description: selected?.description || undefined,
        ...(selected?.coverUrl ? { coverUrl: selected.coverUrl } : {}),
      },
      isbn: isbn.trim() || undefined,
    });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.sub}
      size="lg"
      closeLabel={copy.cancel}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {copy.cancel}
          </Button>
          <Button onClick={apply} disabled={searching && candidates.length === 0}>
            <Check aria-hidden="true" className="h-4 w-4" />
            {copy.apply}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Input
            label={copy.searchLabel}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={copy.searchPlaceholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void search();
              }
            }}
            wrapperClassName="flex-1"
          />
          <Button variant="secondary" onClick={() => void search()} disabled={searching} className="sm:mb-0">
            {searching ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Search aria-hidden="true" className="h-4 w-4" />}
            {searching ? copy.searching : copy.search}
          </Button>
        </div>

        {guessed.current.title && guessed.current.title !== title ? (
          <p className="-mt-2 text-[11px] leading-5 text-paper-dim/70">{copy.guessTitle}</p>
        ) : null}

        {reason ? (
          <p className="rounded-xl border border-paper/12 bg-ink-950/40 px-3 py-2 text-xs leading-5 text-paper-dim">
            {reason === 'disabled' ? copy.disabled : reason === 'empty' ? copy.noResults : reason === 'error' ? copy.searchFailed : copy.offline}
          </p>
        ) : null}

        {candidates.length > 0 ? (
          <div>
            <p className="text-[11px] font-medium tracking-wide text-paper-dim uppercase">{copy.results}</p>
            <ul className="mt-2 space-y-2">
              {candidates.map((candidate, index) => {
                const active = selected === candidate;
                return (
                  <li key={`${candidate.provider}-${candidate.providerId ?? index}`}>
                    <button
                      type="button"
                      onClick={() => choose(candidate)}
                      aria-pressed={active}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                        active
                          ? 'border-moss-500/60 bg-moss-500/10'
                          : 'border-paper/12 bg-ink-950/30 hover:border-paper/25 hover:bg-paper/[0.03]',
                      )}
                    >
                      <CandidateCover
                        url={candidate.coverUrl}
                        title={candidate.title}
                        alt={fill(copy.coverAlt, { title: candidate.title })}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-paper">{candidate.title}</span>
                        <span className="mt-0.5 block text-xs text-paper-dim">
                          {[candidate.author, candidate.publisher, candidate.publishedAt?.slice(0, 4)].filter(Boolean).join(' · ')}
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge tone="paper" mono>
                            {fill(copy.provider, {
                              provider:
                                candidate.provider === 'douban'
                                  ? providerNames.providerDouban
                                  : candidate.provider === 'google'
                                    ? providerNames.providerGoogle
                                    : providerNames.providerOpenLibrary,
                            })}
                          </Badge>
                          {active ? (
                            <Badge tone="moss" className="gap-1">
                              <Check aria-hidden="true" className="h-3 w-3" />
                              {copy.selected}
                            </Badge>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label={copy.fields.title}
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
              setTouched(false);
            }}
            error={touched && !title.trim() ? error ?? copy.titleRequired : undefined}
            wrapperClassName="sm:col-span-3"
          />
          <Input label={copy.fields.author} value={author} onChange={(event) => setAuthor(event.target.value)} wrapperClassName="sm:col-span-2" />
          <Input label={copy.fields.isbn} value={isbn} onChange={(event) => setIsbn(event.target.value)} inputMode="numeric" />
        </div>

        <p className="text-[11px] leading-5 text-paper-dim/70">{copy.note}</p>
        {touched && error ? (
          <p role="alert" className="text-xs text-clay">
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
