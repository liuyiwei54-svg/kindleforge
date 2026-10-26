# Third-party notices

KindleForge's own code is **MIT** (see [LICENSE](LICENSE)). It stands on a lot of
other people's work; this file is the short, honest inventory. It is not legal
advice — if you redistribute a built image, read the license texts in
[`docs/LICENSES.md`](docs/LICENSES.md) and keep the required notices.

## 1. Runtime npm dependencies (bundled into the app)

| License | Packages (selected) |
|---|---|
| MIT | `next`, `react`, `react-dom`, `clsx`, `fast-xml-parser`, `he`, `node-unrar-js`, `zod`, `@xmldom/xmldom`, `argparse` |
| ISC | `lucide-react`, `semver` |
| BSD-2-Clause | `mammoth`, `dingbat-to-unicode`, `lop`, `option` |
| BSD-3-Clause | `source-map-js`, `sprintf-js` |
| (MIT OR GPL-3.0-or-later) | `jszip` — used under the **MIT** option |
| (MIT AND Zlib) | `pako` |
| Apache-2.0 | `sharp`, `@swc/helpers`, `detect-libc` |
| LGPL-3.0-or-later | `@img/sharp-libvips-*` (libvips prebuilt binaries) |
| CC-BY-4.0 | `caniuse-lite` (data only) |

`sharp` loads libvips as a shared library. If you ship a compiled bundle that
contains `@img/sharp-libvips-*`, the LGPL-3.0 requires you to (a) include the
license text and notices, and (b) let recipients replace/relink that library.
Keeping `sharp` and its `@img/*` packages in `node_modules` (as the Docker images
do) satisfies the "replaceable library" intent; static-linking or single-binary
packaging would need extra work.

JSZip is dual-licensed; this project uses it under MIT.

## 2. Optional external engines (invoked as separate processes)

These are **not** distributed with the source tree or the slim image. They are
optional runtime dependencies detected at start-up; when missing, the UI shows
`ENGINE_MISSING` with install instructions.

| Engine | License | Used for |
|---|---|---|
| [Calibre](https://calibre-ebook.com/) `ebook-convert` | GPL-3.0 | MOBI / AZW3 / PDF / DOCX targets; PDF, ODT, RTF inputs |
| [Pandoc](https://pandoc.org/) | GPL-2.0-or-later | optional fallback reader |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | Apache-2.0 | scanned-PDF / image OCR |
| [Poppler](https://poppler.freedesktop.org/) `pdftoppm` | GPL-2.0 / GPL-3.0 | renders PDF pages for OCR |
| [Noto CJK fonts](https://github.com/notofonts/noto-cjk) | SIL OFL-1.1 | CJK rendering inside the full image |

Because Calibre/Pandoc/Poppler are GPL, **`Dockerfile.full` (the `full` compose
profile) is a GPL-covered aggregate**: if you distribute that image you must
provide the corresponding source (or a written offer) for the GPL components
alongside the image. The slim image does not include them and stays MIT +
LGPL(libvips) only.

## 3. Fonts and assets in this repository

- All SVG brand assets, illustrations, CSS and copy in `public/**`, `design/**`,
  `docs/COPY.md` were produced for this project and are MIT with the code.
- No web fonts are downloaded at runtime; the UI uses the system font stack
  (PingFang SC / Songti SC / Noto / Georgia fallbacks). Nothing is sent to a
  third-party font CDN.

## 4. Sample files used in tests

`tests/fixtures/pride.epub` is *Pride and Prejudice* from Project Gutenberg
(public domain). The Chinese TXT, DOCX, CBZ, CBR and scanned PDF fixtures are
synthetic, generated for these tests.

## 5. Regenerating this inventory

```bash
pnpm licenses list --prod --json   # npm side
npx tsx scripts/doctor.ts          # which external engines this machine has
```

`docs/LICENSES.md` carries the longer per-package table and the distribution
checklist produced during the independent audit.
