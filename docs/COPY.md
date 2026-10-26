# KindleForge 文案库（中 / EN）

> 供前端直接粘贴进 `lib/i18n/**`。按页面 → 区块组织；每条都给了建议 key。
> 原则：**说清楚，不夸大**。凡是数字，都能在仓库里指到出处；凡是「不支持」，都给出下一步。
>
> 维护者：design。改文案前先读第 9 节「语气与禁区」。

---

## 0. 数字口径（先读再写文案）

这些数字是全站唯一口径。不要写「很多」「几乎全部」「任何格式」。

| 事实 | 值 | 出处 |
|---|---|---|
| 输入格式 | **15 类**：EPUB / MOBI / AZW / AZW3 / PDF / DOCX / ODT / TXT / Markdown / HTML / RTF / FB2 / CBZ / CBR / 图片 | `lib/engine/formats.ts` `INPUT_FORMATS` |
| 输出格式 | **7 类**：EPUB / MOBI / AZW3 / PDF / TXT / DOCX / HTML | `lib/engine/formats.ts` `OUTPUT_FORMATS` |
| 设备预设 | **5 种**：Paperwhite / Oasis / Scribe / 入门款 / App 及其他阅读器 | `lib/engine/formats.ts` `DEVICES` |
| 单文件上限 | **200 MB** | `docs/CONTRACT.md` §3 |
| EPUB 解压资源上限 | **1 GB**；条目数 > 5000 或解压比 > 200 直接拒绝 | `docs/CONTRACT.md` §3 |
| 临时文件保留 | 任务结束或下载后**最多 10 分钟**，自动清理；可手动立即删除 | `docs/CONTRACT.md` §4 |
| 浏览器本地转换 | TXT / Markdown / HTML → EPUB 全程在 Web Worker；EPUB → TXT / HTML 的解析同为同构实现 | `docs/BRIEF.md`、`formats.ts` `local` 标记 |
| 竞品参数（对照用） | RunConvert 公开页面标注：18 种电子书格式、1 GB、云端转换、1 小时后删除、免注册、有广告（2026-10 核对） | `docs/BRIEF.md` |
| 外部引擎 | Calibre / Pandoc / Tesseract 均为**可选**；缺失时必须提示并降级，不能假装成功 | `docs/BRIEF.md`、`docs/CONTRACT.md` §3 |

**文案里的状态必须读真实状态**：任何「OCR 可用」「MOBI 可输出」都应以 `/api/formats` 返回的 `pairs` / `engines` 为准；引擎缺失时用 `ENGINE_MISSING` 文案，不要显示成功。

---

## 1. 品牌

### 1.1 名称

| 键 | 中文 | English |
|---|---|---|
| `brand.name` | KindleForge | KindleForge |
| `brand.name.zh` | 铸书 KindleForge（「铸书」只作品牌意象，正式名仍是 KindleForge） | KindleForge (Chinese nickname: 铸书) |
| `brand.short` | Forge | Forge |
| `brand.domain` | kindleforge.app | kindleforge.app |

### 1.2 一句话定位

**ZH**
> 把一份文件，铸成 Kindle 上最好读的那本书 —— 本地优先、零广告、开源可自托管。

**EN**
> Turn any document into the best-reading book on your Kindle — local-first, ad-free, open source, self-hostable.

### 1.3 Tagline（三个备选）

| # | 中文 | English | 适用 |
|---|---|---|---|
| 1 | **任何文件，都是一本书。** | **Any file, a real book.** | 主推：首屏、OG、名片 |
| 2 | 为 Kindle，认真排一次版。 | Typeset once. Read well forever. | 品质向：排版卖点、格式页 |
| 3 | 不上传，也能转。 | Convert without uploading. | 隐私向：绿色页、本地转换区 |

### 1.4 Footer 说明

| 键 | 中文 | English |
|---|---|---|
| `footer.tagline` | 本地优先的电子书转换器。不追踪、不投广告、不留存你的文件。 | A local-first ebook converter. No tracking, no ads, no copies of your files. |
| `footer.legal` | © 2026 KindleForge · 开源项目 · 与 Amazon 无关联。Kindle 是 Amazon.com, Inc. 的商标。 | © 2026 KindleForge · open source · not affiliated with Amazon. Kindle is a trademark of Amazon.com, Inc. |
| `footer.selfhost` | 也可以自己跑：`docker compose up -d` | Run it yourself: `docker compose up -d` |
| `footer.status` | 引擎状态 | Engine status |

**Footer 栏目**

| 中文 | English |
|---|---|
| 转换工作台 | Workbench |
| 格式矩阵 | Format matrix |
| 本地转换 | Local mode |
| 为什么更绿色 | Why it's greener |
| API 文档 | API docs |
| 常见问题 | FAQ |
| 源码仓库 | Source |
| 自托管指南 | Self-hosting |

---

## 2. 落地页 `/`（EN：`/en`）

### 2.1 导航

| 键 | 中文 | English |
|---|---|---|
| `nav.convert` | 转换 | Convert |
| `nav.formats` | 格式 | Formats |
| `nav.local` | 本地转换 | Local |
| `nav.green` | 绿色 | Green |
| `nav.api` | API | API |
| `nav.faq` | 常见问题 | FAQ |
| `nav.cta` | 开始转换 | Start converting |
| `nav.lang` | English | 中文 |
| `nav.skip` | 跳到主要内容 | Skip to content |

### 2.2 Hero

| 键 | 中文 | English |
|---|---|---|
| `landing.hero.eyebrow` | 本地优先 · 开源 · 零广告 | Local-first · open source · ad-free |
| `landing.hero.title` | 把任何文件，变成 Kindle 上最好读的那本书。 | Turn any file into the best book your Kindle has read. |
| `landing.hero.titleAlt` | 任何文件，都是 Kindle 上的一本好书。 | Any file, a good book on your Kindle. |
| `landing.hero.cta` | 选文件开始 | Choose a file |
| `landing.hero.ctaSecondary` | 看它能转什么 | See what it converts |
| `landing.hero.microcopy` | 免注册 · 单文件 ≤ 200 MB · TXT / MD / HTML 可不上传 | No sign-up · ≤ 200 MB per file · no upload for TXT / MD / HTML |
| `landing.hero.localBadge` | 本地转换 · 文件不上传 | Local conversion · no upload |

**Hero 副标题（ZH）**
> EPUB、MOBI、AZW3、PDF、DOCX、TXT、漫画互转。认真做中文排版：首行缩进、标点挤压、中英混排、目录与封面一次配好。转换前告诉你会得到什么，转换后告诉你改了什么。
>
> TXT / Markdown / HTML → EPUB 在你的浏览器里完成，文件一个字节都不上传。

**Hero 副标题（EN）**
> Convert EPUB, MOBI, AZW3, PDF, DOCX, TXT and comics. We set CJK typography properly — first-line indents, punctuation compression, mixed Chinese/English spacing, a real table of contents and a cover. You see what you'll get before converting, and what changed afterwards.
>
> TXT / Markdown / HTML → EPUB happens in your browser. Not one byte is uploaded.

### 2.3 上传组件（首屏真实可用）

| 键 | 中文 | English |
|---|---|---|
| `upload.title` | 把文件拖进来，或点击选择 | Drop files here, or click to choose |
| `upload.supports` | 支持 EPUB / MOBI / AZW / AZW3 / PDF / DOCX / ODT / TXT / Markdown / HTML / RTF / FB2 / CBZ / CBR / 图片 | EPUB / MOBI / AZW / AZW3 / PDF / DOCX / ODT / TXT / Markdown / HTML / RTF / FB2 / CBZ / CBR / images |
| `upload.multi` | 可一次选择多个文件 | Select multiple files at once |
| `upload.limit` | 单文件最大 200 MB；浏览器本地转换建议 ≤ 20 MB | 200 MB per file; keep browser-local conversions under 20 MB |
| `upload.local` | 这个文件可以在本地转换，不会上传 | This file can convert locally — it stays on your device |
| `upload.willUpload` | 这个格式需要临时上传，任务结束即清理 | This format needs a temporary upload; cleaned up when the job ends |
| `upload.unsupported` | 「{ext}」暂不支持 | “{ext}” isn't supported yet |
| `upload.unsupportedHint` | 试 EPUB、MOBI、AZW3、PDF、DOCX、TXT、Markdown、HTML、CBZ 或图片；也可以先转成 EPUB 再继续。 | Try EPUB, MOBI, AZW3, PDF, DOCX, TXT, Markdown, HTML, CBZ or an image — or convert to EPUB first. |
| `upload.tooLarge` | 文件超过 200 MB 上限 | This file is over the 200 MB limit |
| `upload.tooLargeHint` | 压缩图片、拆分文档，或改用本地转换（TXT / MD / HTML）。 | Compress images, split the document, or use local mode for TXT / MD / HTML. |
| `upload.aria` | 选择要转换的文件 | Choose files to convert |

