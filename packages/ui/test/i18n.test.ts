// Dictionary parity and Portuguese rendering of the core's keyed messages.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CHANGE_EN, IMPACT_EN, PROBLEM_EN, renderMessage, buildProject, readTexts, validate } from '../../core/src/index.js';
import { en, pt } from '../src/i18n-dict';
import { CHANGE_PT, IMPACT_PT, PROBLEM_PT } from '../src/i18n-messages';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ai-chat/architecture', import.meta.url));
const keys = (o: object) => Object.keys(o).sort();
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n dictionaries', () => {
  it('has every UI key in both English and Portuguese', () => {
    expect(keys(pt)).toEqual(keys(en));
    for (const k of keys(en)) expect(pt[k].trim(), k).not.toBe('');
  });

  it('uses the same placeholders in both languages', () => {
    for (const k of keys(en)) expect(placeholders(pt[k]), k).toEqual(placeholders(en[k]));
  });

  it('has a Portuguese template for every problem, change and impact the core emits', () => {
    expect(keys(PROBLEM_PT)).toEqual(keys(PROBLEM_EN));
    expect(keys(CHANGE_PT)).toEqual(keys(CHANGE_EN));
    expect(keys(IMPACT_PT)).toEqual(keys(IMPACT_EN));
  });
});

describe('problem localization', () => {
  it('renders E041 in Portuguese from its params, and in English by default', async () => {
    const texts = await readTexts(EXAMPLE);
    const flowPath = [...texts.keys()].find((p) => p.startsWith('flows/'))!;
    const project = buildProject(EXAMPLE, texts);
    const flow = project.flows.get(flowPath.slice(6, -5))!.flow;
    // Walk the first outgoing step backwards: `reverse: true` without reply.
    const step = flow.steps!.find((s) => 'via' in s && project.connections.get(s.via)?.conn.direction !== 'bidirectional') as { id: string; via: string };
    texts.set(flowPath, texts.get(flowPath)!.replace(`    via: ${step.via}\n`, `    via: ${step.via}\n    reverse: true\n`));
    const e041 = validate(buildProject(EXAMPLE, texts)).find((p) => p.code === 'E041')!;
    expect(e041.key).toBe('E041');
    expect(e041.message).toMatch(/goes against .* Reverse the connection or mark reply: true/);
    const ptText = renderMessage(PROBLEM_PT, e041.key, e041.params, e041.message);
    expect(ptText).toContain(`passo ${step.id} anda na contramão de ${step.via}`);
    expect(ptText).toContain('Inverta a conexão ou marque reply: true');
  });

  it('falls back to the English message when the key is unknown', () => {
    expect(renderMessage(PROBLEM_PT, 'X999', {}, 'english text')).toBe('english text');
  });
});
