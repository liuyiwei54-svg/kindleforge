import { FormatMatrix, type MatrixFormatItem, type MatrixPopularItem } from '@/components/site/format-matrix';
import { Section } from '@/components/site/section';
import { capabilities, FORMAT_INFO, INPUT_FORMATS, pairSlug, POPULAR_PAIRS } from '@/lib/engine/formats';
import { getDict, localePath, type Locale } from '@/lib/i18n';
import { formatDescription, formatName } from '@/lib/i18n/formats';

export function FormatMatrixSection({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const pairs = capabilities();

  const items: MatrixFormatItem[] = INPUT_FORMATS.map((from) => {
    const info = FORMAT_INFO[from];
    const name = formatName(from, locale);
    const description = formatDescription(from, locale);
    // "EPUB 电子书" would repeat the name already shown above it; keep only the
    // descriptive tail (and fall back to the whole string when there is none).
    const tail = description.toLowerCase().startsWith(name.toLowerCase())
      ? description.slice(name.length).replace(/^[\s·:：-]+/, '').trim()
      : description;
    return {
      from,
      name,
      localizedName: tail.length > 0 ? tail : description,
      kind: info.kind,
      ext: info.ext,
      outputs: pairs
        .filter((pair) => pair.from === from && pair.to !== from)
        .map((pair) => ({
          to: pair.to,
          name: formatName(pair.to, locale),
          local: pair.local,
          quality: pair.quality,
          href: localePath(locale, `/convert/${pairSlug(from, pair.to)}`),
        })),
    };
  }).filter((item) => item.outputs.length > 0);

  const popular: MatrixPopularItem[] = POPULAR_PAIRS.filter((pair) =>
    pairs.some((entry) => entry.from === pair.from && entry.to === pair.to),
  ).map((pair) => {
    const capability = pairs.find((entry) => entry.from === pair.from && entry.to === pair.to);
    return {
      from: pair.from,
      to: pair.to,
      name: `${formatName(pair.from, locale)} → ${formatName(pair.to, locale)}`,
      href: localePath(locale, `/convert/${pairSlug(pair.from, pair.to)}`),
      local: capability?.local ?? false,
    };
  });

  return (
    <Section id="formats" eyebrow={dict.matrix.eyebrow} title={dict.matrix.title} sub={dict.matrix.sub}>
      <FormatMatrix
        items={items}
        popular={popular}
        labels={dict.matrix}
        workspaceHref={localePath(locale, '/convert')}
      />
    </Section>
  );
}