### 2.4 信任条（4 条）

| 键 | 中文标题 | 中文说明 | English title | English body |
|---|---|---|---|---|
| `trust.local` | 本地转换 | 纯文本格式在浏览器里完成，可以断网验证。 | Local conversion | Text formats convert in your browser. Try it offline. |
| `trust.retention` | 零留存 | 临时文件最多保留 10 分钟，随任务一起删除。 | Zero retention | Temp files live at most 10 minutes, deleted with the job. |
| `trust.ads` | 无广告，无追踪 | 没有分析脚本、没有 Cookie 墙、没有第三方请求。 | No ads, no trackers | No analytics, no cookie wall, no third-party requests. |
| `trust.oss` | 开源可自托管 | 一条命令跑在自己的机器上，转换逻辑可以逐行读。 | Open source | Run it on your own machine with one command; read every line. |

### 2.5 三维修比表

标题：**和 RunConvert 比，我们哪里更好，哪里更差。**
EN: **Where we beat RunConvert — and where we don't.**

> 说明（必放，客观性来源）：
> 对方参数取自其公开页面（2026-10 核对），可能随时变化。★ 标记的行可以单独组成首屏精简版。

**中文表**

| | 维度 | KindleForge | RunConvert（公开页面标注） |
|---|---|---|---|
| ★ | **质量 · Kindle 排版预设** | 5 种设备预设（Paperwhite / Oasis / Scribe / 入门款 / App），字号、行距、页边距、缩进、对齐一次配好 | 通用电子书转换，未见 Kindle 专属预设 |
| ★ | **质量 · 中文排版** | 首行缩进 2em、标点挤压、中英混排、可选两端对齐 | 未见中文排版选项 |
| ★ | **质量 · 转换前后可见** | 转换前列出章节 / 字数 / 图片 / 预计阅读时长与风险；转换后给出实际结果与警告 | 直接转换，无预估与报告 |
| | **质量 · 失败处理** | 错误码 + 原因 + 下一步，拒绝产出坏文件 | 通用错误提示 |
| | **质量 · 目录 / 封面 / 元数据** | EPUB 3 nav + NCX；封面、书名、作者、语言可改 | 基础元数据保留 |
| | **覆盖 · 输入格式** | 15 类，含 DOCX / ODT / RTF / FB2 / CBZ / CBR / 图片 | 18 种电子书格式（**对方更广**） |
| | **覆盖 · 输出格式** | 7 类：EPUB / MOBI / AZW3 / PDF / TXT / DOCX / HTML | 多种电子书格式，未公开完整矩阵 |
| ★ | **覆盖 · 本地转换** | TXT / Markdown / HTML → EPUB 在浏览器完成，0 上传 | 全部上传云端 |
| | **覆盖 · 批量与 ZIP** | 多文件队列、单条重试、ZIP 打包下载 | 以单文件为主，未见批量打包 |
| | **覆盖 · OCR 与漫画** | 扫描 PDF 中 / 英 OCR（需 Tesseract）；CBZ / CBR 整页 + 右到左翻页 | 未见 OCR；漫画支持未标注 |
| | **覆盖 · 开放 API** | `POST /api/convert`、任务查询、下载、删除 | 未提供公开 API |
| ★ | **绿色 · 上传范围** | 纯文本格式 0 上传；其余仅临时上传 | 全部上传云端 |
| ★ | **绿色 · 保留时长** | 任务结束或下载后最多 10 分钟，自动清理，无数据库 | 1 小时后删除（其页面标注） |
| ★ | **绿色 · 广告与追踪** | 无广告、无分析脚本、无第三方请求 | 页面含广告 |
| | **绿色 · 自托管** | `docker compose up` 或 `npx next start` | 不支持 |
| | **绿色 · 可审计** | 源码开放，转换逻辑可读 | 闭源服务 |

**English table**

| | Dimension | KindleForge | RunConvert (per their page) |
|---|---|---|---|
| ★ | **Quality · Kindle presets** | Five device presets (Paperwhite / Oasis / Scribe / basic / app) set size, leading, margins, indent and alignment in one go | Generic conversion; no Kindle-specific presets found |
| ★ | **Quality · CJK typesetting** | 2em first-line indent, punctuation compression, mixed-script spacing, optional justification | No CJK typesetting options found |
| ★ | **Quality · Before & after** | Chapters, words, images, reading time and risks before converting; real results and warnings afterwards | Converts directly; no estimate or report |
| | **Quality · Failure handling** | Error code, cause and next step — never a quietly broken file | Generic error messages |
| | **Quality · TOC / cover / metadata** | EPUB 3 nav + NCX; editable cover, title, author, language | Basic metadata preserved |
| | **Coverage · Inputs** | 15 classes, including DOCX / ODT / RTF / FB2 / CBZ / CBR / images | 18 ebook formats (**they cover more**) |
| | **Coverage · Outputs** | 7 classes: EPUB / MOBI / AZW3 / PDF / TXT / DOCX / HTML | Several ebook formats; full matrix not published |
| ★ | **Coverage · Local conversion** | TXT / Markdown / HTML → EPUB in the browser, zero upload | Everything goes to the cloud |
| | **Coverage · Batch & ZIP** | Multi-file queue, per-item retry, ZIP download | Single-file focus; no batch packaging found |
| | **Coverage · OCR & comics** | Chinese/English OCR for scans (needs Tesseract); CBZ / CBR full-page and right-to-left | No OCR found; comic support not stated |
| | **Coverage · Open API** | `POST /api/convert`, job status, download, delete | No public API |
| ★ | **Green · Upload scope** | Text formats never leave the browser; others only a temporary upload | Everything uploaded to the cloud |
| ★ | **Green · Retention** | At most 10 minutes after the job ends or the download; automatic cleanup, no database | Deleted after 1 hour (per their page) |
| ★ | **Green · Ads & tracking** | No ads, no analytics, no third-party requests | Ads on the site |
| | **Green · Self-hosting** | `docker compose up` or `npx next start` | Not supported |
| | **Green · Auditability** | Open source; every conversion path is readable | Closed service |

**结论段（ZH）**
> 我们没赢的地方写在这儿：对方输入扩展名更多（18 种 vs 我们 15 类），单文件上限更大（1 GB vs 200 MB）。如果这两点对你最重要，对方可能更合适。
>
> 我们赌的是另一件事：**同一本书，在 Kindle 上读起来更好**。这来自排版、目录、中文断行，以及失败时不糊弄你。

**Conclusion (EN)**
> Here's where we lose: they accept more input extensions (18 formats vs our 15 classes) and allow larger single files (1 GB vs 200 MB). If those two matter most to you, they may be the better fit.
>
> We're betting on something else: **the same book reads better on a Kindle.** That comes from typesetting, a real TOC, CJK line breaking — and from not bluffing when a conversion fails.

### 2.6 格式矩阵区

| 键 | 中文 | English |
|---|---|---|
| `formats.title` | 15 类进，7 类出。 | 15 in, 7 out. |
| `formats.sub` | 点一个格式，看它能变成什么；也可以直接读每个格式对的说明。 | Pick a format to see where it can go — or read the page for any pair. |
| `formats.input` | 输入 | Input |
| `formats.output` | 输出 | Output |
| `formats.local` | 可在浏览器本地完成 | Can run in your browser |
| `formats.server` | 需要服务器或外部引擎 | Needs the server or an external engine |
| `formats.viewPair` | 查看 {from} → {to} | Open {from} → {to} |
| `formats.all` | 全部格式对 | All pairs |
| `formats.pairsCount` | {count} 组合法格式对 | {count} supported pairs |

### 2.7 本地模式说明

标题：**不出这台设备，也能转成 EPUB。**
EN: **EPUB without leaving your device.**

**ZH 正文**
> 对 TXT、Markdown、HTML 这三类纯文本，转换完全在你的浏览器里跑：读取、识别章节、排版、写 EPUB 容器，全部由 Web Worker 完成。文件不上传，服务器不知道你转过什么。
>
> 断网也能用。打开开发者工具的 Network 面板，转换期间你会看到 0 个上传请求 —— 这是可以当场验证的，不是一句口号。

**EN**
> For TXT, Markdown and HTML, the whole pipeline runs in your browser: read, detect chapters, typeset, write the EPUB container — all inside a Web Worker. Nothing is uploaded, and the server never learns what you converted.
>
> It works with the network off. Open DevTools → Network and convert a file: you'll see zero upload requests. That's a claim you can check in ten seconds.

