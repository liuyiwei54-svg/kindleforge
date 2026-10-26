import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { NotFoundPage } from '@/components/site/not-found-page';

export default function EnNotFound() {
  return (
    <>
      <Header locale="en" />
      <NotFoundPage locale="en" />
      <Footer locale="en" />
    </>
  );
}
