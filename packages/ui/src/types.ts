import type { Catalog, Connection, Drawing, Entity, Flow, FlowItem, Step, DrawingEdge, DrawingNode } from '@core/schema';
import type { Problem } from '@core/validate';

export type { Catalog, Connection, Drawing, Entity, Flow, FlowItem, Step, DrawingEdge, DrawingNode, Problem };

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
}

export interface Conn {
  ref: string;
  from: string;
  to: string;
  conn: Connection;
  file: string;
}
