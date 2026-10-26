import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { NotFoundPage } from '@/components/site/not-found-page';

export default function ZhNotFound() {
  return (
    <>
      <Header locale="zh" />
      <NotFoundPage locale="zh" />
      <Footer locale="zh" />
    </>
  );
}
