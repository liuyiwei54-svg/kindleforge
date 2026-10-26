# KindleForge 设计规范（DESIGN）

> 版本 1.0 · 2026-10-27 · owner: design
> 配套文件：`app/globals.css`（Tailwind v4 令牌）、`styles/tokens.css`（运行时变量 + 组件类）、`docs/COPY.md`（文案）。
>
> 一句话：**深夜书房里的纸与墨，一点苔绿。** 不是 SaaS 蓝紫渐变，也不是电商大促。

---

## 1. 设计原则

1. **先像一本书，再像一个工具。** 大留白、稳定网格、宋体标题、克制颜色；信息密度靠排版解决，不靠装饰。
2. **一处只强调一件事。** 每屏最多一个 moss 主 CTA / 一个高亮数字；其余信息靠纸色层级（paper → paper-dim → paper-mute）。
3. **不假装。** 失败状态、缺失引擎、格式限制都直说；视觉上不用绿色假装成功，不用红色制造恐慌。
4. **为 e-ink 服务。** 不使用对墨水屏无意义的视觉噪音（大面积渐变、半透明玻璃、细微阴影）；对比、字重、留白优先。

---

## 2. 色彩

### 2.1 调色板

| 令牌 | 色值 | 用途 | 使用规则 |
|---|---|---|---|
| `ink-950` | `#070b09` | 画布、页面底 | 全站底色；`body` 已内置极淡的苔绿顶光 + 纸纹 |
| `ink-900` | `#0b100e` | 下沉面板、代码块 | 比画布更「深」而不是更亮 |
| `ink-800` | `#111815` | 卡片默认面 | `.kf-card` 背景 |
| `ink-700` | `#18211d` | 次级面、hover、轨道 | `.kf-btn-quiet`、进度轨道、`pre` 内嵌 |
| `ink-600` | `#243029` | 交互 hover 深阶、滚动条拇指 | 不要用于文字 |
| `ink-500` | `#33433a` | 滚动条 hover、极少边框 | 新增，谨慎 |
| `paper` | `#f4f0e6` | 标题、主要文字 | 正文不要全用 paper，用 paper-dim |
| `paper-dim` | `#d9d3c4` | 正文 | 全站正文默认（13.26:1） |
| `paper-mute` | `#9d9789` | 三级文字：说明、meta、占位说明 | 最小文字色；不要用在 < 12px 的正文上 |
| `paper-faint` | `#8a8578` | placeholder / disabled | **只**用于占位符、禁用态、图形标注 |
| `moss-500` | `#a8f06a` | 主强调：CTA、链接下划线、关键数字、进度 | 每屏一个主用途；正文里不做长段文字颜色 |
| `moss-400` | `#bff78d` | moss hover / 细高亮 | 按钮 hover |
| `moss-600` | `#86d94a` | moss active、进度的深端 | 按下态 |
| `moss-700` | `#6cbb38` | 装饰性数据线、深底上的图表 | 只在需要更暗的绿时 |
| `moss-800` | `#3f7a1f` | **浅底上的绿**（logo-light、打印） | 浅底不要用 moss-500（1.2:1） |
| `moss-900` | `#16240f` | 苔绿 tint 背景 | 极少，成功行的底色 |
| `clay` | `#e8a87c` | 暖点缀：需注意、非错误提醒、少量插画 | 一屏最多一处；不用于大段文字 |
| `ember` | `#fb7f6d` | 错误 | 错误文字、错误描边、错误进度；不用于装饰 |
| `line` | `paper 12%` | 装饰性 hairline | 卡片边、分隔线；**不能**作为输入框边界 |
| `line-strong` | `#666761` | 表单/交互边界 | 3.47:1 @ ink-950、3.16:1 @ ink-800（≥3:1） |
| `focus` | `#a8f06a` | 键盘焦点环 | 2px + 3px offset |

**语义别名**（新代码优先用）：`canvas` `surface` `surface-raised` `fg` `fg-muted` `fg-subtle` `accent` `on-accent` `warn` `danger` `line` `line-strong`。旧名（`ink-*` / `moss-*` / `paper*` / `clay`）已冻结，永远保留。

### 2.2 用色比例（经验值）

- 90% 墨与纸（ink-950/900/800 + paper 系）
- 8% 灰阶层级与细线
- 2% moss；clay/ember 合计 < 0.2%

### 2.3 对比度实测

