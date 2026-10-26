/**
 * Zod validation for the `options` multipart field.
 *
 * Unknown keys are stripped (the UI may send cosmetic fields), but wrong types
 * or out-of-range values are a hard 400 — a silently ignored indent of "abc"
 * would be worse than an explicit error.
 */
import { z } from 'zod';
import type { KindleOptions } from '../engine/types';
import { invalidOptions } from './errors';

const typographySchema = z.object({
  indent: z.number().min(0).max(8).optional(),
  paragraphSpacing: z.number().min(0).max(4).optional(),
  lineHeight: z.number().min(0.8).max(3).optional(),
  justify: z.boolean().optional(),
  hyphenate: z.boolean().optional(),
  fontFamily: z.enum(['serif', 'sans', 'default']).optional(),
  fontSize: z.number().int().min(8).max(48).optional(),
});

const metadataSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  author: z.string().min(1).max(300).optional(),
  language: z.string().min(2).max(16).optional(),
  publisher: z.string().min(1).max(300).optional(),
  description: z.string().max(5000).optional(),
});

export const kindleOptionsSchema = z.object({
  device: z.enum(['paperwhite', 'oasis', 'scribe', 'basic', 'app']).optional(),
  typography: typographySchema.optional(),
  toc: z.boolean().optional(),
  cover: z.boolean().optional(),
  mangaMode: z.boolean().optional(),
  splitChapters: z.boolean().optional(),
  ocr: z.boolean().optional(),
  // Accept BCP-47/ISO codes (`zh`, `en-US`) AND tessdata pack names, including
  // the `+` composition Tesseract uses: `chi_sim`, `chi_tra`, `chi_sim+eng`.
  // The engine maps ISO codes to tessdata names and passes unknown values
  // through for power users (lib/engine/node/ocr.ts).
  ocrLanguage: z
    .string()
    .min(2)
    .max(32)
    .regex(/^[A-Za-z0-9_+-]{2,32}$/, 'ocrLanguage must be an ISO code or tessdata name (e.g. chi_sim+eng)')
    .optional(),
  optimizeImages: z.boolean().optional(),
  metadata: metadataSchema.optional(),
});

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`)
    .join('; ');
}

/** Parse the raw `options` form field. Empty/null → defaults. */
export function parseKindleOptions(raw: FormDataEntryValue | null | undefined): KindleOptions {
  if (raw == null) return {};
  if (typeof raw !== 'string') throw invalidOptions('options must be a JSON string');
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null' || trimmed === 'undefined') return {};
  if (trimmed.length > 16_384) throw invalidOptions('options payload is too large');

  let decoded: unknown;
  try {
    decoded = JSON.parse(trimmed);
  } catch {
    throw invalidOptions('not valid JSON');
  }
  if (decoded === null || decoded === undefined) return {};
  if (typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw invalidOptions('expected a JSON object');
  }
  const parsed = kindleOptionsSchema.safeParse(decoded);
  if (!parsed.success) throw invalidOptions(formatIssues(parsed.error));
  return parsed.data as KindleOptions;
}
