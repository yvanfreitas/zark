import { parse } from 'yaml';
import type { Project } from '../project.js';
import { importContext, type ImportResult } from './common.js';
import { fromIcePanel, isIcePanel } from './icepanel.js';
import { fromStructurizr, isStructurizr } from './structurizr.js';

export * from './common.js';
export * from './icepanel.js';
export * from './structurizr.js';

export type ImportFormat = 'structurizr' | 'icepanel';

/** Recognizes a parsed file by shape: Structurizr workspace or IcePanel LandscapeImportData. */
export function detectFormat(data: unknown): ImportFormat | undefined {
  if (isStructurizr(data)) return 'structurizr';
  if (isIcePanel(data)) return 'icepanel';
  return undefined;
}

/** Normalizes CLI/API format names: icepanel, icepanel-json, icepanel-yaml, structurizr, auto. */
export function normalizeFormat(name: string | undefined): ImportFormat | 'auto' {
  const f = (name ?? 'auto').toLowerCase();
  if (f === 'structurizr' || f === 'structurizr-json') return 'structurizr';
  if (f.startsWith('icepanel')) return 'icepanel';
  if (f === 'auto') return 'auto';
  throw new Error(`Formato de importação desconhecido: ${name}. Use structurizr, icepanel-json ou icepanel-yaml`);
}

/**
 * Parses file text (JSON or YAML) and converts it into core operations for `project`.
 * Throws with a readable message when the text or its shape is not recognized.
 */
export function planImport(text: string, format: string | undefined, project?: Project): ImportResult & { format: ImportFormat } {
  let data: unknown;
  try {
    data = parse(text);
  } catch (err) {
    throw new Error(`Arquivo inválido: ${(err as Error).message.split('\n')[0]}`);
  }
  const wanted = normalizeFormat(format);
  const found = detectFormat(data);
  const fmt = wanted === 'auto' ? found : wanted;
  if (!fmt) throw new Error('Formato não reconhecido: esperava um workspace JSON do Structurizr ou um modelo do IcePanel (modelObjects)');
  if (found !== fmt) throw new Error(`O arquivo não parece ${fmt === 'structurizr' ? 'um workspace do Structurizr' : 'um modelo do IcePanel'}`);
  const ctx = importContext(project);
  const result = fmt === 'structurizr' ? fromStructurizr(data as never, ctx) : fromIcePanel(data as never, ctx);
  return { ...result, format: fmt };
}
