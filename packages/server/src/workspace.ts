import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface WorkspaceRepo {
  key: string;
  prefix: string;
  /** The repo folder. */
  root: string;
  /** `<root>/architecture`. */
  dir: string;
}

/** Finds direct child folders of `root` that contain `architecture/zark.yaml`, sorted by name. */
export async function discoverWorkspace(root: string): Promise<WorkspaceRepo[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const repos = entries
    .filter((e) => e.isDirectory() && existsSync(join(root, e.name, 'architecture', 'zark.yaml')))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({
      key: name,
      prefix: `/r/${encodeURIComponent(name)}`,
      root: join(root, name),
      dir: join(root, name, 'architecture'),
    }));
  if (repos.length === 0) throw new Error(`No repos with architecture/zark.yaml under ${root}`);
  return repos;
}
