'use client';

import type { Dict } from '@/lib/i18n/types';
import type { KindleOptions } from '@/lib/engine/types';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

export interface TypographyState {
  indent: number;
  lineHeight: number;
  justify: boolean;
  fontFamily: NonNullable<KindleOptions['typography']>['fontFamily'];
}

export interface ExtraOptionsState {
  toc: boolean;
  cover: boolean;
  mangaMode: boolean;
}

export interface OcrChoice {
  enabled: boolean;
  language: string;
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-sm text-paper">{label}</span>
        <span className="font-mono text-xs text-moss-400 tabular-nums">
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
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-paper/15 accent-moss-500 disabled:cursor-not-allowed disabled:opacity-50"
      />
    </label>
  );
}

export function OptionsPanel({
  dict,
  typography,
  onTypography,
  extras,
  onExtras,
  ocr,
  ocrRelevant,
  onOcr,
  autoSave,
  onAutoSave,
  autoSaveHint,
  autoSaveDisabled,
  disabled,
}: {
  dict: Dict['convert']['options'];
  typography: TypographyState;
  onTypography: (next: TypographyState) => void;
  extras: ExtraOptionsState;
  onExtras: (next: ExtraOptionsState) => void;
  ocr: OcrChoice;
  ocrRelevant: boolean;
  onOcr: (next: OcrChoice) => void;
  autoSave: boolean;
  onAutoSave: (next: boolean) => void;
  autoSaveHint: string;
  autoSaveDisabled?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-[20px] border border-paper/12 bg-ink-800/60 p-4">
      <h3 className="font-serif text-base text-paper">{dict.title}</h3>

      <div className="mt-4 space-y-4">
        <Slider
          label={dict.indent}
          value={typography.indent}
          min={0}
          max={3}
          step={0.5}
          suffix={dict.indentUnit}
          disabled={disabled}
          onChange={(indent) => onTypography({ ...typography, indent })}
        />
        <Slider
          label={dict.lineHeight}
          value={typography.lineHeight}
          min={1.4}
          max={2.2}
          step={0.1}
          suffix=""
          disabled={disabled}
          onChange={(lineHeight) => onTypography({ ...typography, lineHeight })}
        />
        <Switch
          label={dict.justify}
          checked={typography.justify}
          onChange={(justify) => onTypography({ ...typography, justify })}
          disabled={disabled}
        />
        <Select
          label={dict.font}
          value={typography.fontFamily ?? 'serif'}
          disabled={disabled}
          onChange={(event) =>
            onTypography({
              ...typography,
              fontFamily: event.target.value as TypographyState['fontFamily'],
            })
          }
        >
          <option value="serif">{dict.fontSerif}</option>
          <option value="sans">{dict.fontSans}</option>
          <option value="default">{dict.fontDefault}</option>
        </Select>
      </div>

      <div className="mt-4 space-y-3 border-t border-paper/10 pt-4">
        <Switch
          label={dict.toc}
          checked={extras.toc}
          onChange={(toc) => onExtras({ ...extras, toc })}
          disabled={disabled}
        />
        <Switch
          label={dict.cover}
          checked={extras.cover}
          onChange={(cover) => onExtras({ ...extras, cover })}
          disabled={disabled}
        />
        <Switch
          label={dict.manga}
          checked={extras.mangaMode}
          onChange={(mangaMode) => onExtras({ ...extras, mangaMode })}
          disabled={disabled}
        />
      </div>

      <div className="mt-4 space-y-2 border-t border-paper/10 pt-4">
        <Switch
          label={dict.autoSave}
          checked={autoSave}
          onChange={onAutoSave}
          disabled={disabled || autoSaveDisabled}
        />
        <p className="text-[11px] leading-5 text-paper-dim/70">{autoSaveHint}</p>
      </div>

      <div className="mt-4 space-y-3 border-t border-paper/10 pt-4">
        <div>
          <p className="text-sm font-medium text-paper">{dict.ocrTitle}</p>
          <p className="mt-0.5 text-[11px] leading-5 text-paper-dim/70">{dict.ocrNote}</p>
        </div>
        <Switch
          label={dict.ocrToggle}
          checked={ocr.enabled}
          onChange={(enabled) => onOcr({ ...ocr, enabled })}
          disabled={disabled || !ocrRelevant}
        />
        <Select
          label={dict.ocrLanguage}
          value={ocr.language}
          disabled={disabled || !ocr.enabled}
          onChange={(event) => onOcr({ ...ocr, language: event.target.value })}
        >
          <option value="auto">{dict.ocrAuto}</option>
          <option value="chi_sim">{dict.ocrChiSim}</option>
          <option value="chi_tra">{dict.ocrChiTra}</option>
          <option value="eng">{dict.ocrEnglish}</option>
          <option value="jpn">{dict.ocrJapanese}</option>
          <option value="kor">{dict.ocrKorean}</option>
        </Select>
        {!ocrRelevant ? (
          <p className="text-[11px] leading-5 text-paper-dim/60">{dict.ocrUnavailable}</p>
        ) : null}
      </div>

      <p className="mt-4 border-t border-paper/10 pt-3 text-[11px] leading-5 text-paper-dim/70">{dict.note}</p>
    </div>
  );
}
