# KindleForge v2 — 本地书库 / 元数据补全 / Send to Kindle

状态：**草案 v1（Lead 冻结接口）**。codex 的 prompt 建议在此之上增补，不改变本文件的
接口与路径，除非 Lead 明确修订。所有 agent 以本文件 + `docs/CONTRACT.md` 为准。

## 0. 前提

- 个人单用户、本机（127.0.0.1）。无账号、无云数据库、无遥测。
- 书库必须离线可用；元数据/发信是可选的增强，失败不能影响转换与书库。
- 所有密钥只存在本机，永不返回前端、永不进日志。

## 1. 路径与文件布局

```
~/KindleForge/                     # 书库根（KF_LIBRARY_DIR 可改），用户可见
  三体 - 刘慈欣.epub
  夜航西飞 - 柏瑞尔·马卡姆.mobi
~/.kindleforge/                    # 状态根（0700）
  settings.json                    # 0600，含加密后的 SMTP 密码
  .secret.key                      # 0600，32 字节随机，AES-256-GCM
  library.json                     # 0600，索引（原子写；丢失可按目录重建）
  covers/<entryId>.jpg             # 封面缓存，最长边 1200
  cache/metadata/<sha1>.json       # 元数据查询缓存，30 天
  send-log.json                    # 最近 200 条发送记录（无正文、无密码）
```

- 文件名：`<title> - <author>.<ext>`，去掉 `/\:*?"<>|` 与控制字符，长度 ≤120 字节；
  重名追加 ` (2)`。改名发生在元数据更新时，id 不变。
- id：创建时随机 10 位 hex（`crypto.randomBytes(5).toString('hex')`）。
- 索引条目以 `id` 为主键；文件丢失时条目标记 `missing` 并允许删除。
- 书库目录不可写 / 磁盘不足：返回清晰错误，**不**影响转换结果下载。

## 2. 设置（持久化，重启自动加载）

```ts
type MetadataProvider = 'google' | 'openlibrary';

interface Settings {
  version: 1;
  library: { dir: string; autoSave: boolean };
  metadata: { enabled: boolean; providers: MetadataProvider[]; language: 'auto' | 'zh' | 'en' };
  send: {
    smtp: { host: string; port: number; secure: boolean; user: string; from: string; hasPassword: boolean };
    kindleEmail: string;
    maxAttachmentMb: number; // 默认 25，最大 50
  };
}
```

- 文件内 `smtp.password` 存 `enc:v1:<b64(iv|tag|ciphertext)>`；密钥在 `.secret.key`。
- `GET /api/settings` 永远不含明文/密文密码，只含 `hasPassword`。
- `PUT /api/settings`：部分更新；`smtp.password` 省略/空字符串=保留旧密码，
  显式 `clearPassword: true`=删除。保存后立即生效（邮差缓存失效）。
- 威胁模型：同机同用户的其他进程仍可读密钥（与 `.env` 同级别），但可防备份误传、
  日志泄露、git 误提交、前端泄露。README 写明。

## 3. 书库 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/library?q&sort&format` | 列表 + 总数 + 目录；`sort=added\|title\|author\|size` |
| POST | `/api/library` | `{ jobId }` 把任务结果复制进书库；返回 entry |
| GET | `/api/library/:id` | 单条 |
| PATCH | `/api/library/:id` | `MetadataPatch`；改标题/作者会重命名文件；EPUB 会重写 OPF+封面 |
| DELETE | `/api/library/:id` | 删文件 + 索引 + 封面 |
| GET | `/api/library/:id/file` | 下载（RFC 5987） |
| GET | `/api/library/:id/cover` | 封面（可 304） |
| POST | `/api/library/:id/reveal` | macOS `open -R`；仅允许 bookDir 内真实文件 |
| POST | `/api/library/:id/send` | `{ mode: 'smtp' }` 发到 Kindle 邮箱 |
| GET | `/api/library/:id/eml` | 生成 `.eml` 草稿下载（零配置兜底） |

- 自动保存：任务完成时若 `library.autoSave`，在 `lib/server/convert.ts` 完成点调用
  `library.saveJobResult(job)`（失败只加 warning，不改任务状态）。结果卡仍保留手动保存。
- 格式：书库保存转换后的**目标格式**；EPUB 才可写元数据；其他格式只更新索引并提示。

## 4. 元数据

- 猜测：从文件名去扩展名，处理 `《书名》`、`书名 - 作者`、`作者 - 书名`、
  `[作者]书名`、`书名 by 作者`，抽 ISBN-10/13；无结果时 title=原文件名。
