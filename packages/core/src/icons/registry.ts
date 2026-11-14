import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Project } from '../project.js';

/**
 * Icon sets: bundled Lucide (generic, ISC) and Simple Icons (brands,
 * languages, frameworks; only icons without their own non-CC0 license), plus
 * user packs declared in zark.yaml (`icons.packs`), e.g. the official AWS,
 * Azure or Google Cloud architecture icons, which their terms don't let us
 * redistribute. Ids are `<set>:<name>`.
 */
export interface IconInfo {
  id: string;
  set: string;
  name: string;
  title: string;
  keywords: string[];
}

export interface IconSet {
  id: string;
  title: string;
  count: number;
  builtin: boolean;
}

const require = createRequire(import.meta.url);
const MAX_PACK_SVG = 256 * 1024;

interface Builtin {
  index: IconInfo[];
  byId: Map<string, IconInfo>;
  file: Map<string, string>;
  /** Simple Icons brand colour, applied as fill. */
  hex: Map<string, string>;
}

let builtin: Builtin | undefined;
const svgCache = new Map<string, string>();

function loadBuiltin(): Builtin {
  if (builtin) return builtin;
  const index: IconInfo[] = [];
  const file = new Map<string, string>();
  const hex = new Map<string, string>();

  const lucideDir = dirname(require.resolve('lucide-static/package.json'));
  const tags: Record<string, string[]> = JSON.parse(readFileSync(join(lucideDir, 'tags.json'), 'utf8'));
  for (const f of readdirSync(join(lucideDir, 'icons')).filter((n) => n.endsWith('.svg')).sort()) {
    const name = f.slice(0, -4);
    const id = `lucide:${name}`;
    index.push({ id, set: 'lucide', name, title: name.replace(/-/g, ' '), keywords: tags[name] ?? [] });
    file.set(id, join(lucideDir, 'icons', f));
  }

  // simple-icons restricts `exports`; its main entry sits at the package root.
  const siDir = dirname(require.resolve('simple-icons'));
  const data: { title: string; slug: string; hex: string; aliases?: { aka?: string[] }; license?: { type?: string } }[] = JSON.parse(
    readFileSync(join(siDir, 'data', 'simple-icons.json'), 'utf8'),
  );
  for (const icon of data) {
    // Simple Icons is CC0, but some icons carry their own license; keep only CC0 or unlicensed ones.
    const license = icon.license?.type;
    if (license && license !== 'CC0-1.0') continue;
    const path = join(siDir, 'icons', `${icon.slug}.svg`);
    if (!existsSync(path)) continue;
    const id = `si:${icon.slug}`;
    index.push({ id, set: 'si', name: icon.slug, title: icon.title, keywords: icon.aliases?.aka ?? [] });
    file.set(id, path);
    hex.set(id, icon.hex);
  }
  builtin = { index, byId: new Map(index.map((i) => [i.id, i])), file, hex };
  return builtin;
}

function packDir(project: Project, dir: string) {
  return resolve(project.dir, dir);
}

/** Icons of the user packs declared in zark.yaml; read on demand (packs are small folders). */
export function packIcons(project: Project): IconInfo[] {
  const out: IconInfo[] = [];
  for (const pack of project.config.icons?.packs ?? []) {
    const dir = packDir(project, pack.dir);
    const names = existsSync(dir) ? readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.svg')).sort() : [];
    for (const f of names) {
      const name = f.slice(0, -4).toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
      out.push({ id: `${pack.id}:${name}`, set: pack.id, name, title: f.slice(0, -4).replace(/[-_]+/g, ' '), keywords: [] });
    }
  }
  return out;
}

function packFile(project: Project, id: string): string | undefined {
  const [set, name] = id.split(':');
  const pack = project.config.icons?.packs?.find((p) => p.id === set);
  if (!pack) return undefined;
  const dir = packDir(project, pack.dir);
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir).find((n) => n.toLowerCase().endsWith('.svg') && n.slice(0, -4).toLowerCase().replace(/[^a-z0-9._-]+/g, '-') === name);
  return f ? join(dir, f) : undefined;
}

export function iconSets(project: Project): IconSet[] {
  const b = loadBuiltin();
  const sets: IconSet[] = [
    { id: 'lucide', title: 'Lucide', count: b.index.filter((i) => i.set === 'lucide').length, builtin: true },
    { id: 'si', title: 'Simple Icons', count: b.index.filter((i) => i.set === 'si').length, builtin: true },
  ];
  const packs = packIcons(project);
  for (const pack of project.config.icons?.packs ?? []) sets.push({ id: pack.id, title: pack.id, count: packs.filter((i) => i.set === pack.id).length, builtin: false });
  return sets;
}

export function hasIcon(project: Project, id: string): boolean {
  const set = id.split(':')[0];
  if (set === 'lucide' || set === 'si') return loadBuiltin().byId.has(id);
  return !!packFile(project, id);
}

export function iconInfo(project: Project, id: string): IconInfo | undefined {
  return loadBuiltin().byId.get(id) ?? packIcons(project).find((i) => i.id === id);
}

