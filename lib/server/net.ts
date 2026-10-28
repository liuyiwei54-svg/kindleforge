/**
 * Network safety helpers for user-supplied URLs (cover images).
 *
 * The library can download a cover from an arbitrary http(s) URL, which would
 * otherwise be an SSRF primitive: `http://127.0.0.1:...`, cloud metadata at
 * 169.254.169.254, LAN hosts, or a public hostname that resolves to a private
 * address. We resolve the hostname before every request and reject any
 * loopback / link-local / private / reserved address. Redirects are followed
 * manually so every hop passes the same check (a public URL cannot redirect to
 * `localhost`).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { badRequest } from './errors';

const BLOCKED_HOST_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];
const DNS_TIMEOUT_MS = 4000;

function privateUrl(): never {
  throw badRequest('This URL points to a private or reserved address.', {
    zh: '该地址指向本机或私有网络，出于安全考虑不能下载。',
    en: 'This URL points to a local or private network address and cannot be used.',
  });
}

function parseIPv4(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : Number.NaN));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
  return octets;
}

/** Public IPv4 only: reject loopback, private, CGNAT, link-local, docs, multicast, reserved. */
function isPublicIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  if (!octets) return false;
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function ipv6ToGroups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/^\[|\]$/g, '').split('%')[0] ?? '';
  if (!text) return null;
  // IPv4-mapped/embedded forms: check the embedded IPv4 explicitly.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(text) ?? /^64:ff9b::(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (mapped) return isPublicIPv4(mapped[1]!) ? [0x2001, 0x4860] : null;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    const embedded = text.slice(lastColon + 1);
    if (!parseIPv4(embedded)) return null;
    text = `${text.slice(0, lastColon)}:${isPublicIPv4(embedded) ? '1:1' : '0:0'}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0]!.split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1]!.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 && missing < 0) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right].map(
    (group) => (/^[0-9a-f]{1,4}$/i.test(group) ? Number.parseInt(group, 16) : Number.NaN),
  );
  return groups.length === 8 && groups.every((group) => Number.isInteger(group)) ? groups : null;
}

function isPublicIPv6(address: string): boolean {
  const groups = ipv6ToGroups(address);
  if (!groups) return false;
  const [first, second] = groups as [number, number, ...number[]];
  if (groups.every((group) => group === 0)) return false; // ::
  const isLoopback = groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1;
  if (isLoopback) return false;
  // IPv4-mapped was handled above; if we still see a mapped tail, reject it.
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) return false;
  if ((first & 0xfe00) === 0xfc00) return false; // unique local fc00::/7
  if ((first & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((first & 0xff00) === 0xff00) return false; // multicast
  if (first === 0x2001 && second === 0x0db8) return false; // documentation
  // Teredo (2001:0000::/32) is a public tunnel address, not a local range;
  // Open Library's CDN can resolve to one. Do not block it as private.
  return true;
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIPv4(address);
  if (family === 6) return isPublicIPv6(address);
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

async function resolvesToPublicOnly(hostname: string): Promise<boolean> {
  const addresses = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DNS_TIMEOUT')), DNS_TIMEOUT_MS);
      timer.unref?.();
    }),
  ]);
  if (!Array.isArray(addresses) || addresses.length === 0) return false;
  return addresses.every((entry) => isPublicAddress(entry.address));
}

/**
 * Validate a user-supplied URL. Throws a 400 ApiError for non-http(s), embedded
 * credentials, localhost-like names, or any address in a private/reserved range.
 */
export async function assertPublicHttpUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.toString()) : new URL(input);
  } catch {
    throw badRequest('The URL is invalid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('Only http(s) URLs are allowed.');
  }
  if (url.username || url.password) privateUrl();
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) privateUrl();

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) privateUrl();
    return url;
  }

  let publicOnly = false;
  try {
    publicOnly = await resolvesToPublicOnly(hostname);
  } catch {
    throw badRequest('The image host could not be resolved.');
  }
  if (!publicOnly) privateUrl();
  return url;
}
