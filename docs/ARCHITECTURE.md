# 架构

## 一句话

一个 Next.js 应用里跑三件事：**能本地跑的转换引擎**（同构 TypeScript）、**能自托管的任务 API**（零留存）、**能卖货的界面**（中英、SEO、可访问）。

```
浏览器                                Node (Next.js route handlers)
┌────────────────────────────┐        ┌──────────────────────────────────┐
│ 落地页 / 工作台 / 格式页      │  HTTP  │ /api/convert  /api/jobs/:id      │
│  Web Worker ── 本地转换 ─────┼───────▶│ /api/formats  /api/health        │
│   (TXT/MD/HTML → EPUB)      │        │        │                         │
│   ↑ 文件不出浏览器            │        │        ├─ JobStore (内存, 并发2)   │
└────────────────────────────┘        │        ├─ tmpdir/<jobId> (0600)    │
                                       │        └─ engine.convert(host)     │
                                       │                 │                  │
                                       │        buildin readers/writers     │
                                       │        (同构, 进程内)               │
                                       │                 │                  │
                                       │        calibre / pandoc / tesseract│
                                       │        (子进程, 可选)               │
                                       └──────────────────────────────────┘
```

## 为什么这样切

| 决策 | 理由 |
|---|---|
| 引擎同构，核心不碰 `node:*` | 「更绿色」的硬承诺是**文本格式零上传**：同一个 `lib/engine` 在 Worker 和服务器里跑，行为一致，测试一次覆盖两处。 |
| calibre 走 `EngineHost` 注入 | 让 `lib/engine/index.ts` 保持浏览器可打包；Node 适配器集中在 `lib/engine/node/`，缺失时降级为明确错误而不是崩溃。 |
| Job 而不是同步请求 | PDF/MOBI 转换可能几十秒；轮询 + 取消 + TTL 清理比长连接简单可靠，也方便限流。 |
| 临时目录，无数据库 | 隐私卖点：进程退出/任务过期即无痕。代价是单机任务不跨实例，README 里写清楚。 |
| 页面静态生成 | 格式对落地页是 SEO 主战场：`generateStaticParams` 预渲染 60+ 组合，首屏零 JS 依赖。 |

## 数据流（一次转换）

1. 用户在工作台选文件 → `lib/client` 判断 `canRunLocally(from, to)`。
2. 可本地：Worker 里 `convert()` → EPUB bytes → 直接触发下载（不经过网络）。
3. 不可本地：`POST /api/convert`（file, target, options）→ 校验/限流 → `JobStore.create` → 返回 `jobId`。
4. Worker 队列取任务：写临时文件 → `engine.convert` → 成功写结果 → 状态 `done`。
5. 前端轮询 `GET /api/jobs/:id` → 下载 → 取消/删除 → 10 分钟后清扫。

## 模块地图

```
lib/engine/
  types.ts       契约（Lead 冻结）
  formats.ts     格式/设备/能力矩阵（Lead 冻结）
  util.ts        编码、HTML、章节、sanitize
  model.ts       Book 构造与规范化
  readers/       epub mobi(calibre) pdf(calibre) txt md html docx fb2 comic image
  writers/       epub html txt
  node/          calibre pandoc ocr（动态 import）
  index.ts       convert / detectFormat / canRunLocally / engineStatus
lib/server/      jobs storage convert ratelimit errors
app/api/         convert jobs/[id] jobs/[id]/download formats health
app/             页面（zh 根路由，en 前缀）
components/      site / convert / ui
lib/i18n/        zh/en 词典与 t()
```

## 安全边界

- 上传：先按 Content-Length 拒绝，再按实际字节拒绝；`detectFormat` 同时看魔数与扩展名，不一致以魔数为准。
- 压缩包：条目数 ≤ 5000、解压总量 ≤ 1GB、单条目 ≤ 200MB、压缩比 > 200 直接拒绝（zip bomb）。
- 子进程：`spawn` 参数数组、不经过 shell；180s 超时；临时目录隔离；输出路径固定，避免路径穿越。
- 下载：jobId 必须是 UUID 且命中内存记录，磁盘路径二次 `resolve` 校验。
- 日志：只记 jobId/格式/耗时/错误码，不记文件名与内容。

## 降级矩阵

| 情况 | 行为 |
|---|---|
| calibre 未安装 | 所有 MOBI/AZW3/PDF/DOCX 目标返回 `ENGINE_MISSING`，UI 给安装命令；builtin 目标不受影响 |
| sharp 不可用 | 图片原样嵌入 EPUB，附 warning（不优化尺寸） |
| 浏览器不支持 Worker | 直接走服务器路径 |
| OCR 语言包缺失 | 退回英文 + warning，或明确拒绝 |
| 用户断网 | 本地模式仍可用（这是设计目标，不是意外） |
