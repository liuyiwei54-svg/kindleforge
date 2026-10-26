import type { Metadata } from 'next';
import { DocsPage } from '@/components/site/docs-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('en');

export const metadata: Metadata = pageMetadata({
  locale: 'en',
  path: '/docs',
  title: dict.meta.docs.title,
  description: dict.meta.docs.description,
});

export default function EnDocsRoute() {
  return <DocsPage locale="en" />;
}
