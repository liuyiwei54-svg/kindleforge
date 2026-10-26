# KindleForge · 独立审核报告（AUDIT）

| | |
|---|---|
| 审核人 | `qa`（不参与实现；只读代码 + 真实转换 + 浏览器取证） |
| 审核对象 | `/Users/yiwei/Desktop/daily/kindle`；`http://127.0.0.1:3100`（前半程 dev server，结尾为 `next build` + `next start` 生产构建） |
| 环境 | macOS arm64 · Node 24.19 · Calibre 8.16.2 · Tesseract 5.5.3（chi_sim/eng/osd）· poppler（pdftoppm）· Pandoc **未安装** · 无 git（比对靠读取当前文件） |
| 审核时间 | 2026-10-27 00:16 → 00:45（期间 engine/backend/frontend 并发修改，见「时序说明」） |
| 取证目录 | `/tmp/kf-qa/`（curl 输出、下载产物）、`/tmp/kf-qa/audit/`（截图）、`/tmp/kf-samples/`（样本） |
| 可重复测试 | `tests/e2e/*.test.ts`（`npx vitest run tests/e2e`） |

> **时序说明（重要）**：本次审核期间多个 owner 在并发改代码，过程中遇到两次服务端中间态（一次是 `lib/engine/readers/epub.ts:269` 语法错误导致 3100 全站 500；随后 Lead 执行 `rm -rf .next && next build` 并重启，3100 短暂下线）。因此：
> - 标 **✅ 已修复并复验** 的条目，都是我自己的命令在修复后重新跑过的；
> - 标 **✅ 源码已修** 的条目，是指当前源码已修、但**不在本次生产构建里**，随下一次 build 生效（见 §5-3）；
> - 文中文件:行号以审核时的内容为准，若后续重构导致偏移，以代码语义为准。

---

## 0. 结论摘要

| 级别 | 发现 | 状态 |
|---|---|---|
| **P0** | OCR 语言参数三处契约不一致：UI 送 `chi_sim` / API 正则只收 `[A-Za-z-]` / 引擎把 ISO 码直接当 tessdata 名 | ✅ 已修复并复验（engine + backend） |
| **P1** | 限流身份可伪造：`X-Forwarded-For` 被无条件信任 → 换 IP 头即绕过 | ✅ 已修复（默认忽略头）；⚠️ 引入回归，见 P1-2 |
| **P1** | `X-Forwarded-For` 修复后**本机额度从 200/h 掉到 20/h**，与 README/错误提示「本机 200」矛盾 | ✅ 源码已修（`ratelimit.ts:93` 把 `direct` 归 local）；运行中的旧构建需 `KF_RATE_LIMIT_PER_HOUR=200` 兜底 |
| **P1** | 无 `Content-Length` 的 chunked 上传把整个 body 读进内存后才判 413（实测 +644MB RSS） | ✅ 已改为 411 前置拒绝，**e2e 复验通过** |
| **P1** | ZIP 安全校验只信中央目录：伪造 `uncompressedSize` 可绕过预检 | ✅ 已修复（reader 层按实际解压字节计账）；建议 `archive.ts` 同步加固 |
| **P2** | 失败时 `job.warnings` 与 `error.message/hint` 完全重复；OCR 失败的 tesseract stderr 丢失 | ✅ 已修复并复验 |
| **P2** | 扫描 PDF→DOCX 返回 `done` 但 0 字符文本、无 warning | ✅ 已修复并复验（新增「未检测到文字层」warning） |
| **P2** | calibre 失败时把服务器绝对临时路径回显给客户端 | ✅ 源码已修（`redactEngineOutput`），随下次构建生效 |
| **P2** | `/convert` 的 SSR HTML 里没有 `<h1>` | ✅ 源码已修（`convert-page.tsx:28` 服务端渲染），随下次构建生效 |
| **P2** | 中文文件名下载时 `filename="____.mobi"`（ASCII 回退全是下划线） | ✅ 源码已修（`storage.ts:76` 可读回退），随下次构建生效 |
| **P2** | `/api/jobs/<非-UUID 且不匹配路由>` 返回 Next 的 HTML 404，不是统一 JSON 错误 | ✅ 源码已修（新增 `app/api/[...path]/route.ts`），随下次构建生效 |
| **P2** | 本地 worker 加载失败时**自动上传**，且文案「本地转换失败（本地转换失败）」自我重复 | 🔴 已派单 frontend |
| **P2** | calibre 路径（pdf/odt/rtf→epub）产物**没有 NCX**，ODT→EPUB 的 nav 只有 `Start` | 🔴 新增（engine） |

