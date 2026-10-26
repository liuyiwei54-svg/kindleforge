'use client';

import { Loader2, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { cn } from '@/components/ui/cn';

export interface DropzoneProps {
  title: string;
  subtitle: string;
  browse: string;
  active: string;
  acceptNote: string;
  badge?: string;
  privacy?: string;
  disabled?: boolean;
  compact?: boolean;
  onFiles: (files: File[]) => void;
}

/** Shared accept list, generated from the engine's contract at module load. */
const ACCEPT =
  '.epub,.mobi,.azw,.azw3,.pdf,.docx,.odt,.txt,.md,.markdown,.html,.htm,.xhtml,.rtf,.fb2,.cbz,.cbr,.jpg,.jpeg,.png,.webp,.gif,.tif,.tiff';

export function Dropzone({
  title,
  subtitle,
  browse,
  active,
  acceptNote,
  badge,
  privacy,
  disabled,
  compact,
  onFiles,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const acceptId = useId();
  const hintId = useId();

  const openPicker = () => {
    if (!disabled) inputRef.current?.click();
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onFiles(Array.from(files));
  };

  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (disabled) return;
    dragDepth.current += 1;
    setDragging(true);
  };

  const onDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    if (disabled) return;
    handleFiles(event.dataTransfer.files);
  };

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'relative rounded-[20px] border border-dashed transition-colors duration-200',
        dragging ? 'border-moss-500 bg-moss-500/[0.06]' : 'border-paper/25 bg-ink-900/50 hover:border-paper/40',
        disabled && 'pointer-events-none opacity-60',
        compact ? 'p-4' : 'p-5 sm:p-7',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          handleFiles(event.target.files);
          event.target.value = '';
        }}
      />

      <button
        type="button"
        onClick={openPicker}
        aria-describedby={`${acceptId} ${hintId}`}
        className={cn(
          'flex w-full flex-col items-center justify-center gap-2 rounded-2xl px-2 text-center',
          'focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950 focus-visible:outline-none',
          compact ? 'py-3' : 'py-6 sm:py-8',
        )}
      >
        <span
          className={cn(
            'grid place-items-center rounded-full border border-moss-500/30 bg-moss-500/10 text-moss-500 transition-transform duration-200',
            compact ? 'h-9 w-9' : 'h-12 w-12',
            dragging && 'scale-105',
          )}
        >
          <Upload aria-hidden="true" className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
        </span>
        <span className={cn('font-serif text-paper', compact ? 'text-base' : 'text-lg sm:text-xl')}>
          {dragging ? active : title}
        </span>
        <span className="text-sm leading-6 text-paper-dim">{subtitle}</span>
        <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-paper/20 bg-paper/5 px-3.5 py-1.5 text-sm text-paper">
          <Upload aria-hidden="true" className="h-3.5 w-3.5 text-moss-500" />
          {browse}
        </span>
      </button>

      <p id={acceptId} className="mt-3 text-center text-[11px] leading-5 text-paper-dim/70">
        {acceptNote}
      </p>
      <p id={hintId} className="sr-only">
        {privacy ?? subtitle}
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        {badge ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-moss-500/30 bg-moss-500/10 px-2.5 py-0.5 text-[11px] text-moss-400">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-moss-500" />
            {badge}
          </span>
        ) : null}
        {privacy ? <span className="text-[11px] text-paper-dim/70">{privacy}</span> : null}
      </div>

      {dragging ? (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[20px] ring-1 ring-moss-500/50" />
      ) : null}
    </div>
  );
}

export function DropzoneBusy() {
  return (
    <div className="flex items-center justify-center gap-2 rounded-[20px] border border-paper/20 bg-ink-900/50 py-8 text-sm text-paper-dim">
      <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-moss-500" />
      …
    </div>
  );
}
