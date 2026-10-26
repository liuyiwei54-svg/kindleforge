import { describe, expect, it } from 'vitest';
import { fill } from '../lib/i18n/fill';
import { localePath, switchLocalePath } from '../lib/i18n/paths';
import en from '../lib/i18n/en';
import zh from '../lib/i18n/zh';

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length === 0 ? [] : [shape(value[0])];
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, shape((value as Record<string, unknown>)[key])]),
    );
  }
  return typeof value;
}

function stringLeaves(value: unknown, path = 'dict'): Array<{ path: string; value: string }> {
  if (typeof value === 'string') return [{ path, value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => stringLeaves(entry, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) =>
      stringLeaves(entry, `${path}.${key}`),
    );
  }
  return [];
}

describe('i18n dictionaries', () => {
  it('exposes exactly the same structure in Chinese and English', () => {
    expect(shape(en)).toEqual(shape(zh));
  });

  it('has no empty strings in either dictionary', () => {
    for (const dict of [zh, en]) {
      for (const leaf of stringLeaves(dict)) {
        expect(leaf.value.trim(), leaf.path).not.toBe('');
      }
    }
  });

  it('keeps the 8 FAQ entries promised on the landing page', () => {
    expect(zh.faq.items).toHaveLength(8);
    expect(en.faq.items).toHaveLength(8);
  });
});

describe('fill', () => {
  it('replaces known placeholders and leaves unknown ones intact', () => {
    expect(fill('{a} and {b}', { a: 'one' })).toBe('one and {b}');
    expect(fill('no placeholders', {})).toBe('no placeholders');
  });
});

describe('locale paths', () => {
  it('mirrors routes between locales', () => {
    expect(localePath('zh', '/')).toBe('/');
    expect(localePath('en', '/')).toBe('/en');
    expect(localePath('zh', '/convert')).toBe('/convert');
    expect(localePath('en', '/convert/epub-to-mobi')).toBe('/en/convert/epub-to-mobi');
    expect(switchLocalePath('zh', '/docs')).toEqual({ href: '/en/docs', locale: 'en' });
    expect(switchLocalePath('en', '/en/convert')).toEqual({ href: '/convert', locale: 'zh' });
  });
});
