import type { Metadata } from 'next';
import { Header } from '@/components/site/header';
import { Footer } from '@/components/site/footer';
import { Landing } from '@/components/site/landing';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('en');

export const metadata: Metadata = {
  ...pageMetadata({
    locale: 'en',
    path: '/',
    title: dict.meta.home.title,
    description: dict.meta.home.description,
  }),
  title: { absolute: dict.meta.home.title },
};

export default function EnHomePage() {
  return (
    <>
      <Header locale="en" path="/" />
      <Landing locale="en" />
      <Footer locale="en" />
    </>
  );
}
