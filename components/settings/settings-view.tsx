'use client';

import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  FolderOpen,
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Settings2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button, buttonClass } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ToastRegion, useToast } from '@/components/ui/toast';
import { cn } from '@/components/ui/cn';
import {
  buildSettingsPatch,
  formFromSettings,
  isValidEmail,
  settingsDirty,
  validateSettingsForm,
  type SettingsForm,
} from '@/lib/client/library-utils';
import { fetchSettings, saveSettings, testSmtpConnection, type SmtpTestResult } from '@/lib/client/settings';
import { fill, getDict, type Locale } from '@/lib/i18n';
import type { MetadataProvider, Settings } from '@/lib/shared/types';

type LoadStatus = 'loading' | 'ready' | 'error';

const AMAZON_PERSONAL_DOCS = 'https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc';

function SectionHeading({
  eyebrow,
  title,
  sub,
  id,
  icon: Icon,
}: {
  eyebrow: string;
  title: string;
  sub: string;
  id: string;
  icon: typeof Settings2;
}) {
  return (
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-moss-500/25 bg-moss-500/10 text-moss-500">
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <p className="font-mono text-[0.62rem] tracking-[0.22em] text-moss-500 uppercase">{eyebrow}</p>
        <h2 id={id} className="mt-1 font-serif text-xl text-paper">
          {title}
        </h2>
        <p className="mt-1 max-w-2xl text-xs leading-6 text-paper-dim">{sub}</p>
      </div>
    </div>
  );
}

