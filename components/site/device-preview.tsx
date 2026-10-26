'use client';

import { useState } from 'react';
import { cn } from '@/components/ui/cn';
import type { Dict } from '@/lib/i18n/types';

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-2 text-[11px] text-paper-dim">
        <span>{label}</span>
        <span className="font-mono text-[11px] text-moss-400 tabular-nums">
          {value}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1.5 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-paper/15 accent-moss-500"
      />
    </label>
  );
}

export function DevicePreview({ dict }: { dict: Dict['device'] }) {
  const [fontSize, setFontSize] = useState(17);
  const [lineHeight, setLineHeight] = useState(1.7);
  const [indent, setIndent] = useState(2);
  const [justify, setJustify] = useState(true);
  const [serif, setSerif] = useState(true);

  return (
    <div>
      <div className="mx-auto w-full max-w-[370px]">
        <div className="rounded-[24px] border border-paper/20 bg-ink-700 p-3 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.8)]">
          <div className="mb-2 flex items-center justify-between px-2 text-[9px] tracking-[0.22em] text-paper-dim/70 uppercase">
            <span>Kindle</span>
            <span className="inline-flex items-center gap-1 text-moss-400">
              <span aria-hidden="true" className="h-1 w-1 animate-pulse rounded-full bg-moss-500" />
              {dict.live}
            </span>
          </div>

          <div className="relative overflow-hidden rounded-[6px] bg-paper px-5 py-5 text-ink-950 sm:px-6">
            <div className="flex items-center justify-between border-b border-ink-950/15 pb-2 text-[9px] text-ink-950/60">
              <span className="max-w-[70%] truncate">{dict.sample.book}</span>
              <span>Kindle</span>
            </div>

            <div className="mt-4">
              <p className="text-[9px] tracking-[0.2em] text-ink-950/50 uppercase">{dict.sample.chapter}</p>
              <h3 className="mt-1 font-serif text-base leading-snug text-ink-950">{dict.sample.title}</h3>
            </div>

            <div
              className={cn('mt-3', serif ? 'font-serif' : 'font-sans')}
              style={{ fontSize: `${fontSize}px`, lineHeight, textAlign: justify ? 'justify' : 'left' }}
            >
              {dict.sample.paragraphs.map((paragraph) => (
                <p key={paragraph} style={{ textIndent: `${indent}em`, marginBottom: '0.7em' }}>
                  {paragraph}
                </p>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between border-t border-ink-950/15 pt-2 text-[9px] text-ink-950/60">
              <span>{Math.min(99, Math.round((fontSize + lineHeight * 10) * 1.7))}%</span>
              <span>{dict.sample.author}</span>
            </div>
          </div>

          <div aria-hidden="true" className="mx-auto mt-3 h-1 w-10 rounded-full bg-paper/20" />
        </div>

        <p className="mt-3 text-center text-[10px] leading-5 text-paper-dim/70">{dict.footnote}</p>
      </div>

      <div className="mt-5 rounded-[20px] border border-paper/12 bg-ink-800/60 p-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
          <RangeControl label={dict.controls.fontSize} value={fontSize} min={14} max={24} step={1} suffix="px" onChange={setFontSize} />
          <RangeControl
            label={dict.controls.lineHeight}
            value={lineHeight}
            min={1.4}
            max={2.2}
            step={0.1}
            onChange={setLineHeight}
          />
          <RangeControl label={dict.controls.indent} value={indent} min={0} max={3} step={0.5} suffix="em" onChange={setIndent} />
          <div className="flex flex-wrap items-end justify-between gap-2">
            <label className="block">
              <span className="block text-[11px] text-paper-dim">{dict.controls.fontFamily}</span>
              <select
                value={serif ? 'serif' : 'sans'}
                onChange={(event) => setSerif(event.target.value === 'serif')}
                className="mt-1.5 w-full rounded-full border border-paper/20 bg-ink-900 px-3 py-1.5 text-xs text-paper focus-visible:border-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              >
                <option value="serif">{dict.controls.serif}</option>
                <option value="sans">{dict.controls.sans}</option>
              </select>
            </label>

            <button
              type="button"
              role="switch"
              aria-checked={justify}
              onClick={() => setJustify((value) => !value)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                justify
                  ? 'border-moss-500/50 bg-moss-500/10 text-moss-400'
                  : 'border-paper/20 bg-ink-900 text-paper-dim',
              )}
            >
              {dict.controls.justify}: {justify ? dict.controls.on : dict.controls.off}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
