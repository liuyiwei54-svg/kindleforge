import type { Settings, SettingsPatch } from '@/lib/shared/types';
import { apiFetch, apiJson } from './http';

export interface SmtpTestInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  from?: string;
  password?: string;
}

export interface SmtpTestResult {
  ok: boolean;
  code?: string;
  message: string;
  hint?: string;
}

export async function fetchSettings(signal?: AbortSignal): Promise<Settings> {
  return apiJson<Settings>('/api/settings', { signal });
}

export async function saveSettings(patch: SettingsPatch): Promise<Settings> {
  return apiJson<Settings>('/api/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * The endpoint answers 200 even when the connection fails, with a diagnostic
 * body ({ ok, code, message, hint }). Only transport errors reject.
 */
export async function testSmtpConnection(input: SmtpTestInput): Promise<SmtpTestResult> {
  const response = await apiFetch('/api/settings/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ smtp: input }),
  });
  const payload = (await response.json()) as Partial<SmtpTestResult>;
  return {
    ok: payload.ok === true,
    code: typeof payload.code === 'string' ? payload.code : undefined,
    message: typeof payload.message === 'string' ? payload.message : '',
    hint: typeof payload.hint === 'string' ? payload.hint : undefined,
  };
}
