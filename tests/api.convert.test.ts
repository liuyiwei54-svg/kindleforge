import { existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { POST } from '../app/api/convert/route';
import { DELETE, GET } from '../app/api/jobs/[id]/route';
import { GET as DOWNLOAD } from '../app/api/jobs/[id]/download/route';
import { getJobStore } from '../lib/server/jobs';
import { engineAvailability } from '../lib/server/engines';
import { TMP_ROOT, writeJobFile } from '../lib/server/storage';

const BASE = 'http://127.0.0.1:3100';

interface PublicJobBody {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  engine: string | null;
  warnings: string[];
  durationMs: number | null;
  error: { code: string; message: string; hint?: { zh: string; en: string } } | null;
  result: { filename: string; size: number; mime: string; downloadUrl: string } | null;
}

interface ErrorBody {
  error: { code: string; message: string; hint?: { zh: string; en: string } };
}

function formWith(fields: { file?: File; target?: string; options?: string }): FormData {
  const form = new FormData();
  if (fields.file) form.set('file', fields.file);
  if (fields.target !== undefined) form.set('target', fields.target);
  if (fields.options !== undefined) form.set('options', fields.options);
  return form;
}

/** Encode the multipart body explicitly so Content-Length is present (like fetch/curl). */
async function post(fields: { file?: File; target?: string; options?: string }): Promise<Response> {
  const encoded = new Response(formWith(fields));
  const payload = await encoded.arrayBuffer();
  return POST(
    new Request(`${BASE}/api/convert`, {
      method: 'POST',
      headers: {
        'content-type': encoded.headers.get('content-type') ?? 'multipart/form-data',
        'content-length': String(payload.byteLength),
      },
      body: payload,
    }),
  );
}

function getJob(id: string): Promise<Response> {
  return GET(new Request(`${BASE}/api/jobs/${id}`), { params: Promise.resolve({ id }) });
}

function downloadJob(id: string): Promise<Response> {
  return DOWNLOAD(new Request(`${BASE}/api/jobs/${id}/download`), {
    params: Promise.resolve({ id }),
  });
}

function deleteJob(id: string): Promise<Response> {
  return DELETE(new Request(`${BASE}/api/jobs/${id}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id }),
  });
}

async function readJob(id: string): Promise<PublicJobBody> {
  const response = await getJob(id);
  return (await response.json()) as PublicJobBody;
}

async function waitForJob(id: string, timeoutMs = 120_000): Promise<PublicJobBody> {
  const started = Date.now();
  let last: PublicJobBody | null = null;
  while (Date.now() - started < timeoutMs) {
    last = await readJob(id);
    if (last.status === 'done' || last.status === 'error') return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`job ${id} did not finish; last=${JSON.stringify(last)}`);
}

const sampleTxt = [
  '测试之书',
  '',
  '第一章 起点',
  '',
  '深夜的城市像一本摊开的书，每一扇窗都是未读的一页。',
  '',
  '第二章 远行',
  '',
  '火车站的长椅很凉，月亮挂在站台的尽头。',
  '',
  '第三章 归途',
  '',
  '多年以后他仍然记得那本书的味道。',
  '',
].join('\n');

function txtFile(name = '测试之书.txt'): File {
  return new File([new TextEncoder().encode(sampleTxt)], name, { type: 'text/plain' });
}

describe('POST /api/convert', () => {
  it('rejects an invalid target with 400 INVALID_TARGET', async () => {
    const response = await post({ file: txtFile(), target: 'azw' });
    const body = (await response.json()) as ErrorBody;
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(body.error.code).toBe('INVALID_TARGET');
    expect(body.error.hint?.zh).toBeTruthy();
    expect(body.error.hint?.en).toBeTruthy();
  });

  it('rejects malformed options JSON with 400 INVALID_OPTIONS', async () => {
    const badJson = await post({ file: txtFile(), target: 'epub', options: '{not json' });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as ErrorBody).error.code).toBe('INVALID_OPTIONS');

    const badShape = await post({
      file: txtFile(),
      target: 'epub',
      options: JSON.stringify({ typography: { indent: 'two' } }),
    });
    expect(badShape.status).toBe(400);
    expect(((await badShape.json()) as ErrorBody).error.code).toBe('INVALID_OPTIONS');
  });

  it('rejects an unsupported format pair with 415 UNSUPPORTED_PAIR', async () => {
    const pdf = new File([new TextEncoder().encode('%PDF-1.4\n% smoke\n')], 'sample.pdf', {
      type: 'application/pdf',
    });
    const response = await post({ file: pdf, target: 'html' });
    const body = (await response.json()) as ErrorBody;
    expect(response.status).toBe(415);
    expect(body.error.code).toBe('UNSUPPORTED_PAIR');
    expect(body.error.hint?.zh).toBeTruthy();
  });

  it('rejects an upload whose Content-Length exceeds 200MB with 413', async () => {
    const request = new Request(`${BASE}/api/convert`, {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=----smoke' },
      body: 'tiny',
    });
    request.headers.set('content-length', String(250 * 1024 * 1024));
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(((await response.json()) as ErrorBody).error.code).toBe('TOO_LARGE');
  });

  it('runs the full TXT → EPUB flow: 202, poll, download, validate, delete', async () => {
    const upload = await post({
      file: txtFile(),
      target: 'epub',
      options: JSON.stringify({
        device: 'paperwhite',
        typography: { indent: 2, lineHeight: 1.8, justify: true },
        toc: true,
      }),
    });
    expect(upload.status).toBe(202);
    expect(upload.headers.get('cache-control')).toContain('no-store');
    const { jobId } = (await upload.json()) as { jobId: string };
    expect(jobId).toMatch(/^[0-9a-f-]{36}$/i);

    const job = await waitForJob(jobId);
    expect(job.error).toBeNull();
    expect(job.status).toBe('done');
    expect(job.progress).toBe(100);
    expect(job.engine).toBeTruthy();
    expect(typeof job.durationMs).toBe('number');
    expect(job.result?.filename).toMatch(/\.epub$/i);
    expect(job.result?.mime).toContain('epub');
    expect(job.result?.downloadUrl).toBe(`/api/jobs/${jobId}/download`);

    const response = await downloadJob(jobId);
    expect(response.status).toBe(200);
    const disposition = response.headers.get('content-disposition') ?? '';
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain('%E6%B5%8B'); // 测
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('content-type')).toContain('epub');

    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(Number(response.headers.get('content-length'))).toBe(bytes.byteLength);
    expect(bytes.byteLength).toBeGreaterThan(500);

    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    // OCF requires the mimetype entry to be the first local file header and STORED.
    const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(header.getUint32(0, true)).toBe(0x04034b50);
    expect(header.getUint16(8, true)).toBe(0); // 0 = STORED / uncompressed
    expect(header.getUint16(26, true)).toBe('mimetype'.length);
    expect(names).toContain('META-INF/container.xml');

    const opfName = names.find((name) => /\.opf$/i.test(name));
    expect(opfName).toBeTruthy();
    expect(names.some((name) => /(^|\/)nav\.xhtml$/i.test(name))).toBe(true);

    const chapterNames = names.filter(
      (name) => /\.x?html?$/i.test(name) && !/(^|\/)nav\.xhtml$/i.test(name),
    );
    expect(chapterNames.length).toBeGreaterThan(0);
    const chaptersText: string[] = [];
    for (const name of chapterNames) {
      const file = zip.file(name);
      if (file) chaptersText.push(await file.async('string'));
    }
    expect(chaptersText.join('\n')).toContain('第一章');

    const directory = join(TMP_ROOT, jobId);
    expect(existsSync(directory)).toBe(true); // retained until TTL / explicit delete

    const deleted = await deleteJob(jobId);
    expect(deleted.status).toBe(204);
    expect(existsSync(directory)).toBe(false);

    const afterDelete = await getJob(jobId);
    expect(afterDelete.status).toBe(404);
    expect(((await afterDelete.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  }, 180_000);

  it('serves a finished job download twice (retained until TTL) with CJK headers', async () => {
    const store = getJobStore();
    const job = store.create({
      source: { name: '测试 书.txt', size: 10, format: 'txt' },
      target: 'epub',
    });
    const payload = new TextEncoder().encode('epub-bytes-for-header-test');
    await writeJobFile(job.id, 'output.epub', payload);
    store.update(job.id, {
      status: 'done',
      progress: 100,
      engine: 'builtin',
      resultPath: 'output.epub',
      resultName: '测试 书.epub',
      resultMime: 'application/epub+zip',
      resultSize: payload.byteLength,
      durationMs: 5,
    });

    const queuedReady = await downloadJob(job.id);
    expect(queuedReady.status).toBe(200);
    expect(queuedReady.headers.get('content-type')).toBe('application/epub+zip');
    expect(Number(queuedReady.headers.get('content-length'))).toBe(payload.byteLength);
    const disposition = queuedReady.headers.get('content-disposition') ?? '';
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain('%E6%B5%8B%E8%AF%95');
    expect(new Uint8Array(await queuedReady.arrayBuffer())).toEqual(payload);

    // Downloading does not delete the job — a second download still works.
    const second = await downloadJob(job.id);
    expect(second.status).toBe(200);

    expect((await deleteJob(job.id)).status).toBe(204);
    expect((await downloadJob(job.id)).status).toBe(404);
  }, 30_000);

  it('fails honestly: a broken EPUB returns an actionable structured error', async () => {
    const zip = new JSZip();
    zip.file('random.txt', 'not an epub at all');
    const generated = await zip.generateAsync({ type: 'uint8array' });
    const buffer = new ArrayBuffer(generated.byteLength);
    new Uint8Array(buffer).set(generated);
    const broken = new File([buffer], 'broken.epub', { type: 'application/epub+zip' });

    const upload = await post({ file: broken, target: 'txt' });
    expect(upload.status).toBe(202);
    const { jobId } = (await upload.json()) as { jobId: string };
    const job = await waitForJob(jobId, 60_000);

    expect(job.status).toBe('error');
    expect(job.error).not.toBeNull();
    const diagnostics = `${job.error?.message ?? ''} ${job.warnings.join(' ')}`;
    expect(diagnostics.trim().length).toBeGreaterThan(20);
    // The bare generic failure is exactly what we promised not to return.
    expect(diagnostics.trim()).not.toBe('Conversion failed.');
    // P2: never paste the exact same stderr into both warnings and message.
    for (const warning of job.warnings) {
      const detail = warning.replace(/^ENGINE_FAILURE:\s*/, '').trim();
      if (detail.length > 40) expect(job.error?.message ?? '').not.toContain(detail.slice(-40));
    }
    await deleteJob(jobId);
  }, 90_000);

  it('puts calibre stderr in structured warnings, not in error.message', async () => {
    const engines = await engineAvailability();
    if (!engines.calibre) return; // optional engine; the suite still passes without it

    const zip = new JSZip();
    zip.file('random.txt', 'definitely not an epub');
    const generated = await zip.generateAsync({ type: 'uint8array' });
    const buffer = new ArrayBuffer(generated.byteLength);
    new Uint8Array(buffer).set(generated);
    const broken = new File([buffer], 'calibre-broken.epub', { type: 'application/epub+zip' });

    const upload = await post({ file: broken, target: 'mobi' });
    expect(upload.status).toBe(202);
    const { jobId } = (await upload.json()) as { jobId: string };
    const job = await waitForJob(jobId, 120_000);

    expect(job.status).toBe('error');
    expect(job.error?.hint?.zh).toBeTruthy();
    const warning = job.warnings.find((entry) => entry.startsWith('ENGINE_FAILURE:'));
    expect(warning).toBeTruthy();
    const warningDetail = (warning ?? '').replace(/^ENGINE_FAILURE:\s*/, '').trim();
    expect(warningDetail.length).toBeGreaterThan(20);
    // Short message + structured warning: the stderr tail lives in exactly one place.
    expect(job.error?.message ?? '').not.toContain(warningDetail.slice(-60));
    expect((job.error?.message ?? '').length).toBeLessThan(300);
    expect(job.error?.message ?? '').not.toContain('\n');
    // Privacy: absolute server temp paths must never reach the client.
    const exposed = JSON.stringify({ error: job.error, warnings: job.warnings });
    expect(exposed).not.toMatch(/\/var\/folders|\/tmp\/|file:\/\//);
    await deleteJob(jobId);
  }, 150_000);

  it('accepts tessdata OCR language names (chi_sim / chi_tra / chi_sim+eng)', async () => {
    // Validation-level: these used to fail INVALID_OPTIONS, blocking OCR UI.
    for (const language of ['chi_sim', 'chi_tra', 'chi_sim+eng']) {
      const upload = await post({
        file: txtFile(),
        target: 'epub',
        options: JSON.stringify({ ocr: true, ocrLanguage: language }),
      });
      expect(upload.status).toBe(202);
      const { jobId } = (await upload.json()) as { jobId: string };
      await waitForJob(jobId, 60_000);
      await deleteJob(jobId);
    }
  }, 180_000);

  it('direct mode lets a 21-request batch through (21st is still 202)', async () => {
    const jobIds: string[] = [];
    for (let i = 0; i < 21; i += 1) {
      const response = await post({ file: txtFile(`batch-${i}.txt`), target: 'epub' });
      expect(response.status, `request ${i + 1} should not be rate limited`).toBe(202);
      jobIds.push(((await response.json()) as { jobId: string }).jobId);
    }
    for (const id of jobIds) await deleteJob(id);
  }, 120_000);

  it('returns 409 while a job is still running', async () => {
    const store = getJobStore();
    const job = store.create({
      source: { name: 'waiting.txt', size: 3, format: 'txt' },
      target: 'epub',
    });
    expect(job.status).toBe('queued');
    const response = await downloadJob(job.id);
    expect(response.status).toBe(409);
    expect(((await response.json()) as ErrorBody).error.code).toBe('RESULT_NOT_READY');
    await deleteJob(job.id);
  });

  it('returns 404 for an unknown job id', async () => {
    const response = await getJob('00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
    expect(((await response.json()) as ErrorBody).error.code).toBe('NOT_FOUND');
  });
});
