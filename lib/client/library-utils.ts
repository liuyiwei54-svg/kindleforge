import type { FormatId } from '@/lib/engine/types';
import type { LibraryEntry, MetadataPatch, MetadataProvider, Settings, SettingsPatch } from '@/lib/shared/types';
import type { Locale } from '@/lib/i18n';
import type { LibrarySort } from './library';

/** Formats Amazon's Send to Kindle accepts over email. */
export const SENDABLE_FORMATS: FormatId[] = ['epub', 'pdf', 'docx', 'txt'];

export function canSendFormat(format: FormatId): boolean {
  return SENDABLE_FORMATS.includes(format);
}

export function matchesQuery(entry: LibraryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [entry.title, entry.author, entry.filename, entry.isbn, entry.publisher]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function filterEntries(entries: LibraryEntry[], query: string): LibraryEntry[] {
  return entries.filter((entry) => matchesQuery(entry, query));
}

export function sortEntries(entries: LibraryEntry[], sort: LibrarySort, locale: Locale = 'en'): LibraryEntry[] {
  const collator = new Intl.Collator(locale === 'zh' ? 'zh-Hans' : 'en', { numeric: true, sensitivity: 'base' });
  const copy = [...entries];
  switch (sort) {
    case 'title':
      return copy.sort((a, b) => collator.compare(a.title, b.title));
    case 'author':
      return copy.sort(
        (a, b) => collator.compare(a.author, b.author) || collator.compare(a.title, b.title),
      );
    case 'size':
      return copy.sort((a, b) => b.size - a.size);
    case 'added':
    default:
      return copy.sort((a, b) => b.addedAt - a.addedAt);
  }
}

export function libraryStats(entries: LibraryEntry[]): { totalBytes: number; latestAddedAt: number | null } {
  let totalBytes = 0;
  let latestAddedAt: number | null = null;
  for (const entry of entries) {
    totalBytes += entry.size;
    if (latestAddedAt === null || entry.addedAt > latestAddedAt) latestAddedAt = entry.addedAt;
  }
  return { totalBytes, latestAddedAt };
}

export function formatFacets(entries: LibraryEntry[]): Array<{ format: FormatId; count: number }> {
  const counts = new Map<FormatId, number>();
  for (const entry of entries) counts.set(entry.format, (counts.get(entry.format) ?? 0) + 1);
  return [...counts.entries()]
    .map(([format, count]) => ({ format, count }))
    .sort((a, b) => b.count - a.count || a.format.localeCompare(b.format));
}

/** Stable 0–3 variant used by the generated cover placeholder. */
export function coverVariant(title: string): number {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) {
    hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  }
  return hash % 4;
}

/**
 * Only send fields that actually differ from the saved entry: ISBN plus the
 * candidate cover URL (the backend downloads it and rewrites the EPUB).
 */
export function libraryMetadataPatch(
  entry: Pick<LibraryEntry, 'isbn' | 'hasCover'>,
  values: { isbn?: string; coverUrl?: string },
): MetadataPatch {
  const patch: MetadataPatch = {};
  if (values.isbn && entry.isbn !== values.isbn) patch.isbn = values.isbn;
  if (values.coverUrl && !entry.hasCover) patch.coverUrl = values.coverUrl;
  return patch;
}

export function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}

export interface SettingsForm {
  dir: string;
  autoSave: boolean;
  metadataEnabled: boolean;
  providers: MetadataProvider[];
  metadataLanguage: 'auto' | 'zh' | 'en';
  host: string;
  port: string;
  secure: boolean;
  user: string;
  from: string;
  password: string;
  clearPassword: boolean;
  kindleEmail: string;
  maxAttachmentMb: string;
}

export function formFromSettings(settings: Settings): SettingsForm {
  return {
    dir: settings.library.dir,
    autoSave: settings.library.autoSave,
    metadataEnabled: settings.metadata.enabled,
    providers: [...settings.metadata.providers],
    metadataLanguage: settings.metadata.language,
    host: settings.send.smtp.host,
    port: String(settings.send.smtp.port),
    secure: settings.send.smtp.secure,
    user: settings.send.smtp.user,
    from: settings.send.smtp.from,
    password: '',
    clearPassword: false,
    kindleEmail: settings.send.kindleEmail,
    maxAttachmentMb: String(settings.send.maxAttachmentMb),
  };
}

export type SettingsFieldError =
  | 'dir'
  | 'port'
  | 'email'
  | 'max';

export function validateSettingsForm(form: SettingsForm): Partial<Record<SettingsFieldError, string>> {
  const errors: Partial<Record<SettingsFieldError, string>> = {};
  if (!form.dir.trim()) errors.dir = 'dir';
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = 'port';
  const max = Number(form.maxAttachmentMb);
  if (!Number.isInteger(max) || max < 1 || max > 50) errors.max = 'max';
  if (form.from.trim() && !isValidEmail(form.from)) errors.email = 'email';
  if (form.kindleEmail.trim() && !isValidEmail(form.kindleEmail)) errors.email = 'email';
  return errors;
}

/** Build a PUT body from the full form. An empty password means "keep". */
export function buildSettingsPatch(form: SettingsForm, hasPassword: boolean): SettingsPatch {
  type SmtpPatch = NonNullable<NonNullable<SettingsPatch['send']>['smtp']>;
  const smtp: SmtpPatch = {
    host: form.host.trim(),
    port: Number(form.port),
    secure: form.secure,
    user: form.user.trim(),
    from: form.from.trim(),
  };
  if (form.password.trim()) smtp.password = form.password;
  else if (form.clearPassword && hasPassword) smtp.clearPassword = true;

  return {
    library: { dir: form.dir.trim(), autoSave: form.autoSave },
    metadata: {
      enabled: form.metadataEnabled,
      providers: form.providers,
      language: form.metadataLanguage,
    },
    send: {
      smtp,
      kindleEmail: form.kindleEmail.trim(),
      maxAttachmentMb: Number(form.maxAttachmentMb),
    },
  };
}

export function settingsDirty(form: SettingsForm, initial: SettingsForm, hasPassword: boolean): boolean {
  return JSON.stringify(buildSettingsPatch(form, hasPassword)) !== JSON.stringify(buildSettingsPatch(initial, hasPassword));
}
