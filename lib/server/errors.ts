/**
 * Unified error model for every /api/* route.
 *
 * Wire shape (always JSON, always `Cache-Control: no-store`):
 *   { "error": { "code": "UNSUPPORTED_PAIR", "message": "...", "hint": { "zh": "...", "en": "..." } } }
 *
 * Never include user file names in a message we log. Messages that reach the
 * client may echo a format pair, but not a path on disk.
 */
import { ConversionError } from '../engine/types';
import { config, uploadLimitHint } from './config';

export interface BilingualHint {
  zh: string;
  en: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    hint?: BilingualHint;
  };
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'INVALID_TARGET'
  | 'INVALID_OPTIONS'
  | 'UNSUPPORTED_PAIR'
  | 'UNSUPPORTED_FORMAT'
  | 'TOO_LARGE'
  | 'LENGTH_REQUIRED'
  | 'ZIP_BOMB'
  | 'DRM'
  | 'NOT_FOUND'
  | 'RESULT_NOT_READY'
  | 'RESULT_GONE'
  | 'RATE_LIMITED'
  | 'INSUFFICIENT_STORAGE'
  | 'ENGINE_MISSING'
  | 'TIMEOUT'
  | 'INTERNAL'
  | 'METHOD_NOT_ALLOWED';

export const NO_STORE: Record<string, string> = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly hint?: BilingualHint;
  /** Extra headers, e.g. Retry-After on 429. */
  readonly headers: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    status: number,
    message: string,
    hint?: BilingualHint,
    headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.hint = hint;
    this.headers = headers;
  }
}

export function errorBody(code: string, message: string, hint?: BilingualHint): ApiErrorBody {
  return { error: { code, message, ...(hint ? { hint } : {}) } };
}

export function jsonResponse(
  data: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(data), {
    status: init.status ?? 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE,
      ...init.headers,
    },
  });
}

export function emptyResponse(status = 204, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { ...NO_STORE, ...headers } });
}

/** Explicit 405 with the no-store header (Next's auto-405 omits it). */
export function methodNotAllowedResponse(allowed: string[]): Response {
  const error = methodNotAllowed();
  return jsonResponse(errorBody(error.code, error.message, error.hint), {
    status: 405,
    headers: { Allow: allowed.join(', ') },
  });
}

/** Explicit OPTIONS with Allow + no-store. */
export function optionsResponse(allowed: string[]): Response {
  return emptyResponse(204, { Allow: allowed.join(', ') });
}

/* ------------------------------------------------------------------ */
/* Factories used by the routes                                        */
/* ------------------------------------------------------------------ */

export function badRequest(message: string, hint?: BilingualHint): ApiError {
  return new ApiError('BAD_REQUEST', 400, message, hint);
}

export function invalidTarget(target: string): ApiError {
  return new ApiError('INVALID_TARGET', 400, `Unsupported target format: ${target}`, {
    zh: '目标格式不受支持。可选：EPUB、MOBI、AZW3、PDF、TXT、DOCX、HTML。',
    en: 'That output format is not supported. Pick EPUB, MOBI, AZW3, PDF, TXT, DOCX or HTML.',
  });
}

export function invalidOptions(detail: string): ApiError {
  return new ApiError('INVALID_OPTIONS', 400, `Invalid conversion options: ${detail}`, {
    zh: '转换参数格式不正确，请使用 JSON 对象（或留空使用默认排版）。',
    en: 'Conversion options must be a JSON object; omit the field to use defaults.',
  });
}

export function unsupportedFormat(): ApiError {
  return new ApiError('UNSUPPORTED_FORMAT', 415, 'Could not detect a supported input format.', {
    zh: '无法识别文件格式。支持 EPUB/MOBI/AZW/AZW3/PDF/DOCX/ODT/TXT/MD/HTML/RTF/FB2/CBZ/CBR/图片。',
    en: 'Unrecognised file type. We support EPUB, MOBI, AZW, AZW3, PDF, DOCX, ODT, TXT, MD, HTML, RTF, FB2, CBZ, CBR and images.',
  });
}

