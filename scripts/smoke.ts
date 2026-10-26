#!/usr/bin/env tsx
/**
 * End-to-end smoke test — no dev server required.
 *
 *   Chinese TXT → POST /api/convert → poll /api/jobs/:id → download EPUB
 *   → validate the EPUB with JSZip (mimetype first + STORED, container, OPF,
 *     nav, chapters, Chinese payload) → DELETE → verify tmp dir is gone.
 *
 * Usage: npx tsx scripts/smoke.ts
 * Exit:  0 all good · 1 any step failed
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { POST as convertRoute } from '../app/api/convert/route';
import { DELETE as deleteJobRoute, GET as getJobRoute } from '../app/api/jobs/[id]/route';
import { GET as downloadRoute } from '../app/api/jobs/[id]/download/route';
import { TMP_ROOT } from '../lib/server/storage';

type Json = Record<string, unknown>;

const BASE = 'http://127.0.0.1:3100';
let failures = 0;

function step(name: string): void {
  console.log(`\n▸ ${name}`);
}

function pass(message: string): void {
  console.log(`  ✓ ${message}`);
}

function fail(message: string): void {
  failures += 1;
  console.error(`  ✗ ${message}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (condition) pass(message);
  else fail(message);
}

async function json(response: Response): Promise<Json> {
  return (await response.json()) as Json;
}

async function readJob(jobId: string): Promise<Json> {
  const response = await getJobRoute(new Request(`${BASE}/api/jobs/${jobId}`), {
    params: Promise.resolve({ id: jobId }),
  });
  return json(response);
}

async function waitForJob(jobId: string, timeoutMs = 120_000): Promise<Json> {
  const started = Date.now();
  let last: Json = {};
  while (Date.now() - started < timeoutMs) {
    last = await readJob(jobId);
    if (last.status === 'done' || last.status === 'error') return last;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms (last status: ${String(last.status)})`);
}

function chineseTxt(): string {
  return [
    '测试之书',
    '',
    '第一章 起点',
    '',
    '深夜的城市像一本摊开的书，每一扇窗都是未读的一页。',
    '他合上电脑，听见楼下便利店的风铃响了一声。',
    '',
    '第二章 远行',
    '',
    '火车站的长椅很凉，月亮挂在站台的尽头。',
    '列车进站时带起一阵风，把票根吹到了铁轨旁。',
    '',
    '第三章 归途',
    '',
    '多年以后他仍然记得那本书的味道：纸张、灰尘，还有一点点雨。',
    'Kindle 的屏幕亮起来，像一盏很小很小的灯。',
    '',
  ].join('\n');
}

interface EpubReport {
  entries: string[];
  mimetypeFirst: boolean;
  mimetypeStored: boolean;
  mimetypeValue: string;
  hasContainer: boolean;
  opf: string | null;
  hasNav: boolean;
  chapters: number;
  hasChineseProse: boolean;
}

async function inspectEpub(bytes: Uint8Array): Promise<EpubReport> {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files);
  const first = names[0] ?? '';
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const mimetypeFirstHeader = header.getUint32(0, true) === 0x04034b50;
  const mimetypeMethod = header.getUint16(8, true);
  const mimetypeValue = zip.file('mimetype') ? await zip.file('mimetype')!.async('string') : '';
  const opf = names.find((name) => /\.opf$/i.test(name)) ?? null;
  const nav = names.some((name) => /(^|\/)nav\.xhtml$/i.test(name));
  const chapterFiles = names.filter(
    (name) => /\.x?html?$/i.test(name) && !/(^|\/)nav\.xhtml$/i.test(name),
  );
  const texts: string[] = [];
  for (const name of chapterFiles) {
    const file = zip.file(name);
    if (file) texts.push(await file.async('string'));
  }
  return {
    entries: names,
    mimetypeFirst: first === 'mimetype' && mimetypeFirstHeader,
    mimetypeStored: mimetypeMethod === 0,
    mimetypeValue,
    hasContainer: names.includes('META-INF/container.xml'),
    opf,
    hasNav: nav,
    chapters: chapterFiles.length,
    hasChineseProse: texts.join('\n').includes('第一章'),
  };
}

async function main(): Promise<void> {
  console.log('KindleForge smoke test');
  console.log(`tmp root: ${TMP_ROOT}`);

  step('1/6 Upload a Chinese TXT and ask for EPUB');
  const txt = chineseTxt();
  const form = new FormData();
  form.set('file', new File([new TextEncoder().encode(txt)], '测试之书.txt', { type: 'text/plain' }));
  form.set('target', 'epub');
  form.set(
    'options',
    JSON.stringify({
      device: 'paperwhite',
      typography: { indent: 2, lineHeight: 1.8, justify: true },
      toc: true,
    }),
  );
  // Encode the multipart body so Content-Length is present, exactly like fetch/curl.
  const encoded = new Response(form);
  const payload = await encoded.arrayBuffer();
  const upload = await convertRoute(
    new Request(`${BASE}/api/convert`, {
      method: 'POST',
      headers: {
        'content-type': encoded.headers.get('content-type') ?? 'multipart/form-data',
        'content-length': String(payload.byteLength),
      },
      body: payload,
    }),
  );
  const uploadBody = await json(upload);
  assert(upload.status === 202, `POST /api/convert → ${upload.status} (expected 202)`);
  const jobId = typeof uploadBody.jobId === 'string' ? uploadBody.jobId : '';
  assert(Boolean(jobId), `jobId = ${jobId}`);
  if (!jobId) return;
  assert(
    upload.headers.get('cache-control')?.includes('no-store') === true,
    'response is Cache-Control: no-store',
  );

  step('2/6 Poll the job until it finishes');
  const started = Date.now();
  const job = await waitForJob(jobId);
  assert(job.status === 'done', `job status = ${String(job.status)} in ${Date.now() - started}ms`);
  if (job.status !== 'done') {
    fail(`job error: ${JSON.stringify(job.error)}`);
    return;
  }
  const result = (job.result ?? {}) as Json;
  assert(typeof result.filename === 'string' && /\.epub$/i.test(result.filename), `filename = ${String(result.filename)}`);
  assert(typeof job.engine === 'string' && job.engine.length > 0, `engine = ${String(job.engine)}`);
  assert(Number(job.durationMs) >= 0, `duration = ${String(job.durationMs)}ms`);
  assert(Array.isArray(job.warnings), `warnings = ${JSON.stringify(job.warnings)}`);
  assert(
    result.downloadUrl === `/api/jobs/${jobId}/download`,
    `downloadUrl = ${String(result.downloadUrl)}`,
  );

  step('3/6 Download the EPUB');
  const download = await downloadRoute(new Request(`${BASE}${String(result.downloadUrl)}`), {
    params: Promise.resolve({ id: jobId }),
  });
  assert(download.status === 200, `GET download → ${download.status}`);
  const disposition = download.headers.get('content-disposition') ?? '';
  assert(
    disposition.includes("filename*=UTF-8''") && disposition.includes('%E6%B5%8B'),
    `Content-Disposition encodes the Chinese name: ${disposition}`,
  );
  assert(
    (download.headers.get('content-type') ?? '').includes('epub'),
    `Content-Type = ${String(download.headers.get('content-type'))}`,
  );
  const bytes = new Uint8Array(await download.arrayBuffer());
  assert(bytes.byteLength > 500, `downloaded ${bytes.byteLength} bytes`);
  assert(
    Number(download.headers.get('content-length')) === bytes.byteLength,
    'Content-Length matches the body',
  );

  step('4/6 Validate the EPUB structure');
  let report: EpubReport | null = null;
  try {
    report = await inspectEpub(bytes);
  } catch (error) {
    fail(`EPUB could not be opened by JSZip: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
  assert(report.mimetypeFirst, `mimetype is the first entry (got "${report.entries[0] ?? ''}")`);
  assert(report.mimetypeStored, 'mimetype is STORED (uncompressed)');
  assert(report.mimetypeValue === 'application/epub+zip', `mimetype = ${report.mimetypeValue}`);
  assert(report.hasContainer, 'META-INF/container.xml exists');
  assert(report.opf !== null, `OPF package document exists (${report.opf ?? 'missing'})`);
  assert(report.hasNav, 'nav.xhtml exists (EPUB 3 navigation)');
  assert(report.chapters >= 1, `${report.chapters} chapter XHTML file(s)`);
  assert(report.hasChineseProse, 'chapter text contains the Chinese content');

  if (report.opf) {
    const opfText = await JSZip.loadAsync(bytes).then((zip) => zip.file(report!.opf!)!.async('string'));
    assert(/<spine[\s>]/.test(opfText), 'OPF has a <spine>');
    assert(/<manifest[\s>]/.test(opfText), 'OPF has a <manifest>');
  }

  step('5/6 DELETE the job (immediate zero-retention)');
  const deleted = await deleteJobRoute(new Request(`${BASE}/api/jobs/${jobId}`, { method: 'DELETE' }), {
    params: Promise.resolve({ id: jobId }),
  });
  assert(deleted.status === 204, `DELETE → ${deleted.status}`);

  const afterDelete = await getJobRoute(new Request(`${BASE}/api/jobs/${jobId}`), {
    params: Promise.resolve({ id: jobId }),
  });
  assert(afterDelete.status === 404, `GET after DELETE → ${afterDelete.status}`);

  step('6/6 Verify the temp directory is cleaned up');
  const jobDir = join(TMP_ROOT, jobId);
  assert(!existsSync(jobDir), `${jobDir} no longer exists`);

  console.log('\n' + '─'.repeat(56));
  if (failures === 0) {
    console.log('SMOKE PASS — TXT → EPUB → download → cleanup verified.');
  } else {
    console.error(`SMOKE FAIL — ${failures} assertion(s) failed.`);
  }
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error('\nSMOKE CRASH:', error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