| 键 | 中文 | English |
|---|---|---|
| `local.how` | 怎么做到的 | How it works |
| `local.howBody` | 共用同一套同构引擎：浏览器里跑的是 Node 上的同一份 reader / writer 代码，只是不碰文件系统。 | The same isomorphic engine: the browser runs the same reader/writer code as Node, minus the filesystem. |
| `local.verify` | 怎么验证 | How to verify |
| `local.verifyBody` | 断网；或在 Network 面板过滤 XHR，转换期间计数应为 0。 | Disconnect the network, or filter XHR in DevTools — the count should stay at 0. |
| `local.limit` | 边界 | Limits |
| `local.limitBody` | 受浏览器内存限制，建议 ≤ 20 MB；需要 MOBI / AZW3 / PDF 等输出，仍会走服务器。 | Browser memory is the limit; keep it under 20 MB. Outputs like MOBI / AZW3 / PDF still need the server. |
| `local.cta` | 试一个 TXT | Try a TXT |

### 2.8 绿色区

标题：**少传一次文件，就少开一台服务器。**
EN: **One less upload, one less server.**

**ZH 正文**
> 绿色不该是贴纸。这里能验证的只有三件事：传了多少字节、服务器留了多久、页面发了几个第三方请求。我们把这三件事压到最低，并且不编造精确的碳排数字。

**EN**
> Green shouldn't be a sticker. Only three things here are verifiable: how many bytes travel, how long the server keeps a copy, and how many third-party requests the page makes. We keep all three as low as we can — and we don't invent carbon numbers.

| 键 | 中文标题 | 中文说明 | English title | English body |
|---|---|---|---|---|
| `green.zero` | 零上传 | 纯文本格式在浏览器完成；其他格式只在转换期间临时上传。 | Zero upload | Text formats never leave the browser; others are uploaded only for the job. |
| `green.retention` | 零留存 | 任务结束或下载后最多 10 分钟自动删除；无数据库、无备份。 | Zero retention | Deleted within 10 minutes of the job ending or download; no database, no backups. |
| `green.tracking` | 无追踪 | 没有分析脚本、没有广告像素、没有第三方字体与 CDN。 | No tracking | No analytics, no ad pixels, no third-party fonts or CDNs. |
| `green.selfhost` | 自托管 | `docker compose up -d`，或 `npx next start`。断网也能跑。 | Self-host | `docker compose up -d`, or `npx next start`. Works offline. |
| `green.honest` | 我们不做的事 | 不编造碳排数字，不买「碳中和」标签，不用「环保」当形容词。 | What we don't do | No invented carbon figures, no "carbon neutral" badges, no "eco" adjectives. |

链接：`green.more` 读完整说明 / Read the full note。

### 2.9 Kindle 排版卖点

标题：**在 Kindle 上好看，是因为排版是转出来的，不是碰运气。**
EN: **It reads well because the typography is converted, not hoped for.**

| 键 | 中文 | English |
|---|---|---|
| `type.indent` | 首行缩进 2em | 2em first-line indent |
| `type.indentBody` | 中文段落靠缩进分节，不靠空行硬撑。 | Chinese paragraphs are separated by indent, not by blank lines. |
| `type.leading` | 行高 1.5–1.8 可调 | Adjustable 1.5–1.8 leading |
| `type.leadingBody` | 长篇阅读不累，诗句与注释也能单独设。 | Comfortable over long reads; verse and notes can differ. |
| `type.justify` | 两端对齐 + 标点挤压 | Justification with punctuation compression |
| `type.justifyBody` | 中文标点不占半格，中英之间自动留出呼吸。 | CJK punctuation stops stealing half-widths; Latin and Chinese get breathing room. |
| `type.device` | 按设备预设 | Device presets |
| `type.deviceBody` | Paperwhite / Oasis / Scribe / 入门款 / App，字号与页边距一次到位。 | Paperwhite / Oasis / Scribe / basic / app — size and margins set for the screen. |
| `type.toc` | 真正的目录 | A real table of contents |
| `type.tocBody` | EPUB 3 nav + NCX，Kindle 侧边栏可以直接跳章。 | EPUB 3 nav + NCX, so the Kindle sidebar can jump chapters. |
| `type.meta` | 封面与元数据 | Cover and metadata |
| `type.metaBody` | 书名、作者、语言、出版信息、封面一次带过去。 | Title, author, language, publisher and cover travel with the book. |
| `type.report` | 转换报告 | Conversion report |
| `type.reportBody` | 章节、字数、图片、预计阅读时长，以及所有降级警告。 | Chapters, words, images, reading time and every downgrade warning. |

### 2.10 批量 / OCR / 漫画

标题：**一次一摞，或者一整柜漫画。**
EN: **A batch of files, or a shelf of manga.**

| 键 | 中文标题 | 中文说明 | English title | English body |
|---|---|---|---|---|
| `batch.title` | 批量 + ZIP | 多选、排队、单条重试，完成后打包成一个 ZIP。 | Batch + ZIP | Select many, queue them, retry individual items, download one ZIP. |
| `ocr.title` | OCR（可选） | 扫描 PDF 先识别再重排；支持简体中文与英文。没装 Tesseract 时会明确告诉你，而不是交出一个空白文件。 | OCR (optional) | Scanned PDFs are recognised before reflow — Simplified Chinese and English. If Tesseract is missing we say so instead of handing you a blank file. |
| `comic.title` | 漫画模式 | CBZ / CBR 整页阅读，右到左翻页，图片按墨水屏尺寸优化。 | Comics | CBZ / CBR as full-page manga, right-to-left, images sized for e-ink. |
| `gallery.title` | 图册 / 字帖 | 单张或一组图片做成整页图册，适合摄影、画册、字帖。 | Galleries | One image or a set becomes a full-page art book — photography, portfolios, copybooks. |

### 2.11 FAQ（10 条）

标题：**常见问题。**
EN: **Questions people actually ask.**

**1. 支持有 DRM 的书吗？** `faq.drm`
> 不支持，也不破解。检测到 DRM 时我们会拒绝转换并说明原因。你仍然可以在购买平台允许的范围内导出自己拥有的书，或提供无 DRM 的版本。

**Do you support DRM-protected books?**
> No — and we don't break DRM. If protection is detected we refuse the job and explain why. You can still export a book you own through whatever your store permits, or supply a DRM-free copy.

**2. 现在还需要 MOBI 吗？** `faq.mobi`
> 看设备。Paperwhite、Oasis 这类新机型用 AZW3 或 EPUB 更好（排版、字体、目录都更完整）；老款 Kindle 用 MOBI 最稳。我们两种都能输出，按设备预设会自动推荐。

**Do I still need MOBI?**
> Depends on the device. Newer Paperwhite/Oasis models do better with AZW3 or EPUB — richer typography, fonts and TOC. Older Kindles are safest with MOBI. We output both, and the device preset picks a sensible default.

**3. 我的文件会被看到吗？** `faq.privacy`
> 纯文本格式（TXT / MD / HTML → EPUB）完全不上传。需要服务器的格式只在转换期间临时上传，任务结束或下载后最多 10 分钟自动删除；不落数据库、不记录文件名、无第三方脚本。自托管时，文件连这台机器都不会离开。

**Can anyone see my files?**
> Text formats (TXT / MD / HTML → EPUB) are never uploaded. Formats that need the server are uploaded only for the job and deleted within 10 minutes of completion or download — no database, no filenames in logs, no third-party scripts. Self-hosted, files never leave your machine.

**4. 转换失败了怎么办？** `faq.failure`
> 我们会给一个错误码、一句人话解释和一个下一步：文件损坏、缺少引擎、有 DRM、超出大小，还是超时。失败时不会给你一个坏文件。多数情况可以按提示重试，或换一个目标格式。

**What if a conversion fails?**
> You get an error code, a plain-language cause and a next step — corrupt file, missing engine, DRM, size limit or timeout. We never hand you a quietly broken file. Most failures can be retried or solved by picking a different target.

**5. 有 API 吗？** `faq.api`
> 有。`POST /api/convert` 提交任务，`GET /api/jobs/:id` 查进度，`GET /api/jobs/:id/download` 下载，`DELETE /api/jobs/:id` 立即删除。无鉴权，自托管时建议在反向代理上做限流。

**Is there an API?**
> Yes. `POST /api/convert` starts a job, `GET /api/jobs/:id` reports progress, `GET /api/jobs/:id/download` downloads, `DELETE /api/jobs/:id` deletes it immediately. There's no auth; when self-hosting, put rate limiting on your reverse proxy.

**6. 怎么自己部署？** `faq.selfhost`
> 源码仓库里两种方式：`docker compose up -d`，或 `npx next start`。Calibre / Pandoc / Tesseract 是可选的增强引擎；没装也能跑内置路径，只是部分格式对会提示需要引擎。

