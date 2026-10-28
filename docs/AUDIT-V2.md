# KindleForge v2 独立审核报告（进行中）

- 审核人：qa（独立审核，不参与实现）
- 审核对象：v2 后端（task-6，作者 backend）与 v2 前端（task-8，作者 frontend）
- 审核方式：读源码 + 独立端到端测试（直接调用 route handler，真实 SMTP/Sharp/文件系统）+ 全量测试/类型检查 + 服务端 HTTP 复验 + puppeteer 真实 Chromium 走查
- 环境：macOS / Node 24.19 / Calibre 8.16.2 / Tesseract 5.5.3 / Pandoc 未装；3100 为 v2 生产构建（`next start`，14:05 重建，限流放宽到 2000/h）
- 时间窗：2026-10-28 13:00–15:20（Asia/Shanghai）
- **构建时序**：首轮浏览器走查（14:05 构建）所见「最近添加 2026-10-28 换行」「保存条未固定」属**过期构建**（修复在 14:05:58–14:06:49 落地）。Lead 已于 14:20 用 `.next/BUILD_ID=34crcOU8Vnwgc_yRo0GJC` 重建并重启，最终复验见 §5/§6；过期现象不再计入。

## 0. 结论摘要

| 级别 | 数量 | 状态 |
| --- | --- | --- |
| P0 | 0 | — |
| P1 | 2 | 均已修复；in-process + HTTP 级复验通过 |
| P2 | 9 | 3 项已修复（P2-2 封面静默、P2-3 send-log 竞态、P2-9 移动端触控），6 项待处理（2 项文档/契约偏差） |
| 通过项 | 见 §4 | qa-v2 61/61、全仓 33 files/416 tests、e2e 30/30、HTTP 安全 7 项 |

没有发现 P0。P1 两条都属"本机工具被网页/恶意封面利用"类风险，修复方向正确（Host/Origin 守卫 + 出站 URL 公网校验），且未引入功能回归（qa-v2 61/61、全仓 416 项全绿、e2e 30/30）。

## 1. 证据基线

| 命令 | 结果 |
| --- | --- |
| `npx tsc --noEmit` | **exit 0**（frontend 完成豆瓣 UI 后复跑） |
| `npx vitest run tests/qa-v2` | 5 files / **61 tests 全绿** |
| `npx vitest run`（全仓） | **33 files / 416 tests 全绿**（36.4s；含 backend 新增 douban 15 条） |
| `npx vitest run tests/e2e` | **30/30 全绿**（29.3s，含真实转换/OCR/浏览器隐私检查） |
| HTTP 安全复验（curl，见 §6） | 7/7 通过（403/403/400/400/404/400/安全头+sitemap） |
| puppeteer 走查（14:20 最终构建，6 页 × 390/1440） | **12/12 组合** console 0、失败请求 0、横向溢出 0、h1=1、img alt 无缺失 |
| 最终视觉复验 | 短日期 `10月28日`；保存条 390/1440 不遮挡；390 卡片 5 按钮均 36×36、无溢出 |
| 实网豆瓣 + 封面代理 | 候选 1 条；`GET /api/metadata/cover` 200 `image/jpeg` 55,822B 350×500 |
| 1500 个文件重建索引 | 67ms（`scanLibrary` O(n²) 查重目前可接受） |
| 3 并发发送 → send-log | 修复前 8 轮中 1 轮只落 2/3（P2-3）；修复后连续 5 轮均 3/3 |

独立测试文件（不依赖 backend 的测试实现，全部直调真实 handler，临时 `KF_DATA_DIR`/`KF_LIBRARY_DIR`）：

- `tests/qa-v2/qa-v2-settings.test.ts`（12）
- `tests/qa-v2/qa-v2-library.test.ts`（18）
- `tests/qa-v2/qa-v2-metadata.test.ts`（8，含 douban 映射与降级）
- `tests/qa-v2/qa-v2-mail.test.ts`（8）
- `tests/qa-v2/qa-v2-security.test.ts`（15）

## 2. P1（高）

### P1-1 跨站请求 + DNS rebinding 可改写本机设置（已修复）

