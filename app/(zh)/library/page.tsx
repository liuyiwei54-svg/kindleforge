import type { Metadata } from 'next';
import { LibraryPage } from '@/components/library/library-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('zh');

export const metadata: Metadata = pageMetadata({
  locale: 'zh',
  path: '/library',
  title: dict.meta.library.title,
  description: dict.meta.library.description,
});

export default function LibraryRoute() {
  return <LibraryPage locale="zh" />;
}
