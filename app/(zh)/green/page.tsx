import type { Metadata } from 'next';
import { GreenPage } from '@/components/site/green-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('zh');

export const metadata: Metadata = pageMetadata({
  locale: 'zh',
  path: '/green',
  title: dict.meta.green.title,
  description: dict.meta.green.description,
});

export default function GreenRoute() {
  return <GreenPage locale="zh" />;
}
