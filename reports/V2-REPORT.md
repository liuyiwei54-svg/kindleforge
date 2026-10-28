# KindleForge v2 独立审核报告

- 审核人：qa（独立审核，不参与实现；只写 `tests/qa-v2/**`、`docs/AUDIT-V2.md`、`reports/V2-REPORT.md`）
- 审核对象：v2「书库 + 设置 + Send to Kindle + 元数据补全 + 豆瓣源 + 封面代理」（后端 task-6/task-10，前端 task-8）
- 环境：macOS 26 / Node 24.19 / Next 15.5.28 / Calibre 8.16.2 / Tesseract 5.5.3 / Pandoc 未装；3100 生产构建（`next start`，限流放宽 2000/h）
- 时间窗：2026-10-28 13:00–15:30（Asia/Shanghai）
- 详细分级问题、复现命令、文件:行号见 `docs/AUDIT-V2.md`

## 1. 结论

| 项 | 结果 |
| --- | --- |
| P0 | **0** |
| P1 | 2（CSRF/DNS rebinding、封面 URL SSRF）——**均已修复**，in-process 与 HTTP 级复验通过 |
| P2 | 9：2 已修复（封面静默、send-log 竞态），7 待处理（3 项为文档/契约/移动端体验） |
| 独立测试 | `tests/qa-v2` 5 files / **61 tests 全绿** |
| 全量回归 | `npx vitest run` **33 files / 416 tests 全绿**；`tests/e2e` 30/30 |
| 类型检查 | `npx tsc --noEmit` **exit 0**（frontend 豆瓣 UI 完成后复跑） |
| 浏览器走查（14:20 最终构建） | 12/12 页×视口组合：console 错误 0、失败请求 0、横向溢出 0、h1 唯一、img alt 无缺失 |
| 最终视觉复验 | 短日期 `10月28日`、保存条 1440/390 不遮挡、390 卡片 5 按钮均 36×36 |
| 实网豆瓣 | `POST /api/metadata/search` → douban 候选 1 条；cover 代理 200 `image/jpeg` 55,822B 350×500 |

**是否可以交付：可以交付。** 没有发现可导致数据损坏、越权、凭据泄露或静默错误结果的 P0；两条 P1 都是本机工具被网页/恶意封面利用的风险，修复方向正确（Host/Origin 守卫 + 出站公网校验 + 逐跳复检）且有 HTTP 证据。剩余 P2 均为体验/硬化/文档项，可在发布后按 backlog 处理，不构成阻断。

## 2. 审核方法

- **读源码**：设置加密与原子写、路径解析（`resolveInside`/`resolveRealFileInside`）、书库索引与封面、SMTP/`.eml`、元数据三源与缓存、封面代理、origin/Host 守卫、限流与上传。
- **独立端到端测试**（不复用实现者的测试断言，全部直调真实 route handler，临时 `KF_DATA_DIR`/`KF_LIBRARY_DIR`）：
  - `tests/qa-v2/qa-v2-settings.test.ts`（12）：加密落盘/0600/0700、密码保留与清除、子进程真重启、校验与错误码、并发 PUT、未知键剥离、跨站与 Host 重绑定 403。
  - `tests/qa-v2/qa-v2-library.test.ts`（18）：上传/下载字节一致、RFC5987、索引重建 id 稳定、重名与改名、索引投毒/符号链接/非法 id、封面 ETag/304/私网拒绝/超限/解码失败 warning、删除与不存在文件。
  - `tests/qa-v2/qa-v2-metadata.test.ts`（8）：三源合并去重、豆瓣映射与 418 降级、30 天缓存、离线/禁用 reason、双 provider 子集、输入校验。
  - `tests/qa-v2/qa-v2-mail.test.ts`（8）：真实 `smtp-server` 投递、MIME 主题/附件、EAUTH/拒连/非法收件人/415/413 映射、并发 send-log 不丢、`.eml` 结构。
  - `tests/qa-v2/qa-v2-security.test.ts`（15）：真实 net guard 下 coverUrl 私网/元数据地址/file/gopher 全 400、重定向逐跳复检、405+Allow、坏 JSON、安全头、multipart 清洗、settings/test 探针。
- **HTTP 级复验**：`curl` 打 3100（Host/Origin 403、私网封面 400、穿越 404、安全头、sitemap 160、settings/test 诊断）。
- **浏览器走查**：puppeteer-core + 本机 Chrome，`/` `/library` `/settings` `/convert` `/en/*`，390/1440 截图存 `/tmp/kf-qa-v2/shots/`；键盘 Tab、弹窗 focus trap/Esc、密码不回显、i18n 中文残留。

