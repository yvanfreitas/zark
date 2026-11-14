import { z } from 'zod';

// Section 3: slug ids, 1-64 chars, a-z 0-9 and hyphen.
export const Slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'slug: a-z, 0-9 e hífen, 1 a 64 caracteres');
// `<origem>.<conexão>`
export const ConnectionRef = z.string().regex(/^[a-z0-9-]{1,64}\.[a-z0-9-]{1,64}$/, 'ref de conexão: <origem>.<conexão>');

export const Kind = z.enum(['actor', 'system', 'app', 'store', 'component']);
export const Status = z.enum(['live', 'future', 'deprecated', 'removed']);
export const Direction = z.enum(['outgoing', 'bidirectional']);
export type Kind = z.infer<typeof Kind>;

// Section 4, "Hierarquia permitida". null = raiz.
export const ALLOWED_PARENTS: Record<Kind, (Kind | null)[]> = {
  actor: [null],
  system: [null],
  app: ['system'],
  store: ['system'],
  component: ['app', 'store'],
};

const Link = z.strictObject({ label: z.string(), url: z.string() });

export const Connection = z.strictObject({
  id: Slug,
  to: Slug,
  label: z.string(),
  direction: Direction.optional(),
  description: z.string().optional(),
  via: Slug.optional(),
  technologies: z.array(Slug).optional(),
  status: Status.optional(),
  tags: z.array(Slug).optional(),
});

export const Entity = z.strictObject({
  id: Slug,
  name: z.string().min(1),
  kind: Kind,
  parent: Slug.nullable().optional(),
  caption: z.string().optional(),
  description: z.string().optional(),
  external: z.boolean().optional(),
  status: Status.optional(),
  technologies: z.array(Slug).optional(),
  tags: z.array(Slug).optional(),
  owner: Slug.optional(),
  links: z.array(Link).optional(),
  connections: z.array(Connection).optional(),
});

const Int = z.number().int();
const Side = z.enum(['top', 'right', 'bottom', 'left']);

export const Node = z.strictObject({
  x: Int,
  y: Int,
  w: Int.positive().optional(),
  h: Int.positive().optional(),
  expanded: z.boolean().optional(),
});

export const Edge = z.strictObject({
  // auto = orthogonal route around other boxes, computed when drawn (never stored as points).
  shape: z.enum(['straight', 'step', 'curved', 'auto']).optional(),
  from: Side.optional(),
  to: Side.optional(),
  points: z.array(z.tuple([Int, Int])).optional(),
  labelAt: z.number().min(0).max(1).optional(),
});

export const Group = z.strictObject({
  id: Slug,
  label: z.string(),
  members: z.array(Slug),
  style: z.enum(['dashed', 'solid']).optional(),
});

export const Note = z.strictObject({
  id: Slug,
  text: z.string(),
  x: Int,
  y: Int,
  w: Int.positive().optional(),
});

export const Drawing = z.strictObject({
  id: Slug,
  name: z.string().min(1),
  description: z.string().optional(),
  scope: Slug.nullable().optional(),
  nodes: z.record(Slug, Node).optional(),
  edges: z.record(ConnectionRef, Edge).optional(),
  groups: z.array(Group).optional(),
  notes: z.array(Note).optional(),
});

export const Step = z.strictObject({
  id: Slug,
  via: ConnectionRef,
  text: z.string(),
  reply: z.boolean().optional(),
  reverse: z.boolean().optional(),
  description: z.string().optional(),
});

export type FlowItem =
  | z.infer<typeof Step>
  | { parallel: FlowItem[][] }
  | { alternatives: { name: string; steps: FlowItem[] }[] }
  | { subflow: string }
  | { note: string };

