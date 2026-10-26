import { ArrowUpRight, Server, TerminalSquare } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CodeBlock } from '@/components/ui/code-block';
import { Footer } from '@/components/site/footer';
import { Header } from '@/components/site/header';
import { Section } from '@/components/site/section';
import { getDict, type Locale } from '@/lib/i18n';
import type { Dict } from '@/lib/i18n/types';

interface Endpoint {
  method: 'POST' | 'GET' | 'DELETE';
  path: string;
  description: string;
  code: string;
}

const BASE = 'http://localhost:3100';

function endpointsFor(locale: Locale): Endpoint[] {
  const zh = locale === 'zh';
  return [
    {
      method: 'POST',
      path: '/api/convert',
      description: zh
        ? 'multipart 提交任务：file、target、options（JSON 字符串）。成功返回 202 { jobId }；不支持的组合返回 415。'
        : 'Queue a job with multipart fields: file, target, options (JSON string). Returns 202 { jobId }; unsupported pairs return 415.',
      code: `curl -F "file=@book.txt" \\
     -F "target=epub" \\
     -F 'options={"device":"paperwhite","typography":{"indent":2}}' \\
     ${BASE}/api/convert`,
    },
    {
      method: 'GET',
      path: '/api/jobs/:id',
      description: zh
        ? '轮询任务状态，建议间隔 800ms。status 为 done 时可下载，error 时带 code / message / hint。'
        : 'Poll job state — 800ms is a good interval. Download when status is done; error responses carry code / message / hint.',
      code: `curl ${BASE}/api/jobs/<jobId>

{
  "id": "<jobId>",
  "status": "running",
  "progress": 42,
  "engine": "builtin",
  "warnings": []
}`,
    },
    {
      method: 'GET',
      path: '/api/jobs/:id/download',
      description: zh
        ? '下载结果，带 Content-Disposition。下载不会立即删除任务，10 分钟后自动清理。'
        : 'Download the result with Content-Disposition. Downloading does not delete the job immediately; it expires after 10 minutes.',
      code: `curl -OJ ${BASE}/api/jobs/<jobId>/download`,
    },
    {
      method: 'DELETE',
      path: '/api/jobs/:id',
      description: zh
        ? '立即取消任务并删除文件与记录，用于「取消」按钮。'
        : 'Cancel the job immediately and delete its files and record — this powers the Cancel button.',
      code: `curl -X DELETE ${BASE}/api/jobs/<jobId>`,
    },
    {
      method: 'GET',
      path: '/api/formats',
      description: zh
        ? '返回格式、设备、能力矩阵与引擎状态。前端用它渲染目标格式下拉框，失败时回落到内置矩阵。'
        : 'Formats, devices, capability matrix and engine status. The UI uses it for the target picker and falls back to the built-in matrix.',
      code: `curl ${BASE}/api/formats`,
    },
    {
      method: 'GET',
      path: '/api/health',
      description: zh
        ? '返回服务与引擎（calibre / pandoc / tesseract）状态，用于部署检查。'
        : 'Service and engine (calibre / pandoc / tesseract) status, for deployment checks.',
      code: `curl ${BASE}/api/health`,
    },
  ];
}

const API_ERROR_CODES = ['UNSUPPORTED_PAIR', 'ENGINE_MISSING', 'DRM', 'TOO_LARGE', 'TIMEOUT', 'INVALID_FILE', 'INTERNAL'] as const;

function methodTone(method: Endpoint['method']) {
  if (method === 'POST') return 'moss' as const;
  if (method === 'DELETE') return 'clay' as const;
  return 'paper' as const;
}

