/**
 * KindleForge — 端到端：真实转换（qa 拥有，不修改产品代码）
 *
 * 这些测试**必须打到真实服务**（默认 http://127.0.0.1:3100），并且真的转换文件。
 * 服务没起来 → 整组 skip（不算失败）；服务在但没有 calibre/tesseract → 对应用例 skip。
 *
 *   npx vitest run tests/e2e
 *   KF_BASE=http://127.0.0.1:3101 npx vitest run tests/e2e   # 打别的实例
 *
 * 断言口径来自 docs/CONTRACT.md §3：
 *   - EPUB 必须是合法 EPUB 3：mimetype 首条且 STORED、container.xml、OPF、nav.xhtml、NCX
 *   - 中文不能丢、不能乱码；TXT 要识别「第X章」
 *   - MOBI/AZW3 的 offset 60 必须是 BOOKMOBI
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

const BASE = process.env.KF_BASE ?? 'http://127.0.0.1:3100';
const FIXTURES = new URL('../fixtures/', import.meta.url).pathname;
const TMP_ROOT = join(tmpdir(), 'kindleforge');

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

interface JobError {
  code: string;
  message: string;
  hint?: { zh: string; en: string };
}

interface JobBody {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  engine: string | null;
  warnings: string[];
  error: JobError | null;
  result: { filename: string; size: number; mime: string; downloadUrl: string } | null;
}

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function engines(): Promise<{ calibre: boolean; pandoc: boolean; tesseract: boolean }> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    const body = (await res.json()) as { engines?: { calibre: boolean; pandoc: boolean; tesseract: boolean } };
    return body.engines ?? { calibre: false, pandoc: false, tesseract: false };
  } catch {
    return { calibre: false, pandoc: false, tesseract: false };
  }
}

async function submit(input: {
  bytes: Uint8Array;
  name: string;
  target: string;
  options?: unknown;
}): Promise<{ jobId: string } | { error: JobError }> {
  const form = new FormData();
  form.set('file', new File([input.bytes as unknown as BlobPart], input.name));
  form.set('target', input.target);
  if (input.options !== undefined) form.set('options', JSON.stringify(input.options));
  const res = await fetch(`${BASE}/api/convert`, { method: 'POST', body: form });
  const body = (await res.json().catch(() => ({}))) as { jobId?: string; error?: JobError };
  if (!res.ok) {
    if (res.status === 429) {
      throw new Error(
        `429 RATE_LIMITED —— 服务端本小时额度已用尽（见 docs/AUDIT.md P1-2）。` +
          `请等额度窗口重置，或调大 KF_RATE_LIMIT_* 后重跑。body=${JSON.stringify(body)}`,
      );
    }
    return { error: body.error ?? { code: `HTTP_${res.status}`, message: 'no error body' } };
  }
  if (!body.jobId) throw new Error(`no jobId in response: ${JSON.stringify(body)}`);
  return { jobId: body.jobId };
}

async function poll(jobId: string, timeoutMs = 180_000): Promise<JobBody> {
  const deadline = Date.now() + timeoutMs;
  let last: JobBody | undefined;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/jobs/${jobId}`, { signal: AbortSignal.timeout(5000) });
    last = (await res.json()) as JobBody;
    if (last.status === 'done' || last.status === 'error') return last;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`job ${jobId} did not finish in ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

async function convert(input: {
  bytes: Uint8Array;
  name: string;
  target: string;
  options?: unknown;
  timeoutMs?: number;
}): Promise<{ job: JobBody; data: Uint8Array; headers: Headers }> {
  const submitted = await submit(input);
  if ('error' in submitted) throw new Error(`submit failed: ${JSON.stringify(submitted.error)}`);
  const job = await poll(submitted.jobId, input.timeoutMs);
  if (job.status !== 'done') throw new Error(`conversion failed: ${JSON.stringify(job.error)} warnings=${JSON.stringify(job.warnings)}`);
  const res = await fetch(`${BASE}${job.result!.downloadUrl}`, { signal: AbortSignal.timeout(30_000) });
  expect(res.ok).toBe(true);
  const data = new Uint8Array(await res.arrayBuffer());
  return { job, data, headers: res.headers };
}

/** 断言一个合法 EPUB 3，并返回解包后的 zip 便于继续断言内容。 */
async function assertValidEpub(bytes: Uint8Array, label: string): Promise<JSZip> {
  expect(bytes.byteLength, `${label}: non-empty`).toBeGreaterThan(0);
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files);
  expect(entries.length, `${label}: has entries`).toBeGreaterThan(3);

  // mimetype 必须是第一个条目且 STORED（未压缩）
  const raw = bytes;
  const firstNameLen = raw[26] | (raw[27] << 8);
  const firstName = new TextDecoder().decode(raw.subarray(30, 30 + firstNameLen));
  expect(firstName, `${label}: mimetype is first entry`).toBe('mimetype');
  const method = raw[8] | (raw[9] << 8);
  expect(method, `${label}: mimetype is STORED`).toBe(0);
  expect(await zip.file('mimetype')!.async('string'), `${label}: mimetype content`).toBe('application/epub+zip');

  expect(entries, `${label}: container.xml`).toContain('META-INF/container.xml');
  const opfPath = entries.find((name) => name.endsWith('.opf'));
  expect(opfPath, `${label}: OPF present`).toBeTruthy();
  const opf = await zip.file(opfPath!)!.async('string');
  expect(opf, `${label}: OPF has identifier`).toMatch(/<dc:identifier[^>]*>[^<]+<\/dc:identifier>/);
  expect(opf, `${label}: OPF has title`).toContain('<dc:title');

  const navPath = entries.find((name) => name.endsWith('nav.xhtml') || name.endsWith('nav.html'));
  expect(navPath, `${label}: EPUB3 nav present`).toBeTruthy();
  expect(entries.some((name) => name.endsWith('.ncx')), `${label}: NCX present`).toBe(true);
  return zip;
}