export function unsupportedPair(from: string, to: string): ApiError {
  return new ApiError('UNSUPPORTED_PAIR', 415, `Conversion ${from} → ${to} is not supported.`, {
    zh: `${from.toUpperCase()} 转 ${to.toUpperCase()} 暂不支持，可在格式矩阵查看全部支持的组合。`,
    en: `${from.toUpperCase()} → ${to.toUpperCase()} is not in our conversion matrix yet.`,
  });
}

export function engineMissingForPair(from: string, to: string, engine: string): ApiError {
  return new ApiError(
    'ENGINE_MISSING',
    415,
    `Conversion ${from} → ${to} needs an optional engine (${engine}) that is not installed.`,
    {
      zh: `这一转换需要外部引擎 ${engine}，当前服务器未安装。安装后即可使用；纯文本/EPUB 相关转换不受影响。`,
      en: `This pair needs the optional ${engine} engine, which is not installed on this server. Plain-text/EPUB conversions still work.`,
    },
    { 'X-KindleForge-Engine': engine },
  );
}

export function lengthRequired(chunked: boolean): ApiError {
  const maxMb = Math.round(config.maxUploadBytes / 1024 ** 2);
  return new ApiError(
    'LENGTH_REQUIRED',
    411,
    chunked
      ? `Chunked uploads are rejected; Content-Length is required (max ${config.maxUploadBytes} bytes).`
      : `Content-Length is required (max ${config.maxUploadBytes} bytes).`,
    {
      zh: `上传必须声明 Content-Length（不支持 chunked/未知长度，上限 ${maxMb}MB）。浏览器 fetch(FormData) 与 curl -F 会自动带上。`,
      en: `Uploads must declare Content-Length (chunked/unknown-length bodies are rejected; max ${maxMb}MB). Browsers and curl -F send it automatically.`,
    },
  );
}

export function tooLarge(size: number, limit: number): ApiError {
  return new ApiError('TOO_LARGE', 413, `File is too large (${size} bytes, limit ${limit}).`, uploadLimitHint());
}

export function drmProtected(): ApiError {
  return new ApiError('DRM', 422, 'This file is DRM-protected and cannot be converted.', {
    zh: '检测到 DRM 加密，我们不能也不会破解。请使用已授权的无 DRM 副本（例如从阅读器导出或联系卖家）。',
    en: 'DRM encryption detected. We do not break DRM — please use an authorised DRM-free copy.',
  });
}

export function zipBomb(detail: string): ApiError {
  return new ApiError('ZIP_BOMB', 422, `Archive rejected by safety limits (${detail}).`, {
    zh: '压缩包解压后体积异常（疑似 zip bomb），已拒绝处理。',
    en: 'The archive expands far beyond its size (possible zip bomb) and was rejected.',
  });
}

export function notFound(what = 'Job'): ApiError {
  return new ApiError('NOT_FOUND', 404, `${what} not found.`, {
    zh: '任务不存在，或已超过 10 分钟保留期被自动清理。',
    en: 'No such job — it may have expired after the 10-minute retention window.',
  });
}

export function resultNotReady(): ApiError {
  return new ApiError('RESULT_NOT_READY', 409, 'Result is not ready yet.', {
    zh: '转换还在进行中，请稍候再下载。',
    en: 'The conversion is still running — retry the download shortly.',
  });
}

export function resultGone(): ApiError {
  return new ApiError('RESULT_GONE', 410, 'Result file is no longer available.', {
    zh: '结果文件已被清理，请重新转换。',
    en: 'The result file has been cleaned up; please convert again.',
  });
}

export type RateLimitScope = 'direct' | 'local' | 'ip';

export interface RateLimitMeta {
  limit: number;
  scope: RateLimitScope;
}

