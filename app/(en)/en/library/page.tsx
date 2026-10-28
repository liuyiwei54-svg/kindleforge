import type { Metadata } from 'next';
import { LibraryPage } from '@/components/library/library-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('en');

export const metadata: Metadata = pageMetadata({
  locale: 'en',
  path: '/library',
  title: dict.meta.library.title,
  description: dict.meta.library.description,
});

export default function EnLibraryRoute() {
  return <LibraryPage locale="en" />;
}