**How do I self-host it?**
> Two ways in the repo: `docker compose up -d`, or `npx next start`. Calibre / Pandoc / Tesseract are optional enhancers — the built-in paths work without them, though some format pairs will explain that they need an engine.

**7. 能传多大的文件？** `faq.size`
> 单个文件 ≤ 200 MB；EPUB 解压后的资源 ≤ 1 GB。浏览器本地转换受内存限制，建议 ≤ 20 MB。超大文件先拆分，通常比硬转更快也更稳。

**How large can a file be?**
> Up to 200 MB per file, and up to 1 GB of unpacked assets inside an EPUB. Browser-local conversion is memory-bound — keep it under 20 MB. Splitting a huge file is usually faster and safer than forcing it through.

**8. 文件会留多久？** `faq.retention`
> 任务结束或下载后最多 10 分钟，随后自动删除；也可以在工作台点「立即删除」。没有数据库，没有备份，进程退出时也会清理。

**How long do you keep my file?**
> At most 10 minutes after the job ends or you download it, then it's removed automatically — or delete it immediately from the workbench. No database, no backups, and the process cleans up on exit.

**9. 中文为什么会乱码？** `faq.encoding`
> 常见原因是源文件编码不是 UTF-8（老 TXT 常见 GBK / GB18030）。我们会在读取时检测并转换，输出统一 UTF-8 并声明语言。如果排版正常但显示方框，那是阅读器字体问题，换一款中文字体即可。

**Why does Chinese sometimes turn into garbage?**
> Usually the source isn't UTF-8 — older TXT files are often GBK/GB18030. We detect and convert on read, and always write UTF-8 with a declared language. If the layout is fine but you see boxes, that's a reader font issue: switch to a CJK font.

**10. 手机上能用吗？** `faq.mobile`
> 能。工作台从 390px 起可用，上传、选格式、转换、下载都能完成；本地转换在移动浏览器也能跑，只是内存更紧，大文件建议用桌面。API 在手机上同样可用。

**Does it work on my phone?**
> Yes. The workbench works from 390px wide — upload, choose a format, convert, download. Local conversion runs on mobile browsers too, with tighter memory; big files are better on a desktop. The API works anywhere.

### 2.12 结尾 CTA

**ZH**
> **手边那份文件，值得一个更好的版本。**
> 拖进来，选设备，读一遍转换报告，然后把书放进 Kindle。
>
> `[开始转换]` `[先看看格式矩阵]`
> 免注册 · 无广告 · 文件最多保留 10 分钟

**EN**
> **That file on your desktop deserves a better edition.**
> Drop it in, pick your device, read the conversion report, then send the book to your Kindle.
>
> `[Start converting]` `[Browse the format matrix]`
> No sign-up · no ads · files kept for at most 10 minutes

---

## 3. 转换工作台 `/convert`

### 3.1 页面头

| 键 | 中文 | English |
|---|---|---|
| `wb.title` | 转换工作台 | Conversion workbench |
| `wb.sub` | 上传、选目标格式、调 Kindle 排版。每一步都会告诉你发生了什么。 | Upload, choose a target, tune the Kindle typography. Every step tells you what's happening. |
| `wb.breadcrumb` | 首页 / 转换 | Home / Convert |
| `wb.queue` | 队列 | Queue |

### 3.2 上传与文件列表

| 键 | 中文 | English |
|---|---|---|
| `wb.drop.title` | 把文件拖到这里 | Drop your files here |
| `wb.drop.body` | 支持 15 类输入；TXT / Markdown / HTML 可以不上传，直接在浏览器里转成 EPUB。 | 15 input classes; TXT / Markdown / HTML convert to EPUB in your browser without uploading. |
| `wb.drop.choose` | 选择文件 | Choose files |
| `wb.drop.addMore` | 继续添加 | Add more |
| `wb.drop.release` | 松手即可加入队列 | Release to add to the queue |
| `wb.drop.empty` | 队列是空的。拖入文件，或用上面的按钮选择。 | The queue is empty. Drop files here or use the button above. |
| `wb.col.file` | 文件 | File |
| `wb.col.format` | 格式 | Format |
| `wb.col.size` | 大小 | Size |
| `wb.col.target` | 目标 | Target |
| `wb.col.status` | 状态 | Status |
| `wb.col.actions` | 操作 | Actions |
| `wb.file.remove` | 移除 | Remove |
| `wb.file.removeAria` | 移除文件 {name} | Remove file {name} |
| `wb.file.local` | 本地 · 未上传 | Local · not uploaded |
| `wb.file.uploaded` | 临时上传 | Temporary upload |
| `wb.file.retry` | 重试 | Retry |
| `wb.file.cancel` | 取消 | Cancel |

**状态** `wb.status.*`

| 值 | 中文 | English |
|---|---|---|
| queued | 等待中 | Queued |
| uploading | 上传中 | Uploading |
| parsing | 解析中 | Parsing |
| converting | 转换中 | Converting |
| packaging | 打包中 | Packaging |
| done | 已完成 | Done |
| cancelled | 已取消 | Cancelled |
| error | 失败 | Failed |

### 3.3 目标格式与设备

| 键 | 中文 | English |
|---|---|---|
| `wb.target.label` | 目标格式 | Target format |
| `wb.target.hint` | 每台 Kindle 的最优格式不同。不确定就选 AZW3（Paperwhite / Oasis），或 EPUB（App 与其他阅读器）。 | The best format depends on the device. If unsure: AZW3 for Paperwhite/Oasis, EPUB for apps and other readers. |
| `wb.target.recommended` | 推荐 | Recommended |
| `wb.target.outputs` | 可输出 7 类 | 7 output classes |
| `wb.device.label` | 设备预设 | Device preset |
| `wb.device.hint` | 预设只影响排版参数与推荐格式，不会锁定输出。 | Presets tune typography and the recommended target; they never lock the output. |

**设备选项**（与 `DEVICES` 一致）

| 值 | 中文 | English |
|---|---|---|
| paperwhite | Kindle Paperwhite · AZW3 · 6.8 英寸 · 300ppi | Kindle Paperwhite · AZW3 · 6.8" · 300ppi |
| oasis | Kindle Oasis · AZW3 · 7 英寸 · 实体翻页键 | Kindle Oasis · AZW3 · 7" · page-turn buttons |
| scribe | Kindle Scribe · PDF · 10.2 英寸 · 手写批注 | Kindle Scribe · PDF · 10.2" · stylus notes |
| basic | 入门款 Kindle · MOBI · 老设备最稳妥 | Kindle (basic) · MOBI · safest for old devices |
| app | Kindle App / 其他阅读器 · EPUB · 手机、平板、Kobo | Kindle App / other readers · EPUB · phones, tablets, Kobo |

### 3.4 Kindle 排版选项

| 键 | 中文标签 | 中文说明 | English label | English hint |
|---|---|---|---|---|
| `wb.type.indent` | 首行缩进 | 0–4em，中文建议 2em。 | First-line indent | 0–4em; 2em is the CJK default. |
| `wb.type.spacing` | 段间距 | 0–1.5em；与缩进二选一，不要同时用力。 | Paragraph spacing | 0–1.5em; use it instead of, not in addition to, a big indent. |
| `wb.type.leading` | 行高 | 1.3–2.0，长篇建议 1.6–1.8。 | Line height | 1.3–2.0; 1.6–1.8 for long reads. |
| `wb.type.justify` | 两端对齐 | 中文建议开启；英文长篇关掉可避免「河」。 | Justify | On for Chinese; off for long English text to avoid rivers. |
| `wb.type.hyphenate` | 英文连字符 | 仅影响拉丁文，中文不受影响。 | Hyphenate Latin | Latin text only; CJK is untouched. |
| `wb.type.font` | 正文字体 | 宋体 / 黑体 / 出版社默认。 | Body font | Serif / sans / publisher default. |
| `wb.type.size` | 基准字号 | 16–24px；Kindle 端仍可缩放。 | Base size | 16–24px; Kindle still lets readers scale it. |
| `wb.type.note` | 说明 | 这些设置写进 EPUB 样式表，在 Kindle 上仍可被系统设置覆盖——我们给的是更好的起点。 | Note | Settings go into the EPUB stylesheet and can still be overridden on the device — we're setting a better starting point. |

### 3.5 结构与增强

