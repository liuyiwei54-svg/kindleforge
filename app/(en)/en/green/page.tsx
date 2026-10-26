import type { Metadata } from 'next';
import { GreenPage } from '@/components/site/green-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('en');

export const metadata: Metadata = pageMetadata({
  locale: 'en',
  path: '/green',
  title: dict.meta.green.title,
  description: dict.meta.green.description,
});

export default function EnGreenRoute() {
  return <GreenPage locale="en" />;
}
