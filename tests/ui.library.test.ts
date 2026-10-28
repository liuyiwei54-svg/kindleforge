import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LibraryCover } from '../components/library/library-cover';
import { metadataCoverProxyUrl } from '../lib/client/metadata';
import type { LibraryEntry, Settings } from '../lib/shared/types';
import {
  SENDABLE_FORMATS,
  buildSettingsPatch,
  canSendFormat,
  coverVariant,
  filterEntries,
  formFromSettings,
  libraryMetadataPatch,
  isValidEmail,
  matchesQuery,
  settingsDirty,
  sortEntries,
  validateSettingsForm,
} from '../lib/client/library-utils';
import { getDict } from '../lib/i18n';

function entry(patch: Partial<LibraryEntry>): LibraryEntry {
  return {
    id: patch.id ?? 'id',
    filename: patch.filename ?? 'book.epub',
    title: patch.title ?? 'Book',
    author: patch.author ?? 'Author',
    format: patch.format ?? 'epub',
    size: patch.size ?? 1024,
    addedAt: patch.addedAt ?? 1,
    updatedAt: patch.updatedAt ?? 1,
    hasCover: patch.hasCover ?? false,
    ...patch,
  };
}

const settings: Settings = {
  version: 1,
  library: { dir: '/Users/me/Books', autoSave: true },
  metadata: { enabled: true, providers: ['douban', 'google', 'openlibrary'], language: 'auto' },
  send: {
    smtp: {
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      user: 'me@example.com',
      from: 'me@example.com',
      hasPassword: true,
    },
    kindleEmail: 'kindle@example.com',
    maxAttachmentMb: 25,
  },
};