| 键 | 中文标签 | 中文说明 | English label | English hint |
|---|---|---|---|---|
| `wb.opt.toc` | 生成目录 | nav.xhtml + NCX，Kindle 侧边栏可跳转。 | Table of contents | nav.xhtml + NCX, so the Kindle sidebar can jump. |
| `wb.opt.cover` | 保留封面 | 关闭会移除封面页（仍保留元数据）。 | Keep cover | Off removes the cover page but keeps metadata. |
| `wb.opt.split` | 按标题拆分章节 | 每个一级标题一个文件，翻页更快。 | Split by headings | One file per top-level heading; faster page turns. |
| `wb.opt.manga` | 漫画右到左 | 仅对 CBZ / CBR / 图集生效。 | Manga right-to-left | Applies to CBZ / CBR / image sets. |
| `wb.opt.ocr` | OCR 扫描件 | 服务器端识别，中 / 英；缺失引擎时会提示。 | OCR scans | Server-side, Chinese/English; warns if the engine is missing. |
| `wb.opt.ocrLang` | OCR 语言 | 简体中文 / English。 | OCR language | Simplified Chinese / English. |
| `wb.opt.images` | 图片适配墨水屏 | 压缩尺寸并可选灰度，减少体积。 | Optimise for e-ink | Resize and optionally grey-scale to cut size. |
| `wb.opt.metadata` | 元数据 | 书名、作者、语言、出版信息可覆盖原文件。 | Metadata | Override title, author, language, publisher. |

**元数据字段** `wb.meta.*`

| 键 | 中文 | English |
|---|---|---|
| `wb.meta.title` | 书名 | Book title |
| `wb.meta.author` | 作者 | Author |
| `wb.meta.language` | 语言 | Language |
| `wb.meta.publisher` | 出版信息 | Publisher |
| `wb.meta.description` | 简介 | Description |
| `wb.meta.titlePlaceholder` | 留空则沿用原文件 | Leave blank to keep the original |
| `wb.meta.languagePlaceholder` | zh-CN / en | zh-CN / en |

### 3.6 操作按钮

| 键 | 中文 | English |
|---|---|---|
| `wb.action.convert` | 开始转换 | Convert |
| `wb.action.convertAll` | 全部转换（{count}） | Convert all ({count}) |
| `wb.action.cancelAll` | 取消全部 | Cancel all |
| `wb.action.clear` | 清空队列 | Clear queue |
| `wb.action.delete` | 立即删除 | Delete now |
| `wb.action.download` | 下载 | Download |
| `wb.action.downloadZip` | 全部下载（ZIP） | Download all (ZIP) |
| `wb.action.again` | 再转一个 | Convert another |
| `wb.action.report` | 转换报告 | Conversion report |
| `wb.action.retryAll` | 重试失败项 | Retry failed |

### 3.7 进度文案

| 键 | 中文 | English |
|---|---|---|
| `wb.progress.upload` | 正在上传 {name}（{percent}%）… | Uploading {name} ({percent}%)… |
| `wb.progress.uploadLocal` | 本地读取中，文件没有离开你的浏览器。 | Reading locally — nothing has left your browser. |
| `wb.progress.parse` | 分析结构：读取章节、图片与元数据。 | Reading structure: chapters, images and metadata. |
| `wb.progress.convert` | 正在按 Kindle 预设排版。 | Setting type for your Kindle. |
| `wb.progress.package` | 生成 EPUB 容器与目录。 | Packaging the EPUB container and TOC. |
| `wb.progress.finalise` | 最后检查：mimetype、OPF、导航。 | Final check: mimetype, OPF, navigation. |
| `wb.progress.eta` | 预计还需 {seconds} 秒 | About {seconds}s left |
| `wb.progress.slow` | 比预期慢。大文件与扫描 PDF 会更久，可以留在这一页。 | Slower than usual. Large files and scanned PDFs take longer; you can stay on this page. |
| `wb.progress.cancelled` | 已取消。临时文件会一起删掉。 | Cancelled. Temporary files are deleted with the job. |
| `wb.progress.aria` | 转换进度 {percent}% | Conversion progress {percent}% |
| `wb.progress.step` | 第 {current} / {total} 步 | Step {current} of {total} |

### 3.8 空状态（工作台 / 批量）

| 键 | 中文 | English |
|---|---|---|
| `wb.empty.title` | 还没有文件 | No files yet |
| `wb.empty.body` | 拖入一个 EPUB、PDF、DOCX 或一整个文件夹。纯文本格式可以直接在浏览器里转，不上传。 | Drop an EPUB, PDF, DOCX or a whole folder. Text formats can convert in the browser without uploading. |
| `wb.empty.cta` | 选择文件 | Choose files |
| `wb.empty.hint` | 单文件 ≤ 200 MB；本地转换建议 ≤ 20 MB。 | 200 MB per file; keep local conversions under 20 MB. |
| `wb.empty.batch` | 这一批还没有成功的文件 | Nothing in this batch yet |
| `wb.empty.batchBody` | 失败项可以单独重试；也可以换一个目标格式重新排队。 | Failed items can be retried individually, or re-queued with a different target. |

### 3.9 成功文案

| 键 | 中文 | English |
|---|---|---|
| `wb.done.title` | 转换完成 | Conversion complete |
| `wb.done.body` | 已检查 EPUB 结构：mimetype 首条且未压缩，OPF 与导航齐全。 | EPUB structure verified: uncompressed mimetype first, OPF and navigation present. |
| `wb.done.download` | 下载 {filename} | Download {filename} |
| `wb.done.again` | 再转一个 | Convert another |
| `wb.done.warnings` | 需要你知道的 | Worth knowing |
| `wb.done.warningsBody` | 有些东西可以更接近原版，但不是全部都能保住。下面是最实际的影响。 | Some things could be closer to the original, but not everything survives. Here's what actually changed. |
| `wb.done.noWarnings` | 没有警告：排版与目录都按预期生成。 | No warnings: typography and TOC came out as expected. |
| `wb.done.stats` | 这本书记录 | This book |
| `wb.done.engine` | 引擎：{engine} | Engine: {engine} |
| `wb.done.duration` | 用时 {seconds} 秒 | Took {seconds}s |
| `wb.done.size` | {size} | {size} |

**统计字段**

| 键 | 中文 | English |
|---|---|---|
| `wb.stats.chapters` | 章节 | Chapters |
| `wb.stats.words` | 字数 | Words |
| `wb.stats.images` | 图片 | Images |
| `wb.stats.reading` | 预计阅读 | Reading time |
| `wb.stats.format` | 格式 | Format |
| `wb.stats.source` | 来源 | Source |
| `wb.stats.local` | 本地完成 | Converted locally |

**阅读时长格式**：`{h} 小时 {m} 分钟` / `{h}h {m}m`；< 1 小时只显示 `{m} 分钟` / `{m}m`。

**引擎名**

| 值 | 中文 | English |
|---|---|---|
| builtin | 内置引擎 | Built-in |
| calibre | Calibre | Calibre |
| pandoc | Pandoc | Pandoc |
| ocr | OCR | OCR |

### 3.10 批量 ZIP

| 键 | 中文 | English |
|---|---|---|
| `wb.zip.title` | 打包好了 | Zip ready |
| `wb.zip.body` | {done} 个成功，{failed} 个失败。ZIP 里只有成功的文件。 | {done} succeeded, {failed} failed. The ZIP contains successful files only. |
| `wb.zip.allGood` | {done} 个文件已打包，目录结构保持原样。 | {done} files zipped, folder structure preserved. |
| `wb.zip.download` | 下载 ZIP | Download ZIP |
| `wb.zip.partial` | 失败的条目仍可单独重试。 | Failed items can still be retried individually. |
| `wb.zip.name` | kindleforge-{date}.zip | kindleforge-{date}.zip |

### 3.11 错误码 → 人话

每个错误都包含：**发生了什么 / 为什么 / 下一步**。不要在 UI 里只显示错误码。

**`UNSUPPORTED_PAIR`**
> **这一对格式还不支持。** `{from}` → `{to}` 需要外部引擎，或尚未实现。试试先转成 EPUB 再转目标格式，或者看看这些相邻组合：{suggestions}。
> EN: **That pair isn't supported yet.** `{from}` → `{to}` needs an external engine or isn't implemented. Try going through EPUB first, or pick one of these nearby pairs: {suggestions}.

**`ENGINE_MISSING`**
> **缺少转换引擎。** 这个组合需要 {engine}，当前机器上没有检测到。文件没有上传，也没有被删除。自托管时安装引擎后重试；或改选内置引擎支持的目标格式。
> EN: **Converter engine missing.** This pair needs {engine}, which isn't available on this machine. Nothing was uploaded or deleted. Install it on your self-hosted instance and retry, or pick a target the built-in engine supports.

**`DRM`**
> **这本书有 DRM 保护。** 我们不解密受 DRM 保护的文件，也不会尝试绕过。请使用你购买时允许的导出方式，或提供无 DRM 的版本。
> EN: **This book is DRM-protected.** We don't decrypt DRM-protected files or try to work around them. Use whatever export your purchase permits, or supply a DRM-free copy.

