# 许可证与分发义务（LICENSES）

> 生成方式：`npx pnpm licenses list --prod --json` / `--dev --json`（pnpm 12.15.0，锁文件 `pnpm-lock.yaml`），
> 加上对 `lib/engine/node/*` 的外部程序调用点、`Dockerfile` / `Dockerfile.full` 的人工核对。
> 审核时间：2026-10-27。依赖版本变化后请重跑命令并更新本表。

**结论先行**
- 本项目**代码**为 MIT（见 `LICENSE`）。
- 运行时代码依赖**没有 GPL/AGPL**；唯一 copyleft 是 `@img/sharp-libvips-*`（**LGPL-3.0-or-later**，动态加载的 libvips 共享库）与双许可的 `jszip`（MIT **或** GPL-3.0-or-later，本项目按 MIT 使用）。
- **Calibre（GPL-3）、Pandoc（GPL-2+）、Tesseract（Apache-2.0）、Poppler（GPL-2.0/3.0）都是“外部可选程序”，通过子进程调用，不随本仓库/本 npm 包分发**。但 `Dockerfile.full` **会**把它们装进镜像 → 那一层镜像的分发义务见 §3。

---

## 1. 运行时代码依赖（随应用分发 / 打进 `next build` standalone 与 Docker 镜像）

生产依赖共 **58** 个包（含传递依赖）。按许可证分组：

| 许可证 | 数量 | 包 |
|---|---|---|
| MIT | 38 | `next`, `react`, `react-dom`, `scheduler`, `styled-jsx`, `client-only`, `zod`, `clsx`, `he`, `nanoid`, `fast-xml-parser`（+`fast-xml-builder`, `strnum`, `xmlbuilder`, `@xmldom/xmldom`, `@nodable/entities`, `xml-naming`, `path-expression-matcher`, `anynum`, `is-unsafe`）, `node-unrar-js`, `postcss`, `argparse`, `underscore`, `lie`, `immediate`, `isarray`, `readable-stream`, `safe-buffer`, `string_decoder`, `util-deprecate`, `core-util-is`, `process-nextick-args`, `setimmediate`, `base64-js`, `@img/colour`, `@next/env`, `@next/swc-darwin-arm64` |
| Apache-2.0 | 4 | `sharp`, `@img/sharp-darwin-arm64`, `@swc/helpers`, `detect-libc` |
| BSD-2-Clause | 4 | `mammoth`, `dingbat-to-unicode`, `lop`, `option` |
| BSD-3-Clause | 2 | `source-map-js`, `sprintf-js` |
| BSD | 1 | `duck` |
| ISC | 4 | `lucide-react`, `inherits`, `picocolors`, `semver` |
| 0BSD | 1 | `tslib` |
| MIT AND Zlib | 1 | `pako`（JSZip 的依赖；两个许可证同时满足即可） |
| MIT **OR** GPL-3.0-or-later | 1 | `jszip` —— **本项目选择 MIT**，因此不触发 GPL 义务 |
| **LGPL-3.0-or-later** | 1 | **`@img/sharp-libvips-darwin-arm64`**（预编译 libvips 共享库） |
| CC-BY-4.0 | 1 | `caniuse-lite`（浏览器数据，构建期使用） |

### 需要额外留意的三个

1. **`@img/sharp-libvips-*`（LGPL-3.0-or-later）**
   - 以**动态库**形式随 `sharp` 分发（`node_modules/.pnpm/@img+sharp-libvips-*/.../*.dylib` / `*.so`）。
   - LGPL-3 义务：① 随分发提供该库的许可证文本与版权声明；② 允许最终用户替换该库（动态加载本身满足「可替换」，但**不要**把它静态链接或改写后闭源分发）。
   - 本项目里 `sharp` 是**可选**的：`lib/engine/readers/image.ts:33-39` 动态 `optionalImport('sharp')`，缺失时退回纯 JS 路径（只是不做尺寸优化）。若发行方想彻底避开 LGPL，可在构建镜像时排除 `@img/sharp-*` / `sharp`（功能降级，需在 README 注明）。
   - 本项目未修改该库源码，只做动态加载。
2. **`node-unrar-js`（MIT，但内含 UnRAR 源码的 WASM）**
   - npm 包许可证是 MIT；其内嵌的 UnRAR 代码带 Alexander Roshal 的 **UnRAR 许可证**：允许自由使用/复制/分发（含商业），但**禁止用其逆向 RAR 压缩算法或开发 RAR 压缩器**。
   - 本项目只用它**解包 CBR**（`lib/engine/readers/cbr.ts:45-47`），符合该许可证的用途。
3. **`caniuse-lite`（CC-BY-4.0）**：数据文件，若分发 `node_modules` 需保留其 LICENSE/署名；`next build` 产物不含它（构建期依赖），风险低。

---

## 2. 构建 / 测试工具（devDependencies，不进入运行时产物）

共 **98** 个包，主要是 MIT；需要点名的：

