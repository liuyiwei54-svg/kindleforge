# KindleForge — 团队契约（先读这个）

> 产品：把「任何文件」变成 Kindle 上最好读的那本书。竞品 https://www.runconvert.com/zh/ebook-converter 。
> 我们的三个必胜点：**更好**（Kindle 专属排版/中文排版/目录/封面）、**更全面**（格式矩阵 + 批量 + OCR + 漫画 + API + 自托管）、**更绿色**（纯文本格式在浏览器本地转换，文件 0 上传；服务器零留存；无广告无追踪；开源可审计）。

## 0. 铁律

1. **只改自己 scope 内的文件**。需要跨界改动 → 先在群里说明，由 Lead 协调。不要 `git checkout`/回滚别人的文件，不要动 `node_modules`。
2. 每完成一个模块立刻 `npx tsc --noEmit` 自检（全局 typecheck 由 Lead 收口）。提交前不要留 `TODO` 占位实现。
3. UI 文案必须中英双语；不要出现「Lorem ipsum」或竞品原样文案。
4. 不引入重型依赖（>2MB 或需要系统服务）除非在 CONTRACT 里已批准。已装：`next react jszip mammoth node-unrar-js lucide-react zod sharp`。
5. 隐私是卖点：**不接入任何分析/追踪脚本**，不把用户文件名写日志（用 hash 或 `<file>` 代替）。
6. 真实文件转换必须能跑通。不能用假数据、mock 成功。

## 1. 运行方式

```bash
cd /Users/yiwei/Desktop/daily/kindle
npx next dev -p 3100     # 开发（不要用 pnpm dev，pnpm 11 的 deps 校验会报错）
npx tsc --noEmit         # 类型检查
npx vitest run           # 单测
npx tsx scripts/doctor.ts  # 体检：calibre/pandoc/tesseract 是否可用
```

开发服务器已跑在 http://127.0.0.1:3100 。**端口 3100 归 Lead 独占**；需要自己验证页面时直接 curl 或读 HTML，不要另起 dev server。如需隔离验证，用 `npx next build` 或直接调用 lib 里的函数（`npx tsx`）。

## 2. 目录与归属

| 路径 | 归属 | 说明 |
|---|---|---|
| `lib/engine/types.ts` `formats.ts` | **Lead（只读）** | 已定稿的契约。需要改类型 → 找 Lead |
| `lib/engine/{index,model,util,readers/*,writers/*,node/*}.ts` | engine | 转换核心，浏览器/Node 同构 |
| `lib/engine/readers/*.ts` 里每个 reader 独立文件 | engine | 由 `readers/index.ts` 统一注册 |
| `lib/server/**` `app/api/**` `scripts/**` | backend | 任务队列、清理、API、体检脚本 |
| `app/**`（除 `globals.css`）、`components/**`、`lib/client/**`、`lib/i18n/**` | frontend | 页面、交互、Worker 本地转换、i18n |
| `app/globals.css` `styles/**` `design/**` `public/brand/**` `docs/COPY.md` | design | 视觉系统、品牌资产、文案 |
| `tests/**` | 各自模块 | 文件名前缀隔离：`engine.*` / `api.*` / `ui.*` / `e2e.*` |
| `docs/**` `README.md` | Lead | 文档收口 |
| `reports/**` | qa | 审计报告 |

## 3. 引擎契约（已定稿，不要改名）

```ts
// lib/engine/index.ts —— 唯一入口
export async function convert(input: ConverterInput, req: ConvertRequest): Promise<ConversionResult>;
export function detectFormat(name: string, data: Uint8Array): FormatId | null;
export function canRunLocally(from: FormatId, to: FormatId): boolean;
export async function engineStatus(): Promise<{ calibre: boolean; pandoc: boolean; tesseract: boolean }>;
export function listPairs(): Capability[];  // 读 formats.ts 的 capabilities()
```

- Reader: `(input: ConverterInput) => Promise<Book>`，只依赖 `types.ts`；**禁止 Node API**（本地模式要复用）。
- Writer: `(book: Book, opts: KindleOptions) => Promise<Uint8Array>`，同样同构。
- Node 专属（spawn calibre、fs、OCR）只能放 `lib/engine/node/**`，并且必须**动态 import**，否则浏览器打包会炸。
- 编排规则：优先 buildin reader → Book → writer(epub)；需要 mobi/azw3 时 `epub → calibre`；calibre 原生的输入可以直接交给 calibre 以保真。任何一步失败要抛 `ConversionError` 带 `code` + 中英 `hint`，不要裸 throw。
- 质量底线：生成的 EPUB 必须是合法 EPUB 3（mimetype 未压缩且第一个条目、container.xml、OPF、nav.xhtml、NCX 兼容），能被 calibre 无警告读取；中文不乱码（UTF-8 + 正确 lang）；TXT 要能识别章节（"第X章"、英文 "Chapter N"、Markdown 标题）。
- 大小限制：单文件 ≤ 200MB，解压后 EPUB 内资源 ≤ 1GB；防 zip bomb（条目数 > 5000 或解压比 > 200 直接拒绝）。

## 4. API 契约（后端实现，前端按此对接）

- `POST /api/convert` — multipart：`file`、`target`、`options`(JSON 字符串) → `202 { jobId }`；超过 200MB → 413；不支持的组合 → 415 + `{error:{code,hint}}`。
- `GET /api/jobs/:id` — `{ id, status: 'queued'|'running'|'done'|'error', progress: 0-100, engine?, warnings?, error?, result?: { filename, size, mime, downloadUrl } }`
- `GET /api/jobs/:id/download` — 附件下载；下载后任务在 TTL 内仍可用，10 分钟后自动清理。
- `DELETE /api/jobs/:id` — 立即删除文件与记录。
- `GET /api/formats` — `{ formats, devices, pairs, engines:{calibre,pandoc,tesseract} }`
- `GET /api/health` — `{ ok, uptime, engines, version }`
- 所有响应 `Cache-Control: no-store`；下载响应带 `Content-Disposition`；错误统一 `{ error: { code, message, hint } }`。
- 存储：`os.tmpdir()/kindleforge/<jobId>/`（0600），不落数据库；进程退出清理。

## 5. 设计令牌（design 可扩展，frontend 直接用 Tailwind 类）

- 深色底 `ink-950 #070b09` / `ink-900 #0b100e` / 卡片 `ink-800 #111815`
- 主强调 `moss-500 #a8f06a`（按钮/高亮），纸色 `paper #f4f0e6`，次文本 `paper-dim #d9d3c4`
- 中文标题用 `font-serif`（宋体栈），正文 `font-sans`；正文行高 ≥1.7；正文颜色对比度 ≥ 7:1
- 圆角：卡片 20px，按钮 999px；边框 `paper/12`；阴影少而柔
- 动效：≤200ms ease-out，`prefers-reduced-motion` 下全部禁用；不做自动播放视频

## 6. 协作规矩

- 共享同一个文件系统，**不要抢文件**。改动前先 `git status`？没有 git —— 直接读文件现状再改。
- 需要取消/重跑别人的工作 → 发消息给 Lead，不要自己动手。
- 完成时用 `send_message` 给 lead 汇报：改了哪些文件、如何验证、发现了什么风险。
- 遇到阻塞（缺依赖/权限/契约不清）立刻问 Lead，不要猜着实现半小时。