describe('library filtering', () => {
  const entries = [
    entry({ id: 'a', title: '海边的卡夫卡', author: '村上春树', format: 'epub', size: 3_000_000, addedAt: 30 }),
    entry({ id: 'b', title: 'The Little Prince', author: 'Antoine de Saint-Exupéry', format: 'pdf', size: 500_000, addedAt: 10 }),
    entry({ id: 'c', title: 'Dune', author: 'Frank Herbert', format: 'mobi', size: 1_500_000, addedAt: 20, isbn: '9780441013593' }),
  ];

  it('matches title, author, filename and ISBN case-insensitively', () => {
    expect(matchesQuery(entries[0], '海边')).toBe(true);
    expect(matchesQuery(entries[1], 'saint-exupéry')).toBe(true);
    expect(matchesQuery(entries[2], 'dune')).toBe(true);
    expect(matchesQuery(entries[2], '9780441013593')).toBe(true);
    expect(matchesQuery(entries[2], '龘')).toBe(false);
  });

  it('returns everything for an empty query', () => {
    expect(filterEntries(entries, '   ')).toHaveLength(3);
  });

  it('sorts by added (desc), title and size (desc)', () => {
    expect(sortEntries(entries, 'added').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortEntries(entries, 'size').map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(sortEntries(entries, 'title', 'en').map((item) => item.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('send rules', () => {
  it('only allows formats Send to Kindle accepts', () => {
    expect(SENDABLE_FORMATS).toEqual(['epub', 'pdf', 'docx', 'txt']);
    expect(canSendFormat('epub')).toBe(true);
    expect(canSendFormat('txt')).toBe(true);
    expect(canSendFormat('azw3')).toBe(false);
    expect(canSendFormat('mobi')).toBe(false);
  });
});

describe('cover placeholders', () => {
  it('is stable and bounded', () => {
    expect(coverVariant('海边的卡夫卡')).toBe(coverVariant('海边的卡夫卡'));
    for (const title of ['a', 'Dune', '三体', 'x'.repeat(120)]) {
      const value = coverVariant(title);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(4);
    }
  });
});

describe('library save patch', () => {
  const cover = 'https://img.example/douban/l.jpg';

  it('sends ISBN and cover together in one patch when both differ', () => {
    expect(libraryMetadataPatch(entry({ hasCover: false }), { isbn: '9787536692930', coverUrl: cover })).toEqual({
      isbn: '9787536692930',
      coverUrl: cover,
    });
  });

  it('omits fields that already match the saved entry', () => {
    expect(libraryMetadataPatch(entry({ isbn: '9787536692930', hasCover: true }), {
      isbn: '9787536692930',
      coverUrl: cover,
    })).toEqual({});
  });

  it('still sends ISBN when only the cover already exists', () => {
    expect(libraryMetadataPatch(entry({ isbn: 'old', hasCover: true }), { isbn: 'new', coverUrl: cover })).toEqual({
      isbn: 'new',
    });
  });
});

describe('settings form', () => {
  it('keeps the saved password out of the form and never sends it unless typed', () => {
    const form = formFromSettings(settings);
    expect(form.password).toBe('');
    expect(form.clearPassword).toBe(false);
    expect(buildSettingsPatch(form, true).send?.smtp?.password).toBeUndefined();
    expect(buildSettingsPatch(form, true).send?.smtp?.clearPassword).toBeUndefined();

    expect(buildSettingsPatch({ ...form, password: 'app-password' }, true).send?.smtp?.password).toBe('app-password');
    expect(buildSettingsPatch({ ...form, clearPassword: true }, true).send?.smtp?.clearPassword).toBe(true);
  });

  it('keeps the Douban source in the form and saves it back', () => {
    const form = formFromSettings(settings);
    expect(form.providers).toContain('douban');
    expect(buildSettingsPatch(form, true).metadata?.providers).toEqual(['douban', 'google', 'openlibrary']);

    const withoutDouban = { ...form, providers: form.providers.filter((item) => item !== 'douban') };
    expect(settingsDirty(withoutDouban, form, true)).toBe(true);
    expect(buildSettingsPatch(withoutDouban, true).metadata?.providers).toEqual(['google', 'openlibrary']);
  });

  it('flags dirty state for text edits and password input', () => {
    const initial = formFromSettings(settings);
    expect(settingsDirty(initial, initial, true)).toBe(false);
    expect(settingsDirty({ ...initial, dir: '/tmp' }, initial, true)).toBe(true);
    expect(settingsDirty({ ...initial, password: 'x' }, initial, true)).toBe(true);
    expect(settingsDirty({ ...initial, clearPassword: true }, initial, true)).toBe(true);
  });

  it('validates port, attachment size, dir and Kindle email', () => {
    const form = formFromSettings(settings);
    expect(validateSettingsForm(form)).toEqual({});
    expect(validateSettingsForm({ ...form, port: '70000' }).port).toBeTruthy();
    expect(validateSettingsForm({ ...form, maxAttachmentMb: '99' }).max).toBeTruthy();
    expect(validateSettingsForm({ ...form, dir: '  ' }).dir).toBeTruthy();
    expect(validateSettingsForm({ ...form, kindleEmail: 'nope' }).email).toBeTruthy();
    expect(isValidEmail('kindle@example.com')).toBe(true);
  });

  it('converts secure ports to SSL automatically', () => {
    const form = formFromSettings(settings);
    expect(validateSettingsForm({ ...form, port: '465' }).port).toBeUndefined();
    expect(validateSettingsForm({ ...form, port: '587' }).port).toBeUndefined();
  });
});

describe('metadata cover proxy urls', () => {
  it('routes candidates through the backend cover proxy with an encoded url', () => {
    expect(metadataCoverProxyUrl('http://books.google.com/books/content?id=x&printsec=frontcover')).toBe(
      '/api/metadata/cover?url=http%3A%2F%2Fbooks.google.com%2Fbooks%2Fcontent%3Fid%3Dx%26printsec%3Dfrontcover',
    );
  });
});

describe('library cover placeholder', () => {
  it('renders a generated cover with the title when no real cover exists', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryCover, {
        entry: { id: 'e1', title: '三体', author: '刘慈欣', hasCover: false },
        alt: '《三体》封面',
      }),
    );
    expect(html).toContain('三体');
    expect(html).toContain('刘慈欣');
    expect(html).not.toContain('<img');
  });

  it('points at the local cover endpoint when the entry has a cover', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryCover, {
        entry: { id: 'e1', title: '三体', author: '刘慈欣', hasCover: true, coverVersion: 3 },
        alt: 'cover',
      }),
    );
    expect(html).toContain('/api/library/e1/cover');
    expect(html).toContain('v=3');
  });
});

describe('bilingual copy for the new pages', () => {
  const zh = getDict('zh');
  const en = getDict('en');

  it('has library/settings navigation and page titles', () => {
    expect(zh.nav.library).toBe('书库');
    expect(en.nav.library).toBe('Library');
    expect(zh.settings.title).toBeTruthy();
    expect(en.settings.title).toBeTruthy();
    expect(zh.library.empty).not.toBe(en.library.empty);
  });

  it('explains the saved-password placeholder in both locales', () => {
    expect(zh.settings.send.passwordSaved).toContain('已保存');
    expect(en.settings.send.passwordSaved.toLowerCase()).toContain('saved');
  });

  it('has metadata and result actions', () => {
    expect(zh.metadata.title).toBeTruthy();
    expect(en.metadata.title).toBeTruthy();
    expect(zh.convert.result.save).toBeTruthy();
    expect(en.convert.result.send).toBeTruthy();
  });
});
