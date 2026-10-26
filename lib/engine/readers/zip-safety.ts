/**
 * ZIP safety shared by the EPUB/CBZ readers.
 *
 * Contract: single file ≤ 200 MB, unpacked resources ≤ 1 GB, compression ratio
 * over 200 is a bomb. The central directory is checked up front for speed, but a
 * forged header can claim 1 KB and inflate to 30 MB — so every entry is also
 * measured *after* decompression and charged to a hard byte budget.
 */

import type JSZip from 'jszip';
import { ConversionError } from '../types';

const MAX_TOTAL_UNCOMPRESSED = 1024 * 1024 * 1024; // 1 GiB
const MAX_ENTRY_UNCOMPRESSED = 200 * 1024 * 1024; // 200 MiB
const MAX_RATIO = 200;
const RATIO_SAMPLE_BYTES = 1024 * 1024; // ignore tiny entries when judging ratios

interface EntryData {
  uncompressedSize?: number;
  compressedSize?: number;
}

function entryData(file: unknown): EntryData | Uint8Array | undefined {
  return (file as { _data?: EntryData | Uint8Array })._data;
}

export function assertArchiveSane(zip: JSZip): void {
  let uncompressed = 0;
  let compressed = 0;
  let entries = 0;

  for (const file of Object.values(zip.files)) {
    if (file.dir) continue;
    entries += 1;
    const data = entryData(file);
    if (data instanceof Uint8Array) {
      uncompressed += data.length;
      compressed += data.length;
      continue;
    }
    if (data && typeof data === 'object') {
      if (typeof data.uncompressedSize === 'number') uncompressed += data.uncompressedSize;
      if (typeof data.compressedSize === 'number') compressed += data.compressedSize;
    }
  }

  if (entries > 5000) {
    throw new ConversionError('TOO_LARGE', `压缩包内条目过多（${entries}）。`, {
      zh: '可能是异常文件或 ZIP 炸弹，请检查来源。',
      en: 'The archive looks like a zip bomb. Check where it came from.',
    });
  }

  if (uncompressed > MAX_TOTAL_UNCOMPRESSED) {
    throw new ConversionError('TOO_LARGE', '解压后超过 1GB（按目录声明值）。', {
      zh: '文件太大，Kindle 也无法顺畅阅读。请先压缩图片或拆分文件。',
      en: 'Over 1 GB unpacked — split the file or compress the images first.',
    });
  }

  if (
    uncompressed > RATIO_SAMPLE_BYTES &&
    compressed > 0 &&
    uncompressed / compressed > MAX_RATIO
  ) {
    throw new ConversionError('TOO_LARGE', '压缩比异常，已拒绝解压。', {
      zh: '这个压缩包的压缩比超过 200:1，可能是 ZIP 炸弹。',
      en: 'Compression ratio is over 200:1 — likely a zip bomb.',
    });
  }
}

/**
 * Hard budget on bytes we have actually decompressed. Readers hand one instance
 * to every entry they read, so a lying central directory cannot win.
 */
export class ZipBudget {
  private used = 0;

  constructor(private readonly limit = MAX_TOTAL_UNCOMPRESSED) {}

  get consumed(): number {
    return this.used;
  }

  consume(bytes: number, path: string): void {
    this.used += bytes;
    if (this.used > this.limit) {
      throw new ConversionError(
        'TOO_LARGE',
        `解压数据超过 ${Math.round(this.limit / (1024 * 1024))}MB（实际已解压 ${Math.round(
          this.used / (1024 * 1024),
        )}MB，最后读取：${path}）。`,
        {
          zh: '文件解压后太大，Kindle 也无法顺畅阅读。请先压缩图片或拆分文件。',
          en: 'The archive expands too far — split the file or compress the images first.',
        },
      );
    }
  }
}

function entryTooLarge(path: string, bytes: number): ConversionError {
  return new ConversionError(
    'TOO_LARGE',
    `压缩包内单个文件超过 200MB（${path}，实际 ${Math.round(bytes / (1024 * 1024))}MB）。`,
    {
      zh: '请先把这张图片或文件压缩后再转换。',
      en: 'Compress that single image/file before converting it.',
    },
  );
}

function bombSuspected(path: string, actual: number, declared: number): ConversionError {
  return new ConversionError(
    'TOO_LARGE',
    `压缩包疑似伪造大小（${path}：声明 ${declared} 字节，实际 ${actual} 字节）。`,
    {
      zh: '这个压缩包的声明大小与实际不符，可能是 ZIP 炸弹，已拒绝。',
      en: 'Declared size does not match the real size — likely a zip bomb, refused.',
    },
  );
}

/**
 * Read one archive entry, measuring the real bytes. Never trust the central
 * directory: most bombs are just a forged `uncompressedSize`.
 */
export async function readZipEntry(
  zip: JSZip,
  path: string,
  budget?: ZipBudget,
): Promise<Uint8Array> {
  const file = zip.file(path);
  if (!file) {
    throw new ConversionError('INVALID_FILE', `压缩包内缺少文件：${path}`, {
      zh: '文件结构不完整，可能已损坏。',
      en: 'The archive is missing a file and may be damaged.',
    });
  }

  const data = entryData(file);
  const declared =
    data && !(data instanceof Uint8Array) && typeof data.uncompressedSize === 'number'
      ? data.uncompressedSize
      : 0;
  if (declared > MAX_ENTRY_UNCOMPRESSED) throw entryTooLarge(path, declared);

  let bytes: Uint8Array;
  try {
    bytes = await file.async('uint8array');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/size mismatch|uncompressed data size|invalid (?:distance|stored block)/i.test(detail)) {
      throw new ConversionError(
        'TOO_LARGE',
        `压缩包内文件实际大小与声明不符（${path}）。`,
        {
          zh: '这个文件可能被伪造过声明大小（ZIP 炸弹），已拒绝解压。',
          en: 'The entry lies about its size (zip bomb) — refused to decompress.',
        },
      );
    }
    throw new ConversionError('INVALID_FILE', `压缩包内文件损坏：${path}（${detail.slice(0, 160)}）`, {
      zh: '压缩包可能已损坏，请重新下载后重试。',
      en: 'The archive looks damaged — download it again and retry.',
    });
  }

  if (bytes.length > MAX_ENTRY_UNCOMPRESSED) throw entryTooLarge(path, bytes.length);
  if (
    declared > 0 &&
    bytes.length > RATIO_SAMPLE_BYTES &&
    bytes.length / declared > MAX_RATIO
  ) {
    throw bombSuspected(path, bytes.length, declared);
  }

  budget?.consume(bytes.length, path);
  return bytes;
}

/** Same as `readZipEntry`, decoded as UTF-8 (EPUB documents are always UTF-8). */
export async function readZipText(
  zip: JSZip,
  path: string,
  budget?: ZipBudget,
): Promise<string> {
  const bytes = await readZipEntry(zip, path, budget);
  return new TextDecoder('utf-8').decode(bytes);
}