方法：WCAG 2.2 相对亮度公式，`docs/DESIGN.md` 编写时用脚本逐对计算（sRGB，无透明度混合）。**所有正文组合 ≥ 4.5:1，正文默认组合 ≥ 7:1。**

| 前景 | 背景 | 对比度 | 等级 | 用途 |
|---|---|---|---|---|
| paper `#f4f0e6` | ink-950 | **17.39:1** | AAA | 标题 |
| paper | ink-900 | 16.86:1 | AAA | 标题（下沉） |
| paper | ink-800 | **15.84:1** | AAA | 卡片标题 |
| paper | ink-700 | 14.48:1 | AAA | hover 面标题 |
| paper-dim | ink-950 | **13.26:1** | AAA | 正文（页面） |
| paper-dim | ink-800 | **12.07:1** | AAA | 正文（卡片） |
| paper-mute | ink-950 | **6.81:1** | AA / AAA(大字) | 说明文字 |
| paper-mute | ink-800 | 6.20:1 | AA | 卡片说明 |
| paper-faint | ink-950 | 5.38:1 | AA | 占位符 |
| paper-faint | ink-800 | 4.90:1 | AA | 占位符（卡片内） |
| moss-500 | ink-950 | **14.46:1** | AAA | 链接、强调文字 |
| moss-500 | ink-800 | 13.16:1 | AAA | 卡片内强调 |
| ink-950（按钮字） | moss-500（按钮底） | **14.46:1** | AAA | 主 CTA |
| clay | ink-950 | 9.73:1 | AAA | 暖提醒 |
| ember | ink-950 | 7.88:1 | AAA | 错误文字 |
| ember | ink-800 | 7.17:1 | AAA | 卡片内错误 |
| moss-600 | ink-950 | 11.35:1 | AAA | 进度深端 |
| moss-800 | paper（浅底） | **4.60:1** | AA | 浅底 logo/绿字 |
| line-strong `#666761` | ink-950 | 3.47:1 | 非文本 ≥3:1 | 表单边界 |
| line-strong | ink-800 | 3.16:1 | 非文本 ≥3:1 | 卡片内表单边界 |
| focus `#a8f06a` | ink-950 / ink-800 | 14.46 / 13.16:1 | 非文本 ≥3:1 | 焦点环 |

**已知不达标组合（禁止）**：moss-500 on paper `1.20:1`；paper on moss-600 `1.53:1`；moss-600 on paper `1.53:1`；paper-faint on ink-700 `4.48:1`（差 0.02，不要在此组合用小字）。

**结论**：正文用 `text-paper-dim`；`text-paper-mute` 只能用于辅助信息；`text-paper-faint` 只用于占位符；任何浅底（打印、邮件、浅色导出）切换到 `logo-light` 与 `moss-800`。

---

## 3. 字体与字阶

### 3.1 字体栈（不下载 webfont，不走 CDN）

| 令牌 | 栈 | 用途 |
|---|---|---|
| `font-serif` | Source Han Serif SC → Noto Serif SC → Songti SC → STSong → SimSun → Georgia | 中文标题、`.kf-prose` 标题、大数字 |
| `font-sans` | Inter → system-ui → PingFang SC → Noto Sans SC | 正文、按钮、表单 |
| `font-mono` | SF Mono → JetBrains Mono → Menlo → Consolas | 数字、代码、eyebrow、错误码、大小 |

**规则**
- 标题（h1–h4）默认宋体；需要现代感时用 `font-sans` 覆盖，但一页内不要混两种标题风格。
- 正文 1.7+ 行高；`.kf-prose` 1.78；标题 1.04–1.45（越大越紧）。
- 标题 `letter-spacing` 收紧：display -0.032em → h4 -0.006em。
- 中文段落**不用** `letter-spacing` 加宽；英文小标题可用 mono 的 0.22em（`.kf-eyebrow`）。
- 数字一律 `font-variant-numeric: tabular-nums`（`.kf-metric-value` 已内置）。
- 中英混排：英文两侧留半角空格；代码/格式名用 `font-mono` 小一号。

### 3.2 字阶表