**审核通过项**（详见 §4）：路径穿越 / jobId 伪造 / 文件名穿越 / 大小限制 / zip bomb（条目数、压缩比）/ DRM 拒绝 / 坏文件诚实失败 / 临时目录权限 0700-0600 / DELETE 立即清盘 / 中文 GB18030 TXT→EPUB / DOCX→EPUB / CBZ·CBR→EPUB / 图片→EPUB / EPUB→MOBI·AZW3·PDF·TXT·DOCX / TXT→MOBI·AZW3 / OCR（zh / zh-TW / 未安装语言的回退）/ 首屏 0 第三方请求 / 本地模式 0 上传 / 对比度 ≥ 4.5 / 键盘可达 / SEO title·description·canonical / JSON-LD 合法 / sitemap 含 148 个格式对。

---

## 1. P0

### P0-1 OCR 语言参数：UI / API / 引擎三方契约不一致（已修复，已复验）

**现象（修复前）**
1. UI 的识别语言下拉送的是 tesseract 原生名（`chi_sim` / `chi_tra` / `eng` / `jpn` / `kor`），但 `lib/server/options.ts` 的正则是 `^[A-Za-z-]+$`（下划线不合法）→ 选「简体中文」必定 **400 INVALID_OPTIONS**。
2. `lib/engine/types.ts:111-113` 约定 `ocrLanguage` 是 “ISO 639-1”，但 `lib/engine/node/ocr.ts` 把它原样传给 `tesseract -l`。`zh` / `en` 都不是 tessdata 名（tessdata 里是 `chi_sim` / `eng`）→ 运行期 OCR 全灭。
3. 两种失败的错误提示都不指向真正原因（恒说「请确认语言包已安装（chi_sim）」）。

**复现（修复前，3100）**
```bash
# 1) UI 实际会发的值
curl -s -F file=@/tmp/kf-samples/scanned.pdf -F target=epub \
     -F 'options={"ocr":true,"ocrLanguage":"chi_sim"}' localhost:3100/api/convert
# -> 400 {"code":"INVALID_OPTIONS","message":"... must be an ISO 639-1 code"}
# 2) ISO 码：校验通过但引擎必失败
npx tsx -e "..."   # 见下方 tsx 探针
# -> ocrPdf lang= zh FAIL / lang= en FAIL / lang=undefined OK chars=73
```

**证据**
- `lib/server/options.ts:38-43`（旧正则 `^[A-Za-z-]+$`）
- `components/convert/options-panel.tsx:175-180`（`<option value="chi_sim">`）
- `lib/engine/node/ocr.ts:104-114`（旧的直接透传；新代码见下）
- tsx 探针输出：`ocrPdf lang= zh FAIL ... / lang= chi_sim OK chars=72`

**修复后的独立复验（我自己的命令，不是 owner 的自测）**
```bash
cd /tmp/kf-samples
for L in zh zh-TW kor auto; do
  curl -s -F file=@scanned.pdf -F target=epub \
    -F "options={\"ocr\":true,\"ocrLanguage\":\"$L\"}" localhost:3100/api/convert
done
```
| 请求 | 结果 |
|---|---|
| `ocrLanguage:"zh"` | `done` · `engine:"ocr"` · 72 字符 · **EPUB 内含「数字化的第一页 / 扫描件里的文字要能被认出来」** |
| `ocrLanguage:"zh-TW"` | `done` · warning「chi_tra 没有安装，已回退 chi_sim…可用语言：chi_sim, eng, osd」 |
| `ocrLanguage:"kor"` | `done` · warning「OCR 语言「kor」没有安装，已改用 chi_sim+eng」 |
| `{"ocr":true}`（自动） | `done` · 73 字符 · 中文识别正确 |
| `ocrLanguage:"eng"` | `done` · 84 字符（用英文包识别中文页，字符少但不再报错） |

**建议**：已完成。补充一条契约说明即可：`types.ts` 的注释应写成「ISO 639-1 / BCP-47 或 tessdata 名（chi_sim+eng），引擎负责映射」。
**Owner**：engine（映射）、backend（校验）、frontend（下拉值）—— 三方均已改。

---

## 2. P1

### P1-1 限流身份可伪造：`X-Forwarded-For` 无条件信任（已修复，已复验）

**现象（修复前）**：同一伪造 IP 的第 21 次请求返回 429，但**每次换一个 XFF 值就重新开一个桶**，26 次请求 26 个 202、0 个 429 —— 限流形同虚设。
**复现（修复前）**
```bash
for i in $(seq 1 26); do
  curl -s -o /dev/null -w '%{http_code} ' -H "X-Forwarded-For: 198.51.100.$((i+10))" \
    -F file=@/tmp/kf-samples/zh-utf8.txt -F target=epub localhost:3100/api/convert
done
# -> 202 x26（0 个 429）
```
**证据**：`lib/server/ratelimit.ts:52-63`（旧版直接取 XFF 首段）。

**修复后复验**
```bash
npx tsx /tmp/kf-rl2.ts
# rotating XFF: first deny at #21 429/RATE_LIMITED   allowed=20 denied=185
# no header  : first deny at #21 429/RATE_LIMITED   allowed=20 denied=185
# same XFF   : first deny at #21 429/RATE_LIMITED   allowed=20 denied=185
```
`clientIp(XFF=10.1.2.3) === 'direct'` —— 头被忽略，伪造无效。✅