## 3. 对照 `docs/FEATURES-V2.md` §7 验收

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `tsc` 0 错 | **PASS** | `npx tsc --noEmit` exit 0 |
| `npx vitest run` 全绿、新增 ≥40 条 | **PASS** | 33 files / 416 tests；v2 新增测试 94+（backend 52 + qa 61 独立口径） |
| 真实流程：上传中文 TXT → EPUB → 自动进书库 → 补元数据（离线不崩）→ 搜索/下载/删除 → 重启后配置仍在 | **PASS（拆分验证）** | 转换/自动保存由 `tests/api-v2-autosave.test.ts` 与 v1 e2e 真转换覆盖；qa 独立验证了自动保存后的列表/搜索/下载/删除、子进程重启后 `hasPassword:true` 与解密一致；元数据离线降级见 qa-v2-metadata |
| 安全：日志/响应无密码；settings 0600；穿越全拒；reveal 不接受任意路径 | **PASS** | grep `enc:v1:` 断言、0600/0700 断言、`../`/`%2e%2e%2f`/绝对路径/NUL/符号链接 400/404、HTTP 复验；reveal 仅 darwin + `spawn('open',['-R',path])` + realpath/lstat |
| mock SMTP：主题、附件字节、中文名编码正确；错误路径可读 | **PASS** | 真实 smtp-server 收信解码 `《测试书》`、附件 base64 含标记字节；EAUTH→502、拒连→504、非法收件人→400、mobi→415、超限→413 |
| `/library` `/settings` 页面可用、`/en` 无中文残留、键盘可达、无 console 错误 | **PASS**（视觉三项待重建复验） | 6 页 × 2 视口 0 错误/0 溢出；Tab 首项 skip link、焦点环 2px；`/en` 仅语言自名「中文」；书库中文名为用户数据 |
| sitemap 含新页面 | **PASS** | `sitemap.xml` 160 个 `<loc>`，含 `/library` |
| 封面代理与豆瓣源 | **PASS** | 私网/file 400；豆瓣 `type:'b'`、`/s/→/l/`、UA/Referer、418 降级均有测试；qa 在最终构建上实网复核：1 条 douban 候选 + 封面 200 JPEG 55,822B 350×500 |

## 4. 关键通过项（摘要）

- **设置/密钥**：AES-256-GCM `enc:v1:<b64(iv|tag|ciphertext)>`，settings 0600、`.secret.key` 32B 0600、data 0700；GET 只有 `hasPassword`；留空=保留、`clearPassword`=清除；16 并发 PUT 后 JSON 合法；未知键被剥离；kindleEmail/port/from/大小校验 400；目录相对路径 400、不可写 507 且旧配置不破坏。
- **书库**：下载字节与上传一致；RFC5987 中文名；`no-store`/`nosniff`；删索引重建 id 不变；重名 ` (2)`；改名清洗并处理撞名；路径穿越/绝对路径/NUL/索引投毒/软链全 400/404 且不泄露服务器路径；封面 sharp 规范 JPEG、ETag `kf-cover-<id>-<version>`、304；`>8MB` 400；删除即时清盘。
- **发送**：主题 `《书名》` MIME 编码、附件名与字节正确；错误映射可读且不泄密；`.eml` `message/rfc822`+multipart 可解析；并发 send-log 已加锁（5 轮 ×3 并发均 3 条）。
- **元数据**：只发 query（无 Cookie/body）、固定 host、三源并发 8s 预算、豆瓣失败只降级该源、30 天缓存、离线/禁用状态清晰、封面代理私网拒绝。
- **接口面**：错误方法 405+`Allow`；错误体 JSON+`no-store`；无 CORS 头；安全头齐全；跨站 `text/plain` PUT 与 DNS rebinding Host 均 403。

## 5. 剩余问题（按优先级）

