# KindleForge 项目 Brief（团队共享）

## 一句话

把任何一份文件，变成 Kindle 上最好读的那本书 —— 本地优先、零广告、开源可自托管。

## 对手与我们的差异

对手 RunConvert 的电子书转换器（https://www.runconvert.com/zh/ebook-converter）已经做得不错：18 种电子书格式、1GB 上限、云端转换、1 小时删除、免注册、有广告。
我们要赢在三点，且每一点都必须能当场演示、能在代码里指出来：

1. **更好（质量）**
   - Kindle 专属排版：字号/行距/首行缩进/两端对齐/中文标点、页边距、封面、目录、元数据一次配好。
   - 中文排版认真做：段落缩进 2em、标点挤压、中英混排空格、竖排不考虑但横排要好看；宋体/黑体可选。
   - 转换前后可见：章节数、字数、图片数、预计阅读时长、警告（丢版式、字体、DRM）。
   - 失败要诚实：说清楚哪一步失败、为什么、怎么改，而不是转出一个坏文件。
2. **更全面（覆盖）**
   - 输入 15 类：EPUB/MOBI/AZW/AZW3/PDF/DOCX/ODT/TXT/MD/HTML/RTF/FB2/CBZ/CBR/图片。
   - 输出 7 类：EPUB/MOBI/AZW3/PDF/TXT/DOCX/HTML。
   - 批量、ZIP 打包下载、OCR（扫描 PDF）、漫画整页、图册模式、格式矩阵页（每个格式对都有 SEO 落地页）、开放 API。
3. **更绿色（隐私 + 能耗）**
   - **浏览器本地转换**：TXT / MD / HTML → EPUB 完全在 Web Worker 里完成，文件一个字节都不上传（可断网演示）。这是对手没有的。
   - 服务器零留存：临时目录、任务完成即删、下载后清理、无数据库、无第三方脚本、日志脱敏。
   - 自托管：一条 `docker compose up` 或 `npx next start` 就能跑；README 给出一键部署。
   - 绿色叙事必须诚实：用「少传一次文件 = 少一次上传带宽 + 少一台常开服务器」这种可验证的说法，不编造精确碳排数字。

## 技术决策（已定，不要推翻）

- Next.js 15 App Router + React 19 + TypeScript + Tailwind v4，单仓单应用，`npx next dev -p 3100`。
- 转换核心 `lib/engine` 同构（浏览器/Node 共用），Node 专属适配器放 `lib/engine/node/` 并动态 import。
- 外部引擎：Calibre `ebook-convert` 为可选增强（本机正在安装）；Pandoc、Tesseract（已装）同理。缺失时降级并明确告知，不假装成功。
- 存储：`os.tmpdir()/kindleforge/<jobId>`，无数据库。
- i18n：中文在 `/`，英文在 `/en`；词典集中在 `lib/i18n/`。

## P0 范围（必须全部跑通）

1. 落地页（中/英）：首屏真实可用的拖拽上传、格式矩阵、与 RunConvert 的三维对比、本地转换演示、绿色/隐私说明、FAQ。
2. 转换工作台 `/convert`：多文件、目标格式、Kindle 预设（设备 + 排版参数）、进度、取消、下载、ZIP 批量、错误提示（带下一步建议）。
3. 引擎：TXT/MD/HTML→EPUB 本地、DOCX/FB2/CBZ/CBR/图片→EPUB 服务端、EPUB→TXT/HTML、calibre 桥（EPUB→MOBI/AZW3/PDF/DOCX、PDF→EPUB…）。
4. API：`/api/convert`、`/api/jobs/:id`、`/download`、`/api/formats`、`/api/health`；安全限制（大小/超时/并发/zip bomb/路径穿越）。
5. 格式对落地页 `/convert/[from]-to-[to]`（静态生成热门 12 对 + 全部合法对）。
6. 测试：引擎单测（真实文件往返）、API 集成测试、至少 1 个端到端脚本 `scripts/smoke.ts` 会在真实转换后校验 EPUB 结构。

## P1（有余力再做，别影响 P0 质量）

OCR（扫描 PDF 简体中文/英文）、漫画右到左、图片压缩与灰度、元数据/封面编辑、历史（localStorage 元数据）、URL 导入、PWA。

## 非目标

- 不做 DRM 破解（检测到 DRM 要明确拒绝并解释）。
- 不做视频/音频转换。
- 不接入付费、登录、广告、分析脚本。
- 不承诺「任何格式」——统一口径：主流 15 类输入 + 7 类输出，矩阵与降级路径清晰。

## 质量门槛（验收时逐条过）

- `npx tsc --noEmit` 0 错误；`npx vitest run` 全绿。
- `curl -s localhost:3100/api/health` 返回真实引擎状态。
- 真实样本：中文 TXT、英文 EPUB、DOCX（带标题/图片）、CBZ、扫描 PDF 各转一次，产物能用 `unzip -l`/`ebook-convert` 二次校验（EPUB 必须 mimetype 首条且未压缩、有 OPF/nav）。
- 首屏 LCP < 2.5s（本地），无第三方请求；移动端 390px 可用；键盘可完成上传→转换→下载；对比度 ≥ 4.5:1。
- 所有 UI 文案中英双语，无 mock 数据，无 TODO 占位。

## 汇报格式（给 Lead 的消息）

```
[模块] 完成/阻塞
改动的文件：...
验证方式与结果：...
风险/待决：...
```