| 令牌 / 类 | 字号 | 行高 | 字距 | 字重 | 用途 |
|---|---|---|---|---|---|
| `text-display` | clamp(2.6rem → 4.75rem) | 1.04 | -0.032em | 600 | 首屏 H1（每页最多一次） |
| `text-h1` | clamp(2.1rem → 3.25rem) | 1.12 | -0.026em | 600 | 页面 H1（格式页、文档） |
| `text-h2` | clamp(1.6rem → 2.25rem) | 1.20 | -0.020em | 600 | 区块标题 |
| `text-h3` | 1.375rem | 1.35 | -0.012em | 600 | 卡片组标题 |
| `text-h4` | 1.125rem | 1.45 | -0.006em | 600 | 小标题、FAQ 问句 |
| `text-body-lg` | 1.125rem | 1.75 | 0 | 400 | Hero 副标题、导语 |
| `text-body` | 1rem | 1.75 | 0 | 400 | 正文默认 |
| `text-small` | 0.875rem | 1.60 | 0.002em | 400 | 说明、表单 hint |
| `text-caption` | 0.75rem | 1.55 | 0.01em | 400 | 图注、元信息 |
| `text-mono` | 0.875rem | 1.60 | 0 | 400 | 代码、数字、错误码 |

断点无关：全部用 `clamp()`，390px 不溢出，1440px 不散架。

### 3.3 阅读宽度

- 正文与 FAQ：`max-width: 68ch`（`.kf-measure` / `container-prose`）。
- 长文（`.kf-prose`）默认占满容器，但外层应是 1 列 + 68ch 上限，不要双栏长文。
- 标题可以比正文宽，但不要超过 24 个中文字符一行。

---

## 4. 间距、栅格与断点

### 4.1 间距刻度

基础单位 **4px**；主用 8 的倍数。

| 值 | 用途 |
|---|---|
| 4px | 图标与文字、徽章内边距 |
| 8px | 紧凑元素间距 |
| 12px | 表单内、卡片内小间距 |
| 16px | 卡片内段落、移动端 gutter |
| 24px | 卡片 padding（移动端 clamp 下限）、栅格 gap |
| 32px | 卡片 padding（桌面）、组间距 |
| 48px | 区块内大分隔 |
| 64px | 区块间距下限 |
| 96–120px | 区块间距（桌面，`--spacing-section` = clamp(4rem, 9vw, 7.5rem)） |

命名令牌（可直接生成 Tailwind 工具类）：

| 令牌 | 值 | 类 |
|---|---|---|
| `--spacing-gutter` | clamp(1.25rem, 4vw, 2.5rem) | `p-gutter` / `gap-gutter` / `px-gutter` |
| `--spacing-section` | clamp(4rem, 9vw, 7.5rem) | `py-section` |
| `--spacing-card` | 1.75rem | `p-card` |
| `--spacing` | 0.25rem（基础单位） | 所有数字间距 `p-4` = 16px |

### 4.2 容器与栅格

| 令牌 | 值 | 用途 |
|---|---|---|
| `--kf-page-max` / `container-page` | 76rem（1216px） | 常规页面 |
| `container-wide` | 88rem（1408px） | 格式矩阵、对比表 |
| `container-prose` | 68ch | 阅读列 |
| `--kf-gutter` | clamp(1.25rem, 4vw, 2.5rem) | 左右留白 |
| `--kf-header-h` | 4.5rem | 吸顶导航高度；锚点偏移用 |

- 桌面 12 列、gap 24px；常用非对称 **7/5** 或 **8/4**（左文右图）。
- 移动端单列，卡片全宽，gutter 20px。
- 首屏允许 `100dvh`，但不要 `100vh`（移动端地址栏）。
- 网格背景只用于极少数区块（`bg-grid`，1px 5% paper），不要整页铺。

### 4.3 断点（Tailwind 默认）

| 名称 | 宽度 | 行为 |
|---|---|---|
| base | < 640 | 单列，H1 用 clamp 下限，按钮全宽 |
| `sm` | 640 | 两列卡片（仅图标/短文案） |
| `md` | 768 | 表单两列，表格开始显示 |
| `lg` | 1024 | 7/5 栅格，导航展开 |
| `xl` | 1280 | 容器达到 76rem |
| `2xl` | 1536 | 只增加留白，不增加内容密度 |

移动端最低验证宽度：**390px**（iPhone 12/13/14 逻辑宽度）。表格在 < 768px 改为卡片或横向滚动，不缩字。

---

## 5. 形状、描边与阴影