### P1-2 回归：本机额度从 200/h 掉到 20/h（与文档矛盾）—— ✅ 源码已修

**现象**：修复后 `clientIp()` 对所有直连请求返回字面量 `'direct'`，而 `limitsFor('direct')` 不满足 `isLocalAddress`，于是走 `DEFAULT_LIMITS`（20/h）。实测：无 XFF 头也**第 21 次就被 429**。
**影响**：README:120 写「每 IP 20 次/小时（本机 200）」；429 的 hint 也写「本机 200 次」；自托管单用户实例（无反向代理）实际只有 20/h，批量上传（一次 5 个文件）也够呛，且提示文案在骗用户。
**复现**
```bash
npx tsx /tmp/kf-rl2.ts   # no header: allowed=20 denied=185
```
**证据**：`lib/server/ratelimit.ts:66-72` 返回 `'direct'`；`:105` `limitsFor`；`lib/server/config.ts` 的 `rateLimitPerHour=20` / `rateLimitLocalPerHour=200`。`lib/server/errors.ts:199-219` 的 hint 仍写「本机 200 次」。
**修复状态**：`lib/server/ratelimit.ts:93` 已改成 `if (ip === 'direct' || isLocalAddress(ip)) return localLimits;`（审核当时运行的是旧构建，靠 Lead 的 `KF_RATE_LIMIT_PER_HOUR=200` 兜底；随下次构建生效）。仍需同步 README 与 429 hint 文案。

**建议**：`KF_TRUST_PROXY=false`（无代理 = 单机自托管）时用 LOCAL_LIMITS + 在 README/绿色页写明「无代理部署为单桶 200/h；公网部署请置于你控制的代理之后并设 `KF_TRUST_PROXY=true`」；或新增 `KF_RATE_LIMIT_DIRECT` 显式配置。同时修正 hint 文案，不要写死「本机 200」。
**Owner**：backend（+ docs 由 Lead 收口）

### P1-3 无 `Content-Length` 的 chunked 上传：先吃满内存再判 413 —— ✅ 已修，e2e 复验

**现象（修复前）**：`app/api/convert/route.ts` 只在有 `Content-Length` 时预检；chunked 请求会把整个 body 缓冲进内存，解析完才检查 `uploaded.size`。
**实测（修复前）**
```bash
python3 /tmp/kf-chunked.py     # 230MB，Transfer-Encoding: chunked
# status: 413  (但先缓冲了整包)
# RSS before 1065MB -> peak 1709MB  (+644MB，0.7s)
```
并发槽位 8 时约 5GB，足以 OOM 一个自托管实例。
**证据（修复前）**：旧 `route.ts:80-83` 只用 content-length；旧 `:95` `request.formData()` 全量缓冲；旧 `:116` 才判大小。
**修复后**：`route.ts` 现在要求必须有 `Content-Length`，否则 411（`lib/server/errors.ts` 新增 `lengthRequired`）。代码已读确认；运行期复验被 Lead 的 `next build` 打断，见 §5。
**建议**：除 411 外，建议在 README/部署文档里给 nginx `client_max_body_size 210m;` 示例（双保险）。
**Owner**：backend

### P1-4 ZIP 安全预检只信中央目录（已修复，已复验）

**现象（修复前）**：`lib/server/archive.ts:84-85` 从中央目录读 `uncompressedSize`，`:222-230` 直接信它。把声明大小改成 1000B、实际解压 30MB 的 zip 可以过预检。
**复现（修复前）**
```bash
# 构造：central dir + local header 的 uncompressedSize 都改写为 1000
curl -s -F file=@/tmp/kf-samples/bomb-lying.zip -F target=epub localhost:3100/api/convert
# -> 202（未拦截；靠 reader 层「没有图片」才失败）
```
**修复后复验（关键是让条目真的被解压）**
```bash
# /tmp/kf-samples/lying-png.cbz：page-01.png 声明 1000B、实际 5MB
curl -s -F file=@/tmp/kf-samples/lying-png.cbz -F target=epub localhost:3100/api/convert
# -> 202 然后 job: error {"code":"TOO_LARGE",
#    "message":"压缩包内文件实际大小与声明不符（page-01.png）。",
#    "hint":{"zh":"这个文件可能被伪造过声明大小（ZIP 炸弹），已拒绝解压。"}}
# 合法 CBZ 回归：
curl -s -F file=@/tmp/kf-samples/comic.cbz -F target=epub localhost:3100/api/convert
# -> done · builtin ·「3 fixed-layout pages」· 18139B
```
**建议**：`archive.ts` 仍可加一条「声明/实际不一致就 422」的快速检查（现在依赖 reader 层）；这样恶意包在 202 之前就被拒，省一次排队。非必须。
**Owner**：engine（已修 `lib/engine/readers/zip-safety.ts`）

---

## 3. P2

