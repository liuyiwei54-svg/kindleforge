import type { Metadata } from 'next';
import { ConvertPage } from '@/components/convert/convert-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('en');

export const metadata: Metadata = pageMetadata({
  locale: 'en',
  path: '/convert',
  title: dict.meta.convert.title,
  description: dict.meta.convert.description,
});

export default function EnConvertRoute() {
  return <ConvertPage locale="en" />;
}