**`TOO_LARGE`**
> **文件太大了。** 单文件上限 200 MB，EPUB 解压后资源上限 1 GB。压缩图片、拆分文档，或对 TXT / MD / HTML 改用本地转换。
> EN: **File too large.** The limit is 200 MB per file and 1 GB of unpacked assets inside an EPUB. Compress images, split the document, or use local mode for TXT / MD / HTML.

**`TIMEOUT`**
> **转换超时。** 超过 {limit} 秒仍未完成，任务已停止，临时文件已清理。先拆成更小的文件，或先转成 EPUB 再转目标格式，通常会更快。
> EN: **Conversion timed out.** The job ran past {limit}s, was stopped, and its temporary files were removed. Splitting the file or going through EPUB first is usually faster.

**`INVALID_FILE`**
> **这个文件读不出来。** 扩展名和内容对不上、文件损坏，或者加了密。用原程序重新导出一次，或换一个副本再试。
> EN: **Couldn't read this file.** The extension doesn't match the contents, the file is damaged, or it's encrypted. Re-export it from the original app, or try another copy.

**`INTERNAL`**
> **我们这边出错了。** 已记录一个不含文件名的错误编号 `{id}`，临时文件已清理。重试一次；如果仍然失败，带上这个编号反馈。
> EN: **Something broke on our side.** We logged an error ID that contains no filename (`{id}`) and cleaned up the temp files. Try once more; if it still fails, send us that ID.

| 键 | 中文 | English |
|---|---|---|
| `err.retry` | 重试 | Retry |
| `err.changeFormat` | 换一个目标格式 | Pick another target |
| `err.readDocs` | 看错误说明 | Read the error guide |
| `err.copyId` | 复制编号 | Copy ID |
| `err.copied` | 已复制 | Copied |

### 3.12 键盘与无障碍微文案

| 键 | 中文 | English |
|---|---|---|
| `wb.a11y.hint` | 键盘：Tab 移动，Enter 选择，Esc 关闭弹窗。 | Keyboard: Tab to move, Enter to select, Esc to close dialogs. |
| `wb.a11y.queue` | 队列中有 {count} 个文件 | {count} files in the queue |
| `wb.a11y.progress` | {name}：{status}，{percent}% | {name}: {status}, {percent}% |
| `wb.a11y.done` | {name} 转换完成，可下载 | {name} is ready to download |
| `wb.a11y.error` | {name} 转换失败：{message} | {name} failed: {message} |

---

## 4. 格式页模板 `/convert/[from]-to-[to]`

> 变量：`{fromName}` `{toName}`（英文显示名，如 `EPUB` / `MOBI`）、`{fromNameZh}` `{toNameZh}`、`{fromExt}` `{toExt}`、`{fromBlurb}` `{toBlurb}`（来自 `FORMAT_INFO`）、`{qualityNote}`（`capabilities().note`）、`{engineLabel}`、`{localEligible}`、`{pairCount}`、`{relatedPairs}`。

### 4.1 SEO 元信息

| 键 | 中文 | English |
|---|---|---|
| `pair.meta.title` | {fromNameZh} 转 {toNameZh} — 在线转换，Kindle 排版优化 · KindleForge | Convert {fromName} to {toName} — Kindle-ready, typography-aware · KindleForge |
| `pair.meta.description` | 把 {fromNameZh} 转成 {toNameZh}：Kindle 专用排版、目录与封面一次配好，转换前给出预估，结束后给出报告。{localLine} | Convert {fromName} to {toName} with Kindle typography, a real TOC and cover. You see an estimate before converting and a report afterwards. {localLine} |
| `pair.meta.descriptionLocal` | 纯文本格式，转换在浏览器里完成，文件不上传。 | Text formats convert in your browser — no upload. |

### 4.2 页面结构

| 键 | 中文 | English |
|---|---|---|
| `pair.h1` | {fromNameZh} 转 {toNameZh} | Convert {fromName} to {toName} |
| `pair.eyebrow` | 格式转换 | Format conversion |
| `pair.cta` | 现在转换 {fromName} | Convert {fromName} now |
| `pair.ctaSecondary` | 查看全部格式 | See all formats |
| `pair.badge.local` | 本地转换 · 0 上传 | Local · zero upload |
| `pair.badge.server` | 服务端转换 · 临时文件 ≤ 10 分钟 | Server conversion · temp files ≤ 10 min |
| `pair.engine` | 引擎：{engineLabel} | Engine: {engineLabel} |
| `pair.quality` | 质量：{quality} | Quality: {quality} |
| `pair.steps.title` | 三步 | Three steps |
| `pair.steps.one` | 选择 {fromNameZh} 文件（单文件 ≤ 200 MB） | Choose your {fromName} file (≤ 200 MB) |
| `pair.steps.two` | 选 {toNameZh} 与设备预设；需要的话调排版 | Pick {toName} and a device preset; tune typography if you like |
| `pair.steps.three` | 下载；多文件可以打包成 ZIP | Download — or batch several files into a ZIP |
| `pair.about.title` | 关于 {fromNameZh} → {toNameZh} | About {fromName} → {toName} |
| `pair.about.body` | {fromBlurb} 转成 {toNameZh} 之后，{toBlurb} {qualityNote} | {fromBlurb} Converted to {toName}, {toBlurb} {qualityNote} |
| `pair.report.title` | 转换前你会看到 | What you'll see before converting |
| `pair.report.body` | 章节数、字数、图片数、预计阅读时长，以及可能丢失的东西（固定版式、嵌入字体、DRM）。 | Chapters, words, images, reading time — and what may be lost (fixed layout, embedded fonts, DRM). |
| `pair.quality.title` | 这个组合的真实质量 | What this pair actually preserves |
| `pair.related` | 相邻格式 | Nearby conversions |
| `pair.all` | 全部格式对 | All format pairs |
| `pair.faq.title` | {fromNameZh} 转 {toNameZh} 常见问题 | {fromName} → {toName} questions |

### 4.3 引言模板

**本地组合（`{localEligible}` 为真）**
> 把 {fromNameZh} 转成 {toNameZh}，全程在你的浏览器里完成：章节识别、Kindle 排版、EPUB 容器都由 Web Worker 生成。文件不上传，断网也能跑。
> Convert {fromName} to {toName} entirely in your browser — chapter detection, Kindle typesetting and the EPUB container are built in a Web Worker. Nothing is uploaded; it works offline.

**服务端组合**
> 把 {fromNameZh} 转成 {toNameZh}，按 Kindle 的设备预设输出。文件只为这次转换临时上传，任务结束或下载后最多 10 分钟删除。
> Convert {fromName} to {toName} with Kindle device presets. The file is uploaded only for this job and deleted within 10 minutes of completion or download.

### 4.4 能力说明

| 键 | 中文 | English |
|---|---|---|
| `pair.cap.format` | 输入 {fromNameZh} → 输出 {toNameZh} | {fromName} in → {toName} out |
| `pair.cap.toc` | 目录：自动生成 nav + NCX | TOC: nav + NCX generated |
| `pair.cap.meta` | 元数据：书名、作者、语言可改 | Metadata: title, author, language editable |
| `pair.cap.cover` | 封面：保留、替换或移除 | Cover: keep, replace or remove |
| `pair.cap.device` | 设备预设：5 种 | Device presets: 5 |
| `pair.cap.limit` | 单文件 ≤ 200 MB | 200 MB per file |
| `pair.cap.retention` | 临时文件 ≤ 10 分钟 | Temp files ≤ 10 min |
| `pair.cap.engine` | 引擎：{engineLabel} | Engine: {engineLabel} |
| `pair.cap.local` | 本地：{localEligible} | Local: {localEligible} |

### 4.5 FAQ 模板（4 条）

| 键 | 中文 | English |
|---|---|---|
| `pair.faq.loss.q` | {fromNameZh} 转 {toNameZh} 会丢格式吗？ | What gets lost converting {fromName} to {toName}? |
| `pair.faq.loss.a` | {fidelityNote} 我们能保住文字、标题层级、图片与目录；固定版式、复杂表格、嵌入字体会被重排或替换。转换报告会逐项列出。 | {fidelityNote} Text, heading structure, images and the TOC survive; fixed layouts, complex tables and embedded fonts are reflowed or replaced. The report lists each change. |
| `pair.faq.size.q` | 文件多大可以转？ | How large can the file be? |
| `pair.faq.size.a` | 单文件 ≤ 200 MB；EPUB 解压资源 ≤ 1 GB。浏览器本地转换建议 ≤ 20 MB。 | Up to 200 MB per file and 1 GB of unpacked EPUB assets. Browser-local conversion is happiest under 20 MB. |
| `pair.faq.batch.q` | 可以批量转换吗？ | Can I convert several files at once? |
| `pair.faq.batch.a` | 可以。多选后进入队列，逐条显示进度，失败项可单独重试，最后可打包成 ZIP 下载。 | Yes. Select multiple files, watch each item, retry failures individually, then download everything as one ZIP. |
| `pair.faq.fail.q` | 转换失败怎么办？ | What happens if it fails? |
| `pair.faq.fail.a` | 你会看到错误码、原因和下一步建议；失败时不会生成坏文件。常见原因是文件损坏、缺引擎、DRM 或超出大小。 | You'll get an error code, the cause and a next step — never a broken file. Common causes: damaged input, missing engine, DRM, or size limits. |

