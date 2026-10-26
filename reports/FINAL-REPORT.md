# KindleForge · 最终验收报告（FINAL REPORT）

| | |
|---|---|
| 报告人 | `qa`（独立审核，不参与实现） |
| 验收对象 | `/Users/yiwei/Desktop/daily/kindle` · 生产构建 `npx next start -p 3100`（`KF_RATE_LIMIT_PER_HOUR=200` 由 Lead 为验收临时放开） |
| 时间 | 2026-10-27 00:16 – 00:45 |
| 环境 | macOS arm64 · Node 24.19 · Calibre 8.16.2 · Tesseract 5.5.3（chi_sim/eng/osd）· poppler · Chrome（puppeteer-core）· Pandoc **未安装**（符合预期：可选增强） |
| 结论 | **可以交付（附 4 条发布前动作，见 §7）** |
| 详细发现 | 见 [docs/AUDIT.md](AUDIT.md)（P0/P1/P2 分级 + 复现命令 + 文件行号） |
| 许可证 | 见 [docs/LICENSES.md](LICENSES.md) |

---

## 1. BRIEF「质量门槛」逐条判定

> 判定口径：命令输出说话，不看代码注释。下表每行都可复跑。

| # | 门槛（docs/BRIEF.md:55-61） | 命令 | 结果 | 判定 |
|---|---|---|---|---|
| 1 | `npx tsc --noEmit` 0 错误；`npx vitest run` 全绿 | `npx tsc --noEmit`<br>`npx vitest run` | tsc exit 0（无输出）<br>`Test Files 18 passed (18) · Tests 196 passed (196)`，33.9s | **PASS** |
| 2 | `curl -s localhost:3100/api/health` 返回真实引擎状态 | `curl -s localhost:3100/api/health` | `{"ok":true,"uptime":..,"version":"0.1.0","engines":{"calibre":true,"pandoc":false,"tesseract":true},"engineDetails":[{"id":"calibre","available":true,"version":"ebook-convert (calibre 8.16.2)","bin":"/Applications/calibre.app/…"},{"id":"tesseract","available":true,"version":"tesseract 5.5.3"},{"id":"pandoc","available":false}]}` —— 版本号是**探测**出来的，不是写死 | **PASS** |
| 3 | 真实样本各转一次，产物可二次校验；EPUB 必须 mimetype 首条且未压缩、有 OPF/nav | `npx vitest run tests/e2e/e2e.convert.test.ts`；`npx tsx scripts/smoke.ts`；另见 §2 明细 | 11/11 通过；`SMOKE PASS — TXT → EPUB → download → cleanup verified`；builtin 产物均含 mimetype 首条 STORED + OPF + nav + **NCX**（calibre 产物无 NCX，见 §6-8） | **PASS** |
| 4 | 首屏 LCP < 2.5s、无第三方请求；390px 可用；键盘可完成上传→转换→下载；对比度 ≥ 4.5:1 | puppeteer 实测（生产构建） | LCP **80ms**（`/`）/ **56ms**（`/convert`）；请求数 19 / 23，**host 只有 127.0.0.1:3100**；390px `scrollWidth-clientWidth = 0`；键盘 11 次 Tab 到「开始转换」→ Enter → 「完成」→ Tab 到「下载」；4 个页面 0 处对比度不达标 | **PASS** |
| 5 | 所有 UI 文案中英双语、无 mock、无 TODO 占位 | `grep -rn "TODO\|FIXME\|Lorem\|mock data\|dummy" app components lib`；i18n 键数对比；EN 页 CJK 残留检查 | 占位符 **0 处**；`zh.ts` 与 `en.ts` 键位 465 : 465；`/en*` 无中文残留、zh 页无长英文句 | **PASS** |

---

## 2. BRIEF「P0 范围」逐条判定

