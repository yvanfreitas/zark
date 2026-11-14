import { parseDocument } from 'yaml';
import { formatText } from './writer.js';

/** Format version written and understood by this Zark. */
export const CURRENT_SCHEMA = 1;

export interface Migration {
  from: number;
  to: number;
  describe: string;
  /** Returns the files rewritten for the next version (path -> text, null = delete). */
  apply: (texts: Map<string, string>) => Map<string, string | null>;
}

// ponytail: the format has not changed since version 1. A schema 2 adds its
// step here ({ from: 1, to: 2, ... }) and `zark migrate` applies it.
export const MIGRATIONS: Migration[] = [];

export class MigrationError extends Error {}

export function schemaVersion(configText: string | undefined): number | undefined {
  if (configText === undefined) return undefined;
  const value = parseDocument(configText).get('schema');
  return typeof value === 'number' ? value : undefined;
}

export interface MigrationResult {
  from: number;
  to: number;
  steps: string[];
  /** Changed files only (path -> new text, null = delete). */
  files: Map<string, string | null>;
}

/** Brings every file up to `target`, one step at a time; changes nothing when already current. */
export function migrate(texts: Map<string, string>, migrations: Migration[] = MIGRATIONS, target = CURRENT_SCHEMA): MigrationResult {
  const from = schemaVersion(texts.get('zark.yaml'));
  if (from === undefined) throw new MigrationError('zark.yaml has no schema field');
  if (from > target) throw new MigrationError(`The project uses schema ${from}, newer than this Zark (supports ${target}). Upgrade Zark`);
  const working = new Map(texts);
  const files = new Map<string, string | null>();
  const steps: string[] = [];
  for (let v = from; v < target; ) {
    const step = migrations.find((m) => m.from === v);
    if (!step) throw new MigrationError(`There is no migration from schema ${v} to ${v + 1}`);
    for (const [path, text] of step.apply(working)) {
      if (text === null) working.delete(path);
      else working.set(path, text);
      files.set(path, text);
    }
    steps.push(`${step.from} -> ${step.to}: ${step.describe}`);
    v = step.to;
  }
  if (steps.length) {
    const config = parseDocument(working.get('zark.yaml')!);
    config.set('schema', target);
    const text = formatText('config', String(config));
    working.set('zark.yaml', text);
    files.set('zark.yaml', text);
  }
  return { from, to: steps.length ? target : from, steps, files };
}
