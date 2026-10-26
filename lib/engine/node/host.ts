/**
 * Node engine host factory.
 *
 * `index.ts` stays isomorphic; the server creates a host here and passes it to
 * `convert(input, req, host)`. Probes happen once per call and every adapter
 * degrades to `available:false` when the binary is missing — the API can then
 * report honest engine status instead of failing at conversion time.
 */

import type { EngineHost } from '../index';
import { calibreHost } from './calibre';
import { pandocHost } from './pandoc';
import { tesseractHost } from './ocr';

export interface EngineProbe {
  calibre: boolean;
  pandoc: boolean;
  tesseract: boolean;
}

let cached: EngineHost | undefined;

export async function createEngineHost(options: { probe?: boolean } = {}): Promise<EngineHost> {
  if (options.probe === false && cached) return cached;
  const [calibre, pandoc, tesseract] = await Promise.all([
    calibreHost(),
    pandocHost(),
    tesseractHost(),
  ]);
  const host: EngineHost = { calibre, pandoc, tesseract };
  cached = host;
  return host;
}

export async function probeEngines(host?: EngineHost): Promise<EngineProbe> {
  const resolved = host ?? (await createEngineHost());
  return {
    calibre: resolved.calibre?.available === true,
    pandoc: resolved.pandoc?.available === true,
    tesseract: resolved.tesseract?.available === true,
  };
}

export { calibreHost } from './calibre';
export { pandocHost } from './pandoc';
export { tesseractHost } from './ocr';
export { convertWithCalibre, findCalibre } from './calibre';
export { convertWithPandoc, findPandoc } from './pandoc';
export { ocrPdf, ocrImage, findTesseract, findPdftoppm } from './ocr';