| ID | 问题 | 级别 | owner | 状态 |
| --- | --- | --- | --- | --- |
| P1-1 | 跨站请求/DNS rebinding 可改写设置 | P1 | backend | **fixed**，HTTP 403 复验 |
| P1-2 | 封面 URL SSRF | P1 | backend | **fixed**，HTTP 400 复验 |
| P2-1 | `settings/test` 任意 host:port TCP 探针 | P2 | backend | open（建议限已保存配置/端口白名单） |
| P2-2 | 封面解码失败静默 | P2 | backend | **fixed**，PATCH 返回 warning |
| P2-3 | send-log 并发丢记录 | P2 | backend | **fixed**，5×3 并发均 3 条 |
| P2-4 | CSP 含 `unsafe-eval`/`unsafe-inline` | P2 | frontend/Lead | open（发布前硬化或记录风险） |
| P2-5 | `maxAttachmentMb` 超范围静默夹取 500→50 | P2 | backend | open（改 400 或回显生效值） |
| P2-6 | `settings/test` 坏 JSON 400 与「恒 200」文档不一致 | P2 | backend | open（文档级） |
| P2-7 | Host 白名单不含局域网 IP，LAN 打开时 API 403 | P2 | backend/文档 | open（README 写明用 127.0.0.1 或设 `KF_ALLOWED_HOSTS`） |
| P2-8 | `scanLibrary` O(n²) | P2 minor | backend | open（1500 文件 67ms，暂可接受） |
| P2-9 | 390px 书库卡片操作按钮挤到 16px | P2 | frontend | **fixed**（`h-9 w-9 shrink-0` + `flex-wrap`；实测 5×36×36、无溢出） |

**平台限制（非缺陷）**：Next 15 在 middleware/handler 之前等待请求体收完，「非零 Content-Length 无 body」的 POST 到不了路由，故「>200MB 立即 413」只能在 handler 内预检；`tests/e2e/e2e.security.test.ts` 已改为直调 `CONVERT_POST` 断言 413，真实行为由路由预检保证。

## 6. 发布后 backlog（均不阻断）

1. `settings/test` 限制目标（P2-1）或文档声明仅限本机信任环境。
2. CSP 去掉 `unsafe-eval` / 收紧 `unsafe-inline`（P2-4）。
3. `maxAttachmentMb` 超范围改 400 或回显生效值（P2-5）。
4. `settings/test`「恒 200」文案改为「合法请求恒 200」（P2-6）。
5. README/启动提示写明 LAN 访问需 `KF_ALLOWED_HOSTS`（P2-7）。
6. `scanLibrary` 用 `Map` 替代 `entries.some`（P2-8，规模小时可延后）。

**已完成的发布前动作**：14:20 重建并复验短日期/保存条/390 卡片（12/12 页面组合 0 console、0 失败请求）；P2-9 已随构建修复。

## 7. 未覆盖与残余风险

- **真实在线源**：豆瓣 live 已由 qa 在最终构建复核（1 条候选 + 封面 200）；Google/Open Library 的 live 结果未逐一复核，契约与降级路径由 stub 覆盖。发布说明仍应保留「第三方源随时可能限流/变更」。
- **真实 Kindle 投递**：无 Amazon 账号/白名单，未做端到端投递；SMTP 层已用真实 `smtp-server` 验证。
- **真实扫描 PDF/OCR**：v2 未改动，v1 已覆盖；本轮未重复。
- 无遗留发布阻断项；14:05 构建的过期视觉现象已在 14:20 构建复验中消除。
- **测试数据**：审核中只在真实书库创建/删除了自己的条目（最终已删净，total=0、目录 0 文件），未写入 `~/.kindleforge` 的密码/SMTP 配置；`KF_DATA_DIR`/`KF_LIBRARY_DIR` 隔离测试。

## 8. 复现命令

```bash
cd /Users/yiwei/Desktop/daily/kindle
npx vitest run tests/qa-v2          # 61 tests
npx vitest run                      # 33 files / 416 tests
npx tsc --noEmit                    # exit 0
npx vitest run tests/e2e            # 30/30（需 3100 在跑且限流放宽）

# HTTP 安全
curl -si -X PUT -H 'content-type: text/plain' -H 'origin: https://evil.example' \
  --data '{"kindleEmail":"attacker@kindle.com"}' http://127.0.0.1:3100/api/settings   # 403
curl -si -H 'Host: evil.example:3100' http://127.0.0.1:3100/api/settings             # 403
curl -si -X PATCH -H 'content-type: application/json' \
  --data '{"coverUrl":"http://127.0.0.1:3100/api/settings"}' \
  http://127.0.0.1:3100/api/library/<id>                                              # 400
curl -si 'http://127.0.0.1:3100/api/metadata/cover?url=file:///etc/passwd'            # 400
```