### 4.6 已填示例：TXT → EPUB（本地）

**H1**：TXT 转 EPUB
**副标题**：把纯文本变成一本有章节、有目录、排版正确的 Kindle 书 —— 全程在浏览器里完成，文件不上传。

**引言**：
> TXT 是最不容易损坏的格式，也是最难读的。我们识别章节（「第X章」「Chapter N」、空行分节）、处理编码（UTF-8 / GBK / GB18030）、按 Kindle 预设排版，再写成一个合法的 EPUB 3 文件。
>
> 整个过程在 Web Worker 里跑：不上传、不排队、断网也能用。20 MB 以内的中文小说通常在几秒内完成。

**三步**：选择 TXT → 选设备与排版（默认 2em 缩进、1.7 行高）→ 下载 EPUB，或直接放进 Kindle。

**能力**：章节识别 · 目录 nav + NCX · 中文标点与缩进 · 封面可选 · 元数据可改 · 单文件 ≤ 200 MB（本地建议 ≤ 20 MB）

**FAQ 补充**：
- 我的 TXT 是 GBK 编码，会乱码吗？→ 会检测并转成 UTF-8；如果检测不确定，会提示你确认编码。
- 没有章节标记的 TXT 怎么办？→ 按空行与长度自动分节，也可以在转换后手动调整（后续版本）。

---

## 5. 绿色页 `/green`

### 5.1 Hero

| 键 | 中文 | English |
|---|---|---|
| `greenPage.eyebrow` | 绿色，是可验证的 | Green, verifiably |
| `greenPage.title` | 更少上传，更多可验证。 | Less upload. More proof. |
| `greenPage.lead` | 我们不说「环保」；我们说清楚三件事：传了多少、留了多久、发了几个第三方请求。 | We don't say "eco". We say three things plainly: how much travels, how long it's kept, how many third-party requests the page makes. |
| `greenPage.cta` | 试一次本地转换 | Try a local conversion |

### 5.2 三个支柱

**零上传** `greenPage.zero.title`
> TXT / Markdown / HTML → EPUB 完全在浏览器里完成。服务器只在你需要 MOBI / AZW3 / PDF 等输出时参与，而且只在你按下转换之后。
>
> 怎么验证：打开 DevTools → Network，转换一个 TXT；上传请求数为 0。

**零留存** `greenPage.zeroRetention.title`
> 临时文件写在系统临时目录，任务结束或下载后最多 10 分钟自动删除。没有数据库，没有备份，没有「为了改进服务」的副本。
>
> 怎么验证：`DELETE /api/jobs/:id` 立即删除；临时目录里只有当前任务。

**无追踪** `greenPage.noTracking.title`
> 没有分析脚本、没有广告像素、没有第三方字体与 CDN。页面请求数就是你自己服务器的那几个。
>
> 怎么验证：Network 面板过滤第三方域名，结果为空。

**自托管** `greenPage.selfHost.title`
> `docker compose up -d`，或 `npx next start`。断网也能用，因为本地转换根本不依赖网络。
>
> 怎么验证：拔掉网线，转一个 TXT。

### 5.3 我们不做的事（诚实边界）

> - 不编造精确碳排数字。少一次上传、少一台常开服务器的收益取决于你的电网与设备，我们无法替你算。
> - 不买「碳中和」标签，不把「绿色」当形容词堆在标题里。
> - 不说「零能耗」：任何计算都要用电。我们说的是「更少」。
> - 不自称「完全离线」——只有本地转换路径是离线的，服务端转换需要服务器。

### 5.4 自托管

| 键 | 中文 | English |
|---|---|---|
| `greenPage.selfhost.title` | 三条命令 | Three commands |
| `greenPage.selfhost.docker` | 用 Docker：`docker compose up -d`，打开 `http://localhost:3100`。 | With Docker: `docker compose up -d`, then open `http://localhost:3100`. |
| `greenPage.selfhost.node` | 不用 Docker：`npx next start`。 | Without Docker: `npx next start`. |
| `greenPage.selfhost.engines` | 可选引擎：Calibre、Pandoc、Tesseract。没装也能跑内置路径；需要的格式对会明确提示。 | Optional engines: Calibre, Pandoc, Tesseract. Built-in paths work without them; pairs that need one say so. |
| `greenPage.selfhost.readme` | 看部署说明 | Read the deployment guide |

### 5.5 绿色 FAQ（3 条）

| 键 | 中文问答 | English Q&A |
|---|---|---|
| `greenPage.faq.upload` | **转换到底上传了什么？** 只有需要服务端的格式才上传，且只在任务期间存在。纯文本格式不上传。 | **What actually gets uploaded?** Only formats that need the server — and only for the life of the job. Text formats are never uploaded. |
| `greenPage.faq.carbon` | **能算出一本书省了多少碳吗？** 不能可靠地算。传输字节和省下的服务器时间可以测，碳排取决于电网，我们不给假数字。 | **Can you estimate carbon saved per book?** Not reliably. Bytes and server time are measurable; carbon depends on the grid. We won't invent a number. |
| `greenPage.faq.ads` | **靠什么活着？** 开源项目，没有广告、没有付费墙、没有数据生意。你愿意的话，可以自己托管或帮忙改代码。 | **How is this funded?** It's an open-source project — no ads, no paywall, no data business. Self-host it or send a patch. |

---

## 6. API 文档页 `/docs/api`

### 6.1 页面头

| 键 | 中文 | English |
|---|---|---|
| `api.title` | 开放接口 | API |
| `api.lead` | 无鉴权、零留存的转换接口。要么用我们的，要么 `docker compose up` 自己跑一套。 | A no-auth, zero-retention conversion API. Use ours, or run your own with `docker compose up`. |
| `api.base` | 基础地址 | Base URL |
| `api.auth` | 鉴权：无。自托管请自行在反向代理限流。 | Auth: none. When self-hosting, add rate limiting at your proxy. |

### 6.2 端点表

| 键 | 方法 | 路径 | 中文说明 | English |
|---|---|---|---|---|
| `api.convert` | POST | `/api/convert` | 提交转换。multipart：`file`、`target`、`options`（JSON 字符串）→ `202 { jobId }` | Start a conversion. multipart: `file`, `target`, `options` (JSON string) → `202 { jobId }` |
| `api.job` | GET | `/api/jobs/:id` | 任务状态与进度（`queued` / `running` / `done` / `error`） | Job status and progress |
| `api.download` | GET | `/api/jobs/:id/download` | 下载结果；带 `Content-Disposition` | Download the result with `Content-Disposition` |
| `api.delete` | DELETE | `/api/jobs/:id` | 立即删除文件与记录 | Delete the file and record immediately |
| `api.formats` | GET | `/api/formats` | 格式、设备、合法格式对与引擎状态 | Formats, devices, supported pairs, engine status |
| `api.health` | GET | `/api/health` | 健康检查：`ok`、`uptime`、`engines`、`version` | Health: `ok`, `uptime`, `engines`, `version` |

### 6.3 示例

```bash
# 提交
curl -F file=@novel.txt -F 'target=epub' -F 'options={"device":"paperwhite"}' \
  http://localhost:3100/api/convert
# → 202 {"jobId":"..."}

# 查询
curl http://localhost:3100/api/jobs/<jobId>
# → {"id":"...","status":"done","progress":100,"result":{...}}

# 下载
curl -OJ http://localhost:3100/api/jobs/<jobId>/download

# 立即删除
curl -X DELETE http://localhost:3100/api/jobs/<jobId>
```

### 6.4 限制与错误