- 源：豆瓣读书（`https://book.douban.com/j/subject_suggest?q=`，无公开 API，个人使用
  best-effort，可在设置关闭；桌面 Chrome UA/Referer；封面 `img*.doubanio.com` 的 `/s/`
  换 `/l/` 取大图，代理请求带 `Referer: https://book.douban.com/`）；Google Books
  （`https://www.googleapis.com/books/v1/volumes?q=`，无需 key）；Open Library
  （`https://openlibrary.org/search.json`，封面走 covers.openlibrary.org）。
  默认顺序 douban → google → openlibrary，三源并发；整体 8s 上限，豆瓣有结果时给其余源
  300ms 宽限后返回（不可达/403/418/429 只降级该源）。只发送书名/作者/ISBN 查询串，不上传文件。
- 缓存 30 天；离线/超时返回 `ok:false, reason:'offline'`，前端可退化为手动编辑。
- `POST /api/metadata/search` `{ q?, title?, author?, isbn? }` → `{ candidates, cached }`。
- `PATCH /api/library/:id` 应用；EPUB 用引擎 `applyEpubMetadata(bytes, meta, cover?)`
  重写 OPF（dc:title/creator[@file-as]/language/publisher/description/identifier）
  与封面（manifest `properties="cover-image"`、`cover.xhtml`、guide），mimetype 保持
  首条 STORED；非 EPUB 跳过并返回 `warning`。
- 封面：下载后由服务端用 sharp 规范为 JPEG（最长边 1200，质量 82），拒绝 >8MB。

## 5. Send to Kindle

- 收件人默认 `settings.send.kindleEmail`，必须是 `@kindle.com`（也接受 `@free.kindle.com`）。
- 只允许 EPUB/PDF/DOCX/TXT（亚马逊不收 MOBI/AZW3）；MOBI 源提示先转 EPUB。
- 大小：默认 25MB，可在设置改到 ≤50MB；超过直接 413 并提示改用 USB。
- SMTP：`nodemailer.createTransport({host,port,secure,auth:{user,pass}})`，10s 超时；
  错误映射：EAUTH→`MAIL_AUTH`（提示应用专用密码/授权码），ECONNECTION/ETIMEDOUT→
  `MAIL_UNREACHABLE`（提示 465/587 与网络），收件人非法→`MAIL_RECIPIENT_INVALID`。
- 邮件：主题 `《书名》`，正文说明来源 + 白名单提示；附件名用原名（ASCII 回退）。
- 发送记录写 `send-log.json`（entryId, at, ok, messageId, error code），前端显示最近状态。
- `.eml`：用 nodemailer 的 MailComposer 生成，`Content-Type: message/rfc822` 下载，
  用户双击用系统邮件客户端发送。UI 文案说明「附件需自己点发送」。
- 白名单：设置页/发送成功提示「把发件地址加入亚马逊已批准列表，否则会被静默丢弃」。

## 6. 前端

- `/library`、`/en/library`：搜索、排序、格式筛选、封面网格/列表切换；空状态引导转换；
  卡片操作：下载、发送、编辑元数据、在 Finder 显示、删除。
- `/settings`、`/en/settings`：书库目录 + 自动保存；元数据开关与源；SMTP 表单
  （密码占位「已保存，留空不修改」+「清除密码」）、测试连接、Kindle 邮箱、保存状态。
- `/convert`：结果卡新增「保存到书库」「发送到 Kindle」；上传后文件卡可「自动补全信息」
  （弹窗展示候选、可改、应用）。
- 导航新增「书库」「设置」；页脚同步；中英双语 key 同步（zh/en 结构一致）。
- 发送按钮在未配置 SMTP 时打开设置页并提示；发送中禁用；成功/失败 toast 可读。

## 7. 验收

- `npx tsc --noEmit` 0 错；`npx vitest run` 全绿（新增 ≥40 条）。
- 真实流程：上传中文 TXT → 转 EPUB → 自动进书库 → 补元数据（离线降级不崩）→
  书库搜索/下载/删除 → 重启服务后书库与 SMTP 配置仍在（`hasPassword:true`）。
- 安全：`grep` 日志/响应无密码；`~/.kindleforge/settings.json` 0600；路径穿越
  （`..`、绝对路径、符号链接）全部拒绝；`reveal` 不接受任意路径。
- mock SMTP（smtp-server）收到邮件：主题、附件字节、中文名编码正确；错误路径可读。

## 8. 实现备注（v2 后端）