### P2-1 失败时 warnings 与 error 重复；OCR stderr 丢失（已修复，已复验）

**现象（修复前）**：坏 EPUB 的 job：
```json
"warnings":["ZIP_CENTRAL_DIRECTORY_UNREADABLE",
 "ENGINE_FAILURE: EPUB 解析失败：文件不是有效的 ZIP 容器。\n文件可能不完整或不是 EPUB。…\nThe file may be truncated…"],
"error":{"code":"INVALID_FILE","message":"EPUB 解析失败：文件不是有效的 ZIP 容器。","hint":{…}}
```
message/hint 原样重复进 warnings；反过来 OCR 失败时 tesseract 的 stderr（「Error opening data file …/zh.traineddata」）**一条都没出现**，用户拿到的错误无法行动。
**证据（修复前）**：`app/api/convert/route.ts:182` 用了 `failureDetail`（含 message+hint），而 `lib/server/jobs.ts:172` 的 `engineDiagnostics` 正是为此准备的；`lib/engine/index.ts:399-417` 在 `fail()` 前没有把 warnings 写回 job。
**修复后复验**：新 OCR 失败路径（`ocrLanguage:"kor"`）warnings 为「OCR 语言「kor」没有安装，已改用 chi_sim+eng…可用语言：chi_sim, eng, osd」，不再重复 message/hint。✅

### P2-2 扫描 PDF→DOCX 返回 done、0 字符、无 warning（已修复，已复验）

**现象（修复前）**：`scanned.pdf`（纯图片，无文字层）→ docx 返回 `status:"done"`、`warnings:[]`，产物 DOCX 里 `w:text` 文本数为 **0**、只有一张整页 JPEG。
**复现**
```bash
resp=$(curl -s -F file=@/tmp/kf-samples/scanned.pdf -F target=docx localhost:3100/api/convert)
# 修复前：done / warnings []
# 修复后：done / warnings ["未检测到文字层，已按图片处理；建议开启 OCR（no text layer detected — treated as images; enable OCR）"]
# 对照（有文字层的 PDF）：pride.pdf -> docx：warnings []  ✅ 不误报
```
**证据（修复前）**：`lib/engine/index.ts` 的 calibre 分支没有文字层探测；`lib/engine/node/calibre.ts:225-235` 只在退出码非 0 时报错，而 calibre 对图片型 PDF 输出 docx 是「成功」。
**Owner**：engine（已修）

### P2-3 calibre 失败时把服务器绝对路径回显给客户端 —— ✅ 源码已修

**现象**：`--extra-css`/stderr 尾部被塞进 `ConversionError.hint`，`lib/engine/node/calibre.ts:226-234` 用的是未脱敏的 `tail`；路径形如 `/var/folders/…/T/kindleforge-calibre-xxxx/output.epub`，会经 `job.error.hint` 返回给任意调用者。
**复现**（服务器恢复后）
```bash
# 造一个能过魔数、但 calibre 打不开的 PDF
printf '%%PDF-1.4\n1 0 obj <<>> endobj\ntrailer <<>>\n%%%%EOF\n' > /tmp/broken.pdf
curl -s -F file=@/tmp/broken.pdf -F target=mobi localhost:3100/api/convert   # 轮询 job.error.hint
```
**证据**：`lib/engine/node/calibre.ts:226-234`（`tail` 直接进 message/hint）；对照 `:170-185` 的 `extractWarnings` 已经会把 tempDir 替换成 `<tmp>`，说明作者知道要脱敏，只是失败路径漏了。
**建议**：失败路径同样 `stderr.replace(dir, '<tmp>')`，并复用 `extractWarnings` 的过滤。
**Owner**：engine

### P2-4 `/convert` 的 SSR HTML 没有 `<h1>` —— ✅ 源码已修

**现象**：`curl -s localhost:3100/convert | grep -c '<h1'` → 0；浏览器执行 JS 后 DOM 里才有 `<h1>转换工作台</h1>`（puppeteer 实测 h1 count=1）。对 SEO 抓取（不执行 JS 的爬虫）和「首屏无 JS 也应可读」不利。
**复现**
```bash
curl -s localhost:3100/convert | grep -c '<h1'
curl -s localhost:3100/en/convert | grep -c '<h1'
# 都是 0；而 / /en /green /docs /convert/[pair] 都是 1
```
**证据**：`app/(zh)/convert/page.tsx` 用 `workspace-loader` 懒加载 `workspace.tsx`，标题在其中（`components/convert/workspace.tsx:451` 附近）。
**建议**：把 h1 放回服务端渲染的外壳（loader 里先渲染标题 + 骨架），workspace 挂载后接管交互。
**Owner**：frontend

### P2-5 中文文件名下载的 ASCII 回退是下划线 —— ✅ 源码已修

