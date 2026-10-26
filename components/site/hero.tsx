import { UploadLauncher } from '@/components/convert/upload-launcher';
import { DevicePreview } from '@/components/site/device-preview';
import { getDict, type Locale } from '@/lib/i18n';

export function Hero({ locale }: { locale: Locale }) {
  const dict = getDict(locale);

  return (
    <section className="relative overflow-hidden">
      <div aria-hidden="true" className="pointer-events-none absolute -top-32 right-[15%] h-80 w-80 rounded-full bg-moss-500/[0.07] blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute bottom-0 left-[-10%] h-64 w-64 rounded-full bg-moss-500/[0.04] blur-3xl" />

      <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 pt-12 pb-16 sm:px-8 md:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:items-start">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-paper/15 bg-paper/5 px-3 py-1 font-mono text-[10px] tracking-[0.18em] text-paper-dim uppercase">
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-moss-500" />
            {dict.hero.eyebrow}
          </p>

          <h1 className="mt-5 font-serif text-[2rem] leading-[1.16] tracking-tight text-paper sm:text-[2.6rem] lg:text-[2.9rem]">
            <span className="block text-paper-dim">{dict.hero.titleLead}</span>
            <span className="mt-1 block text-moss-400">{dict.hero.titleAccent}</span>
          </h1>

          <p className="mt-5 max-w-xl text-sm leading-7 text-paper-dim sm:text-base sm:leading-8">{dict.hero.sub}</p>

          <div className="mt-7">
            <UploadLauncher
              locale={locale}
              convertDict={dict.convert}
              errors={dict.errors}
              dropzone={{
                title: dict.hero.upload.title,
                subtitle: dict.hero.upload.subtitle,
                browse: dict.hero.upload.browse,
                active: dict.hero.upload.active,
                acceptNote: dict.hero.upload.accept,
                badge: dict.hero.upload.localBadge,
                privacy: dict.hero.upload.privacy,
              }}
              hint={dict.hero.upload.opensHint}
              fullConvertLabel={dict.hero.ctaSecondary}
            />
          </div>
        </div>

        <div className="lg:pt-4">
          <DevicePreview dict={dict.device} />
        </div>
      </div>
    </section>
  );
}