- 自动保存位置：`lib/server/jobs.ts` 在任务状态置为 `done` **之前**调用
  `library.saveJobResult(completed)`，因此客户端第一次看到 `status: "done"` 时书库索引已经包含
  该条目；失败只追加 `Auto-save to library failed: …` warning，不改变任务状态。手动
  `POST /api/library { jobId }` 复用同一 `insertJobLocked`，按 `savedFromJobId` 幂等。
  覆盖测试见 `tests/api-v2-autosave.test.ts`（真实 TXT→EPUB、轮询、书库列出、JSON jobId 路径）。
- Host/Origin 守卫：`lib/server/origin.ts` + 根目录 `middleware.ts`（matcher `/api/:path*`，
  v1/v2 路由统一生效）。Host 只允许 `127.0.0.1` / `localhost` / `[::1]` 加配置端口
  （`KF_PORT`，默认 3100），可用 `KF_ALLOWED_HOSTS` 追加；带 `Origin` 时其 host 也必须命中
  同一允许集；不信任 `X-Forwarded-Host`；不匹配返回 403 `FORBIDDEN_HOST` /
  `FORBIDDEN_ORIGIN`，响应 `Cache-Control: no-store`。用于阻断 DNS rebinding 页面通过
  浏览器同源请求访问本机 API。
- 密钥与配置：`settings.json` 和 `.secret.key` **首次创建**即 0600（`open`/`writeFile` 的
  `mode: 0600, flag: 'wx'`，rename 前 chmod），不存在先 0644 再 chmod 的窗口；密钥 32 字节，
  密码为 AES-256-GCM `enc:v1:<b64(iv|tag|ciphertext)>`。GET `/api/settings` 只返回
  `hasPassword`，不返回明文或密文密码。`send-log.json` 只记录
  `entryId/title/at/ok/code?/messageId?`，不含密码、SMTP 配置或附件正文。
- `reveal`：先判断 `process.platform === 'darwin'`，非 macOS 直接 501 `REVEAL_UNSUPPORTED`，
  不执行任何进程；macOS 上仅 `spawn('open', ['-R', resolvedPath])`（detached、stdio ignore），
  路径先经 realpath + lstat 校验，拒绝符号链接与书库目录逃逸，不经过 shell。
- 书库 id：只接受 10 位 hex；`../`、`%2e%2e`、绝对路径、未知 id 全部 4xx/404；下载、封面、
  删除、发送前再经 `resolveRealFileInside`（lstat 拒绝 symlink，realpath 必须位于书库目录）。
- 封面 URL（外部输入入口）：只允许 http/https；`lib/server/net.ts` 的
  `assertPublicHttpUrl` 对首次 URL 和每次重定向都做 `dns.lookup({all:true})` 检查，拒绝
  localhost/.local/.internal、回环、私网、CGNAT、链路本地、保留/组播地址（含 IPv4-mapped
  IPv6）；重定向手动跟随最多 3 次并逐跳复检；超时 10s；响应流式读取并在 8MB 处中断
  （不依赖 Content-Length），随后才交给 sharp 规范化。
- 元数据候选封面代理：`GET /api/metadata/cover?url=`（`lib/server/metadata/cover.ts`）复用
  `assertPublicHttpUrl`，只允许 http/https 公网地址，手动跟随最多 3 次重定向且逐跳复检；
  10s 超时、8MB 流式上限，只接受 JPEG/PNG/WebP/GIF/AVIF（拒绝 SVG/HTML/octet-stream），
  响应带 `X-Content-Type-Options: nosniff`、ETag 与 `Cache-Control: public, max-age=604800`，
  `If-None-Match` 命中直接 304；内存缓存最多 64 条/32MB、30 天。前端只把这个代理 URL 用作
  `<img src>`，保存元数据时仍传候选的原始公网 `coverUrl`，避免把相对代理路径交给书库封面逻辑。

- 豆瓣补充（v2 后端）：`lib/server/metadata/providers.ts` 的 `searchDouban` 只读
  `subject_suggest`，不抓 subject 详情页（避免页面结构变化与被封），因此候选不含 ISBN/
  出版社；`providerUrl` 指向豆瓣 subject 页，`providerId` 为 subject id。查询仍全部并发，
  8s 总预算（`METADATA_TOTAL_TIMEOUT_MS`），豆瓣命中即早返回；`DEFAULT_PROVIDERS` 为
  `['douban','google','openlibrary']`，设置页可逐项关闭。豆瓣没有公开 API，服务随时可能
  限流或变更，此时仅该源降级，界面仍可手填或使用其它源；隐私上只发送书名/作者（无文件、
  无账号/cookie）。封面代理对 doubanio.com 注入 Referer 与桌面 UA，其它域不加。