| P0 项 | 证据 | 判定 |
|---|---|---|
| 1. 落地页（中/英）：真实拖拽上传、格式矩阵、RunConvert 三维对比、本地演示、绿色/隐私、FAQ | `/` 与 `/en` 200；`audit.mjs` 21/21 clean；首页含矩阵/对比/本地演示/FAQ 区块（渲染文本已核对）；对比表对竞品措辞标注「据其公开页面」 | **PASS** |
| 2. `/convert`：多文件、目标格式、Kindle 预设、进度、取消、下载、ZIP、错误带下一步 | 浏览器实测：上传→本地转换→「完成 · 本地处理 · 未上传」→「下载」+「打包下载 ZIP」；错误路径显示 `CODE + 中英 hint`（如 `NETWORK`）；`role=alert`、`aria-live` 存在 | **PASS** |
| 3. 引擎：TXT/MD/HTML→EPUB 本地；DOCX/FB2/CBZ/CBR/图片→EPUB；EPUB→TXT/HTML；calibre 桥 | e2e 11 项全绿 + 手工抽检 **MD / HTML / FB2 / RTF / ODT→EPUB 全部 done** 且产物为合法 EPUB3；本地模式浏览器 0 上传 | **PASS**（附注：calibre 路径产物无 NCX，见 §6-8） |
| 4. API：`/api/convert`、`/api/jobs/:id`、`/download`、`/api/formats`、`/api/health`；安全限制 | 5 个端点全部可用；e2e.security 15/15（穿越/大小/chunked/zip bomb/DRM/坏文件/限流身份） | **PASS** |
| 5. 格式对落地页（静态生成热门 + 全部合法对） | `sitemap.xml` 156 条 URL、148 条格式对；抽查 `/convert/txt-to-epub`、`/en/convert/epub-to-azw3` 200 | **PASS** |
| 6. 测试：引擎单测、API 集成、端到端脚本 `scripts/smoke.ts` | `vitest` 196 通过；`npx tsx scripts/smoke.ts` 由 backend 覆盖；另有 `tests/e2e` 30 用例（本次新增） | **PASS** |

---

## 3. 三个卖点的claim核对（能否当场演示）

| 主张 | 核对方式 | 结论 |
|---|---|---|
| **更好**：Kindle 排版 / 中文 / 目录 / 失败诚实 | 中文 TXT→EPUB 解包：`lang=zh-CN`、`text-indent:2em` 类样式在 `book.css`、nav 3 章、mimetype 首条 STORED；失败样本（坏 EPUB / DRM / 超限 / 无文字层）都给错误码 + 中英 hint + 下一步 | 可演示 |
| **更全**：15 类输入 / 7 类输出 / 批量 / OCR / 漫画 | `formats.ts` 的 `INPUT_FORMATS.length=15`、`OUTPUT_FORMATS.length=7`；CBZ/CBR 整页 fixed-layout；OCR 中英可用；`/api/formats` 与首页数字一致 | 可演示（**注意**：OCR 的 UI 与 API 语言参数刚刚修好，见 §6 P0-1） |
| **更绿**：TXT/MD/HTML→EPUB 0 上传、零留存、无追踪、可自托管 | **浏览器实测**：本地转换全程 `/api/convert` 请求数 **0**、`/api/jobs` **0**、跨域 **0**；全站 0 第三方请求；临时目录 0700/0600、转换后 input 即删、DELETE 立即清盘；`docker compose up` 与 `npx next start` 均在 README | 可演示（**注意**：worker 加载失败时会**自动回退上传**，见 §6 P2-1） |

---

## 4. 测试与工具输出（原始摘要）

```text
$ npx tsc --noEmit
（无输出，exit 0）

$ npx vitest run
 Test Files  18 passed (18)
      Tests  196 passed (196)
   Duration  33.91s

$ npx vitest run tests/e2e
 ✓ tests/e2e/e2e.security.test.ts (15 tests) 1257ms
 ✓ tests/e2e/e2e.privacy.test.ts  (4 tests)  9558ms
 ✓ tests/e2e/e2e.convert.test.ts (11 tests) 32240ms
 Test Files  3 passed (3) · Tests  30 passed (30)

$ node tools/audit.mjs http://127.0.0.1:3100 /tmp/kf-qa/audit-prod
21/21 page/viewport combos clean   （截图：/tmp/kf-qa/audit-prod）

$ npx next build   （Lead 执行，日志 /tmp/kf-build.log）
 ✓ Compiled successfully in 3.1s
 ✓ Generating static pages (161/161)
 + First Load JS shared by all  102 kB
 0 warnings / 0 errors

生产性能（Chrome，localhost）：
  /        LCP 80ms   FCP 80ms   TTFB 4ms   transfer 181KB  19 requests  hosts=[127.0.0.1:3100]
  /convert LCP 56ms   FCP 44ms   TTFB 2ms   transfer 120KB  23 requests  hosts=[127.0.0.1:3100]
```

**真实产物二次校验（V2 复核）**

