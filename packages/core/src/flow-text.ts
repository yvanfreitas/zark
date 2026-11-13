// Pure helpers (no Node imports) shared by core, UI, CLI and MCP.
import type { FlowItem, Step } from './schema.js';

export interface NumberedStep {
  step: Step;
  /** Display number, computed, never stored: 1, 2, 3a, 3b, 4a.1 ... */
  number: string;
  depth: number;
  /** Alternative branch name, when inside `alternatives`. */
  branch?: string;
}

const letter = (i: number) => String.fromCharCode(97 + (i % 26));

export function numberSteps(items: FlowItem[] | undefined, prefix = '', depth = 0, branch?: string): NumberedStep[] {
  const out: NumberedStep[] = [];
  let n = 0;
  for (const item of items ?? []) {
    if ('note' in item) continue;
    n++;
    const here = prefix ? `${prefix}.${n}` : String(n);
    if ('via' in item) out.push({ step: item, number: here, depth, branch });
    else if ('parallel' in item) item.parallel.forEach((b, i) => out.push(...numberBranch(b, `${here}${letter(i)}`, depth + 1, branch)));
    else if ('alternatives' in item) item.alternatives.forEach((a, i) => out.push(...numberBranch(a.steps, `${here}${letter(i)}`, depth + 1, a.name)));
  }
  return out;
}

function numberBranch(items: FlowItem[], label: string, depth: number, branch?: string): NumberedStep[] {
  const steps = numberSteps(items, label, depth, branch);
  // A single-step branch is just "3a", not "3a.1".
  if (steps.length === 1 && items.length === 1 && 'via' in items[0]) steps[0].number = label;
  return steps;
}

export type FlowResolver = (id: string) => FlowItem[] | undefined;

/**
 * Playback frames: each frame is the set of steps active at once.
 * Parallel branches advance together; for alternatives, `choice[i]` picks
 * the branch (default 0) for the i-th alternatives block met.
 */
export function playbackFrames(items: FlowItem[] | undefined, choice: Record<string, number> = {}, resolve?: FlowResolver, path = 'r', seen: string[] = []): Step[][] {
  const frames: Step[][] = [];
  (items ?? []).forEach((item, i) => {
    const key = `${path}.${i}`;
    if ('via' in item) frames.push([item]);
    else if ('parallel' in item) {
      const branches = item.parallel.map((b, bi) => playbackFrames(b, choice, resolve, `${key}.${bi}`, seen));
      const len = Math.max(0, ...branches.map((b) => b.length));
      for (let k = 0; k < len; k++) frames.push(branches.flatMap((b) => b[k] ?? []));
    } else if ('alternatives' in item) {
      const alt = item.alternatives[choice[key] ?? 0];
      if (alt) frames.push(...playbackFrames(alt.steps, choice, resolve, key, seen));
    } else if ('subflow' in item && resolve && !seen.includes(item.subflow)) {
      frames.push(...playbackFrames(resolve(item.subflow), choice, resolve, `${key}.s`, [...seen, item.subflow]));
    }
  });
  return frames;
}

/** Keys of every alternatives block (for choice tabs), in document order. */
export function alternativeBlocks(items: FlowItem[] | undefined, path = 'r'): { key: string; names: string[] }[] {
  const out: { key: string; names: string[] }[] = [];
  (items ?? []).forEach((item, i) => {
    const key = `${path}.${i}`;
    if ('parallel' in item) item.parallel.forEach((b, bi) => out.push(...alternativeBlocks(b, `${key}.${bi}`)));
    else if ('alternatives' in item) {
      out.push({ key, names: item.alternatives.map((a) => a.name) });
      item.alternatives.forEach((a) => out.push(...alternativeBlocks(a.steps, key)));
    }
  });
  return out;
}

export interface ConnectionInfo {
  from: string;
  to: string;
  direction?: 'outgoing' | 'bidirectional';
}

/** Who sends the message of a step: reply or reverse walks destination -> origin. */
export function stepEnds(step: Step, conn: ConnectionInfo): { from: string; to: string; backwards: boolean } {
  const backwards = !!step.reply !== !!step.reverse;
  return backwards ? { from: conn.to, to: conn.from, backwards } : { from: conn.from, to: conn.to, backwards };
}

/** Mermaid `sequenceDiagram` equivalent of a flow (section 6, "Export"). */
export function flowToMermaid(
  flow: { name: string; steps?: FlowItem[] },
  lookup: { connection: (ref: string) => ConnectionInfo | undefined; name: (id: string) => string; subflow?: FlowResolver },
): string {
  const participants: string[] = [];
  const pid = (id: string) => {
    if (!participants.includes(id)) participants.push(id);
    return id.replace(/[^A-Za-z0-9_]/g, '_');
  };
  const esc = (s: string) => s.replace(/[;#\n]/g, ' ');
  const body: string[] = [];
  const emit = (items: FlowItem[] | undefined, indent: string, seen: string[]) => {
    for (const item of items ?? []) {
      if ('via' in item) {
        const conn = lookup.connection(item.via);
        if (!conn) {
          body.push(`${indent}%% conexão inexistente: ${item.via}`);
          continue;
        }
        const ends = stepEnds(item, conn);
        body.push(`${indent}${pid(ends.from)}${item.reply ? '-->>' : '->>'}${pid(ends.to)}: ${esc(item.text)}`);
      } else if ('parallel' in item) {
        item.parallel.forEach((branch, i) => {
          body.push(`${indent}${i === 0 ? 'par' : 'and'}`);
          emit(branch, indent + '  ', seen);
        });
        body.push(`${indent}end`);
      } else if ('alternatives' in item) {
        item.alternatives.forEach((alt, i) => {
          body.push(`${indent}${i === 0 ? 'alt' : 'else'} ${esc(alt.name)}`);
          emit(alt.steps, indent + '  ', seen);
        });
        body.push(`${indent}end`);
      } else if ('subflow' in item) {
        const sub = lookup.subflow?.(item.subflow);
        if (sub && !seen.includes(item.subflow)) {
          body.push(`${indent}rect rgba(128, 128, 128, 0.1)`);
          body.push(`${indent}  %% subfluxo ${item.subflow}`);
          emit(sub, indent + '  ', [...seen, item.subflow]);
          body.push(`${indent}end`);
        } else body.push(`${indent}%% subfluxo ${item.subflow}`);
      } else if ('note' in item && participants.length) {
        body.push(`${indent}Note over ${pid(participants[0])}: ${esc(item.note)}`);
      }
    }
  };
  emit(flow.steps, '  ', []);
  const header = participants.map((id) => `  participant ${pid(id)} as ${esc(lookup.name(id))}`);
  return ['sequenceDiagram', `  title ${esc(flow.name)}`, ...header, ...body].join('\n') + '\n';
}
