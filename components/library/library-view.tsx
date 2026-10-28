'use client';

import {
  Download,
  FolderOpen,
  LayoutGrid,
  List,
  Loader2,
  Pencil,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ToastRegion, useToast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import { ApiError } from '@/lib/client/api';
import { formatBytes } from '@/lib/client/estimate';
import {
  deleteLibraryEntry,
  fetchLibrary,
  fetchLibraryStats,
  libraryFileUrl,
  revealLibraryEntry,
  sendLibraryEntry,
  type LibrarySort,
  type LibraryStats,
} from '@/lib/client/library';
import { canSendFormat, filterEntries, formatFacets, libraryStats, sortEntries } from '@/lib/client/library-utils';
import { fetchSettings } from '@/lib/client/settings';
import { fill, getDict, localePath, type Locale } from '@/lib/i18n';
import { formatName } from '@/lib/i18n/formats';
import type { FormatId } from '@/lib/engine/types';
import type { LibraryEntry } from '@/lib/shared/types';
import { EditBookDialog } from './edit-book-dialog';
import { LibraryCover } from './library-cover';

type Status = 'loading' | 'ready' | 'error';
type BusyAction = { id: string; type: 'send' } | null;

function dateLabel(timestamp: number | null, locale: Locale): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  // Short month + day keeps the narrow 390px stats card on a single line.
  if (locale === 'zh') return `${date.getMonth() + 1}月${date.getDate()}日`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(date);
}

function fullDate(timestamp: number | null): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function errorHint(error: unknown): string | undefined {
  if (error instanceof ApiError) return error.hint ?? error.message;
  if (error instanceof Error) return error.message;
  return undefined;
}

function IconAction({
  label,
  onClick,
  href,
  icon: Icon,
  disabled,
  spinning,
  tone = 'default',
}: {
  label: string;
  onClick?: () => void;
  href?: string;
  icon: typeof Download;
  disabled?: boolean;
  spinning?: boolean;
  tone?: 'default' | 'danger';
}) {
  const classes = cn(
    'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-paper-dim transition-colors',
    'hover:bg-paper/8 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
    'disabled:pointer-events-none disabled:opacity-40',
    tone === 'danger' && 'hover:bg-clay/10 hover:text-clay',
  );
  if (href) {
    return (
      <a href={href} aria-label={label} title={label} className={classes} download>
        <Icon aria-hidden="true" className={cn('h-4 w-4', spinning && 'animate-spin')} />
      </a>
    );
  }
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={classes}>
      <Icon aria-hidden="true" className={cn('h-4 w-4', spinning && 'animate-spin')} />
    </button>
  );
}