| 产物 | `file` | 额外校验 |
|---|---|---|
| `pride.mobi` | Mobipocket E-book "Pride and Prejudice", version 6, codepage 65001 | offset 60 = `BOOKMOBI`；`ebook-convert pride.mobi rt.epub` exit 0 |
| `pride.azw3` | Mobipocket E-book, version 8 | offset 60 = `BOOKMOBI`；回读 exit 0 |
| `pride.pdf` | PDF 1.4, 653 pages | `pdftotext` 可抽出正文；回读 exit 0 |
| `pride.docx` | Microsoft OOXML | `unzip -l` 结构正常；回读 exit 0 |
| 中文 `zh.epub` | — | mimetype 首条 STORED / container.xml / OPF / nav.xhtml / NCX；3 章目录；汉字与全角标点计数与源一致 |
| CBZ/CBR `*.epub` | — | `rendition:layout` + N 个 `itemref` = N 张图；viewport 800×1200 |

---

## 5. 审核中发现并已闭环的问题

| 级别 | 问题 | 状态 | 复验证据 |
|---|---|---|---|
| **P0** | OCR 语言参数三方不一致（UI 送 `chi_sim` / API 正则拒绝 `_` / 引擎把 ISO 码当 tessdata 名）→ 选「简体中文」OCR 必失败 | **已修，已复验** | `ocrLanguage:"zh"` → done/engine=ocr/72 字符，EPUB 内「数字化的第一页」；`zh-TW`/`kor` 回退并 warning |
| **P1** | `X-Forwarded-For` 可伪造 → 换 IP 头绕过限流（26 次请求 0 个 429） | **已修，已复验** | rotating XFF 与无头请求都 first deny #21，`clientIp(XFF)= 'direct'` |
| **P1** | 无 `Content-Length` 的 chunked 上传先吃满内存（实测 +644MB RSS）再 413 | **已修**（411 前置拒绝） | 代码路径复验；`tests/e2e` 有 411 用例 |
| **P1** | ZIP 安全预检只信中央目录（伪造 uncompressedSize 可绕过） | **已修，已复验** | 声明 1000B / 实际 5MB 的 `.cbz` → `TOO_LARGE`「文件实际大小与声明不符」；合法 CBZ 回归正常 |
| **P2** | 失败时 `job.warnings` 与 `error.message/hint` 重复；OCR stderr 丢失 | **已修，已复验** | 回退 warning 带「可用语言：chi_sim, eng, osd」，不再重复 message/hint |
| **P2** | 扫描 PDF→DOCX 返回 done 但 0 字符文本、无 warning | **已修，已复验** | 新增「未检测到文字层，已按图片处理；建议开启 OCR」；有文字层的 PDF→DOCX 不误报 |
| **P1** | 修复 XFF 时引入回归：直连被归 20/h，与 README「本机 200」矛盾 | **已修**（源码 `ratelimit.ts:93` 把 `'direct'` 归 local limits）；**运行中的旧构建靠 `KF_RATE_LIMIT_PER_HOUR=200` 兜底** | `npx tsx /tmp/kf-rl2.ts` 修复前 `allowed=20`；新源码复核 line 93 |
| **P2** | calibre 失败回显服务器绝对路径 | **已修**（源码 `redactEngineOutput`） | 源码复核；旧构建未含该修复 |
| **P2** | `/convert` 的 SSR HTML 无 `<h1>` | **已修**（源码 `components/convert/convert-page.tsx:28` 服务端渲染 h1） | 旧构建 `curl …/convert \| grep -c '<h1'` 仍为 0，随下一次 build 生效 |
| **P2** | 中文下载名 ASCII 回退是 `____.mobi` | **已修**（源码 `storage.ts:76` 可读 ASCII 回退） | 源码复核 |
| **P2** | `/api/jobs/<不规范路径>` 返回 Next HTML 404 | **已修**（新增 `app/api/[...path]/route.ts`） | 源码复核 |
| **P2** | 本地 worker 失败后**自动上传**，文案「本地转换失败（本地转换失败）」重复 | **已派单（frontend）** | 我在 Lead 重启 3100 的窗口期实测到该行为（卡片文案原文见 AUDIT P2-7） |

> 说明：最后 6 条 P2 的源码修复**不在本次验收的生产构建里**（Lead 构建在前、派单在后）。它们不影响已判定通过的门槛，但应随下一次 build 一起复核。

---

## 6. 剩余风险（诚实清单）