| 令牌 | 值 | 用途 |
|---|---|---|
| `rounded-field` | 12px | 输入框、代码块、图片 |
| `rounded-card` | 20px | 卡片（唯一卡片圆角） |
| `rounded-sheet` | 28px | 弹层、抽屉、大面板 |
| `rounded-frame` | 32px | 首屏设备外框、特殊展示块 |
| `rounded-pill` | 999px | 按钮、chip、badge、进度条 |
| 描边 | 1px `paper 12%` | 卡片、分隔线 |
| 描边（强） | 1px `#666761` | 输入框、可选中的控件 |
| `shadow-soft` | `0 1px 0 paper/3.5% inset, 0 10px 30px -22px #000/90%` | 卡片默认 |
| `shadow-lift` | `0 24px 60px -32px #000/95%` + inset 高光 | hover 卡片、弹层 |
| `shadow-moss` | `0 10px 34px -18px moss/50%` | 主 CTA |
| `shadow-halo` | `0 0 0 3px moss/20%` | 输入 focus |

**规则**
- 阴影只用来表达层级，不用来装饰；同一屏不超过 2 种阴影。
- 禁止玻璃拟态（backdrop-filter）、禁止彩色弥散大阴影、禁止 > 32px 的模糊装饰。
- 卡片 hover 上移 2px（`.kf-card-interactive`），不使用缩放。
- 分割优先用 1px 线，不用阴影或色块。

---

## 6. 组件状态

### 6.1 按钮 `.kf-btn`

| 状态 | 视觉 |
|---|---|
| default（次级） | 透明底、1px `line` 描边、paper 字 |
| hover | 底 `paper 7%`、描边 `paper 28%` |
| active | 下移 1px |
| focus-visible | 全局 2px moss 环 + 3px offset |
| disabled | 透明度 45%、`not-allowed`、无位移 |
| loading | `aria-busy="true"` + `.kf-spinner`，保持宽度不跳动 |
| 主 CTA `.kf-btn-primary` | moss-500 底 + ink-950 字 + moss 光晕；hover moss-400；active moss-600 |
| danger `.kf-btn-danger` | ember 字 + ember/38% 描边；hover ember/12% 底 |

- 最小点击区 **44×44px**（`min-block-size: 2.75rem`）；`.kf-btn-sm` 为 34px，只能用于表格/密集工具栏，且需满足 44px 的触控目标例外（周围留白补足）。
- 一屏只允许一个 `.kf-btn-primary`。
- 图标按钮必须 `aria-label`；图标 16–20px，不单独承担语义。

### 6.2 卡片 `.kf-card`

默认 / `-quiet`（无底色无阴影）/ `-raised`（ink-700 + lift）/ `-accent`（moss 描边 + 角部光晕）/ `-interactive`（可点，hover 抬升）/ `-flush`（无 padding）。

### 6.3 输入 `.kf-input`

| 状态 | 视觉 |
|---|---|
| default | ink-900/82% 底、1px `#666761`、12px 圆角 |
| hover | 描边 paper 46% |
| focus-visible | moss 描边 + 3px moss/20% halo，移除原生 outline |
| invalid | ember 描边 + ember/12% halo + `.kf-error` 文案 |
| disabled | 50% 透明、`not-allowed` |

- label 永远可见（`.kf-label`），不要用 placeholder 代替 label。
- 帮助文字 `.kf-hint` 在控件下方；错误 `.kf-error` 使用 `role="alert"`。
- 数字输入保持 mono，便于对齐。

### 6.4 Chip / Badge

- `.kf-chip`：可选中（`aria-pressed`，激活变 moss/12% 底 + moss-400 字）或纯标签（`span`）。
- `.kf-badge`：mono 11px、大写、0.08em 字距；`-moss`（本地/推荐）、`-clay`（注意）、`-danger`（错误）、`-solid`（中性计数）。

### 6.5 进度

- `.kf-progress` 6px 高，轨道 ink-700；填充 moss-600→moss-400 渐变。
- 不可预估时 `data-state="indeterminate"`（38% 宽 + sweep 1.5s）；错误 `data-state="error"` 变 ember。
- 进度必须配文字与 `aria-live="polite"`，不能只给一条动画。
- 不用循环 loading 遮罩盖住内容；按钮原地显示 spinner。

### 6.6 链接与焦点

- 正文链接：paper 字 + moss/45% 下划线，hover 下划线变实 moss；下划线 offset 0.22em。
- 键盘焦点统一 `:focus-visible`：2px moss + 3px offset；**不要**删除 outline，除非用 `.kf-input` 的 halo 替代。
- 焦点顺序 = DOM 顺序；弹层打开时焦点进入弹层，Esc 关闭并归还焦点。