| 许可证 | 包 | 说明 |
|---|---|---|
| Apache-2.0 | `typescript`, `puppeteer-core`, `@puppeteer/browsers`, `chromium-bidi`, `expect-type`, `webdriver-bidi-protocol`, `detect-libc` | 仅开发/测试期 |
| **MPL-2.0** | `lightningcss`, `lightningcss-darwin-arm64`（Tailwind v4 的 CSS 引擎） | **文件级 copyleft**：修改其源文件才需开源那些文件；本项目未修改，仅作为构建依赖调用 → 无分发义务（产物里是编译后的 CSS） |
| BSD-3-Clause | `devtools-protocol`, `source-map-js` | — |
| ISC | `cliui`, `get-caller-file`, `graceful-fs`, `picocolors`, `siginfo`, `y18n`, `yargs-parser` | — |
| MIT | 其余 73 个（`vitest`, `vite`, `rollup`, `esbuild`, `tailwindcss`, `@tailwindcss/*`, `tsx`, `yargs`, `chai`, …） | — |

> `puppeteer-core` **不下载** Chrome（用系统 Chrome），所以没有 Chromium 二进制分发问题。

---

## 3. 外部可选程序（子进程调用；**不随本仓库分发**）

| 程序 | 许可证 | 在项目中的角色 | 调用点 |
|---|---|---|---|
| **Calibre** `ebook-convert` | **GPL-3.0** | MOBI / AZW3 / PDF / DOCX 目标，PDF/ODT/RTF 输入 | `lib/engine/node/calibre.ts:46-59`（找二进制）、`:134-167`（`spawn`，参数数组，无 shell） |
| **Pandoc** | **GPL-2.0-or-later** | 可选备用解析（本机未安装） | `lib/engine/node/pandoc.ts:42`、`:90-103` |
| **Tesseract** | **Apache-2.0** | 扫描 PDF / 图片 OCR | `lib/engine/node/ocr.ts:39-43`、`:58-83` |
| **Poppler** `pdftoppm` | **GPL-2.0 / GPL-3.0**（按发行版） | 扫描 PDF 先渲染成 PNG 再做 OCR | `lib/engine/node/ocr.ts:45-49`、`:121-140` |
| 语言包 `tessdata`（chi_sim/eng/…） | Apache-2.0（Tesseract 官方）/ 各语言包自带 | OCR 语言数据 | `ocr.ts:104-121` |
| 字体 `fonts-noto-cjk`（仅 full 镜像） | **SIL OFL-1.1** | 让 Calibre 在容器里排中文 | `Dockerfile.full` |

**分发义务的边界**
- 源码仓库与 npm 包**只调用**这些程序，不复制它们的代码 → 本仓库以 MIT 分发没有冲突（GPL 程序的「聚合」不传染）。
- **`Dockerfile.full` 会把 Calibre / Pandoc / Tesseract / Poppler 装进镜像并对外分发**。这属于「分发 GPL 二进制」，义务是：提供对应源码/获取方式、保留许可证与版权声明、不额外限制用户对这些 GPL 组件的权利。Debian 包本身已在镜像内保留 `/usr/share/doc/<pkg>/copyright`，但**对外发布镜像前建议**在仓库里放一个 `THIRD-PARTY-NOTICES`（或在镜像 `/usr/share/doc/kindleforge/` 放一份），列明 Calibre(GPL-3)/Pandoc(GPL-2+)/Poppler(GPL)/Tesseract(Apache-2.0) 与 Noto CJK(OFL) 并给出源码链接。
- **`Dockerfile`（slim）不含上述任何 GPL 程序**，只有 Node 运行时 + MIT/Apache 依赖 → 分发负担最小。
- **静态构建**（`next build` 的 `.next/standalone`）包含 §1 的 node_modules，因此包含 LGPL 的 libvips —— 见 §1.1。

---

## 4. 复现命令

```bash
# 生产依赖的许可证（推荐给发布流程）
npx pnpm licenses list --prod

# 精确到包 + 版本（JSON）
npx pnpm licenses list --prod --json > /tmp/licenses-prod.json
npx pnpm licenses list --dev  --json > /tmp/licenses-dev.json

# 外部程序的实际版本（本机）
/Applications/calibre.app/Contents/MacOS/ebook-convert --version
tesseract --version | head -1
pdftoppm -v 2>&1 | head -1
pandoc --version | head -1   # 未安装时忽略

# 确认运行时没有 GPL 依赖（应无输出）
node -e "const d=require('/tmp/licenses-prod.json'); for (const [l,p] of Object.entries(d)) if (/GPL/i.test(l)) console.log(l, p.map(x=>x.name).join(','))"
```

## 5. 待办（给 Lead 收口）

1. README 的「可选引擎」表格里补一行 **Poppler**（OCR 的 PDF 渲染需要 `pdftoppm`，缺它 OCR 直接 `ENGINE_MISSING`）；`docker-compose.yml` 的注释也应提到 full 镜像包含 Poppler。
2. 若要发布 `kindleforge:full` 镜像，加 `THIRD-PARTY-NOTICES`（条目见 §3）。
3. 若希望 slim 发行版完全不含 LGPL，评估把 `sharp` 降级为「仅文档推荐、默认不装」。
