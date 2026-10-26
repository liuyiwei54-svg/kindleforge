/**
 * POST /api/convert — multipart upload → 202 { jobId }.
 *
 * Pipeline: rate limit → size pre-check → multipart parse → target/options
 * validation → format detection → capability matrix → zip/DRM safety →
 * disk-space floor → write input (0600) → enqueue job.
 *
 * Errors always use { error: { code, message, hint } } with a no-store header.
 */
import { FORMAT_INFO, OUTPUT_FORMATS, capabilities } from '../../../lib/engine/formats';
import type { FormatId } from '../../../lib/engine/types';
import { assertArchiveSafe } from '../../../lib/server/archive';
import { detectFormatFor, runConversion } from '../../../lib/server/convert';
import { engineAvailability } from '../../../lib/server/engines';
import {
  badRequest,
  methodNotAllowedResponse,
  optionsResponse,
  engineMissingForPair,
  invalidTarget,
  jsonResponse,
  lengthRequired,
  toErrorResponse,
  tooLarge,
  unsupportedFormat,
  unsupportedPair,
} from '../../../lib/server/errors';
import { engineFailureWarning, getJobStore } from '../../../lib/server/jobs';
import { parseKindleOptions } from '../../../lib/server/options';
import { guardRequest } from '../../../lib/server/ratelimit';
import {
  MAX_UPLOAD_BYTES,
  assertFreeSpace,
  deleteJobDir,
  readJobFile,
  removeJobFile,
  safeFileName,
  writeJobFile,
} from '../../../lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['POST', 'OPTIONS'];

export function GET(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PUT(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function PATCH(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function DELETE(): Response {
  return methodNotAllowedResponse(ALLOWED);
}
export function OPTIONS(): Response {
  return optionsResponse(ALLOWED);
}

/** multipart framing overhead allowance on top of the 200MB file budget. */
const MULTIPART_OVERHEAD = 1024 * 1024;

function isFileLike(value: FormDataEntryValue | null): value is File {
  if (!value || typeof value === 'string') return false;
  const candidate = value as Partial<File>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.size === 'number' &&
    typeof candidate.arrayBuffer === 'function'
  );
}

export async function POST(request: Request): Promise<Response> {
  let release: (() => void) | undefined;
  try {
    const grant = guardRequest(request);
    release = grant.release;

    // Require a declared length. Without it a chunked body would only be
    // discovered as "too large" after the whole thing has been buffered in
    // memory; rejecting up front caps memory per request (and the limiter caps
    // concurrency). Browsers/curl send Content-Length for FormData uploads.
    const contentLengthHeader = request.headers.get('content-length');
    if (contentLengthHeader === null || contentLengthHeader.trim() === '') {
      const chunked = (request.headers.get('transfer-encoding') ?? '').toLowerCase().includes('chunked');
      throw lengthRequired(chunked);
    }
    if (!/^\d+$/.test(contentLengthHeader.trim())) {
      throw badRequest('Invalid Content-Length header.', {
        zh: 'Content-Length 格式不正确。',
        en: 'The Content-Length header is malformed.',
      });
    }
    const contentLength = Number(contentLengthHeader);
    if (contentLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
      throw tooLarge(contentLength, MAX_UPLOAD_BYTES);
    }

    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('multipart/form-data')) {
      throw badRequest('Expected multipart/form-data.', {
        zh: '请使用 multipart/form-data 上传文件（字段名 file）。',
        en: 'Upload the file as multipart/form-data under the "file" field.',
      });
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw badRequest('Malformed multipart body.', {
        zh: '上传内容无法解析，请重试。',
        en: 'The multipart body could not be parsed; please retry.',
      });
    }

    const uploaded = form.get('file');
    if (!isFileLike(uploaded)) {
      throw badRequest('Missing "file" field.', {
        zh: '缺少文件字段（file）。',
        en: 'The request has no "file" field.',
      });
    }
    if (uploaded.size === 0) {
      throw badRequest('The uploaded file is empty.', {
        zh: '上传的文件是空的。',
        en: 'The uploaded file is empty.',
      });
    }
    if (uploaded.size > MAX_UPLOAD_BYTES) throw tooLarge(uploaded.size, MAX_UPLOAD_BYTES);

    const targetRaw = form.get('target');
    if (typeof targetRaw !== 'string' || !OUTPUT_FORMATS.includes(targetRaw as FormatId)) {
      throw invalidTarget(typeof targetRaw === 'string' ? targetRaw : '(missing)');
    }
    const target = targetRaw as FormatId;

    const options = parseKindleOptions(form.get('options'));

    const buffer = await uploaded.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > MAX_UPLOAD_BYTES) throw tooLarge(bytes.byteLength, MAX_UPLOAD_BYTES);

    const sourceName = safeFileName(uploaded.name || 'upload', 'upload');
    const format = await detectFormatFor(sourceName, bytes);
    if (!format) throw unsupportedFormat();

    const engines = await engineAvailability();
    const supportedPair = capabilities({ calibre: engines.calibre }).find(
      (pair) => pair.from === format && pair.to === target,
    );
    if (!supportedPair) {
      const rawPair = capabilities().find((pair) => pair.from === format && pair.to === target);
      if (rawPair) throw engineMissingForPair(format, target, rawPair.engine);
      throw unsupportedPair(format, target);
    }

    const archive = assertArchiveSafe(bytes);
    await assertFreeSpace(bytes.byteLength);

    const store = getJobStore();
    const job = store.create({
      source: { name: sourceName, size: bytes.byteLength, format },
      target,
      options,
      warnings: archive.warnings,
    });

    const inputName = `input.${FORMAT_INFO[format].ext[0]}`;
    try {
      await writeJobFile(job.id, inputName, bytes);

      store.enqueue(job.id, async ({ update }) => {
        try {
          // Read from disk so queued jobs do not pin hundreds of MB in memory.
          const stored = await readJobFile(job.id, inputName);
          const data = new Uint8Array(stored.buffer, stored.byteOffset, stored.byteLength);
          const output = await runConversion({
            jobId: job.id,
            sourceName,
            sourceFormat: format,
            target,
            options,
            data,
            onProgress: (progress) => update({ progress }),
          });
          // The user may DELETE a running job; if so, drop the new result too.
          if (!store.get(job.id)) {
            await deleteJobDir(job.id).catch(() => undefined);
            throw new Error('job was deleted during conversion');
          }
          return output;
        } catch (error) {
          // Surface external-engine stderr (calibre/pandoc) in structured
          // warnings, while error.message stays short (never duplicated).
          const detail = engineFailureWarning(error);
          if (detail) {
            const current = store.get(job.id);
            const warnings = [...(current?.warnings ?? job.warnings), `ENGINE_FAILURE: ${detail}`];
            update({ warnings });
          }
          throw error;
        } finally {
          await removeJobFile(job.id, inputName).catch(() => undefined);
        }
      });
    } catch (error) {
      await store.remove(job.id).catch(() => undefined);
      throw error;
    }

    return jsonResponse({ jobId: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error);
  } finally {
    release?.();
  }
}
