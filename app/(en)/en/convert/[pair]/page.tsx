import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getStaticPair, getStaticPairs, relatedPairs } from '@/components/site/pair-data';
import { PairPage } from '@/components/site/pair-page';
import { fill, getDict } from '@/lib/i18n';
import { formatName } from '@/lib/i18n/formats';
import { pageMetadata } from '@/lib/i18n/seo';

export const dynamicParams = false;

export function generateStaticParams() {
  return getStaticPairs().map((pair) => ({ pair: pair.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ pair: string }> }): Promise<Metadata> {
  const { pair: slug } = await params;
  const pair = getStaticPair(slug);
  if (!pair) return { title: '404' };
  const dict = getDict('en');
  const from = formatName(pair.from, 'en');
  const to = formatName(pair.to, 'en');
  const quality =
    pair.quality === 'high'
      ? dict.pair.qualityHigh
      : pair.quality === 'medium'
        ? dict.pair.qualityMedium
        : dict.pair.qualityLossy;
  return pageMetadata({
    locale: 'en',
    path: `/convert/${pair.slug}`,
    title: fill(dict.meta.pairTitle, { from, to }),
    description: fill(dict.meta.pairDescription, { from, to, quality }),
  });
}

export default async function EnPairRoute({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: slug } = await params;
  const pair = getStaticPair(slug);
  if (!pair) notFound();
  return <PairPage locale="en" pair={pair} related={relatedPairs(pair)} />;
}