export function LibraryView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const router = useRouter();
  const settingsPath = `${localePath(locale, '/settings')}?focus=send`;

  const [status, setStatus] = useState<Status>('loading');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [dir, setDir] = useState('');
  const [facets, setFacets] = useState<Array<{ format: FormatId; count: number }>>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [statsKey, setStatsKey] = useState(0);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sort, setSort] = useState<LibrarySort>('added');
  const [format, setFormat] = useState<FormatId | null>(null);
  const [view, setView] = useState<'grid' | 'list'>('grid');

  const [smtp, setSmtp] = useState<{ configured: boolean; kindleEmail: string } | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [deleteTarget, setDeleteTarget] = useState<LibraryEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [editTarget, setEditTarget] = useState<LibraryEntry | null>(null);

  const { toast, show, hide } = useToast();
  const seq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let alive = true;
    fetchSettings()
      .then((settings) => {
        if (!alive) return;
        setSmtp({
          configured: Boolean(
            settings.send.smtp.host && settings.send.smtp.user && settings.send.smtp.hasPassword && settings.send.kindleEmail,
          ),
          kindleEmail: settings.send.kindleEmail,
        });
      })
      .catch(() => {
        if (alive) setSmtp({ configured: false, kindleEmail: '' });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const id = ++seq.current;
    let alive = true;
    setBusy(true);
    fetchLibrary({ q: debounced, sort, format })
      .then((list) => {
        if (!alive || id !== seq.current) return;
        setEntries(list.entries);
        setTotal(list.total);
        setDir(list.dir);
        setStatus('ready');
        if (!format) setFacets(formatFacets(list.entries));
      })
      .catch(() => {
        if (!alive || id !== seq.current) return;
        setStatus((current) => (current === 'loading' ? 'error' : current));
        show(dict.library.toasts.loadFailed, 'error');
      })
      .finally(() => {
        if (alive && id === seq.current) setBusy(false);
      });
    return () => {
      alive = false;
    };
    // `show` and `dict` are stable enough for this page; refetching only depends on the query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, sort, format]);

  useEffect(() => {
    let alive = true;
    fetchLibraryStats()
      .then((value) => {
        if (alive) setStats(value);
      })
      .catch(() => {
        // stats are decorative — the list response still gives a count
      });
    return () => {
      alive = false;
    };
  }, [statsKey]);

  const sorted = useMemo(() => sortEntries(entries, sort, locale), [entries, sort, locale]);
  const visible = useMemo(() => filterEntries(sorted, debounced), [sorted, debounced]);
  const overall = useMemo(() => {
    const derived = libraryStats(entries);
    return stats ?? { total, totalBytes: derived.totalBytes, latestAddedAt: derived.latestAddedAt, dir };
  }, [stats, entries, total, dir]);

  const hasFilters = Boolean(debounced) || format !== null;

  const retry = () => {
    setStatus('loading');
    setBusy(true);
    const id = ++seq.current;
    fetchLibrary({ q: debounced, sort, format })
      .then((list) => {
        if (id !== seq.current) return;
        setEntries(list.entries);
        setTotal(list.total);
        setDir(list.dir);
        setStatus('ready');
        if (!format) setFacets(formatFacets(list.entries));
      })
      .catch(() => setStatus('error'))
      .finally(() => setBusy(false));
  };

  const send = async (entry: LibraryEntry) => {
    if (!canSendFormat(entry.format)) {
      show(dict.library.send.unsupported, 'error');
      return;
    }
    if (!smtp?.configured) {
      show(dict.library.send.needSetup, 'error', dict.library.send.setupCta);
      router.push(settingsPath);
      return;
    }
    setBusyAction({ id: entry.id, type: 'send' });
    try {
      const result = await sendLibraryEntry(entry.id);
      const now = Date.now();
      setEntries((current) =>
        current.map((item) =>
          item.id === entry.id
            ? { ...item, sendCount: (item.sendCount ?? 0) + 1, lastSentAt: now, lastSendOk: true }
            : item,
        ),
      );
      const message = smtp.kindleEmail
        ? fill(dict.library.send.sent, { email: smtp.kindleEmail })
        : dict.library.send.sentGeneric;
      show(result.message || message, 'ok');
      setStatsKey((key) => key + 1);
    } catch (error) {
      show(dict.library.send.failed, 'error', errorHint(error));
    } finally {
      setBusyAction(null);
    }
  };

  const reveal = async (entry: LibraryEntry) => {
    try {
      await revealLibraryEntry(entry.id);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REVEAL_UNSUPPORTED') {
        show(dict.library.revealUnsupported, 'error');
      } else {
        show(dict.library.revealUnsupported, 'error', errorHint(error));
      }
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const target = deleteTarget;
    try {
      await deleteLibraryEntry(target.id);
      const remaining = entries.filter((entry) => entry.id !== target.id);
      setEntries(remaining);
      setTotal((value) => Math.max(0, value - 1));
      if (!format) setFacets(formatFacets(remaining));
      setDeleteTarget(null);
      setStatsKey((key) => key + 1);
      show(dict.library.toasts.deleted, 'ok');
    } catch (error) {
      show(dict.library.toasts.deleteFailed, 'error', errorHint(error));
    } finally {
      setDeleting(false);
    }
  };

  const onSaved = (updated: LibraryEntry) => {
    setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    show(dict.library.toasts.updated, 'ok');
  };

  const clearFilters = () => {
    setQuery('');
    setDebounced('');
    setFormat(null);
  };

  const closeLabel = locale === 'zh' ? '关闭通知' : 'Close notification';

  return (
    <>
      <section aria-labelledby="library-stats" className="mt-8">
        <h2 id="library-stats" className="sr-only">
          {dict.library.title}
        </h2>
        <dl className="grid grid-cols-3 gap-2 sm:gap-3">
          {[
            { key: 'books', value: String(overall.total), label: dict.library.stats.books },
            { key: 'size', value: formatBytes(overall.totalBytes), label: dict.library.stats.size },
            {
              key: 'latest',
              value: overall.latestAddedAt ? dateLabel(overall.latestAddedAt, locale) : dict.library.stats.none,
              label: dict.library.stats.latest,
            },
          ].map((item) => (
            <div key={item.key} className="rounded-2xl border border-paper/12 bg-ink-800/40 px-4 py-3">
              <dt className="font-mono text-[0.62rem] tracking-[0.16em] text-paper-dim/70 uppercase">{item.label}</dt>
              <dd className="mt-1 font-serif text-lg whitespace-nowrap text-paper sm:text-xl" title={item.key === 'latest' ? fullDate(overall.latestAddedAt) : undefined}>{item.value}</dd>
            </div>
          ))}
        </dl>
        {overall.dir ? (
          <p className="mt-3 flex items-center gap-2 truncate font-mono text-[0.68rem] text-paper-dim/70">
            <FolderOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-moss-500/80" />
            <span className="truncate" title={overall.dir}>
              {fill(dict.library.dir, { dir: overall.dir })}
            </span>
          </p>
        ) : null}
      </section>

      <div className="mt-6 rounded-[20px] border border-paper/12 bg-ink-800/50 p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
          <div className="flex-1">
            <label htmlFor="library-search" className="text-sm font-medium text-paper-dim">
              {dict.library.search.label}
            </label>
            <div className="relative mt-1.5">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-paper-dim" />
              <input
                id="library-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={dict.library.search.placeholder}
                className="w-full rounded-xl border border-paper/20 bg-ink-950/60 py-2.5 pr-10 pl-10 text-sm text-paper placeholder:text-paper-dim/60 transition-colors hover:border-paper/35 focus-visible:border-moss-500 focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  aria-label={dict.library.search.clear}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-1 text-paper-dim transition-colors hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
                >
                  <X aria-hidden="true" className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <Select
              label={dict.library.sort.label}
              hideLabel
              value={sort}
              onChange={(event) => setSort(event.target.value as LibrarySort)}
              wrapperClassName="w-40"
              className="rounded-xl"
            >
              <option value="added">{dict.library.sort.added}</option>
              <option value="title">{dict.library.sort.title}</option>
              <option value="author">{dict.library.sort.author}</option>
              <option value="size">{dict.library.sort.size}</option>
            </Select>

            <div
              role="group"
              aria-label={dict.library.view.label}
              className="inline-flex items-center rounded-full border border-paper/15 bg-ink-950/50 p-1"
            >
              <button
                type="button"
                aria-label={dict.library.view.grid}
                aria-pressed={view === 'grid'}
                onClick={() => setView('grid')}
                className={cn(
                  'rounded-full p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                  view === 'grid' ? 'bg-paper/10 text-paper' : 'text-paper-dim hover:text-paper',
                )}
              >
                <LayoutGrid aria-hidden="true" className="h-4 w-4" />
              </button>
              <button
                type="button"
                aria-label={dict.library.view.list}
                aria-pressed={view === 'list'}
                onClick={() => setView('list')}
                className={cn(
                  'rounded-full p-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                  view === 'list' ? 'bg-paper/10 text-paper' : 'text-paper-dim hover:text-paper',
                )}
              >
                <List aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="font-mono text-[0.62rem] tracking-[0.16em] text-paper-dim/60 uppercase">
            {dict.library.filter.label}
          </span>
          <button
            type="button"
            onClick={() => setFormat(null)}
            aria-pressed={format === null}
            className={cn(
              'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
              format === null
                ? 'border-moss-500/50 bg-moss-500/12 text-moss-400'
                : 'border-paper/15 text-paper-dim hover:border-paper/30 hover:text-paper',
            )}
          >
            {dict.library.filter.all}
          </button>
          {facets.map((facet) => (
            <button
              key={facet.format}
              type="button"
              onClick={() => setFormat(facet.format)}
              aria-pressed={format === facet.format}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none',
                format === facet.format
                  ? 'border-moss-500/50 bg-moss-500/12 text-moss-400'
                  : 'border-paper/15 text-paper-dim hover:border-paper/30 hover:text-paper',
              )}
            >
              {formatName(facet.format, locale)}
              <span className="ml-1 font-mono text-[0.62rem] opacity-70">{facet.count}</span>
            </button>
          ))}
        </div>
      </div>

      <p aria-live="polite" className="sr-only">
        {busy ? dict.library.loading : fill(dict.library.filtered, { n: visible.length })}
      </p>

      {status === 'loading' ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="rounded-2xl border border-paper/10 bg-ink-800/30 p-3">
              <div className="aspect-[2/3] w-full animate-pulse rounded-xl bg-paper/5" />
              <div className="mt-3 h-3 w-4/5 animate-pulse rounded bg-paper/5" />
              <div className="mt-2 h-2.5 w-1/2 animate-pulse rounded bg-paper/5" />
            </div>
          ))}
        </div>
      ) : status === 'error' ? (
        <div className="mt-6 rounded-[20px] border border-clay/30 bg-clay/5 p-6 text-center">
          <h2 className="font-serif text-xl text-paper">{dict.library.errorTitle}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-paper-dim">{dict.library.errorHint}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={retry}>
            {dict.library.retry}
          </Button>
        </div>
      ) : entries.length === 0 && !hasFilters ? (
        <div className="mt-6 rounded-[20px] border border-dashed border-paper/20 bg-ink-900/40 px-6 py-14 text-center">
          <p className="font-mono text-[0.62rem] tracking-[0.24em] text-moss-500 uppercase">{dict.library.eyebrow}</p>
          <h2 className="mt-3 font-serif text-2xl text-paper">{dict.library.empty.title}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-paper-dim">{dict.library.empty.sub}</p>
          <ButtonLink href={localePath(locale, '/convert')} className="mt-5">
            {dict.library.empty.cta}
          </ButtonLink>
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-6 rounded-[20px] border border-paper/12 bg-ink-900/40 px-6 py-12 text-center">
          <h2 className="font-serif text-xl text-paper">{dict.library.noMatch.title}</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-paper-dim">{dict.library.noMatch.sub}</p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={clearFilters}>
              {dict.library.noMatch.cta}
            </Button>
            <ButtonLink href={localePath(locale, '/convert')} size="sm">
              {dict.library.empty.cta}
            </ButtonLink>
          </div>
        </div>
      ) : view === 'grid' ? (
        <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {visible.map((entry) => {
            const sending = busyAction?.id === entry.id && busyAction.type === 'send';
            return (
              <li key={entry.id}>
                <article className="group flex h-full flex-col rounded-2xl border border-paper/12 bg-ink-800/40 p-3 transition-colors hover:border-paper/25">
                  <div className="relative">
                    <LibraryCover
                      entry={entry}
                      alt={fill(dict.library.coverAlt, { title: entry.title })}
                      className="shadow-[0_10px_30px_rgba(0,0,0,0.35)]"
                    />
                    {entry.missing ? (
                      <Badge tone="clay" className="absolute top-2 left-2">
                        {dict.library.missing}
                      </Badge>
                    ) : null}
                  </div>
                  <h3 className="mt-3 line-clamp-2 font-serif text-sm leading-snug text-paper" title={entry.title}>
                    {entry.title}
                  </h3>
                  <p className="mt-0.5 line-clamp-1 text-xs text-paper-dim">{entry.author || '—'}</p>
                  <div className="mt-auto flex items-center gap-1.5 pt-2 text-[0.65rem] text-paper-dim/80">
                    <Badge tone="muted" mono>
                      {formatName(entry.format, locale)}
                    </Badge>
                    <span className="font-mono">{formatBytes(entry.size)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-0 border-t border-paper/8 pt-2">
                    <IconAction
                      label={fill(dict.library.actions.download, { name: entry.filename })}
                      href={libraryFileUrl(entry.id)}
                      icon={Download}
                    />
                    <IconAction
                      label={fill(dict.library.actions.send, { title: entry.title })}
                      icon={sending ? Loader2 : Send}
                      onClick={() => send(entry)}
                      disabled={sending}
                      spinning={sending}
                    />
                    <IconAction
                      label={fill(dict.library.actions.edit, { title: entry.title })}
                      icon={Pencil}
                      onClick={() => setEditTarget(entry)}
                    />
                    <IconAction
                      label={fill(dict.library.actions.reveal, { title: entry.title })}
                      icon={FolderOpen}
                      onClick={() => reveal(entry)}
                    />
                    <IconAction
                      label={fill(dict.library.actions.delete, { title: entry.title })}
                      icon={Trash2}
                      onClick={() => setDeleteTarget(entry)}
                      tone="danger"
                    />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <ul className="mt-6 space-y-2">
          {visible.map((entry) => {
            const sending = busyAction?.id === entry.id && busyAction.type === 'send';
            return (
              <li
                key={entry.id}
                className="flex items-center gap-3 rounded-2xl border border-paper/12 bg-ink-800/40 p-3 transition-colors hover:border-paper/25"
              >
                <div className="w-11 shrink-0">
                  <LibraryCover entry={entry} alt={fill(dict.library.coverAlt, { title: entry.title })} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-serif text-sm text-paper" title={entry.title}>
                    {entry.title}
                  </h3>
                  <p className="truncate text-xs text-paper-dim">{entry.author || '—'}</p>
                  <div className="mt-1 flex items-center gap-2 text-[0.65rem] text-paper-dim/75">
                    <Badge tone="muted" mono>
                      {formatName(entry.format, locale)}
                    </Badge>
                    <span className="font-mono">{formatBytes(entry.size)}</span>
                    <span className="hidden font-mono sm:inline">{dateLabel(entry.addedAt, locale)}</span>
                    {entry.missing ? <span className="text-clay">{dict.library.missing}</span> : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <IconAction
                    label={fill(dict.library.actions.download, { name: entry.filename })}
                    href={libraryFileUrl(entry.id)}
                    icon={Download}
                  />
                  <IconAction
                    label={fill(dict.library.actions.send, { title: entry.title })}
                    icon={sending ? Loader2 : Send}
                    onClick={() => send(entry)}
                    disabled={sending}
                    spinning={sending}
                  />
                  <IconAction
                    label={fill(dict.library.actions.edit, { title: entry.title })}
                    icon={Pencil}
                    onClick={() => setEditTarget(entry)}
                  />
                  <IconAction
                    label={fill(dict.library.actions.reveal, { title: entry.title })}
                    icon={FolderOpen}
                    onClick={() => reveal(entry)}
                  />
                  <IconAction
                    label={fill(dict.library.actions.delete, { title: entry.title })}
                    icon={Trash2}
                    onClick={() => setDeleteTarget(entry)}
                    tone="danger"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {editTarget ? (
        <EditBookDialog
          key={editTarget.id}
          entry={editTarget}
          open
          locale={locale}
          onClose={() => setEditTarget(null)}
          onSaved={onSaved}
        />
      ) : null}

      <Dialog
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title={dict.library.deleteDialog.title}
        closeLabel={locale === 'zh' ? '关闭' : 'Close'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {dict.library.deleteDialog.cancel}
            </Button>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? dict.library.deleteDialog.working : dict.library.deleteDialog.confirm}
            </Button>
          </>
        }
      >
        <p className="text-sm leading-6 text-paper-dim">
          {deleteTarget ? fill(dict.library.deleteDialog.body, { title: deleteTarget.title }) : ''}
        </p>
      </Dialog>

      <ToastRegion toast={toast} onDismiss={hide} closeLabel={closeLabel} />
    </>
  );
}