**现象**：`夜航西飞.mobi` 的响应头是
`Content-Disposition: attachment; filename="____.mobi"; filename*=UTF-8''%E5%A4%9C%E8%88%AA%E8%A5%BF%E9%A3%9E.mobi`
`filename*` 正确（现代浏览器用它），但 `filename` 全下划线，老客户端/某些下载器会得到 `____.mobi`。
**复现**
```bash
curl -s -F file=@/tmp/kf-samples/zh-utf8.txt -F target=mobi localhost:3100/api/convert
# 轮询 done 后 curl -D- .../download | grep -i content-disposition
```
**证据**：`lib/server/storage.ts:63-70` `buildContentDisposition`：非 ASCII 一律替换成 `_`。
**建议**：无 ASCII 文件名时回退到 `book.<ext>` 或 `jobId.<ext>`，别用一串下划线。
**Owner**：backend

### P2-6 非 UUID 的 job 路径返回 HTML 404 —— ✅ 源码已修

**现象**：`GET /api/jobs/%2e%2e%2fetc%2fpasswd` 返回 JSON 404 ✅；但 `GET /api/jobs/../../etc/passwd` 被 curl 规范化成 `/etc/passwd` 后返回 Next 的 **HTML** 404（`text/html`，整页 404 模板）。API 命名空间下混入 HTML 响应，客户端按 `{error:{code}}` 解析会崩。
**复现**
```bash
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' 'localhost:3100/api/jobs/../../etc/passwd'
# 404 text/html; charset=utf-8
```
**建议**：加 `app/api/[...catch]/route.ts`（或 middleware）让 `/api/*` 的未命中统一走 JSON 错误。
**Owner**：backend

---

### P2-7 🔴 本地 worker 失败后自动上传，且文案自我重复

**现象**：`/convert` 的本地转换（TXT→EPUB）在 worker chunk 加载失败时，会**自动改用服务器上传**，卡片显示：
`失败 | 上传 · 完成即删 | 本地转换失败（本地转换失败），已自动切换到服务器。| NETWORK 无法连接转换服务`
——括号里重复了同一句话；更重要的是**「0 字节上传」的承诺在回退路径上不成立**（虽然 UI 披露了「已自动切换到服务器」）。
**复现（需要让 worker 加载失败，最简单是转换瞬间停掉服务）**
```bash
# 先打开 /convert、上传一个 txt，然后在点击「开始转换」的瞬间重启服务：
pkill -f "next start" && (npx next start -p 3100 &)   # 不要在生产验收时做
# 卡片会出现「本地转换失败（本地转换失败），已自动切换到服务器」
```
**证据**：`lib/i18n/zh.ts:666-667`（`message: '本地转换失败'` + `hint: '已自动切换到服务器重试…'`）被拼接成 `message（hint）` 之外还重复了一次 message；我在 Lead 重启窗口真实撞到该表现。
**建议**：文案改成「本地转换失败，已改用服务器（会临时上传你的文件）」；或改为显式确认（「重试 / 改用服务器」两个按钮）。
**Owner**：frontend

### P2-8 🔴 calibre 路径产出的 EPUB 没有 NCX（nav 有，EPUB3 合法）

**现象**：`pdf→epub`、`odt→epub`、`rtf→epub` 都走 calibre，产物里有 `nav.xhtml`（PDF 的 nav 还带完整章节），但**包里没有 `toc.ncx`**。CONTRACT §3 要求「nav.xhtml、NCX 兼容」；EPUB3 阅读器没问题，老 Kindle / EPUB2 派生的阅读器拿不到 NCX 目录。另外 `odt→epub` 的 nav 只有一条 `Start`（calibre 没把 ODT 的 `text:h` 映射成目录，需 `--level1-toc` 之类的 XPath 参数）。
**复现**
```bash
curl -s -F file=@/tmp/kf-qa/t2.odt -F target=epub localhost:3100/api/convert   # 轮询后下载
curl -s -F file=@/tmp/kf-qa/out/pride.pdf -F target=epub localhost:3100/api/convert
unzip -l out.epub | grep -E 'ncx|nav'      # 只有 nav.xhtml，无 toc.ncx
```
**证据**：`lib/engine/node/calibre.ts:87-119`（`buildCalibreArgs` 没有生成 NCX 的参数）；对照 builtin 路径 `lib/engine/writers/epub.ts` 会写 `OEBPS/toc.ncx`（TXT/DOCX/CBZ/CBR 产物均有 NCX，e2e 已断言）。
**建议**：calibre 之后用内置 NCX writer 依据 nav.xhtml 补一个 `toc.ncx`（并在 OPF manifest/spine 里登记），或给 calibre 传 `--level1-toc`/`--epub-version` 让目录完整；ODT 走 `--level1-toc '//text:h'`。
**Owner**：engine

## 4. 审核通过项（逐条可复现）

### A. 安全（P0 组）

