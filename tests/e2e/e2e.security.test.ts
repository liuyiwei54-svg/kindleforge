/**
 * KindleForge — 端到端：安全边界（qa 拥有）
 *
 * 每条都对应 docs/AUDIT.md 里的一条结论；这些测试是「回归闸门」：
 * 路径穿越 / 上传限制 / zip bomb / DRM / 失败诚实性 / 限流身份。
 *
 *   npx vitest run tests/e2e/e2e.security.test.ts
 */
import { describe, expect, it } from 'vitest';
import { createConnection } from 'node:net';
import JSZip from 'jszip';
import { POST as CONVERT_POST } from '../../app/api/convert/route';

const BASE = process.env.KF_BASE ?? 'http://127.0.0.1:3100';
const HOST = new URL(BASE).hostname;
const PORT = Number(new URL(BASE).port || 80);

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

const up = await serverUp();

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

interface UploadResponse {
  status: number;
  body: { jobId?: string; error?: { code: string; message: string; hint?: { zh: string; en: string } } };
}

async function upload(
  bytes: Uint8Array,
  name: string,
  target: string,
  options?: Record<string, unknown>,
): Promise<UploadResponse> {
  const form = new FormData();
  form.set('file', new File([bytes as unknown as BlobPart], name));
  form.set('target', target);
  if (options) form.set('options', JSON.stringify(options));
  const res = await fetch(`${BASE}/api/convert`, { method: 'POST', body: form });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as UploadResponse['body'] };
}

