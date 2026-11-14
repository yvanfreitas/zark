import { numberSteps, playbackFrames, stepEnds } from '@core/flow-text';
import type { Index } from './model';
import type { FlowState } from './store';
import type { EdgeData } from './canvas/build';
import type { Model } from './types';

/** Derived state of the open flow: frames, numbering and what to highlight. */
export function flowView(model: Model, index: Index, state: FlowState | null) {
  const flow = state ? model.flows.find((f) => f.id === state.id) : undefined;
  if (!flow || !state) return undefined;
  const resolve = (id: string) => model.flows.find((f) => f.id === id)?.steps;
  const numbered = numberSteps(flow.steps);
  const numberOf = new Map(numbered.map((n) => [n.step.id, n.number]));
  const frames = playbackFrames(flow.steps, state.choice, resolve);
  const all = state.frame === -1;
  const frame = all ? -1 : Math.min(state.frame, Math.max(0, frames.length - 1));
  const shown = all ? frames.flat() : frames[frame] ?? [];
  const activeSteps = new Map<string, NonNullable<EdgeData['active']>>();
  for (const step of shown) {
    const c = index.conns.get(step.via);
    if (!c) continue;
    const ends = stepEnds(step, { from: c.from, to: c.to, direction: c.conn.direction });
    const list = activeSteps.get(step.via) ?? [];
    list.push({ backwards: ends.backwards, text: step.text, number: numberOf.get(step.id) ?? '', reply: !!step.reply });
    activeSteps.set(step.via, list);
  }
  const flowRefs = new Set(frames.flat().map((s) => s.via));
  // An empty flow dims nothing, so its first connection can be picked.
  return { flow, numbered, numberOf, frames, frame, activeSteps, flowRefs: flowRefs.size ? flowRefs : undefined, activeIds: new Set(shown.map((s) => s.id)) };
}