/** Ranked search over all sets (or one): name, title, then keywords. */
export function searchIcons(project: Project, query: string, opts: { set?: string; limit?: number } = {}): IconInfo[] {
  const q = query.trim().toLowerCase();
  const all = [...loadBuiltin().index, ...packIcons(project)].filter((i) => !opts.set || i.set === opts.set);
  const limit = opts.limit ?? 60;
  if (!q) return all.slice(0, limit);
  const compact = q.replace(/[^a-z0-9]/g, '');
  const scored: [number, IconInfo][] = [];
  for (const i of all) {
    const title = i.title.toLowerCase();
    let score = 0;
    if (i.name === q || i.name === compact) score = 100;
    else if (i.name.startsWith(q) || i.name.startsWith(compact)) score = 80;
    else if (title === q) score = 75;
    else if (title.startsWith(q)) score = 60;
    else if (i.name.includes(compact) || title.includes(q)) score = 40;
    else if (i.keywords.some((k) => k.toLowerCase() === q)) score = 35;
    else if (i.keywords.some((k) => k.toLowerCase().includes(q))) score = 20;
    if (score) scored.push([score, i]);
  }
  return scored
    .sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length || a[1].id.localeCompare(b[1].id))
    .slice(0, limit)
    .map(([, i]) => i);
}

/** Removes anything executable or external from an SVG, keeping shapes. */
export function sanitizeSvg(svg: string): string | undefined {
  let s = svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|foreignObject|iframe|object|embed)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(script|foreignObject|iframe|object|embed)\b[^>]*\/>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s+(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, '')
    .replace(/<title>[\s\S]*?<\/title>/gi, '')
    .trim();
  const open = /<svg\b[^>]*>/i.exec(s);
  if (!open) return undefined;
  // Size is set by the box; keep only the viewBox and namespace from the root.
  const viewBox = /viewBox\s*=\s*"([^"]*)"/i.exec(open[0])?.[1] ?? (() => {
    const w = /\swidth\s*=\s*"([\d.]+)/i.exec(open[0])?.[1];
    const h = /\sheight\s*=\s*"([\d.]+)/i.exec(open[0])?.[1];
    return w && h ? `0 0 ${w} ${h}` : '0 0 24 24';
  })();
  const keep = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin'];
  const attrs = keep
    .map((k) => new RegExp(`\\s${k}\\s*=\\s*"([^"]*)"`, 'i').exec(open[0]))
    .map((m, i) => (m ? ` ${keep[i]}="${m[1]}"` : ''))
    .join('');
  s = s.slice(0, open.index) + `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attrs}>` + s.slice(open.index + open[0].length);
  return s.replace(/\s*\n\s*/g, ' ').replace(/>\s+</g, '><');
}

/** Relative luminance of a hex colour (0 = black, 1 = white). */
function luminance(hex: string) {
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Normalized, sanitized SVG for an icon id, or a catalog icon path relative to the architecture dir. */
export function iconSvg(project: Project, ref: string): string | undefined {
  const cacheable = ref.startsWith('lucide:') || ref.startsWith('si:');
  if (cacheable && svgCache.has(ref)) return svgCache.get(ref);
  let path: string | undefined;
  let svg: string | undefined;
  if (/^[a-z0-9-]+:[a-z0-9._-]+$/.test(ref)) {
    const b = loadBuiltin();
    path = b.file.get(ref) ?? packFile(project, ref);
    if (!path) return undefined;
    svg = sanitizeSvg(readFileSync(path, 'utf8'));
    const hex = b.hex.get(ref);
    // Brand colour, except near-black marks, which follow the theme text colour.
    if (svg && hex) svg = svg.replace('<svg ', `<svg fill="${luminance(hex) < 0.08 ? 'currentColor' : `#${hex}`}" `);
  } else {
    // Legacy catalog icon: an SVG path relative to the architecture dir.
    const file = resolve(project.dir, ref);
    if (!file.startsWith(resolve(project.dir)) || !file.toLowerCase().endsWith('.svg') || !existsSync(file) || statSync(file).size > MAX_PACK_SVG) return undefined;
    svg = sanitizeSvg(readFileSync(file, 'utf8'));
  }
  if (svg && cacheable) svgCache.set(ref, svg);
  return svg;
}

/** Every icon reference the project uses: entity icons and technology icons. */
export function usedIconRefs(project: Project): string[] {
  const refs = new Set<string>();
  for (const { entity } of project.entities.values()) if (entity.icon) refs.add(entity.icon);
  for (const t of project.catalog.technologies ?? []) if (t.icon) refs.add(t.icon);
  return [...refs].sort();
}

/** id -> svg for everything the project uses (shipped in the model snapshot, so boxes and PNGs need no fetch). */
export function usedIcons(project: Project): Record<string, string> {
  const out: Record<string, string> = {};
  for (const ref of usedIconRefs(project)) {
    const svg = iconSvg(project, ref);
    if (svg) out[ref] = svg;
  }
  return out;
}
