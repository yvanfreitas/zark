import type { WorkspaceEntry } from './types';

/** A folder group (no `repo`) or a repo; a repo may also hold nested folders and repos. */
export interface RepoTreeNode {
  path: string;
  label: string;
  repo?: WorkspaceEntry;
  children: RepoTreeNode[];
}

/** Folder paths above a repo key: `a/b/c` -> `['a', 'a/b']`. */
export function ancestorsOf(key: string): string[] {
  const parts = key.split('/');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
}

export function buildRepoTree(repos: WorkspaceEntry[]): RepoTreeNode[] {
  const roots: RepoTreeNode[] = [];
  const byPath = new Map<string, RepoTreeNode>();
  for (const repo of repos) {
    const parts = repo.key.split('/');
    let siblings = roots;
    parts.forEach((label, i) => {
      const path = parts.slice(0, i + 1).join('/');
      let node = byPath.get(path);
      if (!node) {
        node = { path, label, children: [] };
        byPath.set(path, node);
        siblings.push(node);
      }
      if (i === parts.length - 1) node.repo = repo;
      siblings = node.children;
    });
  }
  const sort = (nodes: RepoTreeNode[]) => {
    nodes.sort((a, b) => a.label.localeCompare(b.label));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}
