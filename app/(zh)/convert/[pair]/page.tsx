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
  const dict = getDict('zh');
  const from = formatName(pair.from, 'zh');
  const to = formatName(pair.to, 'zh');
  const quality =
    pair.quality === 'high'
      ? dict.pair.qualityHigh
      : pair.quality === 'medium'
        ? dict.pair.qualityMedium
        : dict.pair.qualityLossy;
  return pageMetadata({
    locale: 'zh',
    path: `/convert/${pair.slug}`,
    title: fill(dict.meta.pairTitle, { from, to }),
    description: fill(dict.meta.pairDescription, { from, to, quality: `${quality}。` }),
  });
}

export default async function PairRoute({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: slug } = await params;
  const pair = getStaticPair(slug);
  if (!pair) notFound();
  return <PairPage locale="zh" pair={pair} related={relatedPairs(pair)} />;
}
