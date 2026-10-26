import { FORMAT_INFO } from '@/lib/engine/formats';
import type { FormatId } from '@/lib/engine/types';
import type { Locale } from './paths';

/**
 * `FORMAT_INFO.name` is a file extension label (EPUB, MOBI) except for the
 * pseudo-format `image`, whose name is Chinese-only. Every user-facing label
 * goes through this helper so /en never leaks 「图片」.
 */
export function formatName(id: FormatId, locale: Locale): string {
  if (id === 'image') return locale === 'zh' ? '图片' : 'Image';
  return FORMAT_INFO[id].name;
}

/** Localised human description, e.g. "EPUB 电子书" / "EPUB eBook". */
export function formatDescription(id: FormatId, locale: Locale): string {
  return locale === 'zh' ? FORMAT_INFO[id].zh : FORMAT_INFO[id].en;
}
