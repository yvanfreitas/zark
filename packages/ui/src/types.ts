import type { CodeGraph, Catalog, Connection, Drawing, Entity, Flow, FlowItem, Step, DrawingEdge, DrawingNode } from '@core/schema';
import type { Problem } from '@core/validate';

export type { CodeGraph, Catalog, Connection, Drawing, Entity, Flow, FlowItem, Step, DrawingEdge, DrawingNode, Problem };

export type WithFile<T> = T & { file: string };

export interface Model {
  /** Absolute path of the architecture dir (for "Open in editor"). */
  root: string;
  config: {
    name: string;
    grid: number;
    defaultDrawing?: string;
    render: { commit: 'pr' | 'always' | 'never'; scale: number; theme: 'light' | 'dark' };
    git: { baseBranch: string; branchPrefix: string };
    mcp?: { prRequiresUi?: boolean };
  };
  catalog: Catalog;
  entities: WithFile<Entity>[];
  drawings: WithFile<Drawing>[];
  flows: WithFile<Flow>[];
  files: Record<string, { hash: string; kind: string; error?: { message: string; line?: number } }>;
  problems: Problem[];
  /** SVG of every icon the project uses (entity and technology icons), keyed by reference. */
  icons?: Record<string, string>;
  /** Generated code-level graphs (C4 level 4), sorted by component. */
  codeGraphs?: CodeGraph[];
}

export interface Conn {
  ref: string;
  from: string;
  to: string;
  conn: Connection;
  file: string;
}

/** One repo of a workspace server (`GET /api/workspace`). */
export interface WorkspaceEntry {
  key: string;
  prefix: string;
  name: string;
  dir: string;
  drawings: number;
  errors: number;
  warnings: number;
  running?: { url: string };
}
