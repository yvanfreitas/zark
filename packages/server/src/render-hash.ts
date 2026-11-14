import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { crc32 } from 'node:zlib';
import { allSteps, ancestors, type Problem, type Project } from '@zark/core';

/** Bump when the canvas look changes, so committed PNGs are re-rendered. */
export const RENDERER_VERSION = '4';
const KEY = 'zark-hash';

export interface RenderTarget {
  drawing?: string;
  flow?: string;
  step?: string;
}

export function targetFile(t: RenderTarget): string {
  if (t.flow) return t.step ? `${t.flow}--${t.step}.png` : `${t.flow}.png`;
  return `${t.drawing}.png`;
}

/** Hash of every input that affects the picture of a drawing or flow. */
export function renderHash(project: Project, target: RenderTarget): string {
  const flow = target.flow ? project.flows.get(target.flow)?.flow : undefined;
  const drawingId = flow?.drawing ?? target.drawing!;
  const drawing = project.drawings.get(drawingId)?.drawing;
  const ids = new Set<string>();
  for (const id of Object.keys(drawing?.nodes ?? {})) ancestors(project, id).forEach((a) => ids.add(a));
  const edges = Object.keys(drawing?.edges ?? {}).map((ref) => project.connections.get(ref));
  for (const c of edges) if (c) [c.from, c.conn.to].forEach((e) => ancestors(project, e).forEach((a) => ids.add(a)));
  const entities = [...ids].sort().map((id) => {
    const e = project.entities.get(id)?.entity;
    return e && { ...e, connections: undefined };
  });
  const scopes = [...project.drawings.values()].map((d) => d.drawing.scope).filter(Boolean).sort();
  const input = {
    v: RENDERER_VERSION,
    theme: project.config.render.theme,
    scale: project.config.render.scale,
    drawing,
    entities,
    edges: edges.map((c) => c && { ref: c.ref, from: c.from, ...c.conn }),
    catalog: project.catalog,
    scopes,
    flow: flow && { ...flow, steps: allSteps(flow) },
    step: target.step,
  };
  return createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 32);
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Inserts a tEXt chunk with the input hash right after IHDR. */
export function embedHash(png: Buffer, hash: string): Buffer {
  const ihdrEnd = 8 + 8 + png.readUInt32BE(8) + 4;
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk('tEXt', Buffer.from(`${KEY}\0${hash}`, 'latin1')), png.subarray(ihdrEnd)]);
}

export function readHash(png: Buffer): string | undefined {
  let offset = 8;
  while (offset + 8 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'tEXt') {
      const text = png.toString('latin1', offset + 8, offset + 8 + length);
      const [key, value] = text.split('\0');
      if (key === KEY) return value;
    }
    if (type === 'IDAT' || type === 'IEND') return undefined;
    offset += 12 + length;
  }
  return undefined;
}

/** Parses `<drawing>.png`, `<flow>.png` or `<flow>--<step>.png` back to a target. */
export function parseTarget(project: Project, file: string): RenderTarget | undefined {
  const name = file.replace(/\.png$/, '');
  const [a, step] = name.split('--');
  if (step) return project.flows.has(a) ? { flow: a, step } : undefined;
  if (project.drawings.has(a)) return { drawing: a };
  if (project.flows.has(a)) return { flow: a };
  return undefined;
}

/** W030: PNGs in rendered/ whose input hash no longer matches the model. */
export async function renderedProblems(project: Project): Promise<Problem[]> {
  const dir = join(project.dir, 'rendered');
  const names = await readdir(dir).catch(() => [] as string[]);
  const out: Problem[] = [];
  for (const name of names.filter((n) => n.endsWith('.png'))) {
    const target = parseTarget(project, name);
    const stored = readHash(await readFile(join(dir, name)));
    if (!target) {
      out.push({ code: 'W030', severity: 'warning', file: `rendered/${name}`, message: `${name} não corresponde a nenhum desenho ou fluxo` });
    } else if (stored !== renderHash(project, target)) {
      out.push({ code: 'W030', severity: 'warning', file: `rendered/${name}`, message: `${name} desatualizado. Rode "zark render"`, ref: `rendered:${target.drawing ?? target.flow}` });
    }
  }
  return out;
}

export interface StaleRender {
  target: RenderTarget;
  file: string;
  reason: 'outdated' | 'missing';
}

export interface RenderStatus {
  commitMode: 'pr' | 'always' | 'never';
  stale: StaleRender[];
}

/**
 * Committed PNGs that no longer match the model. A drawing's PNG counts as
 * missing only when the project keeps renders in the repo (`always`, or
 * rendered/ already holds some); flow PNGs count only if they already exist.
 * `never` mode commits nothing, so nothing is ever stale.
 */
export async function renderStatus(project: Project): Promise<RenderStatus> {
  const commitMode = project.config.render.commit;
  if (commitMode === 'never') return { commitMode, stale: [] };
  const dir = join(project.dir, 'rendered');
  const names = new Set((await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.png')));
  const keepsRenders = commitMode === 'always' || names.size > 0;
  const stale: StaleRender[] = [];
  for (const id of [...project.drawings.keys()].sort()) {
    const target: RenderTarget = { drawing: id };
    const file = targetFile(target);
    if (!names.has(file)) {
      if (keepsRenders) stale.push({ target, file, reason: 'missing' });
      continue;
    }
    if (readHash(await readFile(join(dir, file))) !== renderHash(project, target)) stale.push({ target, file, reason: 'outdated' });
  }
  for (const file of [...names].sort()) {
    const target = parseTarget(project, file);
    if (!target?.flow) continue;
    if (readHash(await readFile(join(dir, file))) !== renderHash(project, target)) stale.push({ target, file, reason: 'outdated' });
  }
  return { commitMode, stale };
}
