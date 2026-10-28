/**
 * Same-origin / Host guard for every `/api/**` request.
 *
 * DNS rebinding lets a malicious page talk to `127.0.0.1` while the browser
 * still sends `Host: evil.example` (and often `Origin: https://evil.example`).
 * Binding to the local server alone is therefore not enough: we require the
 * Host header to be one of the local names (or an explicit `KF_ALLOWED_HOSTS`
 * entry) and, when an Origin is present, to match that allow-list too.
 *
 * This module is intentionally dependency-free so Next middleware (edge
 * runtime) can import it.
 */

export const DEFAULT_PORT = 3100;
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1']);

export type OriginGuardCode = 'FORBIDDEN_HOST' | 'FORBIDDEN_ORIGIN';

export interface OriginGuardRejection {
  ok: false;
  status: 403;
  body: {
    error: {
      code: OriginGuardCode;
      message: string;
      hint: { zh: string; en: string };
    };
  };
}

export type OriginGuardResult = { ok: true } | OriginGuardRejection;

function expectedPort(env: NodeJS.ProcessEnv): number {
  const value = Number(env.KF_PORT);
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : DEFAULT_PORT;
}

function customHosts(env: NodeJS.ProcessEnv): string[] {
  return (env.KF_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

interface Authority {
  hostname: string;
  port: string | null;
}

function parseAuthority(value: string): Authority | null {
  const text = value.trim().toLowerCase();
  if (!text || /[\s/@\\]/.test(text)) return null;
  if (text.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
    if (!match) return null;
    return { hostname: match[1]!, port: match[2] ?? null };
  }
  const colons = text.split(':').length - 1;
  if (colons > 1) return null; // IPv6 literals must be bracketed in Host.
  if (colons === 1) {
    const [hostname, port] = text.split(':') as [string, string];
    if (!hostname || !/^\d+$/.test(port)) return null;
    return { hostname, port };
  }
  return { hostname: text, port: null };
}

function authorityText(authority: Authority): string {
  return authority.port ? `${authority.hostname}:${authority.port}` : authority.hostname;
}

function allowedAuthorities(env: NodeJS.ProcessEnv): Set<string> {
  const port = String(expectedPort(env));
  const allowed = new Set<string>();
  for (const hostname of LOCAL_HOSTNAMES) {
    allowed.add(hostname);
    allowed.add(`${hostname}:${port}`);
  }
  for (const entry of customHosts(env)) {
    const parsed = parseAuthority(entry);
    if (!parsed) continue;
    if (parsed.port) allowed.add(authorityText(parsed));
    else {
      allowed.add(parsed.hostname);
      allowed.add(`${parsed.hostname}:${port}`);
    }
  }
  return allowed;
}

function forbidden(code: OriginGuardCode): OriginGuardRejection {
  if (code === 'FORBIDDEN_HOST') {
    return {
      ok: false,
      status: 403,
      body: {
        error: {
          code,
          message: 'This host is not allowed to access the API.',
          hint: {
            zh: '只能通过本机地址访问 KindleForge（127.0.0.1 / localhost / [::1]）。',
            en: 'KindleForge accepts API requests only through localhost (127.0.0.1 / localhost / [::1]).',
          },
        },
      },
    };
  }
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code,
        message: 'This origin is not allowed to access the API.',
        hint: {
          zh: '跨站来源不允许调用 KindleForge API。',
          en: 'Cross-origin callers are not allowed to use the KindleForge API.',
        },
      },
    },
  };
}

/**
 * Validate a request's Host / Origin headers against the local-only allow-list.
 * `Host` is mandatory for API calls. `Origin` is optional (curl and same-origin
 * navigations omit it), but when present both its scheme and authority must be
 * allowed. `X-Forwarded-Host` is deliberately never consulted.
 */
export interface OriginGuardOptions {
  /**
   * Direct route-handler unit tests build `new Request(...)` without a Host
   * header. Real HTTP/1.1 and HTTP/2 requests always carry one, and Next
   * middleware enforces that; routes may opt into the same guard while still
   * accepting an absent Host so handler tests remain usable.
   */
  allowMissingHost?: boolean;
}

export function evaluateRequestOrigin(
  headers: Headers,
  env: NodeJS.ProcessEnv = process.env,
  options: OriginGuardOptions = {},
): OriginGuardResult {
  const allowed = allowedAuthorities(env);
  const hostHeader = headers.get('host');
  if (!hostHeader && options.allowMissingHost) {
    // Still validate Origin below when present.
  } else {
    const host = hostHeader ? parseAuthority(hostHeader) : null;
    if (!host || !allowed.has(authorityText(host))) return forbidden('FORBIDDEN_HOST');
  }

  const originHeader = headers.get('origin');
  if (originHeader !== null) {
    let origin: URL;
    try {
      origin = new URL(originHeader);
    } catch {
      return forbidden('FORBIDDEN_ORIGIN');
    }
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') {
      return forbidden('FORBIDDEN_ORIGIN');
    }
    const authority = parseAuthority(origin.host);
    if (!authority || !allowed.has(authorityText(authority))) {
      return forbidden('FORBIDDEN_ORIGIN');
    }
  }
  return { ok: true };
}
