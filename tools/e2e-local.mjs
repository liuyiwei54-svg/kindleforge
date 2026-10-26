/**
 * Real browser end-to-end: upload a Chinese TXT on /convert, convert through the
 * Web Worker (local mode), download the EPUB and prove no bytes were uploaded.
 *
 * Usage: node tools/e2e-local.mjs [baseUrl] [file]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import JSZip from 'jszip';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const FILE = process.argv[3] ?? '/tmp/kf-samples/zh-utf8.txt';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DL = '/tmp/kf-e2e-downloads';

rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });

const uploads = [];
const consoleErrors = [];
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/api/convert')) uploads.push(req.url());
});
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 160));
});

const cdp = await page.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle2', timeout: 40000 });
await page.waitForSelector('input[type=file]', { timeout: 20000 });

const before = readdirSync(DL);

const input = await page.$('input[type=file]');
await input.uploadFile(FILE);
await new Promise((r) => setTimeout(r, 1200));

const bodyText = await page.evaluate(() => document.body.innerText);
const sawFile = bodyText.includes('zh-utf8') || bodyText.includes('夜航西飞');
const sawLocal = /本地处理|未上传|本地/.test(bodyText);
console.log('file listed:', sawFile, '| local badge:', sawLocal);

const clicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => {
    const t = (b.textContent ?? '').replace(/\s+/g, '');
    return t === '开始转换' || t === '开始' || t === '转换';
  });
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return true;
});
console.log('clicked convert:', clicked);

let done = false;
for (let i = 0; i < 60; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const t = await page.evaluate(() => document.body.innerText);
  const hasDownload = await page.evaluate(() =>
    [...document.querySelectorAll('button,a')].some((el) => /下载/.test(el.textContent ?? '')),
  );
  if (hasDownload || /转换完成|已完成|保存/.test(t)) {
    done = true;
    break;
  }
  if (/失败|错误/.test(t) && !/0 个失败/.test(t)) {
    console.log('body tail:', t.slice(-500));
    break;
  }
}
console.log('conversion finished:', done);
console.log('POST /api/convert count:', uploads.length, uploads);

// Click the download affordance; anchor downloads land in DL via CDP.
const downloaded = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a')].find((x) =>
    /下载/.test(x.textContent ?? '') || /download/i.test(x.getAttribute('download') ?? ''),
  );
  if (a) {
    a.click();
    return a.getAttribute('href') ?? 'anchor';
  }
  const btn = [...document.querySelectorAll('button')].find((b) => /下载/.test(b.textContent ?? ''));
  if (btn) {
    btn.click();
    return 'button';
  }
  return null;
});
console.log('download trigger:', downloaded);
let after = [];
for (let i = 0; i < 15; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  after = readdirSync(DL).filter((f) => !before.includes(f));
  if (after.length > 0) break;
}
console.log('downloads:', after);
let ok = false;
for (const f of after) {
  const p = `${DL}/${f}`;
  if (!statSync(p).isFile() || !f.endsWith('.epub')) continue;
  const zip = await JSZip.loadAsync(await (await import('node:fs/promises')).readFile(p));
  const names = Object.keys(zip.files);
  const mimetype = names.includes('mimetype') ? await zip.files.mimetype.async('string') : '';
  const text = await Promise.all(
    names.filter((n) => n.endsWith('.xhtml')).map((n) => zip.files[n].async('string')),
  );
  const hasChinese = text.join('').includes('海面在午夜');
  ok = mimetype.trim() === 'application/epub+zip' && hasChinese && names.some((n) => n.endsWith('.opf'));
  console.log(`${f}: entries=${names.length} mimetype=${mimetype.trim()} chinese=${hasChinese}`);
}

await page.screenshot({ path: '/tmp/kf-e2e-convert.png', fullPage: true });
console.log('console errors:', consoleErrors.slice(0, 3));

await browser.close();
const pass = ok && uploads.length === 0;
console.log(pass ? '\nLOCAL E2E PASS — EPUB valid, zero uploads' : '\nLOCAL E2E FAIL');
process.exit(pass ? 0 : 1);