| 项 | 命令 | 结果 |
|---|---|---|
| jobId 路径穿越 | `for p in "../../etc/passwd" "%2e%2e%2f%2e%2e%2fetc%2fpasswd" "/etc/passwd" …; curl localhost:3100/api/jobs/$p` | 全部 404；未逃逸 |
| 下载接口用坏 id | `curl localhost:3100/api/jobs/<bad>/download` | 404（JSON） |
| DELETE 后访问 | `curl -X DELETE …/api/jobs/<id>` → `curl …/api/jobs/<id>` / `…/download` | 204 → 404 / 404；磁盘目录同时消失（`ls /var/folders/.../T/kindleforge/<id>` → GONE） |
| 上传文件名穿越 | `-F 'file=@zh.txt;filename=../../../../tmp/pwned.epub'` | 202；`/tmp/pwned.epub` 不存在；结果名被 `safeFileName` 清洗 |
| 空文件 | `-F file=@empty.txt` | 400 BAD_REQUEST + 中英 hint |
| 超大文件 | 220MB / 204900KB 稀疏文件 | 0.02s 内 413 TOO_LARGE（带字节数） |
| 方法白名单 | GET/PUT/PATCH/DELETE /api/convert | 405 + `Allow: POST, OPTIONS` + `Cache-Control: no-store` |
| zip bomb · 条目数 | 5001 条目 | 422 `ZIP_BOMB (entries=5001 > 5000)` |
| zip bomb · 压缩比 | 120MB 零字节 | 422 `ZIP_BOMB (ratio=1028.8 > 200)` |
| zip bomb · 伪造大小 | 声明 1000B 实际 5MB | `TOO_LARGE`（reader 层实算，见 P1-4） |
| DRM | 自造 `META-INF/encryption.xml` 指向非字体 | 422 DRM + 「我们不会破解」中英 hint |
| 坏文件诚实失败 | `broken.epub`（104B）/ 普通 zip 改名 `.epub` | job error `INVALID_FILE`，message/hint 可操作，未产出坏文件 |
| 临时目录权限 | `stat -f '%Sp' /var/folders/.../T/kindleforge` | root `drwx------`，job 目录 `drwx------`，文件 `-rw-------`（0700/0600） |
| 输入清理 | 转换后 `ls <jobDir>` | 只剩 `output.*`，`input.*` 已删 |
| 子进程注入 | 读 `lib/engine/node/calibre.ts:134-167`、`ocr.ts:58-83` | `spawn(bin, argv[])`，无 `shell:true`，无字符串拼接；文件名不参与命令行 |
| 响应头 | `curl -D- …/download` · 页面 | `Cache-Control: no-store`、`X-Content-Type-Options: nosniff`、CSP（`default-src 'self'`、`frame-ancestors 'none'`、`object-src 'none'`）、`Referrer-Policy`、`X-Frame-Options: DENY`、`Permissions-Policy` |

### B. 转换正确性（真实文件 + 二次校验）

| 用例 | 校验 | 结果 |
|---|---|---|
| 中文 TXT（GB18030，第一章/全角标点）→ EPUB | `unzip -l` + 结构脚本：mimetype 首条且 STORED、container.xml、OPF、nav.xhtml、NCX | ✅ 15 条目；nav 含「第一章 初见 / 第二章 旧书店 / 第三章 归途」；汉字 268→308（差额为 TOC 重复），句子逐条命中；，。""—— 计数与源一致；`lang=zh-CN` |
| DOCX（python-docx：标题/粗体/斜体/项目符号/PNG 图片）→ EPUB | EPUB 结构 + 内容断言 | ✅ nav=3 个标题；`<strong>/<em>/<ul>` 均保留；`OEBPS/images/docx-001.png` 在包内；图片说明文字在正文 |
| CBZ（3 张真 PNG）→ EPUB | OPF `rendition:layout`、spine、img src | ✅ 3 个 `itemref`、3 张图、`page-000N.png` 对应关系正确 |
| CBR（141KB 真 RAR，3 页）→ EPUB | 同上 | ✅ `engine:builtin`（node-unrar-js），3 页整页 |
| PNG 单图 → EPUB | 结构 | ✅ fixed-layout 1 页，图片重编码为 JPEG |
| EPUB（Gutenberg pride.epub）→ MOBI | `file` + offset 60 | ✅ `Mobipocket E-book … version 6`；offset60 = `BOOKMOBI` |
| EPUB → AZW3 | 同上 | ✅ `version 8`；offset60 = `BOOKMOBI` |
| EPUB → PDF | `file` + `pdftotext` | ✅ PDF 1.4 / 653 页 / 可抽出正文 |
| EPUB → TXT | 内容 | ✅ 742KB UTF-8，2528 行 |
| EPUB → DOCX | `unzip -l` | ✅ 标准 OOXML |
| 上述 4 个产物二次回读 | `ebook-convert <out> <tmp>.<ext>` | ✅ 4/4 `exit=0`（mobi→epub 1.6MB、azw3→epub 684KB、pdf→txt 747KB、docx→epub 654KB） |
| TXT → MOBI / AZW3（builtin+calibre 链） | `file` + offset 60 | ✅ `engine:"builtin+calibre"`，offset60=`BOOKMOBI` |
| Markdown → EPUB | 结构 | ✅ mimetype 首条 STORED、nav=「第一章 标题」+「开始阅读」+「封面」 |
| HTML → EPUB | 结构 | ✅ nav=「小节」（h1 成为书名封面）；正文中文标点保留 |
| FB2 → EPUB | 结构 | ✅ 书名「测试书 FB2」、nav=第一章/第二章 |
| RTF → EPUB（calibre） | 结构 | ✅ 合法 EPUB3（mimetype/nav/OPF），**无 NCX**，见 P2-8 |
| ODT → EPUB（calibre，合法 ODT） | 结构 | ✅ 合法 EPUB3、两章正文都在；**无 NCX**、nav 只有 `Start`，见 P2-8 |
| 扫描 PDF → EPUB（OCR，zh / zh-TW / 未装语言回退） | 解包后抽正文 | ✅ 含「数字化的第一页 / 扫描件里的文字要能被认出来」；回退时带 warning 与可用语言列表 |

