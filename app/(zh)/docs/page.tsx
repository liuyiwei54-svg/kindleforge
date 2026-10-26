import type { Metadata } from 'next';
import { DocsPage } from '@/components/site/docs-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('zh');

export const metadata: Metadata = pageMetadata({
  locale: 'zh',
  path: '/docs',
  title: dict.meta.docs.title,
  description: dict.meta.docs.description,
});

export default function DocsRoute() {
  return <DocsPage locale="zh" />;
}