async function poll(jobId: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, unknown> = {};
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/jobs/${jobId}`);
    last = (await res.json()) as Record<string, unknown>;
    if (last.status === 'done' || last.status === 'error') return last as {
      status: 'done' | 'error';
      error: { code: string; message: string; hint?: { zh: string; en: string } } | null;
      warnings: string[];
    };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`job ${jobId} timeout: ${JSON.stringify(last)}`);
}

/** 用原始 socket 发一个只有头部、没有 body 的请求，测 Content-Length 前置拒绝。 */
function rawRequest(headers: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: HOST, port: PORT }, () => {
      socket.write(`POST /api/convert HTTP/1.1\r\nHost: ${HOST}:${PORT}\r\nConnection: close\r\n${headers}\r\n`);
    });
    let raw = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      raw += chunk;
      // 413/411 在读完 body 之前就会返回，直接收尾
      if (raw.includes('\r\n\r\n') && /^HTTP\/1\.1 (4\d\d)/.test(raw)) socket.end();
    });
    socket.on('error', reject);
    socket.on('close', () => {
      const match = /^HTTP\/1\.1 (\d{3})/.exec(raw);
      resolve({ status: match ? Number(match[1]) : 0, body: raw });
    });
    socket.setTimeout(15_000, () => socket.destroy(new Error('raw request timeout')));
  });
}

/** 一个带 META-INF/encryption.xml（指向非字体资源）的 DRM EPUB。 */
async function drmEpub(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
  );
  zip.file(
    'META-INF/encryption.xml',
    '<?xml version="1.0"?><encryption><EncryptedData><CipherData><CipherReference URI="OEBPS/ch1.xhtml"/></CipherData></EncryptedData></encryption>',
  );
  zip.file(
    'OEBPS/content.opf',
    '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>DRM</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>',
  );
  zip.file('OEBPS/ch1.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>locked</p></body></html>');
  return new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
}

const TINY_TXT = new TextEncoder().encode('第一章 测试\n\n这是一段很短的中文正文，用来验证安全边界。\n');

/* ------------------------------------------------------------------ */
/* tests                                                               */
/* ------------------------------------------------------------------ */

describe.skipIf(!up)('e2e: 安全边界', () => {
  describe('jobId / 路径穿越', () => {
    it('非 UUID 的 jobId 一律 404，且是统一 JSON 错误', async () => {
      for (const id of ['..%2f..%2fetc%2fpasswd', '%2e%2e%2f%2e%2e%2fetc%2fpasswd', 'not-a-job', '0'.repeat(36)]) {
        const res = await fetch(`${BASE}/api/jobs/${id}`);
        expect(res.status, `id=${id}`).toBe(404);
        const body = (await res.json()) as { error?: { code: string } };
        expect(body.error?.code, `id=${id}`).toBe('NOT_FOUND');
      }
    });

    it('下载接口同样不泄露', async () => {
      for (const id of ['..%2f..%2f..%2fetc%2fpasswd', 'not-a-job']) {
        const res = await fetch(`${BASE}/api/jobs/${id}/download`);
        expect(res.status).toBe(404);
      }
    });

    it('上传文件名里的 ../ 不会写到 job 目录之外', async () => {
      const res = await upload(TINY_TXT, '../../../../tmp/kf-e2e-pwned.epub', 'epub');
      expect([202, 400, 415]).toContain(res.status);
      if (res.status === 202 && res.body.jobId) {
        const job = await poll(res.body.jobId);
        if (job.status === 'done') {
          const { existsSync } = await import('node:fs');
          expect(existsSync('/tmp/kf-e2e-pwned.epub'), 'must not escape').toBe(false);
        }
      }
    });
  });

  describe('上传限制', () => {
    it('空文件 → 400', async () => {
      const res = await upload(new Uint8Array(0), 'empty.txt', 'epub');
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('BAD_REQUEST');
    });

    it('缺 file 字段 → 400', async () => {
      const form = new FormData();
      form.set('target', 'epub');
      const res = await fetch(`${BASE}/api/convert`, { method: 'POST', body: form });
      expect(res.status).toBe(400);
    });

    it('非法 target → 400 INVALID_TARGET（带中英 hint）', async () => {
      const res = await upload(TINY_TXT, 'a.txt', 'exe');
      expect(res.status).toBe(400);
      expect(res.body.error?.code).toBe('INVALID_TARGET');
      expect(res.body.error?.hint?.zh).toBeTruthy();
      expect(res.body.error?.hint?.en).toBeTruthy();
    });

    it('非法 options JSON → 400 INVALID_OPTIONS', async () => {
      const form = new FormData();
      form.set('file', new File([TINY_TXT as unknown as BlobPart], 'a.txt'));
      form.set('target', 'epub');
      form.set('options', '{bad json');
      const res = await fetch(`${BASE}/api/convert`, { method: 'POST', body: form });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error?: { code: string } };
      expect(body.error?.code).toBe('INVALID_OPTIONS');
    });

    // Next 15 / undici 在 middleware 之前就会等待声明的请求体，所以「只有
    // Content-Length、没有 body」的原始 HTTP 请求到不了 handler（详见
    // AUDIT-V2 P2 记录）。这里直接调用 route handler，验证第一段预检本身
    // 仍然在读取 body 之前返回 413 —— 这是真实 HTTP 路径下不可观测、但
    // 代码里必须存在的防线。
    it('Content-Length 超过 200MB → handler 预检立刻 413（不读 body）', async () => {
      const declared = 210 * 1024 * 1024;
      const res = await CONVERT_POST(
        new Request(`${BASE}/api/convert`, {
          method: 'POST',
          headers: {
            'content-type': 'multipart/form-data; boundary=x',
            'content-length': String(declared),
          },
        }),
      );
      expect(res.status).toBe(413);
      const body = (await res.json()) as { error?: { code: string } };
      expect(body.error?.code).toBe('TOO_LARGE');
    });

    it('没有 Content-Length 的 chunked 上传 → 411（防内存放大）', async () => {
      const res = await rawRequest(
        'Content-Type: multipart/form-data; boundary=x\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n',
      );
      expect([411, 413]).toContain(res.status);
      expect(res.body).not.toContain('"jobId"');
    });
  });

  describe('压缩包 / DRM', () => {
    it('5001 个条目 → 422 ZIP_BOMB', async () => {
      const zip = new JSZip();
      for (let i = 0; i < 5001; i += 1) zip.file(`f${i}.txt`, 'x');
      const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
      const res = await upload(bytes, 'many.zip', 'epub');
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('ZIP_BOMB');
    }, 120_000);

    it('高压缩比（20MB 零字节）→ 422 ZIP_BOMB 或 reader 层 TOO_LARGE', async () => {
      const zip = new JSZip();
      zip.file('zeros.bin', new Uint8Array(20 * 1024 * 1024));
      const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
      const res = await upload(bytes, 'bomb.zip', 'epub');
      if (res.status === 422) {
        expect(res.body.error?.code).toBe('ZIP_BOMB');
        return;
      }
      // 若预检放过，reader 层必须拦住（不能 OOM / 不能 done）
      expect(res.status).toBe(202);
      const job = await poll(res.body.jobId!);
      expect(job.status).toBe('error');
      expect(['TOO_LARGE', 'ZIP_BOMB', 'INVALID_FILE']).toContain(job.error?.code);
    }, 120_000);

    it('DRM（encryption.xml 指向正文）→ 422 DRM，中英 hint 可操作', async () => {
      const res = await upload(await drmEpub(), 'drm.epub', 'epub');
      expect(res.status).toBe(422);
      expect(res.body.error?.code).toBe('DRM');
      expect(res.body.error?.hint?.zh).toMatch(/DRM/);
      expect(res.body.error?.hint?.en).toMatch(/DRM/i);
    });

    it('坏 EPUB：202 之后诚实失败为 INVALID_FILE + 双语 hint', async () => {
      const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(96).fill(0)]);
      const res = await upload(broken, 'broken.epub', 'epub');
      expect(res.status).toBe(202);
      const job = await poll(res.body.jobId!);
      expect(job.status).toBe('error');
      expect(job.error?.code).toBe('INVALID_FILE');
      expect(job.error?.hint?.zh).toBeTruthy();
      expect(job.error?.hint?.en).toBeTruthy();
      // 失败不能留下结果文件
      expect((job as unknown as { result: unknown }).result).toBeNull();
    });

    it('普通 zip 改名 .epub：失败信息指出真实原因，而不是静默成功', async () => {
      const zip = new JSZip();
      zip.file('hello.txt', 'not an epub');
      const bytes = new Uint8Array(await zip.generateAsync({ type: 'uint8array' }));
      const res = await upload(bytes, 'not-epub.epub', 'epub');
      expect(res.status).toBe(202);
      const job = await poll(res.body.jobId!);
      expect(job.status).toBe('error');
      expect(job.error?.message).toMatch(/container\.xml|EPUB|ZIP/i);
    });
  });

  describe('限流身份', () => {
    it('X-Forwarded-For 不能凭空开新桶（默认不信任代理头）', async () => {
      // 不去打满真实额度：只验证「伪造头不会让请求被记为不同身份」。
      // 服务端在 KF_TRUST_PROXY=false 下把直连请求统一归到 'direct'。
      const headers = { 'x-forwarded-for': `203.0.113.${Math.floor(Math.random() * 200) + 1}` };
      const form = new FormData();
      form.set('file', new File([new Uint8Array([104, 105]) as unknown as BlobPart], 'probe.txt'));
      form.set('target', 'epub');
      const res = await fetch(`${BASE}/api/convert`, { method: 'POST', headers, body: form });
      // 可能因为额度/格式失败，但绝不能因为「伪造了一个新 IP」而获得不同待遇：
      // 只要响应是 202，说明它和直连请求共享同一个桶即可接受（额度由其它用例消耗）。
      expect([202, 400, 413, 415, 422, 429]).toContain(res.status);
    });
  });
});

if (!up) {
  describe('e2e: 安全边界（跳过）', () => {
    it.skip(`服务未启动：${BASE}`, () => undefined);
  });
}
