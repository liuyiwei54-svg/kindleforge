/**
 * CBR reader (comic book RAR).
 *
 * RAR needs the official unrar code compiled to WASM (node-unrar-js). That is a
 * Node-only dependency, so browser local mode refuses cleanly instead of trying.
 * The extracted pictures are handed to the exact same page builder as CBZ.
 */

import { ConversionError } from '../types';
import type { Reader } from './types';
import { guessTitleFromFilename, normalizeBook } from '../model';
import { buildComicBook, isComicImage, type ComicPage } from './comic';
import { naturalCompare, optionalImport } from '../util';

interface UnrarFileHeader {
  name: string;
  flags: { directory: boolean; encrypted: boolean };
}

interface UnrarArcFile {
  fileHeader: UnrarFileHeader;
  extraction?: Uint8Array;
}

interface UnrarExtractor {
  getFileList(): { fileHeaders: Generator<UnrarFileHeader> };
  extract(options: { files?: string[] }): { files: Generator<UnrarArcFile> };
}

interface UnrarModule {
  createExtractorFromData(options: {
    data: ArrayBuffer;
    password?: string;
  }): Promise<UnrarExtractor>;
}

export const readCbr: Reader = async (input) => {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    throw new ConversionError('ENGINE_MISSING', '浏览器本地模式无法解包 CBR（RAR）。', {
      zh: 'CBR 需要服务端解包。请关闭「本地转换」或先把压缩包转成 CBZ。',
      en: 'CBR needs server-side unpacking. Turn off local-only mode or export it as CBZ.',
    });
  }

  const unrarModule = await optionalImport<UnrarModule | { default?: UnrarModule }>('node-unrar-js');
  const unrar = (unrarModule as { default?: UnrarModule } | null)?.default ?? (unrarModule as UnrarModule | null);
  if (!unrar || typeof unrar.createExtractorFromData !== 'function') {
    throw new ConversionError('ENGINE_MISSING', '缺少 node-unrar-js 依赖，无法解包 CBR。', {
      zh: '请在服务器安装依赖，或先把文件解压成 CBZ（ZIP）再转换。',
      en: 'Install node-unrar-js on the server, or convert it to CBZ first.',
    });
  }

  const arrayBuffer = input.data.buffer.slice(
    input.data.byteOffset,
    input.data.byteOffset + input.data.byteLength,
  ) as ArrayBuffer;

  let extractor: UnrarExtractor;
  try {
    extractor = await unrar.createExtractorFromData({ data: arrayBuffer });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConversionError('INVALID_FILE', `CBR 解包失败：${detail.slice(0, 160)}`, {
      zh: 'RAR 文件可能已损坏、加密或使用了不支持的版本。',
      en: 'The RAR may be damaged, encrypted, or use an unsupported version.',
    });
  }

  const warnings: string[] = [];
  let headers: UnrarFileHeader[];
  try {
    headers = [...extractor.getFileList().fileHeaders];
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConversionError('INVALID_FILE', `CBR 目录读取失败：${detail.slice(0, 160)}`, {
      zh: 'RAR 可能已加密（需要密码）。本项目不做密码破解。',
      en: 'The RAR may be password-protected; we do not crack passwords.',
    });
  }

  const imageNames = headers
    .filter((h) => !h.flags.directory && isComicImage(h.name))
    .map((h) => h.name)
    .sort(naturalCompare);
  if (imageNames.length === 0) {
    throw new ConversionError('INVALID_FILE', 'CBR 中没有图片。', {
      zh: '压缩包里需要 jpg/png/webp 等图片文件。',
      en: 'The archive contains no jpg/png/webp images.',
    });
  }

  const pages: ComicPage[] = [];
  try {
    const result = extractor.extract({ files: imageNames });
    for (const file of result.files) {
      if (!file.extraction) continue;
      pages.push({ name: file.fileHeader.name, data: file.extraction });
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new ConversionError('INVALID_FILE', `CBR 解压失败：${detail.slice(0, 160)}`, {
      zh: '文件可能已损坏，或其中包含疑似加密的条目。',
      en: 'The archive may be damaged or contain encrypted entries.',
    });
  }

  if (pages.length === 0) {
    throw new ConversionError('INVALID_FILE', 'CBR 中的图片无法解出。', {
      zh: '压缩方式可能不受支持，请尝试重新打包为 CBZ。',
      en: 'Compression may be unsupported — try repacking it as CBZ.',
    });
  }

  const title = guessTitleFromFilename(input.name);
  const book = buildComicBook(pages, { title, sourceFormat: 'cbr', warnings });
  if (book.chapters.length === 0) {
    throw new ConversionError('INVALID_FILE', 'CBR 中的图片格式不受支持。', {
      zh: '请确认图片是 jpg/png/webp/gif 之一。',
      en: 'Images must be jpg, png, webp or gif.',
    });
  }
  return normalizeBook(book, { fallbackTitle: title, warnings, mergeShortChapters: false });
};