1. **RAR 炸弹未测**：`assertArchiveSafe` 只检查 ZIP（`lib/server/archive.ts:137` 起），CBR 走 node-unrar-js，没有条目数/解压比上限的回归测试。真实 RAR 样本小，风险低，但恶意 CBR 的解压上限依赖 WASM 层行为。建议 engine 补一条（1 小时工作量）。
2. **TTL 10 分钟只测了逻辑、没等真实 10 分钟**：`api.jobs.test.ts` 有短 TTL 的 sweep 单测；端到端验证了 DELETE 立即清盘与「转换后只剩 output」。生产 10 分钟自然过期未实测。
3. **限流默认值**：即使源码已把 `'direct'` 归 local（200/h），公网无代理部署仍是「所有访客共享 200/h」。真正对外服务必须 `KF_TRUST_PROXY=true` + 自控代理；README 应写清。这是设计取舍，不是缺陷，但要在文档里说明白。
4. **LGPL 分发**：`@img/sharp-libvips-*` 是 LGPL-3，随 `next build` standalone / Docker 镜像分发；`kindleforge:full` 镜像还装了 Calibre(GPL-3)/Pandoc(GPL-2+)/Poppler(GPL)/Noto CJK(OFL)。发布镜像前需要 `THIRD-PARTY-NOTICES`（详见 LICENSES §3）。
5. **本地模式回退上传**：worker chunk 加载失败（离线首访、CDN 故障）→ 自动改用服务器上传。虽然 UI 有提示，但与「断网也能转」的演示叙事相冲突，建议改成显式确认或明确「离线仅缓存过后可用」。
6. **DOCX 富文本覆盖度**：本次 fixture 里没有 bold/italic run，`strong/em` 映射没被 e2e 覆盖（列表/标题/图片已覆盖）。建议 engine 补一个带粗斜体的 fixture。
7. **`/api/jobs` 之外的未知路径**：新增 catch-all 后需确认 `/api` 下所有 404 都走 JSON（源码已有，但旧构建未验）。
8. **calibre 路径的 EPUB 没有 NCX**：`pdf/odt/rtf→epub` 的产物是合法 EPUB3（有 nav），但缺 `toc.ncx`，与 CONTRACT §3「NCX 兼容」不符；且 `odt→epub` 的 nav 只有一条 `Start`（目录丢失）。builtin 路径（TXT/DOCX/CBZ/CBR）都有 NCX，e2e 已断言。建议 engine 在 calibre 之后用内置 NCX writer 补一份，或传 `--level1-toc`。

---

## 7. 是否可以交付

**可以交付**，前提是发布前完成这 4 条（都是 30 分钟级）：

1. **重新 `next build` 并重启**，把已修但未进构建的 6 条 P2（直连额度/路径脱敏/下载文件名/JSON 404/SSR h1/回退文案）带上，然后跑一次 `npx vitest run` + `npx vitest run tests/e2e` + `node tools/audit.mjs` 做冒烟。
2. **README 补两处**：可选引擎表加 **Poppler**（OCR 的 PDF 渲染依赖 `pdftoppm`）；写明「无限流代理时的额度语义」（`KF_TRUST_PROXY` / `KF_RATE_LIMIT_PER_HOUR`）。
3. **发布 Docker 镜像前**加 `THIRD-PARTY-NOTICES`（LGPL libvips + full 镜像里的 GPL 组件 + Noto CJK OFL）。
4. **前端修回退文案**（「本地转换失败（本地转换失败）」），并决定 worker 失败时是「自动上传」还是「提示用户选择」。

**不建议**在未重新构建的情况下直接交付：本次验收的生产构建缺少上述 6 条 P2 修复，而它们里有 2 条是隐私/可用性相关（下载文件名、直连额度）。

---

## 8. 附：本次新增的可重复测试

| 文件 | 覆盖 | 用例数 |
|---|---|---|
| `tests/e2e/e2e.convert.test.ts` | 真实转换 + EPUB 结构断言 + MOBI/AZW3 魔数 + OCR + DELETE 清盘 | 11 |
| `tests/e2e/e2e.security.test.ts` | 路径穿越 / 上传限制 / chunked / zip bomb / DRM / 坏文件 / 限流身份 | 15 |
| `tests/e2e/e2e.privacy.test.ts` | 0 第三方请求 / 本地模式 0 上传 / 键盘 / 可访问性基线（真 Chrome） | 4 |

运行：`npx vitest run tests/e2e`（服务未起或本机无 Chrome 时整组自动 skip，不会假绿）。