---

## 7. 动效

| 令牌 | 值 | 用途 |
|---|---|---|
| `--kf-dur-fast` | 120ms | 颜色、描边、opacity 的微交互 |
| `--kf-dur` | 160ms | 按钮/卡片/输入 hover、默认 transition |
| `--kf-dur-slow` | 200ms | 入场、进度变化（上限） |
| `--ease-kf` | `cubic-bezier(.2,.7,.2,1)` | 默认：快出慢入，克制 |
| `--ease-out-soft` | `cubic-bezier(.16,1,.3,1)` | 大面板入场（仍 ≤ 200ms） |

**允许**：opacity、transform（translate ≤ 8px / scale ≥ 0.985）、color、background-color、border-color、box-shadow、进度条的 width。
**禁止**：高度/宽度过渡（布局抖动）、视差滚动、自动播放视频、无限旋转的装饰元素、弹跳曲线。

- 入场：`.animate-fade-up`（200ms，位移 10px），同组元素可用 40ms 阶梯延迟，最多 5 个。
- 骨架屏：1.6s shimmer（环境动画，不属于交互动效）；进度 indeterminate 1.5s。
- `prefers-reduced-motion: reduce`：全局动画/过渡 0.001ms，hover 位移取消，滚动不平滑。已写在 `globals.css`，组件不要绕开。
- 不做自动轮播；不做「数字滚动」特效。

---

## 8. 图标

- 统一 **24×24 网格、1.5px stroke、圆头圆角、currentColor、无填充**（`kf-spark` 例外，为实心品牌符号）。
- 尺寸：16px（行内）、20px（按钮内）、24px（导航/卡片）、32px+（插画式强调）。
- 颜色：默认 `text-paper-mute`；激活/强调 `text-moss-500`；危险 `text-ember`。同一区域不要混用 2 种颜色。
- 图标与文字间距 8px；图标不参与 baseline 对齐问题（用 flex + `flex: none`）。
- 图标按钮：必须有 `aria-label`；hover 底色 `paper/6%`；不单独用颜色表达状态。

**优先用 lucide-react**（已安装），不要重复造：

| 语义 | lucide 组件 | 品牌 sprite 备用 |
|---|---|---|
| 上传 | `Upload` | `#kf-upload` |
| 批量 | `Files` / `Layers` | `#kf-batch` |
| 漫画 / 右到左 | `BookOpen` + `ArrowLeft` | `#kf-manga` |
| OCR / 扫描 | `ScanText` | `#kf-ocr` |
| 本地转换 | `Laptop` / `MonitorCheck` | `#kf-local` |
| 绿色 / 隐私 | `Leaf` / `ShieldCheck` | `#kf-leaf` / `#kf-shield` |
| 设备 | `Tablet` | `#kf-device` |
| ZIP | `FolderArchive` | `#kf-zip` |
| API | `Braces` | `#kf-api` |
| 成功 / 失败 | `Check` / `CircleAlert` | — |

sprite 用法（需要非 React 场景时）：

```html
<svg class="size-6" aria-hidden="true">
  <use href="/illustrations/icons.svg#kf-ocr" />
</svg>
```

---

## 9. 图形与图片

### 9.1 原则

- **只用 SVG / CSS**，仓库不放位图主视觉（PNG/JPG/WebP），保证可缩放与仓库轻量。
- 图形语言 = **细线几何 + 纸张纹理**；线宽 1.5（插画 1.5–1.6），端点圆角。
- 不做 3D 渲染、设备实拍、霓虹光效、stock 图、emoji 大图。
- 插画内**不放需要翻译的文案**（设备屏幕上的示例标题除外），文案由 HTML 负责。
- 图形不承担唯一信息：旁边必须有文字说明。

### 9.2 现有资产

| 文件 | 尺寸 | 用途 | 背景 |
|---|---|---|---|
| `public/brand/logo.svg` | 228×64 | 深底横向 logo | 深 |
| `public/brand/logo-mark.svg` | 32×32 | 仅图形，`currentColor` | 任意（可染色） |
| `public/brand/logo-light.svg` | 228×64 | 浅底横向 logo | 浅 |
| `public/brand/favicon.svg` | 64×64 | 浏览器图标（需在 metadata 挂 link） | 任意 |
| `public/brand/og.svg` | 1200×630 | 社交分享（**需转 PNG 上线**，见 §12.3） | 深 |
| `public/illustrations/kindle-paperwhite.svg` | 360×460 | 首屏/排版区设备线稿 | 深 |
| `public/illustrations/empty-no-files.svg` | 260×190 | 空状态 | 深 |
| `public/illustrations/green-zero-upload.svg` | 360×220 | 绿色/零上传区 | 深 |
| `public/illustrations/icons.svg` | sprite 24×24 | 品牌小图标 | 任意 |

