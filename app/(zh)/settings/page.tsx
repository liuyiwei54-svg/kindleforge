import type { Metadata } from 'next';
import { SettingsPage } from '@/components/settings/settings-page';
import { getDict } from '@/lib/i18n';
import { pageMetadata } from '@/lib/i18n/seo';

const dict = getDict('zh');

export const metadata: Metadata = pageMetadata({
  locale: 'zh',
  path: '/settings',
  title: dict.meta.settings.title,
  description: dict.meta.settings.description,
});

export default function SettingsRoute() {
  return <SettingsPage locale="zh" />;
}
