/**
 * ZIP safety inspection (no extraction, no JSZip):
 * - counts entries and total uncompressed size from the central directory
 * - rejects zip bombs (entries > 5000, expansion ratio > 200, > 1GB unpacked)
 * - detects DRM: encrypted zip entries, `META-INF/encryption.xml` covering
 *   non-font resources, Adobe `rights.xml`/`license.lcpl`, Apple `sinf.xml`
 *
 * Font obfuscation (`encryption.xml` that only lists .ttf/.otf/.woff files) is
 * *not* DRM — it is an Adobe font-embedding convention — so it is kept and only
 * surfaced as a warning.
 */
import { inflateRawSync } from 'node:zlib';
import { drmProtected, zipBomb } from './errors';

export interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ArchiveInspection {
  isZip: boolean;
  entries: number;
  compressedBytes: number;
  uncompressedBytes: number;
  encryptedEntries: number;
  hasEncryptionManifest: boolean;
  drm: boolean;
  fontObfuscation: boolean;
  warnings: string[];
}

export const MAX_ARCHIVE_ENTRIES = 5_000;
export const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // 1GB
export const MAX_COMPRESSION_RATIO = 200;

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;
const MAX_COMMENT_SCAN = 0xffff + 22;

export function looksLikeZip(data: Uint8Array): boolean {
  return (
    data.length >= 4 &&
    data[0] === 0x50 &&
    data[1] === 0x4b &&
    (data[2] === 0x03 || data[2] === 0x05 || data[2] === 0x07)
  );
}

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function findEndOfCentralDirectory(dv: DataView): number {
  const lowest = Math.max(0, dv.byteLength - MAX_COMMENT_SCAN);
  for (let i = dv.byteLength - 22; i >= lowest; i -= 1) {
    if (dv.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

function readEntries(data: Uint8Array, dv: DataView, cdOffset: number, count: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (pos + 46 > dv.byteLength || dv.getUint32(pos, true) !== CENTRAL_SIG) break;
    const nameLength = dv.getUint16(pos + 28, true);
    const extraLength = dv.getUint16(pos + 30, true);
    const commentLength = dv.getUint16(pos + 32, true);
    if (pos + 46 + nameLength > dv.byteLength) break;
    const name = Buffer.from(
      data.buffer,
      data.byteOffset + pos + 46,
      nameLength,
    ).toString('utf8');
    entries.push({
      name,
      flags: dv.getUint16(pos + 8, true),
      method: dv.getUint16(pos + 10, true),
      compressedSize: dv.getUint32(pos + 20, true),
      uncompressedSize: dv.getUint32(pos + 24, true),
      localOffset: dv.getUint32(pos + 42, true),
    });
    pos += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readEntryData(data: Uint8Array, dv: DataView, entry: ZipEntry): Uint8Array | null {
  const local = entry.localOffset;
  if (local + 30 > dv.byteLength || dv.getUint32(local, true) !== LOCAL_SIG) return null;
  const nameLength = dv.getUint16(local + 26, true);
  const extraLength = dv.getUint16(local + 28, true);
  const start = local + 30 + nameLength + extraLength;
  const size = entry.compressedSize;
  if (size <= 0 || start + size > dv.byteLength) return null;
  const raw = data.subarray(start, start + size);
  try {
    if (entry.method === 0) return raw;
    if (entry.method === 8) {
      return new Uint8Array(inflateRawSync(raw, { maxOutputLength: 1024 * 1024 }));
    }
  } catch {
    return null;
  }
  return null;
}

const FONT_EXT = /\.(ttf|otf|woff2?|eot)$/i;
const DRM_MANIFEST = /(^|\/)(encryption\.xml|rights\.xml|license\.lcpl|sinf\.xml)$/i;

function classifyEncryption(xml: string): { drm: boolean; fontObfuscation: boolean } {
  const uris = [...xml.matchAll(/CipherReference[^>]*URI\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
  if (uris.length === 0) return { drm: true, fontObfuscation: false };
  const nonFont = uris.filter((uri) => !FONT_EXT.test(uri.split('#')[0] ?? uri));
  if (nonFont.length === 0) return { drm: false, fontObfuscation: true };
  return { drm: true, fontObfuscation: false };
}

/** Inspect bytes without extracting them. Never throws for non-zip input. */
export function inspectZip(data: Uint8Array): ArchiveInspection {
  const empty: ArchiveInspection = {
    isZip: false,
    entries: 0,
    compressedBytes: 0,
    uncompressedBytes: 0,
    encryptedEntries: 0,
    hasEncryptionManifest: false,
    drm: false,
    fontObfuscation: false,
    warnings: [],
  };
  if (!looksLikeZip(data) || data.length < 22) return empty;

  const dv = view(data);
  const eocd = findEndOfCentralDirectory(dv);
  if (eocd < 0) return { ...empty, isZip: true, warnings: ['ZIP_CENTRAL_DIRECTORY_UNREADABLE'] };

  const rawCount = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  const zip64 = rawCount === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  const count = Math.min(rawCount, MAX_ARCHIVE_ENTRIES + 1);

  const listed = zip64 || cdOffset >= dv.byteLength ? [] : readEntries(data, dv, cdOffset, count);
  // Directory entries compress to nothing; count only real files for the bomb
  // limits (real EPUBs carry `META-INF/` and `OEBPS/` entries).
  const entries = listed.filter((entry) => !entry.name.endsWith('/'));
  const sizesKnown = !zip64 && entries.every((e) => e.compressedSize !== 0xffffffff && e.uncompressedSize !== 0xffffffff);

  let compressedBytes = 0;
  let uncompressedBytes = 0;
  let encryptedEntries = 0;
  let hasEncryptionManifest = false;
  let drm = false;
  let fontObfuscation = false;
  const warnings: string[] = [];

  for (const entry of entries) {
    compressedBytes += entry.compressedSize;
    uncompressedBytes += entry.uncompressedSize;
    if ((entry.flags & 0x1) !== 0) encryptedEntries += 1;
    if (DRM_MANIFEST.test(entry.name)) {
      hasEncryptionManifest = true;
      const bytes = readEntryData(data, dv, entry);
      if (bytes) {
        const xml = Buffer.from(bytes).toString('utf8');
        if (/encryption\.xml$/i.test(entry.name)) {
          const verdict = classifyEncryption(xml);
          if (verdict.drm) drm = true;
          if (verdict.fontObfuscation) fontObfuscation = true;
        } else if (/rights\.xml|license\.lcpl|sinf\.xml/i.test(entry.name)) {
          drm = true;
        }
      } else {
        // Manifest we cannot read: be conservative.
        drm = true;
      }
    }
  }

  if (zip64) warnings.push('ZIP64_UNVERIFIED');
  if (!zip64 && listed.length !== rawCount) warnings.push('ZIP_CENTRAL_DIRECTORY_MISMATCH');
  if (!sizesKnown && entries.length > 0) warnings.push('ZIP_SIZES_UNVERIFIED');
  if (fontObfuscation) warnings.push('FONT_OBFUSCATION');

  return {
    isZip: true,
    entries: entries.length || (rawCount === 0xffff ? MAX_ARCHIVE_ENTRIES + 1 : rawCount),
    compressedBytes,
    uncompressedBytes,
    encryptedEntries,
    hasEncryptionManifest,
    drm: drm || encryptedEntries > 0,
    fontObfuscation,
    warnings,
  };
}

/**
 * Validate an archive before it reaches the engine. Throws an ApiError with
 * code ZIP_BOMB / DRM when it is unsafe. Returns the inspection so the caller
 * can copy non-fatal warnings onto the job.
 */
export function assertArchiveSafe(data: Uint8Array): ArchiveInspection {
  const info = inspectZip(data);
  if (!info.isZip) return info;

  if (info.entries > MAX_ARCHIVE_ENTRIES) {
    throw zipBomb(`entries=${info.entries} > ${MAX_ARCHIVE_ENTRIES}`);
  }
  if (info.warnings.includes('ZIP64_UNVERIFIED')) {
    throw zipBomb('zip64');
  }
  if (info.warnings.includes('ZIP_CENTRAL_DIRECTORY_MISMATCH')) {
    throw zipBomb('central-directory-mismatch');
  }
  if (!info.warnings.includes('ZIP_SIZES_UNVERIFIED')) {
    if (info.uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw zipBomb(`uncompressed=${info.uncompressedBytes} > ${MAX_UNCOMPRESSED_BYTES}`);
    }
    const ratio = info.uncompressedBytes / Math.max(info.compressedBytes, 1);
    if (ratio > MAX_COMPRESSION_RATIO) {
      throw zipBomb(`ratio=${ratio.toFixed(1)} > ${MAX_COMPRESSION_RATIO}`);
    }
  }
  if (info.drm) throw drmProtected();
  return info;
}