- **现象（修复前）**：任意网页可用 `fetch('/api/settings', {method:'PUT', headers:{'content-type':'text/plain'}, body:'{"smtp":{...}}'})` 触发简单请求（无预检），`readJsonBody` 不校验 Content-Type，服务端照单全收；`Host` 也未校验，恶意域名 rebind 到 127.0.0.1 后可读回设置。影响：篡改 SMTP（偷 Kindle 邮件/密码）、改书库目录、触发发送。
- **复现（修复前）**：`tests/qa-v2/qa-v2-settings.test.ts` 的 "rejects cross-site text/plain PUT" / "rejects a DNS-rebinding Host" 两条当时返回 200；修复后为 403。
- **修复**：`lib/server/origin.ts:140` `evaluateRequestOrigin`（Origin 存在时校验 scheme+authority；Host 必须在 127.0.0.1/localhost/::1+当前端口 或 `KF_ALLOWED_HOSTS`；从不信任 `X-Forwarded-Host`）+ `middleware.ts`（matcher `/api/:path*`，Host 必填）+ `lib/server/request.ts:66` `guardApiRequest`（direct handler 测试用，`allowMissingHost`）。
- **证据**：两条用例转绿；HTTP 级 curl（待重建）见 §6。
- **owner**：backend（已修）｜**状态**：修复已合入，HTTP 待复验。

### P1-2 封面 URL 可被用于 SSRF（已修复）

- **现象（修复前）**：`PATCH /api/library/:id {coverUrl}` 直接 `fetch` 任意 URL，可打 `http://127.0.0.1:3100/api/settings`、云元数据 169.254.169.254，且跟随重定向、无体积上限，可用于探测内网/读取本机接口。
- **修复**：`lib/server/net.ts:122` `assertPublicHttpUrl`（http(s) only；拒绝 localhost/local/internal/home.arpa 后缀；DNS 解析全部公网才放行，4s 超时；字面 IP 走 `isPublicAddress`）；`lib/server/library.ts:793` `downloadCover` 手动跟随重定向（≤3 跳），**每跳重新校验**，流式读取并在 8MB 截断，失败统一 `COVER_UNAVAILABLE` 422（不回显目标地址）。
- **证据**：`tests/qa-v2/qa-v2-security.test.ts` 15 条全绿：127.0.0.1/localhost/169.254.169.254/10.0.0.1/[::1]/file:/gopher: → 400 且响应不含内网地址；公网 93.184.216.34 302→127.0.0.1 → 422 且不含跳转目标；302 链超过 3 跳被拒。
- **owner**：backend（已修）｜**状态**：修复已合入，HTTP 待复验。

## 3. P2（中）

### P2-1 `/api/settings/test` 是任意 host:port 的 TCP/SMTP 探针（open）

- **现象**：`POST /api/settings/test` 接受任意 `host/port` 并发起 SMTP 连接，永远返回 200 + 诊断 code。可被本机页面用作端口扫描 oracle（区分 open/closed/超时）；也可向任意内网 SMTP 发起握手。
- **复现**：qa-v2-security 的 "settings/test to port 1" → 200 `MAIL_UNREACHABLE`；对 `127.0.0.1:3100` 会收到非 SMTP 响应 → `MAIL_UNREACHABLE`，无法区分"端口开但非 SMTP"。
- **建议**：测试连接只允许两种目标之一：已保存的 `smtp.host/port`，或要求请求带一次性 token/仅同源已登录会话；至少限制端口在 25/465/587/2525 并记录。若不改，README 需说明该端点仅限本机信任环境。
- **owner**：backend｜**状态**：open（P2）

### P2-2 封面下载成功但解码失败时完全静默（open）

- **现象**：`saveCover`（`lib/server/library.ts:341-354`）`catch { return {hasCover:false} }`。PATCH 返回 200，`warnings` 里没有任何封面相关提示。用户以为封面已更新，实际没有；EPUB 条目尤其完全无感。
- **复现**：`qa-v2-library.test.ts` "silently skips a cover sharp cannot decode"：fetch 返回非图片字节 → PATCH 200、`hasCover:false`、`warnings` 只有通用非 EPUB 文案、`GET .../cover` 404。
- **建议**：`saveCover` 返回失败原因；`patchLibraryEntry` 在 `coverUrl` 明确给出且解码/写盘失败时追加 warning。
- **复验（已修）**：backend 已改为返回 warning；`qa-v2-library.test.ts:285` 断言 `warnings` 含 `could not be decoded`，PATCH 仍 200、条目保留。✅
- **owner**：backend｜**状态**：**fixed**（P2）

### P2-3 `appendSendLog` 读-改-写无锁，并发发送丢审计记录（open，已复现）