### C. 前端 / 可访问性 / 内容（浏览器实测）

| 项 | 方法 | 结果 |
|---|---|---|
| console 错误 / 失败请求 | `node tools/audit.mjs http://127.0.0.1:3100 /tmp/kf-qa/audit` | 17/21 clean；4 条均为 `/nope-404` 的**预期** 404 控制台噪音 + 1 次 RSC `ERR_ABORTED`（路由切换取消） |
| 横向溢出 390/768/1440 | 同上 | 无 |
| img alt / h1 数量 / 小触控目标 | 同上 + 自写探针 | 无缺失 alt（页面用内联 SVG）；触控目标无 <24px（除 `sr-only` 的 1×1 radio，属预期） |
| 键盘顺序 | puppeteer 连按 Tab | 第 1 个焦点是「跳到主要内容」跳过链接；随后 logo → 导航 → 返回首页 → 上传按钮 → 输出格式 → 设备单选 → 排版控件，顺序合理 |
| 上传按钮键盘可用 | focus 后按 Enter / Space | 文件选择器分别被触发 1 次 / 2 次 ✅ |
| 焦点可见 | `:focus-visible` 计算样式 | moss 色 ring（`rgb(168,240,106)`）在导航/按钮上均出现；`outline-offset: 3px` |
| aria-live / role=alert | DOM | 状态播报 `aria-live="polite" role="status"` 存在；错误块 `role="alert"` |
| 对比度 ≥ 4.5:1 | canvas 取真实 sRGB 后计算（`/`、`/convert`、`/green`、`/docs`） | **0 处不达标**（含 11px 小字与半透明文字，已按 alpha 合成） |
| 第三方请求 | puppeteer performance entries | `/` 与 `/convert` 均为 **0** 个非 `127.0.0.1` 请求 |
| 本地模式 0 上传 | 上传 TXT→EPUB（默认 EPUB·本地）全程监听 | 上传后新增 12 个请求，`/api/convert` **0 个**，跨域 **0 个**，host 只有 `127.0.0.1:3100` ✅ |
| 文案数字 | 抓取渲染文本对照 `lib/engine/formats.ts` / `lib/server/jobs.ts` | 「15 类输入 / 7 类输出 / 5 款 Kindle 预设」与 `INPUT_FORMATS`(15)/`OUTPUT_FORMATS`(7)/`DEVICES`(5) 一致；「10 分钟」= `ttlMs`；「200MB」= `MAX_UPLOAD_BYTES`；竞品「1 小时后删除」标注了「据其公开页面」，未编造 |
| 绝对化表述 | 全文检索 | 未发现「支持任何格式 / 100% 无损 / 零碳」类表述；正文口径是「15 类输入、7 类输出」；能耗段落明确写「不换算成 X 克碳」 ✅ |
| i18n 残留 | 抓取 `/en*` 全文查 CJK；zh 页查 8 词以上英文句 | `/en`、`/en/green`、`/en/docs`、`/en/convert`、`/en/convert/pdf-to-epub` 无中文残留；zh 页无长英文句 |
| SEO | 10 个页面 | title / meta description / canonical 全部存在；`lang` 正确（zh-CN / en）；JSON-LD 全部 `JSON.parse` 通过 |
| sitemap | `curl /sitemap.xml` | 156 条 URL，其中 148 条格式对；抽查 `txt-to-epub`、`epub-to-mobi`、`pdf-to-epub`、`en/convert/epub-to-azw3` 均在 |
| robots.txt | `curl /robots.txt` | 200 `text/plain`，115B |