async function epubText(zip: JSZip): Promise<string> {
  const names = Object.keys(zip.files).filter((name) => /\.(xhtml|html|ncx)$/i.test(name));
  const parts: string[] = [];
  for (const name of names) parts.push(await zip.file(name)!.async('string'));
  return parts.join('\n');
}

function decodeGbk(bytes: Uint8Array): string {
  return new TextDecoder('gb18030').decode(bytes);
}

/** 中文 TXT（GB18030 编码），内联成 base64 以免依赖外部样本。 */
const GB18030_TXT_B64 =
  'tdrSu9XCINK5ur0K0rnA78/Cuf3T6qOsx+DKr7DlwrfJz7u5u/3XxcuuoaPL+9W+1NrDxb/ao6yw0cmhytXG8MC0oaMKobDT0MjLwvCjv6Gxy/vOyqGjzt3A78O709C72Mn5o6zWu9PQ0rvVtbXG1Nq358Dvu86howoKtdq2/tXCIL7Jyum16grK6bXqtcTDxcrH0OnR2rXEoaPNxsPFvfjIpaOsweXu9c/swcvSu8n5oaMK7OnSs8nP09DSu9DQx6axytfWo7qhsLj4tv7KrsTquvO1xMTjoaOhsQoKtdrI/dXCILnpzb4KzOzBwbXEyrG68qOs0+rNo8HLoaO91snPv6rKvNPQyMvX37avoaMK';

function gb18030Sample(): Uint8Array {
  return new Uint8Array(Buffer.from(GB18030_TXT_B64, 'base64'));
}

/* ------------------------------------------------------------------ */
/* the suite                                                           */
/* ------------------------------------------------------------------ */

const up = await serverUp();