- **现象**：`lib/server/mailer.ts:283-299` 先读 `send-log.json`、unshift、再写回，无 `withLock`。并发发送时后写覆盖先写，send-log 丢条目；`sendCount` 走 `withLock('library')` 不受影响。
- **复现**：`tests/qa-v2/qa-v2-mail.test.ts` 3 并发发送，8 轮中 1 轮 `send-log` 仅 2 条（messageId 唯一性 OK）。当前测试断言为 `>=2` 并注释指向本条，修复后应收紧为 `===3`。
- **建议**：`appendSendLog` 包 `withLock('send-log')`，或 send-log 改为按 messageId 去重的追加写。
- **复验（已修）**：backend 已加锁；测试断言收紧为 3 条，连续 5 轮 `npx vitest run tests/qa-v2/qa-v2-mail.test.ts` 均 8/8 通过，send-log 均 3 条且 messageId 唯一。✅
- **owner**：backend｜**状态**：**fixed**（P2）

### P2-4 生产 CSP 含 `script-src 'unsafe-eval' 'unsafe-inline'`（open）

- **现象**：`next.config.ts:33` 的 CSP 允许 `unsafe-eval`/`unsafe-inline`，削弱 XSS 防护（本机应用风险有限，但与"零上传/本地可信"定位不匹配）。
- **建议**：生产去掉 `unsafe-eval`（Next 生产通常不需要；dev 才需要）；`unsafe-inline` 若被 Next bootstrap 需要，至少用 nonce/hash 方案并复核。改后跑 `next build && next start` 回归。
- **owner**：frontend/Lead｜**状态**：open（P2）

### P2-5 `maxAttachmentMb` 超范围被静默夹取而非 400（open）

- **现象**：`lib/server/settings.ts` 的 `SettingsPatchSchema` 用 preprocess `Math.min(MAX_SEND_LIMIT_MB, Math.max(1, round(value)))`，PUT `{maxAttachmentMb:500}` → 200 且存 50；用户不知道被改了。
- **复现**：`qa-v2-settings.test.ts` 断言 500 → 200/50。
- **建议**：改为 400 + hint（"1–50 MB"），或响应体回显生效值并在前端提示。
- **owner**：backend｜**状态**：open（P2）

### P2-6 `/api/settings/test` 坏 JSON 返回 400，与"永远 200 诊断"的约定不一致（open）

- **现象**：FEATURES-V2 写"永远 200"；实际 `readJsonBody` 对非法 JSON 返回 400。对 UI 无影响（前端不会发坏 JSON），但契约偏差，测试/文档需统一。
- **建议**：要么改文档为"合法请求恒 200"，要么坏 JSON 也返回 200 `{ok:false,code:'BAD_REQUEST'}`。
- **owner**：backend｜**状态**：open（P2，文档级）

### P2-7 Host 白名单不含 `0.0.0.0`/局域网 IP，经 LAN 打开时 API 全 403（open，需文档）

- **现象**：`allowedAuthorities` 仅 127.0.0.1/localhost/::1 + `KF_ALLOWED_HOSTS`。用户若用 `http://192.168.x.x:3100` 打开（同机或手机），页面能开但所有 API 403，容易被误判为"坏了"。
- **建议**：README/启动提示写明"请用 127.0.0.1 打开"或设置 `KF_ALLOWED_HOSTS=192.168.x.x:3100`；如需默认支持 LAN，可在启动日志打印当前允许的 authorities。
- **owner**：backend/文档｜**状态**：open（P2）

### P2-8 `scanLibrary` 查重 O(n²)（open，minor）

- **现象**：`lib/server/library.ts:397-443` 对每个文件 `entries.some(e => e.id === entry.id)` 且串行 `stat` + `guessForFilename`。1500 文件 67ms；1 万文件预计数秒。
- **建议**：用 `Map<id, entry>`；保留当前行为（id 冲突时 `newEntryId`）。
- **owner**：backend｜**状态**：open（P2，minor）

### P2-9 390px 书库卡片操作按钮被挤到 16px，触控目标不达标（fixed，frontend）

- **现象**：390px 宽下书库为 2 列卡片，卡片底部 5 个操作按钮（下载/发送/编辑/打开目录/删除）在 149px 可用宽度里被 flex 压缩，实测宽度 `[32,32,32,16]`，其中 1 个仅 16×32，点按易误触；低于 WCAG 2.5.8（24×24）与 Apple 44pt 建议。
- **证据**：`components/library/library-view.tsx:87` IconAction `inline-flex h-8 w-8 ...` 无 `shrink-0`；操作行 `components/library/library-view.tsx:519` `flex items-center gap-1.5`（5×32+4×6=184px > 149px）。puppeteer 量测与截图 `/tmp/kf-qa-v2/shots/library-mobile.png`。
- **建议**：IconAction 加 `shrink-0`；2 列时改 `flex-wrap` 或把低频操作收进「更多」；目标尺寸 ≥40px。已附最小复现给 frontend。
- **复验（已修）**：frontend 改为 `h-9 w-9 shrink-0` + 操作行 `flex-wrap`；14:20 构建 390px 实测 5 个按钮均 **36×36**、卡片 `scrollWidth == clientWidth`（169px 卡宽无溢出）。✅
- **owner**：frontend｜**状态**：**fixed**（P2）

