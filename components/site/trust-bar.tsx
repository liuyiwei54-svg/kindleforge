import { INPUT_FORMATS, OUTPUT_FORMATS, DEVICES } from '@/lib/engine/formats';
import { fill, getDict, type Locale } from '@/lib/i18n';

export function TrustBar({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const items = [
    {
      ...dict.trust.items.local,
      value: dict.trust.items.local.value,
    },
    {
      ...dict.trust.items.inputs,
      value: fill(dict.trust.items.inputs.value, { inputs: INPUT_FORMATS.length }),
    },
    {
      ...dict.trust.items.ads,
      value: dict.trust.items.ads.value,
    },
    {
      ...dict.trust.items.open,
      value: dict.trust.items.open.value,
    },
  ];

  return (
    <section aria-label={dict.trust.title} className="border-y border-paper/10 bg-ink-900/40">
      <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">
        <h2 className="sr-only">{dict.trust.title}</h2>
        <dl className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="sr-only">{item.label}</dt>
              <dd>
                <p className="font-serif text-2xl leading-none text-moss-400 sm:text-[1.7rem]">{item.value}</p>
                <p className="mt-2 text-sm text-paper">{item.label}</p>
                <p className="mt-1 text-[11px] leading-5 text-paper-dim/70">{item.note}</p>
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[11px] text-paper-dim/60">
          {locale === 'zh'
            ? `另有 ${OUTPUT_FORMATS.length} 类输出与 ${DEVICES.length} 款 Kindle 预设；数字均来自 lib/engine/formats.ts。`
            : `Plus ${OUTPUT_FORMATS.length} output formats and ${DEVICES.length} Kindle presets — all counts read from lib/engine/formats.ts.`}
        </p>
      </div>
    </section>
  );
}
