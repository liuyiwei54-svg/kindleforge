/**
 * Real browser end-to-end, server path: EPUB → MOBI through the API and the UI.
 * Verifies progress polling, download, and the MOBI magic number.
 *
 * Usage: node tools/e2e-server.mjs [baseUrl] [file]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readdirSync, statSync, rmSync, readFileSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const FILE = process.argv[3] ?? '/tmp/kf-samples/pride.epub';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DL = '/tmp/kf-e2e-server';

rmSync(DL, { recursive: true, force: true });
mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
const posts = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 160)));
page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));

const cdp = await page.createCDPSession();
await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL });

await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle2', timeout: 40000 });
await page.waitForSelector('input[type=file]');
await (await page.$('input[type=file]')).uploadFile(FILE);
await new Promise((r) => setTimeout(r, 1500));

// Pick the target format select (the one that contains MOBI options) and choose mobi.
const picked = await page.evaluate(() => {
  const selects = [...document.querySelectorAll('select')];
  const target = selects.find((s) => [...s.options].some((o) => /MOBI/.test(o.textContent ?? '')));
  if (!target) return null;
  const opt = [...target.options].find((o) => /MOBI/.test(o.textContent ?? ''));
  if (!opt) return null;
  target.value = opt.value;
  target.dispatchEvent(new Event('change', { bubbles: true }));
  return opt.value;
});
console.log('target picked:', picked);

const clicked = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(
    (x) => (x.textContent ?? '').replace(/\s+/g, '') === '开始转换',
  );
  if (!b) return false;
  b.click();
  return true;
});
console.log('clicked:', clicked);

let finished = false;
for (let i = 0; i < 90; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  finished = await page.evaluate(() =>
    [...document.querySelectorAll('button,a')].some((el) => /下载/.test(el.textContent ?? '')),
  );
  if (finished) break;
}
console.log('finished:', finished, '| POSTs:', posts.length);

await page.evaluate(() => {
  const el = [...document.querySelectorAll('button,a')].find((x) => /下载/.test(x.textContent ?? ''));
  el?.click();
});

let files = [];
for (let i = 0; i < 20; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  files = readdirSync(DL).filter((f) => !f.endsWith('.crdownload'));
  if (files.length) break;
}
await new Promise((r) => setTimeout(r, 1500));
files = readdirSync(DL);

let ok = false;
for (const f of files) {
  const p = `${DL}/${f}`;
  const buf = readFileSync(p);
  const magic = buf.subarray(60, 68).toString('ascii');
  ok = buf.length > 100_000 && (magic === 'BOOKMOBI' || f.endsWith('.azw3'));
  console.log(`${f}: ${buf.length} bytes, offset60="${magic}"`);
}

await page.screenshot({ path: '/tmp/kf-e2e-server.png', fullPage: true });
console.log('console errors:', errors.slice(0, 3));
await browser.close();
console.log(ok && posts.length > 0 ? '\nSERVER E2E PASS' : '\nSERVER E2E FAIL');
process.exit(ok && posts.length > 0 ? 0 : 1);