describe.skipIf(!up)('e2e: 真实转换（HTTP → 3100）', () => {
  it('健康检查暴露真实引擎状态', async () => {
    const res = await fetch(`${BASE}/api/health`);
    const body = (await res.json()) as {
      ok: boolean;
      engines: { calibre: boolean; pandoc: boolean; tesseract: boolean };
      engineDetails: Array<{ id: string; available: boolean; version: string | null }>;
    };
    expect(body.ok).toBe(true);
    expect(body.engines).toHaveProperty('calibre');
    expect(body.engines).toHaveProperty('tesseract');
    const calibre = body.engineDetails.find((engine) => engine.id === 'calibre');
    // 引擎状态必须是「探测结果」而不是写死：版本号要么是 null，要么像一串版本
    if (calibre?.available) expect(calibre.version).toMatch(/\d+\.\d+/);
  });

  it('中文 GB18030 TXT → EPUB：结构合法、目录正确、字不丢不乱码', async () => {
    const source = decodeGbk(gb18030Sample());
    const { job, data } = await convert({ bytes: gb18030Sample(), name: 'zh-gb18030.txt', target: 'epub' });
    expect(job.engine).toBe('builtin');
    const zip = await assertValidEpub(data, 'zh-gb18030');
    const text = await epubText(zip);

    // 章节标题进入正文与目录（对比时忽略空白差异）
    const compact = text.replace(/\s+/g, '');
    for (const title of ['第一章 夜航', '第二章 旧书店', '第三章 归途']) {
      expect(compact, `chapter title kept: ${title}`).toContain(title.replace(/\s+/g, ''));
    }
    // 具体句子（含全角标点）不丢
    for (const sentence of ['青石板路上还积着水', '扉页上有一行铅笔字', '街上开始有人走动']) {
      expect(text, `sentence kept: ${sentence}`).toContain(sentence);
    }
    // 不乱码：不能出现 U+FFFD
    expect(text).not.toContain('\uFFFD');
    // lang 标记为中文
    const opf = await zip.file(Object.keys(zip.files).find((n) => n.endsWith('.opf'))!)!.async('string');
    expect(opf).toMatch(/<dc:language[^>]*>(zh|zh-CN|zho)/);
    // 源文本的汉字数量应该基本都在产物里（TOC 会重复标题，允许偏多）
    const hanzi = (value: string) => (value.match(/[\u4e00-\u9fff]/g) ?? []).length;
    expect(hanzi(text)).toBeGreaterThanOrEqual(hanzi(source) - 20);
  });

  it('DOCX（标题/粗体/斜体/列表/图片）→ EPUB：目录来自标题，图片在包内', async () => {
    const docxPath = join(FIXTURES, 'sample.docx');
    if (!existsSync(docxPath)) return; // 引擎可重建 fixtures；缺失时跳过
    const { data } = await convert({ bytes: readFileSync(docxPath), name: 'sample.docx', target: 'epub' });
    const zip = await assertValidEpub(data, 'sample.docx');
    const entries = Object.keys(zip.files);
    expect(entries.some((name) => /\.(png|jpe?g)$/i.test(name)), 'image resource kept').toBe(true);
    const text = await epubText(zip);
    // 标题层级 -> 目录（nav 里能看到章节标题）
    const nav = await zip.file(Object.keys(zip.files).find((n) => n.endsWith('nav.xhtml'))!)!.async('string');
    expect(nav).toMatch(/第[一二三]章/);
    // 列表与图片必须保留（fixture 里这两种最容易被 Word 样式杀掉）
    expect(text, 'list markup kept').toMatch(/<(ul|ol)\b/);
    expect(text).toMatch(/<li\b/);
    expect(text).toContain('<img');
    // 不残留 Word 的垃圾样式
    expect(text).not.toMatch(/mso-|\bWordDocument\b/);
  });

  it('CBZ → EPUB：整页 fixed-layout，页序正确', async () => {
    const cbzPath = join(FIXTURES, 'sample.cbz');
    if (!existsSync(cbzPath)) return;
    const { job, data } = await convert({ bytes: readFileSync(cbzPath), name: 'sample.cbz', target: 'epub' });
    expect(job.engine).toBe('builtin');
    const zip = await assertValidEpub(data, 'sample.cbz');
    const opfPath = Object.keys(zip.files).find((name) => name.endsWith('.opf'))!;
    const opf = await zip.file(opfPath)!.async('string');
    expect(opf, 'fixed layout meta').toMatch(/rendition:layout/);
    const images = Object.keys(zip.files).filter((name) => /\.(png|jpe?g)$/i.test(name));
    expect(images.length).toBeGreaterThanOrEqual(2);
    const itemrefs = opf.match(/<itemref\b/g) ?? [];
    expect(itemrefs.length).toBe(images.length);
  });

  it('CBR → EPUB（真 RAR）：3 页整页', async () => {
    const cbrPath = join(FIXTURES, 'sample.cbr');
    if (!existsSync(cbrPath)) return;
    const { data } = await convert({ bytes: readFileSync(cbrPath), name: 'sample.cbr', target: 'epub' });
    const zip = await assertValidEpub(data, 'sample.cbr');
    const images = Object.keys(zip.files).filter((name) => /\.(png|jpe?g)$/i.test(name));
    expect(images.length).toBeGreaterThanOrEqual(3);
  });

  it('EPUB → TXT：正文抽得出来', async () => {
    const epubPath = join(FIXTURES, 'pride.epub');
    if (!existsSync(epubPath)) return;
    const { job, data } = await convert({ bytes: readFileSync(epubPath), name: 'pride.epub', target: 'txt' });
    expect(job.engine).toBe('builtin');
    const text = new TextDecoder().decode(data);
    expect(text.length).toBeGreaterThan(50_000);
    expect(text).toContain('Pride and Prejudice');
  });

  it('EPUB → MOBI：offset 60 = BOOKMOBI（需要 calibre）', async () => {
    const available = await engines();
    if (!available.calibre) return;
    const epubPath = join(FIXTURES, 'pride.epub');
    if (!existsSync(epubPath)) return;
    const { data } = await convert({
      bytes: readFileSync(epubPath),
      name: 'pride.epub',
      target: 'mobi',
      timeoutMs: 240_000,
    });
    expect(data.byteLength).toBeGreaterThan(10_000);
    expect(Buffer.from(data.subarray(60, 68)).toString('latin1')).toBe('BOOKMOBI');
  }, 240_000);

  it('EPUB → AZW3：offset 60 = BOOKMOBI（需要 calibre）', async () => {
    const available = await engines();
    if (!available.calibre) return;
    const epubPath = join(FIXTURES, 'pride.epub');
    if (!existsSync(epubPath)) return;
    const { data } = await convert({
      bytes: readFileSync(epubPath),
      name: 'pride.epub',
      target: 'azw3',
      timeoutMs: 240_000,
    });
    expect(Buffer.from(data.subarray(60, 68)).toString('latin1')).toBe('BOOKMOBI');
  }, 240_000);

  it('扫描 PDF → EPUB（OCR，ocrLanguage:"zh"）：识别出中文', async () => {
    const available = await engines();
    const pdfPath = join(FIXTURES, 'scanned.pdf');
    if (!available.tesseract || !existsSync(pdfPath)) return;
    const { job, data } = await convert({
      bytes: readFileSync(pdfPath),
      name: 'scanned.pdf',
      target: 'epub',
      options: { ocr: true, ocrLanguage: 'zh' },
      timeoutMs: 240_000,
    });
    expect(job.engine).toBe('ocr');
    const zip = await assertValidEpub(data, 'scanned.pdf');
    const text = await epubText(zip);
    expect((text.match(/[\u4e00-\u9fff]/g) ?? []).length).toBeGreaterThan(20);
  }, 240_000);

  it('OCR 语言包缺失时回退并给出 warning（不是静默失败）', async () => {
    const available = await engines();
    const pdfPath = join(FIXTURES, 'scanned.pdf');
    if (!available.tesseract || !existsSync(pdfPath)) return;
    const { job } = await convert({
      bytes: readFileSync(pdfPath),
      name: 'scanned.pdf',
      target: 'epub',
      options: { ocr: true, ocrLanguage: 'kor' },
      timeoutMs: 240_000,
    });
    expect(job.status).toBe('done');
    expect(job.warnings.join('\n')).toMatch(/kor|回退|falling back|可用语言/);
  }, 240_000);

  it('DELETE 立即删除记录与磁盘目录', async () => {
    const submitted = await submit({
      bytes: gb18030Sample(),
      name: 'cleanup.txt',
      target: 'epub',
    });
    if ('error' in submitted) throw new Error(JSON.stringify(submitted.error));
    const job = await poll(submitted.jobId);
    expect(job.status).toBe('done');
    const dir = join(TMP_ROOT, submitted.jobId);
    expect(existsSync(dir), 'job dir exists after conversion').toBe(true);
    const del = await fetch(`${BASE}/api/jobs/${submitted.jobId}`, { method: 'DELETE' });
    expect([204, 200]).toContain(del.status);
    expect(existsSync(dir), 'job dir removed synchronously').toBe(false);
    const after = await fetch(`${BASE}/api/jobs/${submitted.jobId}`);
    expect(after.status).toBe(404);
    const afterDownload = await fetch(`${BASE}/api/jobs/${submitted.jobId}/download`);
    expect(afterDownload.status).toBe(404);
  }, 60_000);
});

// 让「服务没起来」这件事在输出里可见，而不是静默 0 个测试
if (!up) {
  describe('e2e: 真实转换（跳过）', () => {
    it.skip(`服务未启动：${BASE} —— 先 npx next dev -p 3100`, () => undefined);
  });
}

