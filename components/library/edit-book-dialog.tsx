'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { ApiError } from '@/lib/client/api';
import { updateLibraryEntry } from '@/lib/client/library';
import { getDict, type Locale } from '@/lib/i18n';
import type { LibraryEntry } from '@/lib/shared/types';

export function EditBookDialog({
  entry,
  open,
  locale,
  onClose,
  onSaved,
}: {
  entry: LibraryEntry | null;
  open: boolean;
  locale: Locale;
  onClose: () => void;
  onSaved: (entry: LibraryEntry) => void;
}) {
  const dict = getDict(locale);
  const copy = dict.library.edit;
  const [values, setValues] = useState({
    title: entry?.title ?? '',
    author: entry?.author ?? '',
    isbn: entry?.isbn ?? '',
    publisher: entry?.publisher ?? '',
    language: entry?.language ?? '',
    description: entry?.description ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!entry) return null;

  const update = (field: keyof typeof values) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.title.trim()) {
      setError(copy.titleRequired);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await updateLibraryEntry(entry.id, {
        title: values.title.trim(),
        author: values.author.trim(),
        isbn: values.isbn.replace(/[^0-9Xx-]/g, '').trim(),
        publisher: values.publisher.trim(),
        language: values.language.trim(),
        description: values.description.trim(),
      });
      onSaved(updated);
      onClose();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : copy.failed;
      const hint = caught instanceof ApiError ? caught.hint : undefined;
      setError(hint ? `${message} — ${hint}` : message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!saving) onClose();
      }}
      title={copy.title}
      description={copy.sub}
      closeLabel={locale === 'zh' ? '关闭' : 'Close'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {copy.cancel}
          </Button>
          <Button type="submit" form="edit-book-form" disabled={saving}>
            {saving ? copy.saving : copy.save}
          </Button>
        </>
      }
    >
      <form id="edit-book-form" onSubmit={save} className="grid gap-4">
        {error ? (
          <p role="alert" className="rounded-xl border border-clay/40 bg-clay/10 px-3 py-2 text-xs leading-5 text-clay">
            {error}
          </p>
        ) : null}
        <Input label={copy.fields.title} value={values.title} onChange={update('title')} required autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={copy.fields.author} value={values.author} onChange={update('author')} />
          <Input label={copy.fields.isbn} value={values.isbn} onChange={update('isbn')} inputMode="numeric" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={copy.fields.publisher} value={values.publisher} onChange={update('publisher')} />
          <Input label={copy.fields.language} value={values.language} onChange={update('language')} placeholder="zh / en" />
        </div>
        <Textarea label={copy.fields.description} value={values.description} onChange={update('description')} rows={4} />
      </form>
    </Dialog>
  );
}
