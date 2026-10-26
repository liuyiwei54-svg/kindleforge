import en from './en';
import { fill } from './fill';
import { DEFAULT_LOCALE, HTML_LANG, LOCALES, isLocale, localePath, switchLocalePath } from './paths';
import type { Locale } from './paths';
import type { Dict } from './types';
import zh from './zh';

export type { Dict, CompareRow, FaqItem, ErrorCode } from './types';
export { LOCALES, DEFAULT_LOCALE, HTML_LANG, isLocale, localePath, switchLocalePath };
export type { Locale };

const dictionaries: Record<Locale, Dict> = { zh, en };

export function getDict(locale: Locale): Dict {
  return dictionaries[locale];
}

export function errorCopy(dict: Dict, code: string | undefined): { message: string; hint: string } {
  const known = code && code in dict.errors ? dict.errors[code as keyof Dict['errors']] : undefined;
  if (known) return { message: known.message, hint: known.hint };
  return { message: dict.errors.INTERNAL.message, hint: dict.errors.INTERNAL.hint };
}

export { fill };
