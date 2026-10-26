/**
 * Single-image reader.
 *
 * Uses sharp when it is available (Node) to normalise everything to a JPEG that
 * every Kindle renders, capped at 1600px on the long edge — e-ink screens are
 * ~1264px wide, so bigger payloads only slow the device down. Without sharp the
 * original bytes are embedded untouched.
 */

import type { Reader } from './types';
import { ConversionError } from '../types';
import { guessTitleFromFilename, normalizeBook } from '../model';
import { buildComicBook } from './comic';
import { mediaTypeFromBytes, optionalImport } from '../util';

const MAX_EDGE = 1600;
const JPEG_QUALITY = 82;

interface SharpLike {
  (input: Uint8Array, options?: { limitInputPixels?: number }): {
    metadata: () => Promise<{ width?: number; height?: number; format?: string }>;
    rotate: () => {
      resize: (options: {
        width: number;
        height: number;
        fit: string;
        withoutEnlargement: boolean;
      }) => { jpeg: (options: { quality: number; mozjpeg?: boolean }) => { toBuffer: () => Promise<Buffer> } };
    };
  };
}

/** Use sharp itself as the last-resort format sniffer. */
async function drainSharpMetadata(data: Uint8Array): Promise<string | null> {
  const module = await optionalImport<SharpLike | { default?: SharpLike }>('sharp');
  const sharp = (module as { default?: SharpLike } | null)?.default ?? null;
  if (!sharp) return null;
  try {
    const meta = await sharp(data, { limitInputPixels: 268_402_689 }).metadata();
    if (meta.format === 'jpeg') return 'image/jpeg';
    if (meta.format === 'png') return 'image/png';
    if (meta.format === 'webp') return 'image/webp';
    if (meta.format === 'gif') return 'image/gif';
    if (meta.format === 'tiff') return 'image/tiff';
    return null;
  } catch {
    return null;
  }
}

export const readImage: Reader = async (input) => {
  const warnings: string[] = [];
  const title = guessTitleFromFilename(input.name);
  const sniffed = mediaTypeFromBytes(input.data);
  let data = input.data;
  let mediaType = sniffed ?? 'application/octet-stream';

  const sharpModule = await optionalImport<SharpLike | { default?: SharpLike }>('sharp');
  // ESM namespace interop: the callable lives on `default` when bundled by Node.
  const sharp =
    (sharpModule as { default?: SharpLike } | null)?.default ??
    (typeof sharpModule === 'function' ? (sharpModule as SharpLike) : null);
  if (sharp) {
    try {
      const output = await sharp(data, { limitInputPixels: 268_402_689 })
        .rotate()
        .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
        .toBuffer();
      data = new Uint8Array(output);
      mediaType = 'image/jpeg';
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      warnings.push(
        `图片未能压缩，按原样嵌入（image kept as-is）: ${detail.slice(0, 120)}`,
      );
    }
  } else {
    warnings.push(
      '未安装 sharp，图片按原样嵌入（sharp unavailable, image embedded as-is）',
    );
  }

  if (!mediaType.startsWith('image/')) {
    // Last chance: sharp can decode formats without a signature we recognise.
    if (!sniffed) {
      const viaSharp = await drainSharpMetadata(input.data);
      if (viaSharp) mediaType = viaSharp;
    }
  }
  if (!mediaType.startsWith('image/')) {
    throw new ConversionError('INVALID_FILE', '文件不是受支持的图片格式。', {
      zh: '支持 jpg / png / webp / gif / tiff。',
      en: 'Supported picture formats are jpg, png, webp, gif and tiff.',
    });
  }

  const book = buildComicBook([{ name: input.name, data, mediaType }], {
    title,
    sourceFormat: 'image',
    warnings,
  });
  if (book.chapters.length === 0) {
    throw new ConversionError('INVALID_FILE', '无法读取这张图片。', {
      zh: '文件可能已损坏，或实际不是图片。',
      en: 'The file may be damaged, or not actually a picture.',
    });
  }
  return normalizeBook(book, { fallbackTitle: title, warnings, mergeShortChapters: false });
};