export function rateLimited(
  retryAfterSeconds: number,
  kind: 'window' | 'concurrency',
  meta: RateLimitMeta = { limit: config.rateLimitPerHour, scope: 'ip' },
): ApiError {
  const message =
    kind === 'window'
      ? 'Too many conversions from this address.'
      : 'Too many concurrent requests.';
  return new ApiError(
    'RATE_LIMITED',
    429,
    message,
    kind === 'window'
      ? {
          zh: `请求过于频繁（${
            meta.scope === 'direct' ? '直连单实例桶' : meta.scope === 'local' ? '本机桶' : '每 IP'
          }上限 ${meta.limit} 次/小时）。请 ${Math.max(1, Math.ceil(retryAfterSeconds))} 秒后再试。`,
          en: `Rate limit reached (${
            meta.scope === 'direct' ? 'single direct bucket' : meta.scope === 'local' ? 'loopback bucket' : 'per-IP'
          }: ${meta.limit}/hour). Retry in ${Math.max(1, Math.ceil(retryAfterSeconds))}s.`,
        }
      : {
          zh: '同时进行的上传过多，请等当前任务完成再试。',
          en: 'Too many uploads in flight. Wait for a running request to finish.',
        },
    { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  );
}

export function insufficientStorage(freeBytes: number): ApiError {
  return new ApiError(
    'INSUFFICIENT_STORAGE',
    507,
    `Not enough temporary disk space (${Math.round(freeBytes / 1024 ** 2)} MB free).`,
    {
      zh: '服务器临时磁盘空间不足 2GB，暂无法接收上传。请清理磁盘或稍后重试。',
      en: 'The server has less than 2GB of temporary disk space. Free some space and retry.',
    },
  );
}

export function engineMissing(): ApiError {
  return new ApiError('ENGINE_MISSING', 503, 'Conversion engine unavailable.', {
    zh: '内置转换引擎未就绪（部署不完整），请联系管理员。',
    en: 'The built-in conversion engine is unavailable on this deployment.',
  });
}

export function internalError(): ApiError {
  return new ApiError('INTERNAL', 500, 'Internal server error.', {
    zh: '服务器内部错误。请重试；若持续出现请反馈 jobId。',
    en: 'Something went wrong on the server. Retry, and report the jobId if it persists.',
  });
}

export function methodNotAllowed(): ApiError {
  return new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.', {
    zh: '请求方法不支持。',
    en: 'That HTTP method is not supported here.',
  });
}

/* ------------------------------------------------------------------ */
/* Mapping layer                                                       */
/* ------------------------------------------------------------------ */

const CONVERSION_STATUS: Record<ConversionError['code'], number> = {
  UNSUPPORTED_PAIR: 415,
  ENGINE_MISSING: 503,
  INVALID_FILE: 400,
  DRM: 422,
  TOO_LARGE: 413,
  TIMEOUT: 504,
  INTERNAL: 500,
};

function fromConversionError(error: ConversionError): ApiError {
  return new ApiError(
    error.code === 'DRM'
      ? 'DRM'
      : error.code === 'TOO_LARGE'
        ? 'TOO_LARGE'
        : error.code === 'TIMEOUT'
          ? 'TIMEOUT'
          : error.code === 'UNSUPPORTED_PAIR'
            ? 'UNSUPPORTED_PAIR'
            : error.code === 'ENGINE_MISSING'
              ? 'ENGINE_MISSING'
              : error.code === 'INVALID_FILE'
                ? 'BAD_REQUEST'
                : 'INTERNAL',
    CONVERSION_STATUS[error.code] ?? 500,
    error.message,
    error.hint,
  );
}

/** Convert any thrown value into the standard error wire format. */
export function toErrorResponse(error: unknown): Response {
  if (error instanceof ApiError) {
    return jsonResponse(errorBody(error.code, error.message, error.hint), {
      status: error.status,
      headers: { ...error.headers },
    });
  }
  if (error instanceof ConversionError) {
    const mapped = fromConversionError(error);
    return jsonResponse(errorBody(mapped.code, mapped.message, mapped.hint), {
      status: mapped.status,
      headers: { ...mapped.headers },
    });
  }
  // Never echo unknown error messages: they can contain absolute paths.
  const name = error instanceof Error ? error.name : typeof error;
  console.error(`[api] unhandled ${name}`);
  const mapped = internalError();
  return jsonResponse(errorBody(mapped.code, mapped.message, mapped.hint), {
    status: mapped.status,
  });
}