### D. 工程 / 性能

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npx tsc --noEmit` | **0 错误**（exit 0） |
| 单测 | `npx vitest run` | **15 files / 147 tests 全绿**（18.97s；含真 calibre / 真 OCR 用例） |
| 首屏请求数 / 体积（生产） | puppeteer performance entries + PerformanceObserver | `/` **181KB / 19 请求 / LCP 80ms / FCP 80ms / TTFB 4ms**；`/convert` **120KB / 23 请求 / LCP 56ms / FCP 44ms / TTFB 2ms**；两者 hosts 均只有 `127.0.0.1:3100` |
| 首屏（dev，仅供对照） | 同上 | `/` 6 请求 / 1.99MB（`main-app.js` 1.76MB 未压缩），FCP 164ms —— dev 数字不能当验收结论 |
| 第三方请求 | 同上 | 0 |

> 生产构建数据见 §6；`npx next build` 由 Lead 执行（`/tmp/kf-build.log`：161 静态页、0 warning/0 error）。

---

## 5. 未完成 / 待复验（诚实列出）

1. **RAR 炸弹**：`assertArchiveSafe` 只检查 ZIP；CBR 走 node-unrar-js，未做条目数/解压比上限测试（真实 RAR 样本小，没构造恶意 RAR）。风险低（reader 按页读取），但建议 engine 补上限（1 小时工作量）。
2. **TTL 10 分钟**：只由单测（`tests/api.jobs.test.ts` 短 TTL + sweep）与 DELETE 端到端覆盖，没有真实等 10 分钟。
3. **6 条 P2 的源码修复不在本次生产构建里**（Lead 构建在前、派单在后）：直连额度、calibre 路径脱敏、下载文件名、JSON 404、SSR h1、回退文案。需下一次 `next build` 后复核。

> 上一版列出的「chunked 411 运行期复验」与「prod LCP / build 输出」已在 §6 完成。

## 6. 生产验收补充（00:37，`next start -p 3100`，161 静态页）

| 项 | 命令 | 结果 |
|---|---|---|
| 端到端全套 | `npx vitest run tests/e2e` | **3 files / 30 tests 全绿**（security 15 + privacy 4 + convert 11），32.5s |
| 全量单测 + e2e | `npx vitest run` | **18 files / 196 tests 全绿**，33.9s |
| 类型检查 | `npx tsc --noEmit` | exit 0，无输出 |
| 浏览器审计（生产） | `node tools/audit.mjs http://127.0.0.1:3100 /tmp/kf-qa/audit-prod` | **21/21 clean**（dev 时那 4 条 404 页噪音已随 favicon 修复消失） |
| 本地模式 0 上传（生产构建） | `tests/e2e/e2e.privacy.test.ts` | 上传→转换→「完成 · 本地处理 · 未上传」，`/api/convert` 请求 **0**、`/api/jobs` **0**、跨域 **0** |
| 首屏性能（生产） | puppeteer performance entries + PerformanceObserver | `/` LCP **80ms**、FCP 80ms、TTFB 4ms、181KB / 19 请求；`/convert` LCP **56ms**、FCP 44ms、120KB / 23 请求；hosts 只有 `127.0.0.1:3100` |
| 构建输出（Lead 执行） | `/tmp/kf-build.log` | `✓ Compiled successfully in 3.1s` · `✓ Generating static pages (161/161)` · First Load JS shared 102 kB · **0 warning / 0 error** |
| 纯键盘走查 | puppeteer：Tab×11 到「开始转换」→ Enter | 完成 → 「下载」「打包下载 ZIP」均可 Tab 到达 |
| chunked 411 | `tests/e2e/e2e.security.test.ts` 用例 | 通过（响应不含 `jobId`） |
| 占位符 / 双语 | `grep -rn "TODO\|FIXME\|Lorem\|mock data\|dummy" app components lib`；i18n 键数 | 0 处占位；`zh.ts` : `en.ts` = 465 : 465 |

**验收窗口内的两次中间态（非产品缺陷，记录备查）**
1. 00:22 左右 `lib/engine/readers/epub.ts:269` 语法错误导致 3100 全站 500（engine 编辑中间态，数分钟内修复）。
2. 00:35 前后 Lead 执行 `rm -rf .next && next build` 与随后的重启，3100 短暂 connection refused；期间我的一次浏览器探测因此看到「本地转换失败 → 自动切换服务器 → NETWORK」，属于重启窗口的假阳性，**稳定后复测本地模式 0 上传通过**。

## 附录：复现素材

- 样本：`/tmp/kf-samples/{zh-gb18030.txt, sample.docx, comic.cbz, sample.cbr, scanned.pdf, pride.epub, drm.epub, broken.epub, not-epub.epub, bomb-entries.zip, bomb-ratio.zip, bomb-lying.zip, bomb-nested.zip, lying-png.cbz}`
- 脚本：`/tmp/kf-conv.sh`（提交+轮询+下载）、`/tmp/kf-verify-epub.py`（EPUB 结构断言）、`/tmp/kf-chunked.py`（chunked 上传）、`/tmp/kf-rl2.ts`（限流身份）、`/tmp/kf-seo.py`、`/tmp/kf-facts.py`
- 可提交的回归测试：`tests/e2e/e2e.convert.test.ts`、`tests/e2e/e2e.security.test.ts`、`tests/e2e/e2e.privacy.test.ts`（`npx vitest run tests/e2e`）
