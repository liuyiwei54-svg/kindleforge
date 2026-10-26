'use client';

import {
  AlertTriangle,
  ArrowLeft,
  FileArchive,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Select } from '@/components/ui/select';
import { capabilities, DEVICES, formatOfFilename, OUTPUT_FORMATS } from '@/lib/engine/formats';
import type { DeviceId, FormatId, KindleOptions } from '@/lib/engine/types';
import { ApiError, cancelJob, downloadUrlFor, queueConversion, waitForJob } from '@/lib/client/api';
import { isLocalPair, loadCapabilities, pairOf, sharedOutputs } from '@/lib/client/capabilities';
import { downloadUrlFile, fetchAsUint8, saveBlob, saveZip } from '@/lib/client/download';
import { describeError, isAbortError, makeAbortError } from '@/lib/client/errors';
import { formatBytes, MAX_FILE_BYTES } from '@/lib/client/estimate';
import { localWorkerSupported, startLocalConversion } from '@/lib/client/local-convert';
import { clearRecent, readRecent, rememberRecent, timeAgo } from '@/lib/client/recent';
import type { ConversionOutput, FileItem, FormatCapabilities, RecentEntry } from '@/lib/client/types';
import { fill } from '@/lib/i18n/fill';
import { formatName } from '@/lib/i18n/formats';
import { localePath, type Locale } from '@/lib/i18n/paths';
import type { Dict } from '@/lib/i18n/types';
import { Dropzone } from './dropzone';
import { FileCard } from './file-card';
import { OptionsPanel, type ExtraOptionsState, type OcrChoice, type TypographyState } from './options-panel';

export interface WorkspaceProps {
  locale: Locale;
  dict: Dict['convert'];
  errors: Dict['errors'];
  initialFiles?: File[];
  initialTarget?: FormatId;
  /** Present when embedded on the landing / pair pages. */
  onCollapse?: () => void;
  /**
   * Standalone `/convert` page: the server shell renders the <h1>, so this
   * component must not render a second one. Embedded mode renders an <h2>.
   */
  standalone?: boolean;
}

