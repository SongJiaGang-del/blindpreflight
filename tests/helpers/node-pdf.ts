import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as legacy from 'pdfjs-dist/legacy/build/pdf.mjs'
import { extractDocument, type ExtractResult, type PdfjsLib } from '@/parsers/pdf/extract'
import type { DocumentRole } from '@/domain/types'

const ROOT = join(import.meta.dirname, '..', '..')
const lib = legacy as unknown as PdfjsLib

export const nodeAssets = {
  standardFontDataUrl: join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/',
  cMapUrl: join(ROOT, 'node_modules', 'pdfjs-dist', 'cmaps') + '/',
}

export function sampleBytes(name: string): Uint8Array {
  return new Uint8Array(readFileSync(join(ROOT, 'public', 'samples', name)))
}

export async function extractBytes(
  bytes: Uint8Array,
  displayName: string,
  role: DocumentRole = 'main',
  id = displayName,
): Promise<ExtractResult> {
  return extractDocument({ id, role, displayName, bytes }, { lib, assets: nodeAssets })
}

export async function extractSample(name: string, role: DocumentRole = 'main'): Promise<ExtractResult> {
  return extractBytes(sampleBytes(name), name, role)
}
