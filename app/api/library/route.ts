/**
 * GET  /api/library?q&sort&format — list the local library.
 * POST /api/library:
 *   - JSON `{ jobId }`            save a finished server conversion (201)
 *   - multipart file/title/author save bytes from the browser Worker (201)
 */
import {
  badRequest,
  jsonResponse,
  methodNotAllowedResponse,
  optionsResponse,
  toErrorResponse,
  tooLarge,
} from '../../../lib/server/errors';
import { FORMAT_INFO } from '../../../lib/engine/formats';
import type { FormatId } from '../../../lib/engine/types';
import {
  listLibrary,
  saveJobToLibrary,
  saveUpload,
  type LibraryQuery,
} from '../../../lib/server/library';
import { guardApiRequest, readFormData, readJsonBody } from '../../../lib/server/request';
import { getJobStore } from '../../../lib/server/jobs';
import { isJobId, MAX_UPLOAD_BYTES } from '../../../lib/server/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALLOWED = ['GET', 'POST', 'OPTIONS'];

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

export async function GET(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get('q') ?? undefined;
    const sortParam = url.searchParams.get('sort') ?? 'added';
    const formatParam = url.searchParams.get('format');
    const sort = ['added', 'title', 'author', 'size'].includes(sortParam)
      ? (sortParam as LibraryQuery['sort'])
      : null;
    if (!sort) {
      throw badRequest('sort must be one of added, title, author, size.', {
        zh: '排序参数必须是 added、title、author 或 size。',
        en: 'sort must be one of added, title, author, size.',
      });
    }
    let format: FormatId | undefined;
    if (formatParam) {
      if (!(formatParam in FORMAT_INFO)) {
        throw badRequest('Unknown format filter.', {
          zh: '未知的格式筛选。',
          en: 'Unknown format filter.',
        });
      }
      format = formatParam as FormatId;
    }
    return jsonResponse(
      await listLibrary({
        ...(q ? { q: q.slice(0, 200) } : {}),
        sort,
        ...(format ? { format } : {}),
      }),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

async function fromJson(request: Request): Promise<Response> {
  const body = (await readJsonBody(request, { maxBytes: 64 * 1024, required: true })) as {
    jobId?: unknown;
  };
  if (typeof body.jobId !== 'string' || !isJobId(body.jobId)) {
    throw badRequest('jobId must be a finished conversion id.', {
      zh: '请提供已完成的转换任务 id。',
      en: 'Provide the id of a finished conversion job.',
    });
  }
  if (!getJobStore().get(body.jobId)) {
    throw badRequest('The conversion job was not found or has expired.', {
      zh: '转换任务不存在或已过期，请重新转换。',
      en: 'The conversion job was not found or has expired.',
    });
  }
  return jsonResponse(await saveJobToLibrary(body.jobId), { status: 201 });
}

async function fromMultipart(request: Request): Promise<Response> {
  const form = await readFormData(request, MAX_UPLOAD_BYTES);
  const file = form.get('file');
  if (!(file instanceof File)) {
    throw badRequest('A file field is required.', {
      zh: '请选择一个文件。',
      en: 'Choose a file to save.',
    });
  }
  if (file.size === 0) throw badRequest('The uploaded file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw tooLarge(file.size, MAX_UPLOAD_BYTES);
  const title = form.get('title');
  const author = form.get('author');
  if (title !== null && typeof title !== 'string') throw badRequest('Invalid title.');
  if (author !== null && typeof author !== 'string') throw badRequest('Invalid author.');
  const data = new Uint8Array(await file.arrayBuffer());
  return jsonResponse(
    await saveUpload({
      data,
      filename: file.name || 'book.epub',
      ...(typeof title === 'string' && title.trim() ? { title: title.trim().slice(0, 200) } : {}),
      ...(typeof author === 'string' && author.trim() ? { author: author.trim().slice(0, 120) } : {}),
    }),
    { status: 201 },
  );
}

export async function POST(request: Request): Promise<Response> {
  const forbidden = guardApiRequest(request);
  if (forbidden) return forbidden;
  try {
    const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.startsWith('multipart/form-data')) return await fromMultipart(request);
    if (contentType.startsWith('application/json')) return await fromJson(request);
    throw badRequest('Send application/json { jobId } or multipart/form-data.', {
      zh: '请用 JSON 传 jobId，或用 multipart 上传文件。',
      en: 'Use application/json { jobId } or multipart/form-data.',
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
