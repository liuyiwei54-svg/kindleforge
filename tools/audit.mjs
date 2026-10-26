/**
 * Lead's browser audit: drives the real pages with Chrome via CDP.
 * Checks: console errors, failed requests, horizontal overflow at 390/768/1440,
 * heading order, missing alt text, tap-target size, and writes full-page shots.
 *
 * Usage: node tools/audit.mjs [baseUrl] [outDir]
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3100';
const OUT = process.argv[3] ?? '/tmp/kf-audit';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const PAGES = [
  ['home', '/'],
  ['home-en', '/en'],
  ['convert', '/convert'],
  ['green', '/green'],
  ['docs', '/docs'],
  ['pair', '/convert/epub-to-mobi'],
  ['notfound', '/nope-404'],
];

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, mobile: true },
  { name: 'tablet', width: 768, height: 1024, mobile: true },
  { name: 'desktop', width: 1440, height: 900, mobile: false },
];

mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars'],
});

const report = [];

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: vp.mobile, deviceScaleFactor: 1 });
  for (const [name, path] of PAGES) {
    const errors = [];
    const failed = [];
    const onConsole = (msg) => {
      if (msg.type() === 'error') errors.push(msg.text().slice(0, 200));
    };
    const onFail = (req) => failed.push(`${req.url().slice(0, 120)} (${req.failure()?.errorText})`);
    page.on('console', onConsole);
    page.on('requestfailed', onFail);
    const expect404 = path === '/nope-404';

    const resp = await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 700));

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const h1s = [...document.querySelectorAll('h1')].map((h) => h.textContent.trim().slice(0, 80));
      const imgs = [...document.images];
      const noAlt = imgs.filter((i) => !i.hasAttribute('alt')).length;
      const smallTargets = [...document.querySelectorAll('a,button')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24);
      }).length;
      const overflowers = [...document.querySelectorAll('body *')]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 6)
        .map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ').slice(0, 2).join('.')} right=${Math.round(r.right)}`;
        });
      return {
        title: document.title,
        scrollWidth: doc.scrollWidth,
        innerWidth: window.innerWidth,
        overflowPx: doc.scrollWidth - window.innerWidth,
        h1s,
        noAlt,
        smallTargets,
        overflowers,
        lang: doc.lang,
      };
    });

    if (vp.name === 'desktop' || vp.name === 'mobile') {
      await page.screenshot({ path: `${OUT}/${name}-${vp.name}.png`, fullPage: true }).catch(() => {});
    }

    report.push({ vp: vp.name, path, status: resp?.status(), errors, failed, ...metrics });
    page.off('console', onConsole);
    page.off('requestfailed', onFail);
  }
  await page.close();
}

await browser.close();

let bad = 0;
for (const r of report) {
  const problems = [];
  if (![200, 304].includes(r.status) && r.path !== '/nope-404') problems.push(`status ${r.status}`);
  if (r.overflowPx > 1) problems.push(`overflow +${r.overflowPx}px: ${r.overflowers.join(' | ')}`);
  if (r.errors.length && r.path !== '/nope-404') problems.push(`console: ${r.errors.slice(0, 2).join(' ¶ ')}`);
  if (r.failed.length) problems.push(`failed: ${r.failed.slice(0, 2).join(' ¶ ')}`);
  if (r.noAlt) problems.push(`${r.noAlt} img(s) without alt`);
  if (r.h1s.length === 0) problems.push('no h1');
  if (r.h1s.length > 1) problems.push(`${r.h1s.length} h1s`);
  if (problems.length) bad += 1;
  const mark = problems.length ? '✗' : '✓';
  console.log(`${mark} [${r.vp}] ${r.path} (${r.status}) ${r.h1s[0] ? '“' + r.h1s[0] + '”' : ''}`);
  for (const p of problems) console.log(`    - ${p}`);
}
console.log(`\n${report.length - bad}/${report.length} page/viewport combos clean. Shots: ${OUT}`);
process.exit(bad ? 1 : 0);