export function DocsPage({ locale }: { locale: Locale }) {
  const dict = getDict(locale);
  const page = dict.docsPage;
  const endpoints = endpointsFor(locale);

  const toc = [
    { id: 'quickstart', label: page.toc.quickstart },
    { id: 'endpoints', label: page.toc.endpoints },
    { id: 'errors', label: page.toc.errors },
    { id: 'limits', label: page.toc.limits },
    { id: 'self-host', label: page.toc.selfHost },
    { id: 'calibre', label: page.toc.calibre },
  ];

  return (
    <>
      <Header locale={locale} path="/docs" />
      <main id="main">
        <Section id="docs-hero" dense headingLevel={1} eyebrow={page.hero.eyebrow} title={page.hero.title} sub={page.hero.sub}>
          <nav aria-label={locale === 'zh' ? '文档目录' : 'Documentation contents'} className="flex flex-wrap gap-2">
            {toc.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-paper/15 bg-ink-900 px-3 py-1.5 text-xs text-paper-dim transition-colors hover:border-moss-500/40 hover:text-paper focus-visible:ring-2 focus-visible:ring-moss-500 focus-visible:outline-none"
              >
                {item.label}
                <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
              </a>
            ))}
          </nav>
          <p className="mt-4 max-w-2xl text-[11px] leading-5 text-paper-dim/60">{page.apiNote}</p>
        </Section>

        <Section id="quickstart" dense title={page.quickstartTitle} sub={page.quickstartBody}>
          <CodeBlock
            labels={dict.code}
            code={`# 1) queue a job\ncurl -F "file=@book.epub" -F "target=mobi" ${BASE}/api/convert\n# → 202 {"jobId":"…"}\n\n# 2) poll every 800ms\ncurl ${BASE}/api/jobs/<jobId>\n\n# 3) download\ncurl -OJ ${BASE}/api/jobs/<jobId>/download`}
          />
        </Section>

        <Section id="endpoints" dense title={page.endpointTitle}>
          <div className="space-y-4">
            {endpoints.map((endpoint) => (
              <div key={`${endpoint.method}-${endpoint.path}`} className="rounded-[20px] border border-paper/12 bg-ink-900/50 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={methodTone(endpoint.method)} mono>
                    {endpoint.method}
                  </Badge>
                  <code className="font-mono text-sm text-paper">{endpoint.path}</code>
                </div>
                <p className="mt-2 text-xs leading-6 text-paper-dim">{endpoint.description}</p>
                <CodeBlock code={endpoint.code} labels={dict.code} className="mt-3" />
              </div>
            ))}
          </div>
        </Section>

        <Section id="errors" dense title={page.errorsTitle} sub={page.errorsIntro}>
          <div className="overflow-x-auto rounded-[20px] border border-paper/12 bg-ink-900/50">
            <table className="w-full min-w-[640px] border-collapse text-left text-xs">
              <caption className="sr-only">{page.errorsTitle}</caption>
              <thead>
                <tr className="border-b border-paper/10 text-[10px] tracking-wider text-paper-dim/60 uppercase">
                  <th scope="col" className="px-4 py-2.5 font-medium">{page.errorColumns.code}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{page.errorColumns.meaning}</th>
                  <th scope="col" className="px-4 py-2.5 font-medium">{page.errorColumns.fix}</th>
                </tr>
              </thead>
              <tbody>
                {API_ERROR_CODES.map((code) => {
                  const copy: { message: string; hint: string } = dict.errors[code] as { message: string; hint: string };
                  return (
                    <tr key={code} className="border-t border-paper/8 align-top">
                      <th scope="row" className="px-4 py-3 font-mono text-[11px] font-normal text-moss-400">{code}</th>
                      <td className="px-4 py-3 text-paper">{copy.message}</td>
                      <td className="px-4 py-3 text-paper-dim/80">{copy.hint}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section id="limits" dense title={page.limitsTitle}>
          <ul className="grid gap-2 sm:grid-cols-2">
            {page.limits.map((item) => (
              <li key={item} className="rounded-xl border border-paper/12 bg-ink-900/50 px-4 py-3 text-xs leading-6 text-paper-dim">
                {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section id="self-host" dense title={page.selfHostTitle} sub={page.selfHostBody}>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
                <TerminalSquare aria-hidden="true" className="h-4 w-4 text-moss-500" />
                {page.selfHostTitle}
              </h3>
              <CodeBlock code={`npm install\nnpx next build\nnpx next start -p 3100`} labels={dict.code} className="mt-3" />
              <p className="mt-2 text-[11px] leading-5 text-paper-dim/60">{page.selfHostBody}</p>
            </div>

            <div className="rounded-[20px] border border-paper/12 bg-ink-800/50 p-5">
              <h3 className="flex items-center gap-2 font-serif text-lg text-paper">
                <Server aria-hidden="true" className="h-4 w-4 text-moss-500" />
                {page.calibreTitle}
              </h3>
              <p className="mt-2 text-xs leading-6 text-paper-dim">{page.calibreBody}</p>
              <CodeBlock code={page.calibreCommands.join('\n')} labels={dict.code} className="mt-3" />
            </div>
          </div>
        </Section>

        <Section id="status" dense title={page.statusTitle}>
          <div className="overflow-x-auto rounded-[20px] border border-paper/12 bg-ink-900/50">
            <table className="w-full min-w-[480px] border-collapse text-left text-xs">
              <caption className="sr-only">{page.statusTitle}</caption>
              <tbody>
                {page.statusRows.map((row) => (
                  <tr key={row.field} className="border-t border-paper/8 first:border-t-0">
                    <th scope="row" className="w-40 px-4 py-2.5 font-mono text-[11px] font-normal text-moss-400">{row.field}</th>
                    <td className="px-4 py-2.5 text-paper-dim">{row.meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
      <Footer locale={locale} />
    </>
  );
}

export type DocsDict = Dict['docsPage'];
