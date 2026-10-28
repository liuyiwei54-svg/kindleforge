'use client';

import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import { libraryCoverUrl } from '@/lib/client/library';
import { coverVariant } from '@/lib/client/library-utils';
import type { LibraryEntry } from '@/lib/shared/types';

const PLACEHOLDER_TONES = [
  'from-ink-700 via-ink-800 to-ink-950',
  'from-moss-700/70 via-ink-800 to-ink-950',
  'from-ink-700 via-ink-900 to-ink-950',
  'from-clay/25 via-ink-800 to-ink-950',
];

export function LibraryCover({
  entry,
  className,
  alt,
}: {
  entry: Pick<LibraryEntry, 'id' | 'title' | 'author' | 'hasCover' | 'coverVersion'>;
  className?: string;
  alt: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = entry.hasCover && !broken;

  return (
    <div
      className={cn(
        'relative flex aspect-[2/3] w-full items-center justify-center overflow-hidden rounded-xl border border-paper/12 bg-gradient-to-br',
        PLACEHOLDER_TONES[coverVariant(entry.title)] ?? PLACEHOLDER_TONES[0],
        className,
      )}
    >
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- cover bytes come from the local API
        <img
          src={libraryCoverUrl(entry)}
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col justify-between p-3">
          <span className="font-mono text-[0.55rem] tracking-[0.28em] text-paper-dim/60 uppercase">KindleForge</span>
          <div className="min-h-0">
            <BookOpen aria-hidden="true" className="mb-2 h-4 w-4 text-moss-500/80" />
            <p className="line-clamp-4 font-serif text-[0.95rem] leading-snug text-paper/90">{entry.title}</p>
            {entry.author ? <p className="mt-1.5 line-clamp-1 text-[0.68rem] text-paper-dim/80">{entry.author}</p> : null}
          </div>
          <span aria-hidden="true" className="h-px w-8 bg-paper/20" />
        </div>
      )}
      <span className="pointer-events-none absolute inset-y-0 left-0 w-[3px] bg-gradient-to-b from-transparent via-paper/25 to-transparent opacity-70" />
    </div>
  );
}