| 键 | 中文 | English |
|---|---|---|
| `api.limits` | 单文件 ≤ 200 MB；解压资源 ≤ 1 GB；超过返回 413。 | ≤ 200 MB per file; ≤ 1 GB unpacked; otherwise 413. |
| `api.unsupported` | 不支持的组合返回 415，并带 `{error:{code,hint}}`。 | Unsupported pairs return 415 with `{error:{code,hint}}`. |
| `api.retention` | 结果在下载后 TTL 内仍可取；10 分钟后自动清理。 | Results remain available within the TTL; cleaned up after 10 minutes. |
| `api.errors` | 错误统一为 `{ error: { code, message, hint } }`；`code` 见工作台错误表。 | Errors are always `{ error: { code, message, hint } }`; codes match the workbench table. |
| `api.selfhost` | 自托管：`docker compose up -d`，接口行为一致。 | Self-hosting: `docker compose up -d`; same behaviour. |

### 6.5 代码示例标签

| 键 | 中文 | English |
|---|---|---|
| `api.copy` | 复制 | Copy |
| `api.copied` | 已复制 | Copied |
| `api.try` | 在浏览器里试 | Try in browser |
| `api.rate` | 无内置限流；公开部署请自行加一层。 | No built-in rate limiting; put a layer in front of public deployments. |

---

## 7. 404 / 500 / 离线

### 7.1 404

| 键 | 中文 | English |
|---|---|---|
| `err404.eyebrow` | 404 | 404 |
| `err404.title` | 这一页没有铸出来。 | This page never made it to print. |
| `err404.body` | 链接可能旧了，或者这个格式对并不存在。下面两条路都能走通。 | The link may be stale, or that format pair doesn't exist. Both of these work. |
| `err404.home` | 回到首页 | Back home |
| `err404.convert` | 打开转换工作台 | Open the workbench |
| `err404.formats` | 看格式矩阵 | Browse the format matrix |

### 7.2 500

| 键 | 中文 | English |
|---|---|---|
| `err500.eyebrow` | 500 | 500 |
| `err500.title` | 印刷机卡住了。 | The press jammed. |
| `err500.body` | 这不是你的问题。刷新一次；如果还不行，稍后再来。错误详情不会包含你的文件名。 | This isn't on you. Reload once; if it persists, come back later. Error details never include your filename. |
| `err500.reload` | 刷新 | Reload |
| `err500.status` | 查看引擎状态 | Check engine status |

### 7.3 离线（PWA / 断网）

| 键 | 中文 | English |
|---|---|---|
| `offline.title` | 断网了，但本地转换还能用。 | You're offline — local conversion still works. |
| `offline.body` | TXT / Markdown / HTML 转 EPUB 不依赖网络。需要服务器的格式会等你恢复网络。 | TXT / Markdown / HTML → EPUB doesn't need the network. Formats that need the server will wait until you're back. |
| `offline.retry` | 重新连接 | Reconnect |

---

## 8. 通用 UI 微文案

### 8.1 动作 / 状态

| 键 | 中文 | English |
|---|---|---|
| `common.continue` | 继续 | Continue |
| `common.back` | 返回 | Back |
| `common.close` | 关闭 | Close |
| `common.cancel` | 取消 | Cancel |
| `common.save` | 保存 | Save |
| `common.copy` | 复制 | Copy |
| `common.copied` | 已复制 | Copied |
| `common.retry` | 重试 | Retry |
| `common.remove` | 移除 | Remove |
| `common.learnMore` | 了解更多 | Learn more |
| `common.viewAll` | 查看全部 | View all |
| `common.loading` | 加载中… | Loading… |
| `common.optional` | 可选 | Optional |
| `common.required` | 必填 | Required |
| `common.recommended` | 推荐 | Recommended |
| `common.new` | 新 | New |
| `common.beta` | 测试中 | Beta |
| `common.comingSoon` | 还没做 | Not built yet |

### 8.2 表单校验

| 键 | 中文 | English |
|---|---|---|
| `form.required` | 这个是必填的。 | This field is required. |
| `form.invalid.email` | 邮箱格式看起来不对。 | That email doesn't look right. |
| `form.invalid.number` | 请输入 {min}–{max} 之间的数字。 | Enter a number between {min} and {max}. |
| `form.invalid.url` | 请以 http:// 或 https:// 开头。 | Start with http:// or https://. |
| `form.tooLong` | 最多 {max} 个字符。 | {max} characters max. |
| `form.saved` | 已保存。 | Saved. |

### 8.3 语言与主题

| 键 | 中文 | English |
|---|---|---|
| `lang.switch` | English | 中文 |
| `lang.current` | 当前语言：中文 | Current language: English |
| `theme.note` | 本产品只有深色一种主题：它更像一间深夜书房。 | There's one theme only — a late-night study, not a toggle. |

### 8.4 版权与致谢

| 键 | 中文 | English |
|---|---|---|
| `legal.privacy` | 隐私说明 | Privacy |
| `legal.terms` | 使用条款 | Terms |
| `legal.license` | 开源许可 | License |
| `legal.trademark` | Kindle 是 Amazon.com, Inc. 的商标。本项目与 Amazon 无关联。 | Kindle is a trademark of Amazon.com, Inc. This project is not affiliated with Amazon. |
| `legal.credits` | 感谢 Calibre、Pandoc、Tesseract 与所有上游开源项目。 | Thanks to Calibre, Pandoc, Tesseract and every upstream project. |

---

## 9. 语气与禁区

### 9.1 三条写作原则

1. **具体 > 形容词**。写「首行缩进 2em、标点挤压」，不写「极致排版」。
2. **承认边界**。对方更强的地方直接写出来；我们做不到的，给下一步。
3. **不制造焦虑**。不用「你的文件正在被偷走」这类恐吓式文案；把可验证的事实摆出来。

### 9.2 中文语气

- 短句为主，一句话一个意思；标题可以断得更狠。
- 允许一点文气（「铸书」「纸墨」「深夜书房」），但正文里不要堆词。
- 不用感叹号，不用「！」，不用「哦」「呀」这类卖萌语气。
- 数字用阿拉伯数字；单位与英文之间留半角空格（`200 MB`、`10 分钟`）。
- 中英混排时英文两侧留空格；专有名词保持原样（Kindle、EPUB、Calibre）。

### 9.3 English voice

- Plain, concrete, slightly literary in headlines only.
- No exclamation marks, no "revolutionary", "seamless", "effortless", "unleash".
- Prefer "we don't" over "we can't" when it's a choice; prefer "you'll get" over "you will receive".
- Sentence case for headings; labels in sentence case too.
- Use "ebook" (one word), "email", "self-hosted" (hyphenated adjective).

### 9.4 禁用词（写之前搜一遍）

| 禁用 | 为什么 | 改成 |
|---|---|---|
| 支持任何格式 / any format | 未验证，且不真实 | 15 类输入、7 类输出 |
| 100% 无损 / lossless | 多数转换会重排 | 「保住文字、标题、图片与目录；固定版式会重排」 |
| 最快 / 最强 / 完美 | 无法验证 | 给出具体行为（本地、10 分钟清理） |
| 零风险 / 绝对安全 | 绝对化 | 说明威胁模型与清理机制 |
| 永久免费 | 未来承诺 | 「开源、无广告、可自托管」 |
| 环保 / 碳中和 | 无数据支撑 | 「更少上传、更少常开服务器」 |
| 无限制 | 与 200 MB 上限矛盾 | 写明限额 |
| 秒转 | 依赖文件与引擎 | 「通常几秒」或省略时间 |

### 9.5 需要随状态变化的文案

这些句子不能写死，必须读运行时状态：

- 「OCR 可用」「漫画模式可用」→ 读 `engines.tesseract` / 能力矩阵。
- 「MOBI 输出」→ 读 `pairs`，Calibre 缺失时显示 `ENGINE_MISSING`。
- 「本地转换」徽标 → 只在 `local: true` 且前端已启用 Worker 时显示。
- 「零上传」→ 只对 TXT / MD / HTML → EPUB 声称；其他格式写「临时上传」。

### 9.6 占位符约定

- 变量用单花括号：`{fromName}`、`{count}`、`{percent}`、`{seconds}`。
- 复数：中文不区分；英文给两套 key（`*.one` / `*.other`），如 `{count} file` / `{count} files`。
- 文件名一律用 `<file>` 代替出现在日志/错误里；UI 上可以显示，但要转义。
- 日期：`YYYY-MM-DD`（中英一致），时间用本地时区并带时区缩写。

---

## 10. 交付检查清单（给前端 / QA）

- [ ] 每个页面在中英两种语言下无截断、无溢出（390 / 768 / 1440）。
- [ ] Hero、CTA、错误、空状态、成功、ZIP、进度文案全部来自本文件，没有硬编码中文。
- [ ] 所有数字与第 0 节一致；没有出现禁用词。
- [ ] 错误码 6 类都有「原因 + 下一步」。
- [ ] 本地徽标只出现在真实本地路径上；断网演示可用。
- [ ] `aria-live` 覆盖进度与结果；错误用 `role="alert"`。
- [ ] 404 / 500 / 离线页可直接访问。
