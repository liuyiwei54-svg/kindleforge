import { CompareTable } from '@/components/site/compare-table';
import { CtaBand } from '@/components/site/cta-band';
import { Faq } from '@/components/site/faq';
import { FormatMatrixSection } from '@/components/site/format-matrix-section';
import { GreenSection } from '@/components/site/green-section';
import { Hero } from '@/components/site/hero';
import { LocalModeSection } from '@/components/site/local-mode';
import { TrustBar } from '@/components/site/trust-bar';
import { getDict, type Locale } from '@/lib/i18n';

export function Landing({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: dict.faq.items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };

  return (
    <>
      <main id="main">
        <Hero locale={locale} />
        <TrustBar locale={locale} />
        <CompareTable locale={locale} />
        <FormatMatrixSection locale={locale} />
        <LocalModeSection locale={locale} />
        <GreenSection locale={locale} />
        <Faq locale={locale} />
        <CtaBand locale={locale} />
      </main>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
    </>
  );
}