## 4. 已核实通过（可作为验收证据）

**设置/密钥**
- AES-256-GCM：`enc:v1:<b64(iv|tag|ciphertext)>`，密钥 `.secret.key` 32B 0600，settings.json 0600，data 目录 0700；磁盘上无明文密码；GET 只 `hasPassword`。
- 留空/省略保留密码；`clearPassword` 清空；子进程重启后仍能解密并发送。
- 校验：kindleEmail 仅 `@kindle.com`/`@free.kindle.com`；port 1–65535；from 必须邮箱；library.dir 相对路径 400、不可写 507 且旧配置不被破坏；16 并发 PUT 后 JSON 合法；未知键被剥离。

**书库**
- 上传 → 列表 → 下载字节一致；RFC5987 中文文件名；`no-store`/`nosniff`。
- 删 `library.json` 后重建，id 稳定；索引 0600；重名 ` (2)`；改名撞名自动后缀。
- 路径穿越：`../`、`%2e%2e%2f`、绝对路径、反斜杠、NUL、索引投毒、符号链接 → 400/404，响应不含服务器路径；`DELETE` 后文件与索引消失；外部删文件 → `missing:true`。
- 封面：sharp 规范 JPEG、ETag `kf-cover-<id>-<version>`、304；>8MB → 400；SSRF 见 P1-2。

**元数据**
- 默认 3 源 `['douban','google','openlibrary']` 并发、8s 总预算；豆瓣命中早返回，403/418/429/超时只降级该源（`qa-v2-metadata.test.ts` 418 降级 + Google 仍返回）。
- 豆瓣映射：只取 `type:'b'`，`/s/` 封面升级 `/l/`，`providerId`/`providerUrl` 限定 `book.douban.com`；请求带桌面 Chrome UA 与 `Referer: https://book.douban.com/`，只发 query，无 Cookie/body。
- 只访问三源固定 host；合并按 title::author 去重；30 天缓存命中不再请求；离线 `reason:'offline'` + 双语 hint；`enabled:false` → `disabled` 且 0 请求；ISBN/长度校验 400。
- 封面代理 `GET /api/metadata/cover` 复用 `assertPublicHttpUrl`（私网/file 400，curl 已验），doubanio.com 才注入 Referer/UA，8MB/10s/MIME 白名单。

**发送 / .eml**
- 真实 smtp-server 投递：主题 `《书名》` MIME 编码正确、附件名/字节正确、send-log 字段完整；EAUTH → 502 `MAIL_AUTH`、拒连 → 504 `MAIL_UNREACHABLE`、非法收件人 400、mobi 415、超限 413（且未投递）；错误体与日志不含密码。
- `.eml` 200 `message/rfc822`、multipart/mixed、RFC5987 文件名，不依赖 SMTP 配置。

**接口面**
- 错误方法 405 + `Allow`；坏 JSON 400；错误体 `application/json; charset=utf-8` + `no-store`；无 CORS 头；安全响应头齐全（nosniff/DENY/referrer/permissions）；错误不回显绝对路径或 stderr。

## 5. v2 前端（task-8）审核结果

真实 Chromium（puppeteer-core + 本机 Chrome）在 3100 上走查，覆盖 `/` `/library` `/settings` `/convert` `/en/library` `/en/settings`：

