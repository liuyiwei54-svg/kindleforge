'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useState } from 'react';
import type { FormatId } from '@/lib/engine/types';
import { localePath, type Locale } from '@/lib/i18n/paths';
import type { Dict } from '@/lib/i18n/types';
import { Dropzone } from './dropzone';

const Workspace = dynamic(() => import('./workspace').then((module) => module.Workspace), {
  ssr: false,
  loading: () => (
    <div className="mt-6 h-64 animate-pulse rounded-[20px] border border-paper/10 bg-ink-800/40" aria-busy="true" />
  ),
});

export interface UploadLauncherProps {
  locale: Locale;
  convertDict: Dict['convert'];
  errors: Dict['errors'];
  dropzone: {
    title: string;
    subtitle: string;
    browse: string;
    active: string;
    acceptNote: string;
    badge?: string;
    privacy?: string;
  };
  hint?: string;
  initialTarget?: FormatId;
  fullConvertLabel: string;
}

/**
 * Hero / pair-page upload area. Files stay in React memory (never a URL, never
 * sessionStorage), and the workspace expands in place once something is picked.
 */
export function UploadLauncher({
  locale,
  convertDict,
  errors,
  dropzone,
  hint,
  initialTarget,
  fullConvertLabel,
}: UploadLauncherProps) {
  const [files, setFiles] = useState<File[] | null>(null);

  if (files && files.length > 0) {
    return (
      <Workspace
        locale={locale}
        dict={convertDict}
        errors={errors}
        initialFiles={files}
        initialTarget={initialTarget}
        onCollapse={() => setFiles(null)}
      />
    );
  }

  return (
    <div>
      <Dropzone
        title={dropzone.title}
        subtitle={dropzone.subtitle}
        browse={dropzone.browse}
        active={dropzone.active}
        acceptNote={dropzone.acceptNote}
        badge={dropzone.badge}
        privacy={dropzone.privacy}
        onFiles={(next) => setFiles(next)}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {hint ? <p className="text-[11px] leading-5 text-paper-dim/70">{hint}</p> : <span />}
        <Link
          href={localePath(locale, '/convert')}
          className="inline-flex items-center gap-1 rounded-full px-1.5 py-1 text-[11px] text-paper-dim transition-colors hover:text-moss-400 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
        >
          {fullConvertLabel}
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}