export const FlowItem: z.ZodType<FlowItem> = z.lazy(() =>
  z.union([
    Step,
    z.strictObject({ parallel: z.array(z.array(FlowItem)) }),
    z.strictObject({ alternatives: z.array(z.strictObject({ name: z.string(), steps: z.array(FlowItem) })) }),
    z.strictObject({ subflow: Slug }),
    z.strictObject({ note: z.string() }),
  ]),
);

export const Flow = z.strictObject({
  id: Slug,
  name: z.string().min(1),
  description: z.string().optional(),
  drawing: Slug,
  steps: z.array(FlowItem).optional(),
});

const CatalogItem = z.strictObject({
  id: Slug,
  name: z.string(),
  color: z.string().optional(),
  icon: z.string().optional(),
});

export const Catalog = z.strictObject({
  technologies: z.array(CatalogItem).optional(),
  tags: z.array(CatalogItem).optional(),
  teams: z.array(CatalogItem).optional(),
});

export const Config = z.strictObject({
  schema: z.literal(1),
  name: z.string(),
  defaultDrawing: Slug.optional(),
  grid: Int.positive().optional(),
  render: z
    .strictObject({
      commit: z.enum(['pr', 'always', 'never']).optional(),
      scale: z.number().positive().optional(),
      theme: z.enum(['light', 'dark']).optional(),
    })
    .optional(),
  git: z.strictObject({ baseBranch: z.string().optional(), branchPrefix: z.string().optional(), provider: z.enum(['github', 'gitlab']).optional() }).optional(),
  rules: z.record(z.string().regex(/^[EW]\d{3}$/), z.enum(['error', 'warning', 'off'])).optional(),
  mcp: z.strictObject({ prRequiresUi: z.boolean().optional() }).optional(),
});

export type Entity = z.infer<typeof Entity>;
export type Connection = z.infer<typeof Connection>;
export type Drawing = z.infer<typeof Drawing>;
export type DrawingNode = z.infer<typeof Node>;
export type DrawingEdge = z.infer<typeof Edge>;
export type Step = z.infer<typeof Step>;
export type Flow = z.infer<typeof Flow>;
export type Catalog = z.infer<typeof Catalog>;
export type Config = z.infer<typeof Config>;

// Canonical key order (section 9, "Formato canônico"). Unknown keys keep their place at the end.
export const KEY_ORDER: Record<string, string[]> = {
  config: ['schema', 'name', 'defaultDrawing', 'grid', 'render', 'git', 'rules', 'mcp'],
  catalog: ['technologies', 'tags', 'teams'],
  catalogItem: ['id', 'name', 'color', 'icon'],
  entity: ['id', 'name', 'kind', 'parent', 'caption', 'description', 'external', 'status', 'technologies', 'tags', 'owner', 'links', 'connections'],
  link: ['label', 'url'],
  connection: ['id', 'to', 'label', 'direction', 'description', 'via', 'technologies', 'status', 'tags'],
  drawing: ['id', 'name', 'description', 'scope', 'nodes', 'edges', 'groups', 'notes'],
  node: ['x', 'y', 'w', 'h', 'expanded'],
  edge: ['shape', 'from', 'to', 'points', 'labelAt'],
  group: ['id', 'label', 'members', 'style'],
  note: ['id', 'text', 'x', 'y', 'w'],
  flow: ['id', 'name', 'description', 'drawing', 'steps'],
  step: ['id', 'via', 'text', 'reply', 'reverse', 'description'],
};

export const SCHEMA_URL = (name: 'entity' | 'drawing' | 'flow' | 'catalog' | 'config') =>
  `https://unpkg.com/zark/schema/${name}.json`;

export function jsonSchemas() {
  return {
    entity: z.toJSONSchema(Entity, { io: 'input' }),
    drawing: z.toJSONSchema(Drawing, { io: 'input' }),
    flow: z.toJSONSchema(Flow, { io: 'input' }),
    catalog: z.toJSONSchema(Catalog, { io: 'input' }),
    config: z.toJSONSchema(Config, { io: 'input' }),
  };
}