export function SettingsView({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const copy = dict.settings;
  const { toast, show, hide } = useToast();

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [initial, setInitial] = useState<SettingsForm | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<SmtpTestResult | null>(null);
  const [focusSend, setFocusSend] = useState(false);

  const load = () => {
    setStatus('loading');
    fetchSettings()
      .then((value) => {
        const next = formFromSettings(value);
        setSettings(value);
        setInitial(next);
        setForm(next);
        setStatus('ready');
      })
      .catch(() => setStatus('error'));
  };

  useEffect(load, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('focus') === 'send' || window.location.hash === '#send') {
      setFocusSend(true);
      window.requestAnimationFrame(() => document.getElementById('section-send')?.scrollIntoView({ block: 'start' }));
    }
  }, []);

  const errors = useMemo(() => {
    if (!form) return {};
    const raw = validateSettingsForm(form);
    return {
      dir: raw.dir ? copy.validation.dir : undefined,
      port: raw.port ? copy.validation.port : undefined,
      max: raw.max ? copy.validation.max : undefined,
      from: raw.email && form.from.trim() && !isValidEmail(form.from) ? copy.validation.email : undefined,
      kindleEmail: raw.email && form.kindleEmail.trim() && !isValidEmail(form.kindleEmail) ? copy.validation.email : undefined,
    };
  }, [form, copy.validation.dir, copy.validation.email, copy.validation.max, copy.validation.port]);

  const hasErrors = Object.values(errors).some(Boolean);
  const dirty = Boolean(form && initial && settings && settingsDirty(form, initial, settings.send.smtp.hasPassword));

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current));
  };

  const changePort = (value: string) => {
    const port = value.replace(/[^0-9]/g, '');
    setForm((current) => {
      if (!current) return current;
      const next = { ...current, port };
      if (port === '465') next.secure = true;
      else if (port === '587') next.secure = false;
      return next;
    });
  };

  const toggleProvider = (provider: MetadataProvider, checked: boolean) => {
    setForm((current) => {
      if (!current) return current;
      const providers = checked
        ? [...current.providers, provider]
        : current.providers.filter((item) => item !== provider);
      return { ...current, providers };
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form || !settings || hasErrors) return;
    setSaving(true);
    try {
      const updated = await saveSettings(buildSettingsPatch(form, settings.send.smtp.hasPassword));
      const next = formFromSettings(updated);
      setSettings(updated);
      setInitial(next);
      setForm(next);
      show(copy.savedToast, 'ok');
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : copy.saveFailed;
      show(copy.saveFailed, 'error', message);
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!form) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testSmtpConnection({
        host: form.host.trim(),
        port: Number(form.port),
        secure: form.secure,
        user: form.user.trim(),
        from: form.from.trim(),
        password: form.password.trim() || undefined,
      });
      setTestResult(result);
    } catch (error) {
      setTestResult({
        ok: false,
        message: copy.send.testFail,
        hint: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setTesting(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="mt-8 flex items-center gap-3 rounded-2xl border border-paper/12 bg-ink-800/40 px-5 py-6 text-sm text-paper-dim">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-moss-500" />
        {copy.loading}
      </div>
    );
  }

  if (status === 'error' || !form || !settings) {
    return (
      <div className="mt-8 rounded-[20px] border border-clay/30 bg-clay/5 p-6 text-center">
        <h2 className="font-serif text-xl text-paper">{copy.loadError}</h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-paper-dim">{copy.loadHint}</p>
        <Button variant="secondary" size="sm" className="mt-4 gap-2" onClick={load}>
          <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />
          {copy.retry}
        </Button>
      </div>
    );
  }

  const smtp = settings.send.smtp;
  const providers = [
    { id: 'douban' as const, label: copy.metadata.providerDouban },
    { id: 'google' as const, label: copy.metadata.providerGoogle },
    { id: 'openlibrary' as const, label: copy.metadata.providerOpenLibrary },
  ];

  return (
    <>
      <form onSubmit={submit} className="mt-8 space-y-4 pb-28" noValidate>
        {focusSend ? (
          <p role="status" className="rounded-xl border border-moss-500/35 bg-moss-500/8 px-4 py-3 text-sm leading-6 text-paper">
            {copy.focusSend}
          </p>
        ) : null}

        <section aria-labelledby="section-library-title" className="rounded-[20px] border border-paper/12 bg-ink-800/40 p-5 sm:p-6">
          <SectionHeading
            id="section-library-title"
            eyebrow={copy.sections.library.eyebrow}
            title={copy.sections.library.title}
            sub={copy.sections.library.sub}
            icon={FolderOpen}
          />
          <div className="mt-5 grid gap-5">
            <Input
              label={copy.library.dirLabel}
              value={form.dir}
              onChange={(event) => update('dir', event.target.value)}
              error={errors.dir}
              className="font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="text-xs leading-5 text-paper-dim/80">{copy.library.dirNote}</p>
            <div className="rounded-xl border border-paper/10 bg-ink-950/30 px-4 py-3">
              <Switch
                checked={form.autoSave}
                onChange={(checked) => update('autoSave', checked)}
                label={copy.library.autoSave}
                description={copy.library.autoSaveHint}
              />
            </div>
          </div>
        </section>

        <section aria-labelledby="section-metadata-title" className="rounded-[20px] border border-paper/12 bg-ink-800/40 p-5 sm:p-6">
          <SectionHeading
            id="section-metadata-title"
            eyebrow={copy.sections.metadata.eyebrow}
            title={copy.sections.metadata.title}
            sub={copy.sections.metadata.sub}
            icon={Database}
          />
          <div className="mt-5 grid gap-5">
            <div className="rounded-xl border border-paper/10 bg-ink-950/30 px-4 py-3">
              <Switch
                checked={form.metadataEnabled}
                onChange={(checked) => update('metadataEnabled', checked)}
                label={copy.metadata.enabled}
                description={copy.metadata.note}
              />
            </div>

            <fieldset disabled={!form.metadataEnabled} className={cn('grid gap-4 sm:grid-cols-3', !form.metadataEnabled && 'opacity-55')}>
              <legend className="mb-2 text-sm font-medium text-paper-dim">{copy.metadata.providers}</legend>
              {providers.map((provider) => (
                <label
                  key={provider.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-paper/12 bg-ink-950/30 px-3.5 py-2.5 text-sm text-paper"
                >
                  <input
                    type="checkbox"
                    checked={form.providers.includes(provider.id)}
                    onChange={(event) => toggleProvider(provider.id, event.target.checked)}
                    className="h-4 w-4 rounded border-paper/30 bg-ink-900 accent-moss-500"
                  />
                  {provider.label}
                </label>
              ))}
            </fieldset>
            <p className="-mt-1 text-xs leading-5 text-paper-dim/75">{copy.metadata.doubanNote}</p>

            <Select
              label={copy.metadata.language}
              value={form.metadataLanguage}
              onChange={(event) => update('metadataLanguage', event.target.value as SettingsForm['metadataLanguage'])}
              disabled={!form.metadataEnabled}
              wrapperClassName="sm:max-w-xs"
            >
              <option value="auto">{copy.metadata.languageAuto}</option>
              <option value="zh">{copy.metadata.languageZh}</option>
              <option value="en">{copy.metadata.languageEn}</option>
            </Select>
          </div>
        </section>

        <section
          id="section-send"
          aria-labelledby="section-send-title"
          className={cn(
            'rounded-[20px] border bg-ink-800/40 p-5 sm:p-6',
            focusSend ? 'border-moss-500/40' : 'border-paper/12',
          )}
        >
          <SectionHeading
            id="section-send-title"
            eyebrow={copy.sections.send.eyebrow}
            title={copy.sections.send.title}
            sub={copy.sections.send.sub}
            icon={Send}
          />
          <div className="mt-5 grid gap-5">
            <div className="grid gap-4 sm:grid-cols-3">
              <Input
                label={copy.send.host}
                value={form.host}
                onChange={(event) => update('host', event.target.value)}
                placeholder="smtp.example.com"
                autoComplete="off"
                spellCheck={false}
                wrapperClassName="sm:col-span-2"
              />
              <Input
                label={copy.send.port}
                value={form.port}
                onChange={(event) => changePort(event.target.value)}
                error={errors.port}
                inputMode="numeric"
                placeholder="465"
              />
            </div>

            <div className="rounded-xl border border-paper/10 bg-ink-950/30 px-4 py-3">
              <Switch
                checked={form.secure}
                onChange={(checked) => update('secure', checked)}
                label={copy.send.secure}
                description={copy.send.secureHint}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={copy.send.user}
                value={form.user}
                onChange={(event) => update('user', event.target.value)}
                autoComplete="username"
                spellCheck={false}
              />
              <Input
                label={copy.send.from}
                value={form.from}
                onChange={(event) => update('from', event.target.value)}
                type="email"
                error={errors.from}
                autoComplete="email"
                spellCheck={false}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label={copy.send.password}
                value={form.password}
                onChange={(event) => update('password', event.target.value)}
                type="password"
                autoComplete="new-password"
                disabled={form.clearPassword}
                placeholder={smtp.hasPassword ? copy.send.passwordSaved : copy.send.passwordEmpty}
                hint={form.clearPassword ? copy.passwordCleared : copy.send.note}
              />
              <div className="flex flex-col justify-end gap-2 pb-1">
                {smtp.hasPassword ? (
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-paper-dim">
                    <input
                      type="checkbox"
                      checked={form.clearPassword}
                      onChange={(event) => update('clearPassword', event.target.checked)}
                      className="h-4 w-4 rounded border-paper/30 bg-ink-900 accent-moss-500"
                    />
                    {copy.send.clearPassword}
                  </label>
                ) : null}
                <p className="text-xs leading-5 text-paper-dim/70">{copy.testHint}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" onClick={test} disabled={testing} className="gap-2">
                {testing ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Mail aria-hidden="true" className="h-3.5 w-3.5" />}
                {testing ? copy.send.testing : copy.send.test}
              </Button>
              {testResult ? (
                <div role="status" aria-live="polite" className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'flex items-start gap-1.5 text-xs leading-5',
                      testResult.ok ? 'text-moss-400' : 'text-clay',
                    )}
                  >
                    {testResult.ok ? (
                      <CheckCircle2 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    )}
                    <span>
                      {testResult.message || (testResult.ok ? copy.send.testOk : copy.send.testFail)}
                      {!testResult.ok && testResult.code ? (
                        <span className="ml-2 font-mono text-[0.65rem] opacity-80">
                          {fill(copy.send.testCode, { code: testResult.code })}
                        </span>
                      ) : null}
                      {testResult.hint ? <span className="mt-0.5 block text-paper-dim">{testResult.hint}</span> : null}
                    </span>
                  </p>
                </div>
              ) : null}
            </div>

            <div className="grid gap-4 border-t border-paper/10 pt-5 sm:grid-cols-2">
              <Input
                label={copy.send.kindleEmail}
                value={form.kindleEmail}
                onChange={(event) => update('kindleEmail', event.target.value)}
                type="email"
                error={errors.kindleEmail}
                hint={copy.send.kindleEmailHint}
                autoComplete="email"
                spellCheck={false}
              />
              <Input
                label={copy.send.maxAttachment}
                value={form.maxAttachmentMb}
                onChange={(event) => update('maxAttachmentMb', event.target.value.replace(/[^0-9]/g, ''))}
                type="number"
                min={1}
                max={50}
                error={errors.max}
                hint={copy.send.maxAttachmentHint}
              />
            </div>

            <div className="rounded-xl border border-paper/10 bg-ink-950/30 px-4 py-3">
              <p className="flex gap-2 text-xs leading-6 text-paper-dim">
                <BookOpen aria-hidden="true" className="mt-1 h-3.5 w-3.5 shrink-0 text-moss-500/80" />
                {copy.send.whitelist}
              </p>
              <a
                href={AMAZON_PERSONAL_DOCS}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex text-xs text-moss-400 underline-offset-4 transition-colors hover:text-moss-300 hover:underline focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              >
                {copy.send.whitelistCta} ↗
              </a>
            </div>
          </div>
        </section>

        {dirty ? (
        <div className="fixed bottom-4 left-1/2 z-30 flex w-[calc(100%-2.5rem)] max-w-4xl -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl border border-paper/15 bg-ink-900/95 px-4 py-3 shadow-[0_16px_48px_rgba(0,0,0,0.45)] backdrop-blur sm:w-[calc(100%-4rem)]">
          <p className="text-xs text-paper-dim" aria-live="polite">
            {copy.unsaved}
          </p>
          <div className="flex items-center gap-2">
            <a href="#section-send" className="hidden text-xs text-paper-dim underline-offset-4 hover:text-paper hover:underline sm:inline">
              Send to Kindle
            </a>
            <button type="submit" disabled={!dirty || saving || hasErrors} className={buttonClass('primary', 'sm', 'gap-2')}>
              {saving ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Settings2 aria-hidden="true" className="h-3.5 w-3.5" />}
              {saving ? copy.saving : copy.save}
            </button>
          </div>
        </div>
        ) : null}
      </form>

      <ToastRegion toast={toast} onDismiss={hide} closeLabel={locale === 'zh' ? '关闭通知' : 'Close notification'} />
    </>
  );
}