**插画换色**：文件内已设 `color="#f4f0e6"` 并让描边用 `currentColor`。浅底时直接给 `<svg style="color:#18211d">` 或 class `text-ink-700`；强调线条固定为 moss/clay，不跟随换色。

### 9.3 Logo 使用

- 最小尺寸：横向 logo 高度 ≥ 24px；图形 ≥ 20px；favicon 用 16px 仍可识别（K + 火花）。
- 安全空间：四周至少留 logo 高度的 0.5 倍；不要在图形与字标之间插入其他元素。
- 深底用 `logo.svg`，浅底用 `logo-light.svg`，不要用 CSS filter 强行反色。
- 不拉伸、不旋转、不加描边/投影/渐变、不改变「Kindle」「Forge」两段配色关系（Forge 永远是绿）。
- 图形可单独用于头像/分享图标；字标不可单独拉伸使用。
- OG：社交平台不渲染 SVG，上线前必须转 PNG（命令见 §12.3）；CJK 文字需要生成环境安装中文字体。

### 9.4 纸纹与氛围

- 纸纹是 CSS（`--kf-grain` data URI + `bg-grain`），不是图片。
- 全站 body 已有一次纸纹 + 顶部极淡苔绿光；区块内不要再叠第二层纸纹，避免脏。
- `bg-grid` / `bg-vignette` / `bg-moss-wash` 只做局部气氛，单屏最多一种。
- 不用 `backdrop-filter`、不用大面积半透明叠加。

---

## 10. 无障碍

目标：**WCAG 2.2 AA**（正文尽量 AAA）。

| 项 | 规范 | 实测 |
|---|---|---|
| 正文对比 | ≥ 4.5:1，默认 ≥ 7:1 | 13.26:1（paper-dim/ink-950） |
| 大字对比 | ≥ 3:1 | 14.46:1（moss/ink-950） |
| 非文本边界 | ≥ 3:1 | 3.47:1（line-strong/ink-950） |
| 焦点可见 | 2px moss + 3px offset | 14.46:1 |
| 点击目标 | ≥ 44×44px（按钮默认满足） | `.kf-btn` 44px |
| 键盘 | 全流程可完成：上传 → 转换 → 下载 | 需 QA 覆盖 |
| 动效 | 尊重 `prefers-reduced-motion` | 全局禁用 |
| 结构 | `header/nav/main/footer` + 单一 h1 + 顺序 h2/h3 | 需 QA 覆盖 |
| 表单 | label 可见并关联，错误 `role="alert"`，hint `aria-describedby` | — |
| 语言 | `<html lang="zh-CN">`；英文页 `<html lang="en">` | layout 负责 |
| 跳转 | `.kf-skip-link` 到 `#main` | 已提供 |
| 图片 | 装饰性 `aria-hidden`；信息性给 `alt`；SVG `<title>` 已内置 | — |
| 状态播报 | 进度/结果 `aria-live="polite"`；错误 `role="alert"` | 前端接入 |

**禁止**：用颜色单独表达状态（成功/错误必须配文字或图标）；`outline: none` 而不给替代；placeholder 当 label；小于 12px 的正文；正文行宽超过 80ch。

---

## 11. 反例（Do / Don't）

| Do | Don't |
|---|---|
| 一屏一个 moss 主操作 | 每个按钮都绿 |
| 卡片 20px 圆角 + 1px 12% 描边 | 大渐变、玻璃拟态、彩色发光阴影 |
| 大字宋体 + 1.7 行高 | 标题用 Inter 加粗 900 |
| 大留白、稳定 12 列 | 卡片瀑布流、随意错位 |
| 插画细线 + 纸纹 | 3D 设备渲染图、stock 照片 |
| 失败直说「缺引擎，装什么」 | 「转换失败，请重试」 |
| 数字来自 formats.ts | 「支持任何格式」「100% 无损」 |
| 少量 clay 点缀 | clay 当第二种主色 |
| 动效 160ms 完成反馈 | 弹跳、视差、无限旋转 |
| 浅底切 `logo-light` / `moss-800` | 浅底硬用 moss-500 |