const ACTIVE_STATUSES = new Set<FileItem['status']>(['preparing', 'uploading', 'running', 'local']);

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `file-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileKey(item: { name: string; size: number; file: File }): string {
  return `${item.name}:${item.size}:${item.file.lastModified}`;
}

function createItems(
  files: File[] | undefined,
  dict: Dict['convert'],
): { items: FileItem[]; rejected: string[] } {
  const items: FileItem[] = [];
  const rejected: string[] = [];
  for (const file of files ?? []) {
    const from = formatOfFilename(file.name);
    if (!from) {
      rejected.push(fill(dict.unsupportedFile, { name: file.name }));
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      rejected.push(fill(dict.tooLarge, { name: file.name }));
      continue;
    }
    items.push({
      id: makeId(),
      file,
      name: file.name,
      size: file.size,
      from,
      status: 'idle',
      progress: 0,
      mode: null,
    });
  }
  return { items, rejected };
}

export function Workspace({ locale, dict, errors, initialFiles, initialTarget, onCollapse, standalone }: WorkspaceProps) {
  const initialRef = useRef<{ items: FileItem[]; rejected: string[] } | null>(null);
  if (initialRef.current === null) initialRef.current = createItems(initialFiles, dict);

  const [items, setItems] = useState<FileItem[]>(initialRef.current.items);
  const [rejected, setRejected] = useState<string[]>(initialRef.current.rejected);
  const [caps, setCaps] = useState<FormatCapabilities>(() => ({ pairs: capabilities(), source: 'builtin' }));
  const [capsLoading, setCapsLoading] = useState(true);
  const [target, setTarget] = useState<FormatId>(initialTarget ?? 'epub');
  const [device, setDevice] = useState<DeviceId | undefined>(undefined);
  const [typography, setTypography] = useState<TypographyState>({
    indent: 2,
    lineHeight: 1.7,
    justify: true,
    fontFamily: 'serif',
  });
  const [extras, setExtras] = useState<ExtraOptionsState>({ toc: true, cover: true, mangaMode: false });
  const [ocr, setOcr] = useState<OcrChoice>({ enabled: false, language: 'auto' });
  const [running, setRunning] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);

  const itemsRef = useRef(items);
  const capsRef = useRef(caps);
  const canceledRef = useRef<Set<string>>(new Set());
  const stopRef = useRef(false);
  const activeRef = useRef<{ id: string; cancel: () => void } | null>(null);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    capsRef.current = caps;
  }, [caps]);

  useEffect(() => {
    setRecent(readRecent());
    // Deliberately not aborted on unmount: React StrictMode mounts twice in dev
    // and an aborted request shows up as net::ERR_ABORTED in the console.
    let alive = true;
    loadCapabilities().then((result) => {
      if (!alive) return;
      setCaps(result);
      setCapsLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const shared = items.length === 0 ? OUTPUT_FORMATS : sharedOutputs(caps.pairs, items.map((item) => item.from));
  const targetOptions = items.length === 1 ? shared.filter((format) => format !== items[0].from) : shared;
  const noCommonTarget = items.length > 0 && targetOptions.length === 0;
  const ocrRelevant = items.some((item) => item.from === 'pdf' || item.from === 'image');
  const pdfNeedsOcr = items.some((item) => item.from === 'pdf') && !ocr.enabled;

  useEffect(() => {
    if (items.length === 0 || targetOptions.length === 0) return;
    if (!targetOptions.includes(target)) setTarget(targetOptions[0]);
  }, [items.length, targetOptions, target]);

  const update = useCallback((id: string, patch: Partial<FileItem>) => {
    setItems((previous) => previous.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const buildOptions = useCallback((): KindleOptions => {
    return {
      device,
      typography: {
        indent: typography.indent,
        lineHeight: typography.lineHeight,
        justify: typography.justify,
        fontFamily: typography.fontFamily,
      },
      toc: extras.toc,
      cover: extras.cover,
      mangaMode: extras.mangaMode,
      ocr: ocrRelevant && ocr.enabled ? true : undefined,
      ocrLanguage:
        ocrRelevant && ocr.enabled ? (ocr.language === 'auto' ? 'chi_sim+eng' : ocr.language) : undefined,
    };
  }, [device, typography, extras, ocr, ocrRelevant]);

  const convertItem = useCallback(
    async (
      item: FileItem,
      itemTarget: FormatId,
      runOptions: KindleOptions,
    ): Promise<'done' | 'error' | 'canceled'> => {
      const capability = pairOf(capsRef.current.pairs, item.from, itemTarget);
      const canRunLocal = capability?.local === true && localWorkerSupported();

      if (canRunLocal) {
        update(item.id, {
          status: 'preparing',
          progress: 4,
          mode: 'local',
          error: undefined,
          result: undefined,
          notice: undefined,
        });
        try {
          const data = new Uint8Array(await item.file.arrayBuffer());
          if (canceledRef.current.has(item.id)) throw makeAbortError();
          update(item.id, { status: 'local', progress: 35 });
          const handle = startLocalConversion({ name: item.name, data, target: itemTarget, options: runOptions });
          activeRef.current = { id: item.id, cancel: () => handle.cancel() };
          const output = await handle.promise;
          activeRef.current = null;
          if (canceledRef.current.has(item.id)) throw makeAbortError();
          const result: ConversionOutput = {
            filename: output.filename,
            mime: output.mime,
            size: output.data.byteLength,
            engine: output.engine,
            warnings: output.warnings,
            data: output.data,
            book: output.book,
          };
          update(item.id, { status: 'done', progress: 100, mode: 'local', result, notice: undefined });
          setRecent(rememberRecent(itemTarget));
          return 'done';
        } catch (error) {
          activeRef.current = null;
          if (isAbortError(error) || canceledRef.current.has(item.id)) {
            update(item.id, { status: 'canceled', progress: 0 });
            return 'canceled';
          }
          const copy = describeError(error, errors);
          update(item.id, {
            notice: `${dict.fallback} [${copy.code}]`,
            mode: 'server',
            status: 'preparing',
            progress: 6,
          });
        }
      }

      const controller = new AbortController();
      const state: { id: string; jobId?: string; cancel: () => void } = {
        id: item.id,
        cancel() {
          controller.abort();
          if (state.jobId) void cancelJob(state.jobId);
        },
      };
      activeRef.current = state;

      try {
        update(item.id, {
          status: 'uploading',
          progress: 8,
          mode: 'server',
          error: undefined,
          result: undefined,
        });
        const jobId = await queueConversion(item.file, itemTarget, runOptions, controller.signal);
        state.jobId = jobId;
        if (canceledRef.current.has(item.id)) {
          void cancelJob(jobId);
          throw makeAbortError();
        }
        update(item.id, { jobId, status: 'running', progress: 12 });
        const job = await waitForJob(jobId, {
          signal: controller.signal,
          onUpdate: (nextJob) => {
            if (canceledRef.current.has(item.id)) return;
            update(item.id, { status: 'running', progress: Math.max(12, Math.round(nextJob.progress)) });
          },
        });
        if (canceledRef.current.has(item.id)) throw makeAbortError();
        if (job.status === 'error') throw new ApiError(job.error?.code ?? 'INTERNAL');
        if (!job.result) throw new ApiError('INTERNAL');
        const result: ConversionOutput = {
          filename: job.result.filename,
          size: job.result.size,
          mime: job.result.mime,
          downloadUrl: job.result.downloadUrl ?? downloadUrlFor(jobId),
          engine: job.engine ?? 'builtin',
          warnings: job.warnings ?? [],
        };
        update(item.id, { status: 'done', progress: 100, mode: 'server', result, notice: undefined });
        setRecent(rememberRecent(itemTarget));
        return 'done';
      } catch (error) {
        if (isAbortError(error) || canceledRef.current.has(item.id)) {
          update(item.id, { status: 'canceled', progress: 0 });
          return 'canceled';
        }
        update(item.id, { status: 'error', progress: 0, error: describeError(error, errors) });
        return 'error';
      } finally {
        if (activeRef.current?.id === item.id) activeRef.current = null;
      }
    },
    [dict.fallback, errors, update],
  );

  const start = useCallback(async () => {
    if (running) return;
    const snapshotItems = itemsRef.current;
    if (snapshotItems.length === 0) {
      setAnnouncement(dict.noFiles);
      return;
    }
    if (targetOptions.length === 0) {
      setAnnouncement(dict.target.noCommonTarget);
      return;
    }
    const pending = snapshotItems.filter((item) => item.status !== 'done' && item.status !== 'canceled');
    if (pending.length === 0) {
      setAnnouncement(dict.allDone);
      return;
    }

    setRunning(true);
    setActionError(null);
    setAnnouncement(dict.starting);
    canceledRef.current.clear();
    stopRef.current = false;
    const runOptions = buildOptions();
    let doneCount = 0;
    let failedCount = 0;
    let canceledCount = 0;

    for (const snapshot of pending) {
      if (stopRef.current) break;
      if (canceledRef.current.has(snapshot.id)) continue;
      const current = itemsRef.current.find((item) => item.id === snapshot.id);
      if (!current || current.status === 'done' || current.status === 'canceled') continue;
      const outcome = await convertItem(current, target, runOptions);
      if (outcome === 'done') doneCount += 1;
      if (outcome === 'error') failedCount += 1;
      if (outcome === 'canceled') canceledCount += 1;
    }

    setRunning(false);
    if (stopRef.current) {
      setAnnouncement(dict.status.canceled);
    } else if (doneCount === 0 && failedCount === 0 && canceledCount > 0) {
      setAnnouncement(dict.status.canceled);
    } else if (failedCount > 0 || canceledCount > 0) {
      setAnnouncement(fill(dict.partialDone, { done: doneCount, failed: failedCount }));
    } else {
      setAnnouncement(dict.allDone);
    }
  }, [buildOptions, convertItem, dict, running, target, targetOptions.length]);

  const cancelAll = useCallback(() => {
    stopRef.current = true;
    activeRef.current?.cancel();
    itemsRef.current.forEach((item) => {
      if (ACTIVE_STATUSES.has(item.status)) canceledRef.current.add(item.id);
    });
    setItems((previous) =>
      previous.map((item) => (ACTIVE_STATUSES.has(item.status) ? { ...item, status: 'canceled', progress: 0 } : item)),
    );
    setAnnouncement(dict.status.canceled);
  }, [dict.status.canceled]);

  const cancelItem = useCallback((id: string) => {
    canceledRef.current.add(id);
    if (activeRef.current?.id === id) activeRef.current.cancel();
    setItems((previous) =>
      previous.map((item) => (item.id === id ? { ...item, status: 'canceled', progress: 0 } : item)),
    );
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      const { items: created, rejected: issues } = createItems(files, dict);
      const keys = new Set(itemsRef.current.map(fileKey));
      const fresh: FileItem[] = [];
      for (const item of created) {
        const key = fileKey(item);
        if (keys.has(key)) {
          issues.push(fill(dict.duplicate, { name: item.name }));
          continue;
        }
        keys.add(key);
        fresh.push(item);
      }
      setRejected(issues);
      if (fresh.length > 0) setItems((previous) => [...previous, ...fresh]);
    },
    [dict],
  );

  const removeItem = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id));
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setRejected([]);
    setActionError(null);
    setAnnouncement('');
    canceledRef.current.clear();
    stopRef.current = false;
  }, []);

  const retryItem = useCallback(
    async (item: FileItem) => {
      if (running) return;
      canceledRef.current.delete(item.id);
      const fresh: FileItem = {
        ...item,
        status: 'idle',
        progress: 0,
        error: undefined,
        result: undefined,
        notice: undefined,
        mode: null,
      };
      setItems((previous) => previous.map((entry) => (entry.id === item.id ? fresh : entry)));
      setRunning(true);
      const outcome = await convertItem(fresh, target, buildOptions());
      setRunning(false);
      setAnnouncement(outcome === 'error' ? dict.errorTitle : dict.allDone);
    },
    [buildOptions, convertItem, dict.allDone, dict.errorTitle, running, target],
  );

  const completed = items.filter((item) => item.status === 'done' && item.result);
  const doneCount = completed.length;
  const failedCount = items.filter((item) => item.status === 'error').length;
  const allDone = items.length > 0 && items.every((item) => item.status === 'done');

  const downloadItem = useCallback((item: FileItem) => {
    const result = item.result;
    if (!result) return;
    if (result.data) {
      saveBlob(result.data, result.filename, result.mime);
    } else if (result.downloadUrl) {
      downloadUrlFile(result.downloadUrl, result.filename);
    }
  }, []);

  const downloadZip = useCallback(async () => {
    if (zipping || completed.length === 0) return;
    setZipping(true);
    setActionError(null);
    try {
      const entries = await Promise.all(
        completed.map(async (item) => {
          const result = item.result;
          if (!result) throw new Error('missing result');
          if (result.data) return { name: result.filename, data: result.data };
          const url = result.downloadUrl ?? (item.jobId ? downloadUrlFor(item.jobId) : null);
          if (!url) throw new Error('missing download url');
          return { name: result.filename, data: await fetchAsUint8(url) };
        }),
      );
      await saveZip(entries);
      setAnnouncement(dict.zip);
    } catch {
      setActionError(dict.zipError);
    } finally {
      setZipping(false);
    }
  }, [completed, dict.zip, dict.zipError, zipping]);

  const chooseDevice = (id: DeviceId) => {
    setDevice(id);
    const profile = DEVICES.find((entry) => entry.id === id);
    if (profile && (items.length === 0 || targetOptions.includes(profile.format))) {
      setTarget(profile.format);
    }
  };

  const localForTarget = items.length > 0 && items.every((item) => isLocalPair(caps.pairs, item.from, target));
  const startDisabled =
    running || items.length === 0 || targetOptions.length === 0 || items.every((item) => item.status === 'done');

  return (
    <section
      aria-labelledby="workspace-title"
      className={cn(
        onCollapse
          ? 'mt-6'
          : standalone
            ? 'mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8 md:pb-14'
            : 'mx-auto w-full max-w-6xl px-5 py-10 sm:px-8 md:py-14',
      )}
    >
      {standalone ? null : (
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="moss">{locale === 'zh' ? '工作台' : 'Workspace'}</Badge>
            <Badge tone="paper">{caps.source === 'api' ? dict.matrixLive : dict.matrixBuiltin}</Badge>
            <Badge tone="paper">{dict.privacyBadge}</Badge>
          </div>
          <h2 id="workspace-title" className="mt-3 font-serif text-2xl leading-snug text-paper sm:text-3xl">
            {dict.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-7 text-paper-dim">{dict.sub}</p>
        </div>
        <div className="flex items-center gap-2">
          {onCollapse ? (
            <Button variant="ghost" size="sm" onClick={onCollapse} aria-label={dict.collapse}>
              <X aria-hidden="true" className="h-4 w-4" />
              {dict.collapse}
            </Button>
          ) : (
            <Link
              href={localePath(locale, '/')}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-sm text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              {dict.backHome}
            </Link>
          )}
        </div>
      </div>
      )}

      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          <Dropzone
            title={dict.files.dropTitle}
            subtitle={dict.files.dropSubtitle}
            browse={dict.files.browse}
            active={dict.files.dropActive}
            acceptNote={dict.files.acceptNote}
            privacy={dict.privacyBadge}
            compact={items.length > 0}
            disabled={running}
            onFiles={addFiles}
          />

          {pdfNeedsOcr ? (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-moss-500/25 bg-moss-500/[0.05] px-3.5 py-2.5">
              <p className="text-[11px] leading-5 text-paper-dim">{dict.options.ocrHint}</p>
              <Button size="sm" variant="secondary" onClick={() => setOcr((previous) => ({ ...previous, enabled: true }))} disabled={running}>
                {dict.options.ocrEnable}
              </Button>
            </div>
          ) : null}

          {rejected.length > 0 ? (
            <div role="alert" className="rounded-2xl border border-clay/35 bg-clay/[0.08] p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-clay">
                <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5" />
                {dict.errorTitle}
              </p>
              <ul className="mt-1 space-y-1 pl-5 text-[11px] leading-5 text-paper-dim">
                {rejected.map((message) => (
                  <li key={message} className="list-disc">
                    {message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {items.length > 0 ? (
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-paper">
                  {dict.files.title}{' '}
                  <span className="text-paper-dim">· {fill(dict.files.count, { n: items.length })}</span>
                </h2>
                <div className="flex items-center gap-2">
                  {running ? (
                    <Button variant="secondary" size="sm" onClick={cancelAll}>
                      {dict.cancelAll}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => void start()} disabled={startDisabled}>
                      <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
                      {dict.start}
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={reset} disabled={running}>
                    {dict.files.clear}
                  </Button>
                </div>
              </div>
              <ul className="space-y-2" aria-label={dict.aria.listLabel}>
                {items.map((item) => (
                  <li key={item.id}>
                    <FileCard
                      item={item}
                      target={target}
                      dict={dict}
                      locale={locale}
                      disabled={running}
                      onRemove={() => removeItem(item.id)}
                      onCancel={() => cancelItem(item.id)}
                      onDownload={() => downloadItem(item)}
                      onRetry={() => void retryItem(item)}
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

        </div>

        <aside className="space-y-4">
          <div className="rounded-[20px] border border-paper/12 bg-ink-800/60 p-4">
            <Select
              label={dict.target.label}
              value={target}
              disabled={running || targetOptions.length === 0}
              onChange={(event) => setTarget(event.target.value as FormatId)}
              hint={
                noCommonTarget
                  ? dict.target.noCommonTarget
                  : items.length === 0
                    ? dict.target.hint
                    : localForTarget
                      ? dict.target.localHint
                      : dict.target.hint
              }
            >
              {targetOptions.map((format) => {
                const allLocal = items.length > 0 && items.every((item) => isLocalPair(caps.pairs, item.from, format));
                return (
                  <option key={format} value={format}>
                    {formatName(format, locale)}
                    {allLocal ? ` · ${dict.target.localOption}` : ''}
                  </option>
                );
              })}
            </Select>

            {capsLoading ? null : caps.source === 'builtin' ? (
              <p className="mt-2 text-[11px] leading-5 text-clay">{dict.loadError}</p>
            ) : null}
          </div>

          <fieldset className="rounded-[20px] border border-paper/12 bg-ink-800/60 p-4">
            <legend className="px-1 text-sm font-medium text-paper">{dict.device.label}</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DEVICES.map((profile) => (
                <label key={profile.id} className="relative cursor-pointer">
                  <input
                    type="radio"
                    name="kindle-device"
                    value={profile.id}
                    checked={device === profile.id}
                    disabled={running}
                    onChange={() => chooseDevice(profile.id)}
                    className="peer sr-only"
                  />
                  <span className="block h-full rounded-xl border border-paper/15 bg-ink-900 px-2.5 py-2 text-[11px] leading-4 transition-colors peer-checked:border-moss-500 peer-checked:bg-moss-500/10 peer-focus-visible:ring-2 peer-focus-visible:ring-moss-500 peer-focus-visible:outline-none peer-disabled:opacity-50">
                    <span className="block text-paper">{profile.label[locale]}</span>
                    <span className="mt-0.5 block text-paper-dim/70">{profile.hint[locale]}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-paper-dim/70">{dict.device.hint}</p>
          </fieldset>

          <OptionsPanel
            dict={dict.options}
            typography={typography}
            onTypography={setTypography}
            extras={extras}
            onExtras={setExtras}
            ocr={ocr}
            ocrRelevant={ocrRelevant}
            onOcr={setOcr}
            disabled={running}
          />

          <div className="rounded-[20px] border border-paper/12 bg-ink-800/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => void start()} disabled={startDisabled} size="md">
                {running ? (
                  <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles aria-hidden="true" className="h-4 w-4" />
                )}
                {running ? dict.starting : dict.start}
              </Button>

              {running ? (
                <Button variant="secondary" onClick={cancelAll}>
                  {dict.cancelAll}
                </Button>
              ) : null}

              {completed.length > 0 ? (
                <Button variant="secondary" onClick={() => void downloadZip()} disabled={zipping}>
                  {zipping ? (
                    <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                  ) : (
                    <FileArchive aria-hidden="true" className="h-4 w-4" />
                  )}
                  {completed.length > 1 ? fill(dict.zip, { n: completed.length }) : dict.zipEmpty}
                </Button>
              ) : null}

              {!running && doneCount > 0 ? (
                <Button variant="ghost" onClick={reset}>
                  <RefreshCw aria-hidden="true" className="h-4 w-4" />
                  {dict.again}
                </Button>
              ) : null}
            </div>

            {!running && (doneCount > 0 || failedCount > 0) ? (
              <p className="mt-2 text-xs text-paper-dim">
                {failedCount > 0 ? fill(dict.partialDone, { done: doneCount, failed: failedCount }) : dict.allDone}
              </p>
            ) : null}

            {actionError ? (
              <p role="alert" className="mt-2 rounded-xl border border-clay/35 bg-clay/[0.08] px-3 py-2 text-xs text-clay">
                {actionError}
              </p>
            ) : null}

            <p className="mt-2 text-[11px] leading-5 text-paper-dim/70">{dict.limits}</p>
          </div>

          <div className="rounded-[20px] border border-paper/12 bg-ink-800/40 p-4">
            <p className="flex items-center gap-1.5 text-[11px] text-moss-400">
              <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5" />
              {dict.localBadge}
            </p>
            <p className="mt-1.5 text-[11px] leading-5 text-paper-dim/70">{dict.recent.note}</p>
          </div>

          {recent.length > 0 ? (
            <div className="rounded-[20px] border border-paper/12 bg-ink-800/40 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-paper">{dict.recent.label}</h2>
                <button
                  type="button"
                  onClick={() => setRecent(clearRecent())}
                  className="rounded-full px-2 py-1 text-[11px] text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  {dict.recent.clear}
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {recent.map((entry) => (
                  <li key={`${entry.to}-${entry.at}`} className="text-[11px] text-paper-dim">
                    {fill(dict.recent.entry, {
                      format: formatName(entry.to, locale),
                      time: timeAgo(entry.at, dict.recent),
                    })}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] leading-5 text-paper-dim/60">{dict.recent.note}</p>
            </div>
          ) : null}

          <div className="rounded-[20px] border border-paper/12 bg-ink-800/40 p-4">
            <h2 className="text-sm font-medium text-paper">{dict.tips.title}</h2>
            <ul className="mt-2 space-y-1.5 pl-4 text-[11px] leading-5 text-paper-dim/80">
              {dict.tips.items.map((tip) => (
                <li key={tip} className="list-disc">
                  {tip}
                </li>
              ))}
            </ul>
            <p className="mt-3 border-t border-paper/10 pt-2 text-[11px] text-paper-dim/60">
              {formatBytes(MAX_FILE_BYTES)} · {allDone ? dict.allDone : dict.limits}
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}