**通过**
- 6 页 × 390/1440：console error 0、失败请求 0、横向溢出 0、`h1` 恰 1、`img` 无缺 alt；截图在 `/tmp/kf-qa-v2/shots/`。
- `/library`：搜索防抖后精确命中；排序（标题/最近添加）生效；删除弹窗打开即焦点入内、Esc 关闭、确认后卡片消失且 `GET /api/library/:id` 404；编辑弹窗可保存并写回索引（API 标题已更新）；未配置 SMTP 时「发送」跳 `/settings?focus=send`；全流程 0 console 错误。
- `/settings`：单 h1；密码框 `type=password`、不回显；保存条初始隐藏、改动后出现；「测试连接」返回可读诊断；DOM 中无明文密钥。
- 键盘：首个 Tab 为「跳到主要内容」skip link，后续 11 个焦点元素全部可见且 `outline: solid 2px`；弹窗内 focus trap/Esc/焦点归还已验。
- i18n：`/en/*` 的 UI 文案除语言自名「中文」外无中文；书库中中文书名/作者是用户数据，不算文案残留。
- 元数据补全入口位于转换结果卡（`components/convert/file-card.tsx:145`），改造后走 `/api/metadata/search`；本机无外网时后端返回 `reason:'offline'` + 双语 hint（API 层已测），未做真实转换以免写入真实书库。

**14:20 最终构建复验（已通过）**
- 书库统计「最近添加」：临时上传 1 本后显示 `10月28日`（zh 短日期），英文为 `Oct 28`。
- 设置页保存条：1440/390 初始隐藏；改动后出现在视口底部（390：top 770 / bottom 828 / vh 844；1440：top 839 / bottom 871 / vh 900），不遮挡页脚。
- 390 书库卡片：5 个操作按钮均 36×36，卡片无横向溢出（截图 `/tmp/kf-qa-v2/shots/library-final-390.png`）。
- 6 页 × 390/1440 复跑：console 0、失败请求 0、横向溢出 0、h1=1、img alt 无缺失；desktop 二次访问 304 属正常缓存。
- 实网豆瓣：`POST /api/metadata/search {"title":"三体","author":"刘慈欣"}` → 1 条 douban 候选（封面 `/l/public/s2768378.jpg`）；`GET /api/metadata/cover` → 200 `image/jpeg` 55,822B 350×500。
- 复验后已删除临时条目，`/api/library` total=0，`~/KindleForge` 0 文件（尊重 Lead 清空后的书库）。

**契约偏差（Lead 已裁决接受）**
- ISBN 在保存成功后额外 `PATCH /api/library/:id {isbn}` 写入（engine 选项与 server save schema 均无 isbn）；两次写非原子，PATCH 失败只提示。Lead 接受并记入 FEATURES-V2 §4。
- 根 `vitest.config.ts`（@ alias + automatic JSX）仅测试用，Lead 接受。
- frontend 自述「tsc 剩 12 错在 tests/qa-v2」为过期信息：qa-v2 已改 `Uint8Array`，`tsc` exit 0。

## 6. HTTP 级复验（已执行）

1. 跨站 `PUT /api/settings`（`content-type: text/plain` + `origin: https://evil.example`）→ **403**；同请求去掉 Origin → 400（坏 JSON，证明同源路径可达）。✅
2. `Host: evil.example:3100` + `GET /api/settings` → **403**；`Host: 127.0.0.1:3100` → 200。✅
3. `PATCH /api/library/:id {"coverUrl":"http://127.0.0.1:3100/api/settings"}` → **400** 私网拒绝；`169.254.169.254` → 400；`file:///etc/passwd` → 400；响应不含内网地址。✅
4. 路径穿越：`/api/library/..%2f..%2fetc/passwd/file` → **404**；DELETE 后再次 GET/file → 404。✅
5. 安全头：`nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`X-Frame-Options: DENY`、CSP 齐全（仍含 `script-src 'unsafe-inline' 'unsafe-eval'`，见 P2-4）。✅
6. `/api/settings/test {host:127.0.0.1,port:1}` → 200 `MAIL_UNREACHABLE`，无 stderr/端口回显（P2-1 证据）。✅
7. `sitemap.xml` 160 个 `<loc>`，含 `/library`；`/library` `/settings` `/en/library` `/en/settings` 全 200。✅

**平台限制记录（非缺陷）**：Next 15 在 middleware/handler 之前等待请求体收完，原始 socket 验证「非零 Content-Length 但无 body」的 POST 到不了路由（`CL:5` 的 `POST /api/health` 4s 无响应，`CL:0` 才 405）。因此「>200MB 立即 413（不读 body）」只能在 handler 内预检，HTTP 层不可观测；`tests/e2e/e2e.security.test.ts` 已改为直接调用 `CONVERT_POST` 断言 413，真实行为由 `lib/server/storage.ts`/route 预检保证。

**剩余待复验**：frontend 冻结后 rebuild → 短日期/保存条/触控目标三项视觉复测；`.eml` 下载与「自动补全信息」应用流程（依赖真实转换，建议在隔离 `KF_DATA_DIR`/`KF_LIBRARY_DIR` 的实例上做）。