---

## 12. 实现说明

### 12.1 令牌与类

- 颜色/字阶/圆角/阴影/动效定义在 `app/globals.css` 的 `@theme static`；运行时别名与组件类在 `styles/tokens.css`。
- `@theme static` 为有意选择：设计系统需要全量变量（含 `text-display` 等未被使用的字阶），避免 frontend 首次使用时变量缺失。
- 组件类在 `@layer components`，**utilities 永远可以覆盖**：`<button class="kf-btn bg-ink-700">` 有效。
- 新增颜色 → 先进 `@theme` 并同步语义别名与本文档；新增组件状态 → 先写成修饰类，不改基础类。
- 组件里禁止硬编码十六进制；用令牌或语义别名。确需一次性颜色时，写进 `@theme` 再引用。

### 12.2 Tailwind 用法示例

```tsx
<main id="main" className="kf-container kf-section">
  <p className="kf-eyebrow">Local-first</p>
  <h1 className="mt-4 max-w-[18ch] text-display font-serif text-balance text-paper">
    把任何文件，变成 Kindle 上最好读的那本书。
  </h1>
  <p className="kf-measure mt-5 text-body-lg text-paper-dim">
    TXT / Markdown / HTML 在浏览器里完成，文件不上传。
  </p>

  <div className="mt-10 grid gap-6 md:grid-cols-2">
    <article className="kf-card kf-card-interactive">…</article>
    <article className="kf-card kf-card-quiet">…</article>
  </div>

  <button className="kf-btn kf-btn-primary kf-btn-lg mt-8">
    <span className="kf-spinner hidden" aria-hidden="true" />
    开始转换
  </button>
</main>
```

- 用 `size-*` 控制图标；用 `gap-*` 控制间距；不要在组件里写 `style={{ color: '#...' }}`。
- 进度条宽度是唯一允许的内联 `style`（`style={{ width: `${pct}%` }}`）。

### 12.3 上线前必须做的两件事

1. **Favicon**：在 layout metadata 增加 `icons: { icon: '/brand/favicon.svg' }`（或 `<link rel="icon">`）。谁负责 layout 谁加；design 不改页面文件。
2. **OG PNG**：社交平台不渲染 SVG。上线前用仓库已有的 sharp 生成位图（仅生成物进部署，不提交仓库）：

```bash
node -e "require('sharp')('public/brand/og.svg',{density:220}).resize(1200,630).png().toFile('public/brand/og.png')"
```

   - 生成环境需安装中文字体（macOS 自带 Songti；Linux CI 需 `fonts-noto-cjk`），否则中文会变方框。
   - 生成后在 layout 的 `openGraph.images` 指向 `/brand/og.png`。
   - `public/brand/og.svg` 保留为源文件。

### 12.4 浏览器支持

- 需要 `color-mix(in srgb, …)`：Chrome 111+、Safari 16.2+、Firefox 113+。更老的浏览器会丢失部分 tint（线条/底色），不影响文字对比。
- `text-wrap: balance/pretty` 是渐进增强，不支持时退化为普通换行。
- `scrollbar-color` 在 Chromium 121+ 生效，其余使用 `::-webkit-scrollbar` 或系统样式。

---

## 13. 交付与验收清单

- [x] `app/globals.css` 被 `next dev` 编译（已 curl 3100 的 `layout.css` 验证，42 KB，包含全部令牌与组件类）。
- [x] SVG 全部通过 `xmllint --noout`；用 sharp 渲染检查深/浅底可读性。
- [x] 字阶、间距、圆角、阴影、动效均有令牌；组件类不硬编码颜色。
- [x] 对比度实测表（§2.3）覆盖所有正文/按钮/错误/焦点组合。
- [x] 1440 / 390 视觉走查：临时预览页 + headless Chrome 渲染卡片、按钮、表单、进度、prose、浅底 logo（临时文件已删除，不入库）。
- [x] `prefers-reduced-motion`、`prefers-contrast: more`、`print` 三种媒体查询。
- [ ] 前端接入后复查：390 / 768 / 1440 三档、键盘全流程、Lighthouse a11y ≥ 95。
- [ ] 上线前：favicon link + OG PNG（§12.3）。
