/**
 * KindleForge — 端到端：隐私承诺与可访问性（qa 拥有，浏览器实测）
 *
 * 对应 BRIEF 的「更绿色」硬承诺与质量门槛：
 *   - TXT / MD / HTML → EPUB 完全在浏览器完成，**文件一个字节都不上传**
 *   - 全站 0 第三方请求（无分析脚本 / 无外部字体 CDN）
 *   - 键盘可完成上传；跳过链接第一个可达；标题层级、进度播报、移动端不横向溢出
 *
 *   npx vitest run tests/e2e/e2e.privacy.test.ts
 * 需要本机 Chrome（用 puppeteer-core，不下载 Chromium）；缺 Chrome 时整组 skip。
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.KF_BASE ?? 'http://127.0.0.1:3100';
const CHROME = process.env.KF_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let puppeteer: typeof import('puppeteer-core') | null = null;
let browser: Awaited<ReturnType<typeof import('puppeteer-core').launch>> | null = null;

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

const up = await serverUp();
const hasChrome = existsSync(CHROME);

beforeAll(async () => {
  if (!up || !hasChrome) return;
  puppeteer = await import('puppeteer-core');
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu'],
  });
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

describe.skipIf(!up || !hasChrome)('e2e: 隐私与可访问性（真实 Chrome）', () => {
  it('落地页与工作台：0 个第三方请求', async () => {
    for (const path of ['/', '/convert']) {
      const page = await browser!.newPage();
      const urls: string[] = [];
      page.on('request', (req) => urls.push(req.url()));
      await page.goto(BASE + path, { waitUntil: 'networkidle2', timeout: 30_000 });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const foreign = urls.filter((url) => {
        if (url.startsWith('data:') || url.startsWith('blob:')) return false;
        try {
          const target = new URL(url);
          const base = new URL(BASE);
          return target.host !== base.host;
        } catch {
          return true;
        }
      });
      expect(foreign, `${path}: 不应有第三方请求`).toEqual([]);

      // 没有任何分析/广告脚本特征
      const html = await page.content();
      expect(html).not.toMatch(/googletagmanager|google-analytics|gtag\(|plausible|umami|hotjar|segment\.io|doubleclick/i);
      await page.close();
    }
  }, 120_000);

  it('TXT → EPUB 在浏览器本地完成：全程 0 次 /api/convert 请求', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 600));

    // 标记上传之后的请求
    const after: Array<{ method: string; url: string }> = [];
    let recording = false;
    page.on('request', (req) => {
      if (recording) after.push({ method: req.method(), url: req.url() });
    });

    const dir = mkdtempSync(join(tmpdir(), 'kf-e2e-'));
    const file = join(dir, '本地转换.txt');
    writeFileSync(file, '第一章 夜航\n\n夜里下过雨，青石板路上还积着水。\n\n第二章 旧书店\n\n推门进去，铃铛响了一声。\n', 'utf8');

    recording = true;
    const input = await page.$('input[type=file]');
    expect(input, 'file input 存在').toBeTruthy();
    await input!.uploadFile(file);
    await new Promise((resolve) => setTimeout(resolve, 700));

    let convertButton: Awaited<ReturnType<typeof page.$>> = null;
    for (const handle of await page.$$('button')) {
      const label = await handle.evaluate((node) => (node as HTMLElement).innerText.trim());
      if (label === '开始转换') {
        convertButton = handle;
        break;
      }
    }
    expect(convertButton, '找到「开始转换」').toBeTruthy();
    await convertButton!.click();

    // 等「完成」或「失败」
    let card = '';
    for (let i = 0; i < 40; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      card = await page.evaluate(() => {
        const text = document.body.innerText;
        const match = text.match(/本地转换\.txt[\s\S]{0,160}/);
        return (match?.[0] ?? '').replace(/\n+/g, ' | ');
      });
      if (/完成|失败/.test(card)) break;
    }

    expect(card, `本地转换应完成；实际卡片：${card}`).toContain('完成');
    expect(card).toContain('本地处理');
    expect(card, '必须明确标注未上传').toMatch(/未上传/);
    expect(card).not.toMatch(/失败/);

    const uploads = after.filter((req) => /\/api\/convert\b/.test(req.url));
    expect(uploads, '本地模式不允许把文件 POST 到 /api/convert').toEqual([]);
    expect(after.filter((req) => /\/api\/jobs/.test(req.url)), '本地模式不应创建服务端任务').toEqual([]);

    await page.close();
  }, 120_000);

  it('键盘：跳过链接是第一个 Tab 停靠点，上传按钮可 Enter 打开文件选择', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 600));

    await page.keyboard.press('Tab');
    const first = await page.evaluate(() =>
      ((document.activeElement as HTMLElement | null)?.innerText ?? '').trim().replace(/\n+/g, ' '),
    );
    expect(first).toMatch(/跳到主要内容|Skip to content/);

    // 上传按钮：Enter 必须触发隐藏的 file input
    await page.evaluate(() => {
      (window as unknown as { __pickerClicks: number }).__pickerClicks = 0;
      const input = document.querySelector('input[type=file]');
      input?.addEventListener('click', () => {
        (window as unknown as { __pickerClicks: number }).__pickerClicks += 1;
      });
      const dropzone = [...document.querySelectorAll('button')].find((node) =>
        /拖入文件|选择文件|Drop|Choose/.test((node as HTMLElement).innerText),
      );
      (dropzone as HTMLButtonElement | undefined)?.focus();
    });
    await page.keyboard.press('Enter');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const clicks = await page.evaluate(() => (window as unknown as { __pickerClicks: number }).__pickerClicks);
    expect(clicks, 'Enter 应打开文件选择器').toBeGreaterThanOrEqual(1);
    await page.close();
  }, 90_000);

  it('可访问性基线：单一 h1、进度 aria-live、移动端不横向溢出、图片有 alt', async () => {
    const page = await browser!.newPage();
    await page.setViewport({ width: 390, height: 844, isMobile: true });
    await page.goto(`${BASE}/convert`, { waitUntil: 'networkidle2', timeout: 30_000 });
    await new Promise((resolve) => setTimeout(resolve, 600));

    const audit = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        h1: document.querySelectorAll('h1').length,
        live: document.querySelectorAll('[aria-live]').length,
        imagesWithoutAlt: [...document.images].filter((img) => !img.hasAttribute('alt')).length,
        overflow: doc.scrollWidth - doc.clientWidth,
        skipLink: [...document.querySelectorAll('a')].some((a) => /#main/.test(a.getAttribute('href') ?? '')),
        main: Boolean(document.querySelector('main, #main')),
      };
    });
    expect(audit.h1).toBe(1);
    expect(audit.live).toBeGreaterThanOrEqual(1);
    expect(audit.imagesWithoutAlt).toBe(0);
    expect(audit.overflow, '390px 不应横向滚动').toBeLessThanOrEqual(1);
    expect(audit.skipLink).toBe(true);
    expect(audit.main).toBe(true);
    await page.close();
  }, 90_000);
});

if (!up || !hasChrome) {
  describe('e2e: 隐私与可访问性（跳过）', () => {
    it.skip(
      !up ? `服务未启动：${BASE}` : `未找到 Chrome：${CHROME}（可用 KF_CHROME 覆盖）`,
      () => undefined,
    );
  });
}
