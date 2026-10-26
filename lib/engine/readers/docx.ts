/**
 * DOCX reader.
 *
 * mammoth does the heavy lifting (it is the only sane way to turn WordprocessingML
 * into readable HTML). We import it lazily so the browser bundle never pulls the
 * Node build in; DOCX is a server-side path in the capability matrix.
 */

import type { Book } from '../types';
import { ConversionError } from '../types';
import type { Reader } from './types';
import { addChapter, createBook, guessTitleFromFilename, normalizeBook } from '../model';
import { htmlChapters, imageSinkFor } from './html';
import { htmlToText, mediaTypeFromBytes, sanitizeHtml } from '../util';

export const readDocx: Reader = async (input, readerCtx) => {
  const warnings: string[] = [];

  let mammoth: typeof import('mammoth');
  try {
    const mod = await import('mammoth');
    // CJS package: under ESM the namespace may only expose `default`.
    mammoth = ((mod as unknown as { default?: typeof import('mammoth') }).default ??
      mod) as typeof import('mammoth');
  } catch {
    throw new ConversionError('ENGINE_MISSING', 'DOCX 解析器加载失败。', {
      zh: '服务器缺少 mammoth 依赖，无法解析 DOCX。请让管理员检查依赖安装。',
      en: 'The server is missing the mammoth dependency needed for DOCX.',
    });
  }

  const book: Book = createBook({
    title: guessTitleFromFilename(input.name),
    sourceFormat: 'docx',
  });
  const sink = imageSinkFor(book, warnings, readerCtx);

  const arrayBuffer = input.data.buffer.slice(
    input.data.byteOffset,
    input.data.byteOffset + input.data.byteLength,
  ) as ArrayBuffer;

  // The Node build of mammoth only understands {path} / {buffer}; the browser
  // build understands {arrayBuffer}. Pick whichever this runtime can provide.
  const bufferCtor = (globalThis as { Buffer?: { from(data: Uint8Array): unknown } }).Buffer;
  const mammothInput = (
    bufferCtor ? { buffer: bufferCtor.from(input.data) } : { arrayBuffer }
  ) as Parameters<typeof mammoth.convertToHtml>[0];

  let result: { value: string; messages: Array<{ type: string; message: string }> };
  try {
    result = await mammoth.convertToHtml(
      mammothInput,
      {
        // Word images are embedded; keep them in reading order as book resources.
        convertImage: mammoth.images.imgElement(async (image) => {
          sink.counter.value += 1;
          const ext = (image.contentType.split('/')[1] ?? 'png').replace('jpeg', 'jpg');
          const path = `images/docx-${String(sink.counter.value).padStart(3, '0')}.${ext}`;
          const data = new Uint8Array(await image.readAsArrayBuffer());
          book.resources.push({
            path,
            data,
            mediaType: image.contentType || mediaTypeFromBytes(data) || 'image/png',
          });
          return { src: path };
        }),
        // Map the styles Chinese Word documents actually use.
        styleMap: [
          "p[style-name='标题 1'] => h1:fresh",
          "p[style-name='标题 2'] => h2:fresh",
          "p[style-name='标题 3'] => h3:fresh",
          "p[style-name='标题 4'] => h4:fresh",
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh",
          "p[style-name='题注'] => p:fresh",
          "p[style-name='Caption'] => p:fresh",
        ].join('\n'),
      },
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConversionError('INVALID_FILE', `DOCX 解析失败：${detail.slice(0, 200)}`, {
      zh: '文件可能已损坏、受密码保护，或者其实是旧版 .doc。请用 Word/WPS 另存为 .docx 后重试。',
      en: 'The file may be corrupt, password-protected, or an old .doc. Re-save it as .docx and retry.',
    });
  }

  const styleWarnings = result.messages.filter((m) => m.type === 'warning');
  if (styleWarnings.length > 0) {
    warnings.push(
      `DOCX 中有 ${styleWarnings.length} 处样式未识别，已降级为普通段落（${styleWarnings.length} unsupported styles flattened）`,
    );
  }

  const { html } = sanitizeHtml(result.value);
  if (htmlToText(html).length === 0 && !/<img\b/i.test(html)) {
    throw new ConversionError('INVALID_FILE', 'DOCX 中没有可读文本。', {
      zh: '文档可能只有图片或表格对象。可尝试先导出为 PDF 再转换。',
      en: 'The document has no extractable text — try exporting it to PDF first.',
    });
  }

  const chapters = htmlChapters(html, sink);
  if (chapters.length === 0) {
    addChapter(book, { title: '', html, level: 0 });
  } else {
    chapters.forEach((chapter) => addChapter(book, chapter));
    // A Word "Title" paragraph is the book title, not chapter one. The block may
    // still carry a short author line ("林墨 著"), which we keep as metadata.
    const first = chapters[0];
    const firstText = htmlToText(first.html).trim();
    if (first.title && chapters.length > 1 && firstText.length < 60) {
      book.meta.title = first.title;
      if (!book.meta.author && firstText && firstText.length <= 40 && !/[。！？；]/.test(firstText)) {
        book.meta.author = firstText.replace(/^(?:作者|著者)\s*[:：]?\s*/, '').replace(/\s*著$/, '').trim();
      }
      book.chapters.shift();
    }
  }

  return normalizeBook(book, { fallbackTitle: guessTitleFromFilename(input.name), warnings });
};
