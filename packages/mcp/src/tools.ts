import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  hasIcon,
  iconSets,
  searchIcons,
  suggestIcons,
  allSteps,
  errorsOf,
  flowToMermaid,
  jsonSchemas,
  numberSteps,
  resolveEndpoint,
  warningsOf,
  type ApplyResult,
  type Op,
  type Problem,
  type Project,
} from '@zark/core';
import type { ZarkService } from '@zark/server';

const json = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const fmtProblem = (p: Problem) => `${p.code} ${p.ref ?? p.file}${p.line ? `:${p.line}` : ''}: ${p.message}`;

/** One-line next step for the most relevant problem. */
function hintFor(problems: Problem[], result?: ApplyResult): string | undefined {
  if (result?.impact) return 'The deletion affects other items (see impact). Repeat with cascade: true to confirm.';
  if (result?.conflict) return 'The file changed on disk. Read it again and retry.';
  const p = problems[0];
  if (!p) return undefined;
  switch (p.code) {
    case 'W003': return `Use draw_connections to draw ${p.ref} in a drawing.`;
    case 'W001':
    case 'W002': return `Use place_entities to place ${p.ref} in a drawing.`;
    case 'W010': return 'Overlapping boxes: use move_nodes or auto_layout and check with render.';
    case 'W013': return 'Overlapping labels: use fix_label_overlaps on the drawing (returns pinned labels to automatic placement) and check with render.';
    case 'W004': return `Give connection ${p.ref} a descriptive label with update_connection.`;
    case 'E041': return 'The step goes against the connection: use reverse_connection or mark the step with reply: true.';
    case 'E044': return 'Draw the connection in the flow drawing with draw_connections.';
    case 'E032': return 'Place one of the ends (or an ancestor) in the drawing before drawing the connection.';
    case 'E011': return 'Hierarchy: actor/system at the root, app/store inside system, component inside app/store.';
    default: return p.code.startsWith('E') ? 'Fix the error and retry; the message lists the valid values.' : undefined;
  }
}

function contract(result: ApplyResult) {
  const changedFiles = [...result.files.keys()];
  if (!result.ok) {
    const errors = result.newErrors.length ? result.newErrors : [];
    return {
      ok: false,
      error: result.error,
      ...(result.impact ? { impact: result.impact } : {}),
      changedFiles: [],
      changes: result.changes.map((c) => c.text),
      problems: { errors: errors.map(fmtProblem), warnings: [] as string[] },
      hint: hintFor(errors, result),
    };
  }
  // Warnings relevant to what was just written.
  const touched = (p: Problem) => changedFiles.includes(p.file);
  const warnings = warningsOf(result.problems).filter(touched);
  const errors = errorsOf(result.problems);
  return {
    ok: true,
    changedFiles,
    changes: result.changes.map((c) => c.text),
    problems: { errors: errors.map(fmtProblem), warnings: warnings.map(fmtProblem) },
    hint: hintFor([...errors, ...warnings]),
  };
}

const Side = z.enum(['top', 'right', 'bottom', 'left']);
const Kind = z.enum(['actor', 'system', 'app', 'store', 'component']);
const Status = z.enum(['live', 'future', 'deprecated', 'removed']);
const dryRun = z.boolean().optional().describe('Validate without writing');
const fields = z.record(z.string(), z.unknown());
const EdgeShape = {
  shape: z.enum(['straight', 'step', 'curved', 'auto']).optional(),
  from: Side.optional(),
  to: Side.optional(),
  points: z.array(z.tuple([z.number(), z.number()])).optional(),
  labelAt: z.number().min(0).max(1).optional(),
};
const ConnectionInput = z.object({
  id: z.string(),
  to: z.string(),
  label: z.string(),
  direction: z.enum(['outgoing', 'bidirectional']).optional(),
  description: z.string().optional(),
  via: z.string().optional(),
  technologies: z.array(z.string()).optional(),
  status: Status.optional(),
  tags: z.array(z.string()).optional(),
});
const StepInput = z.object({
  id: z.string(),
  via: z.string().describe('<source>.<connection>'),
  text: z.string(),
  reply: z.boolean().optional(),
  reverse: z.boolean().optional(),
  description: z.string().optional(),
});

function entitySummary(p: Project, id: string) {
  const e = p.entities.get(id)!.entity;
  return { id, name: e.name, kind: e.kind, parent: e.parent ?? null, caption: e.caption, external: e.external ?? false, status: e.status ?? 'live' };
}

function availableConnections(p: Project, drawingId: string) {
  const d = p.drawings.get(drawingId)!.drawing;
  return [...p.connections.values()]
    .filter((c) => !d.edges?.[c.ref])
    .filter((c) => {
      const a = resolveEndpoint(p, d, c.from);
      const b = resolveEndpoint(p, d, c.conn.to);
      return a && b && a !== b;
    })
    .map((c) => ({ ref: c.ref, from: c.from, to: c.conn.to, label: c.conn.label }));
}

export const GUIDE = `# Zark: modeling rules

- Entities: actor and system at the root; app and store inside system; component inside app or store.
- Ids are slugs (a-z, 0-9, hyphen). Entity ids are unique in the project; a connection is \`<source>.<id>\`.
- Connections belong to the source entity. Use descriptive labels ("Creates the order"), never "Sends data to".
- Drawings only place and draw what exists in the model. A connection only appears if it is in edges.
- A connection between children can be drawn in a drawing that only shows the parents (inherited connection).
- Flows are steps over connections; reply: true for messages going back.
- Prefer apply_changes: create, connect, place and draw in a single validated call.
- After writing, call render and fix overlaps or crossing arrows.
- Icons: \`icon: <set>:<name>\` on the entity (lucide generic, si brands/languages/frameworks, own packs such as aws). Use search_icons or suggest_icons to choose; without icon the box uses the technology's icon.
- Connection labels must not overlap each other or cover other boxes (W013). Without \`labelAt\` Zark picks a free spot; if a pinned \`labelAt\` collides, use \`fix_label_overlaps\`.
- open_pr is the only action that leaves the machine: first the preview, then confirm: true.
`;

export function createMcpServer(service: ZarkService): McpServer {
  const server = new McpServer({ name: 'zark', version: '0.1.0' });
  const p = () => service.project;
  const write = async (ops: Op[], dry?: boolean) => json(contract(await service.store.apply(ops, 'mcp', { dryRun: dry })));
  const tool = <S extends z.ZodRawShape>(name: string, description: string, inputSchema: S, cb: (args: z.infer<z.ZodObject<S>>) => Promise<any> | any) =>
    server.registerTool(name, { description, inputSchema }, (async (args: any) => {
      try {
        return await cb(args);
      } catch (err) {
        return { ...json({ ok: false, error: (err as Error).message }), isError: true };
      }
    }) as any);

  // ---------- read ----------
  tool('get_overview', 'Counts, drawings, flows, problems and git status', {}, async () => {
    const proj = p();
    const problems = service.store.problems;
    const git = await service.gitStatus().catch(() => undefined);
    return json({
      name: proj.config.name,
      counts: { entities: proj.entities.size, connections: proj.connections.size, drawings: proj.drawings.size, flows: proj.flows.size },
      drawings: [...proj.drawings.values()].map(({ drawing }) => ({ id: drawing.id, name: drawing.name, scope: drawing.scope ?? null })),
      flows: [...proj.flows.values()].map(({ flow }) => ({ id: flow.id, name: flow.name, drawing: flow.drawing })),
      problems: { errors: errorsOf(problems).map(fmtProblem), warnings: warningsOf(problems).map(fmtProblem) },
      git: git && { branch: git.branch, changed: git.changed.length, pr: git.pr },
    });
  });

  tool('list_entities', 'Entity summaries, with optional filters', { kind: Kind.optional(), parent: z.string().optional(), tag: z.string().optional(), query: z.string().optional() }, ({ kind, parent, tag, query }) => {
    const q = query?.toLowerCase();
    const out = [...p().entities.values()]
      .filter(({ entity: e }) => (!kind || e.kind === kind) && (parent === undefined || (e.parent ?? '') === parent) && (!tag || e.tags?.includes(tag)) && (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)))
      .map(({ entity }) => entitySummary(p(), entity.id));
    return json(out);
  });

  tool('get_entity', 'Full entity, incoming and outgoing connections, usage in drawings and flows', { id: z.string() }, ({ id }) => {
    const proj = p();
    const e = proj.entities.get(id);
    if (!e) return json({ ok: false, error: `Entity "${id}" does not exist. Valid: ${[...proj.entities.keys()].join(', ')}` });
    const outgoing = [...proj.connections.values()].filter((c) => c.from === id).map((c) => ({ ref: c.ref, ...c.conn }));
    const incoming = [...proj.connections.values()].filter((c) => c.conn.to === id).map((c) => ({ ref: c.ref, from: c.from, ...c.conn }));
    const refs = new Set([...outgoing, ...incoming].map((c) => c.ref));
    return json({
      ...e.entity,
      connections: undefined,
      file: e.file,
      outgoing,
      incoming,
      drawings: [...proj.drawings.values()].filter(({ drawing }) => drawing.nodes?.[id]).map(({ drawing }) => drawing.id),
      flows: [...proj.flows.values()].filter(({ flow }) => allSteps(flow).some((s) => refs.has(s.via))).map(({ flow }) => flow.id),
    });
  });

  tool('list_connections', 'Connections with full refs', { entity: z.string().optional(), between: z.tuple([z.string(), z.string()]).optional() }, ({ entity, between }) => {
    const out = [...p().connections.values()]
      .filter((c) => !entity || c.from === entity || c.conn.to === entity)
      .filter((c) => !between || (c.from === between[0] && c.conn.to === between[1]) || (c.from === between[1] && c.conn.to === between[0]))
      .map((c) => ({ ref: c.ref, from: c.from, ...c.conn }));
    return json(out);
  });

  tool('list_drawings', 'Project drawings', {}, () =>
    json([...p().drawings.values()].map(({ drawing }) => ({ id: drawing.id, name: drawing.name, scope: drawing.scope ?? null, nodes: Object.keys(drawing.nodes ?? {}).length, edges: Object.keys(drawing.edges ?? {}).length }))),
  );

  tool('get_drawing', 'Nodes, connectors, groups and available connections not yet drawn', { id: z.string() }, ({ id }) => {
    const d = p().drawings.get(id);
    if (!d) return json({ ok: false, error: `Drawing "${id}" does not exist. Valid: ${[...p().drawings.keys()].join(', ')}` });
    return json({ ...d.drawing, file: d.file, available: availableConnections(p(), id) });
  });

  tool('list_flows', 'Project flows', {}, () =>
    json([...p().flows.values()].map(({ flow }) => ({ id: flow.id, name: flow.name, drawing: flow.drawing, steps: allSteps(flow).length }))),
  );

  tool('get_flow', 'Numbered steps of a flow, as JSON or Mermaid', { id: z.string(), format: z.enum(['json', 'mermaid']).optional() }, ({ id, format }) => {
    const proj = p();
    const f = proj.flows.get(id);
    if (!f) return json({ ok: false, error: `Flow "${id}" does not exist. Valid: ${[...proj.flows.keys()].join(', ')}` });
    if (format === 'mermaid') {
      const text = flowToMermaid(f.flow, {
        connection: (ref) => {
          const c = proj.connections.get(ref);
          return c && { from: c.from, to: c.conn.to, direction: c.conn.direction };
        },
        name: (eid) => proj.entities.get(eid)?.entity.name ?? eid,
        subflow: (sid) => proj.flows.get(sid)?.flow.steps,
      });
      return { content: [{ type: 'text' as const, text }] };
    }
    return json({ ...f.flow, file: f.file, numbered: numberSteps(f.flow.steps).map((n) => ({ number: n.number, ...n.step, branch: n.branch })) });
  });

  tool('search', 'Entities, connections, drawings and flows matching the text', { query: z.string() }, ({ query }) => {
    const q = query.toLowerCase();
    const has = (...s: (string | undefined)[]) => s.some((x) => x?.toLowerCase().includes(q));
    const proj = p();
    return json({
      entities: [...proj.entities.values()].filter(({ entity: e }) => has(e.id, e.name, e.caption, e.description)).map(({ entity }) => entitySummary(proj, entity.id)),
      connections: [...proj.connections.values()].filter((c) => has(c.ref, c.conn.label, c.conn.description)).map((c) => ({ ref: c.ref, label: c.conn.label })),
      drawings: [...proj.drawings.values()].filter(({ drawing: d }) => has(d.id, d.name, d.description)).map(({ drawing }) => drawing.id),
      flows: [...proj.flows.values()].filter(({ flow: f }) => has(f.id, f.name, f.description) || allSteps(f).some((s) => has(s.text))).map(({ flow }) => flow.id),
    });
  });

  tool('validate', 'List of validation problems', {}, () => {
    const problems = service.store.problems;
    return json({ errors: errorsOf(problems).map(fmtProblem), warnings: warningsOf(problems).map(fmtProblem) });
  });

  tool('diff', 'Semantic diff against a git ref (default: baseBranch)', { base: z.string().optional() }, async ({ base }) => {
    const r = await service.diff(base);
    return json({ base: r.base, changes: r.changes.map((c) => c.text) });
  });

  tool('render', 'PNG of a drawing or a flow step, as an image', { drawing: z.string().optional(), flow: z.string().optional(), step: z.string().optional() }, async ({ drawing, flow, step }) => {
    const png = await service.renderPng({ drawing, flow, step });
    return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
  });

  tool('search_icons', 'Searches icons by name or keyword in the bundled sets (lucide, si) and the packs from zark.yaml', { query: z.string(), set: z.string().optional(), limit: z.number().int().positive().max(100).optional() }, ({ query, set, limit }) =>
    json({ sets: iconSets(p()).map((s) => s.id), icons: searchIcons(p(), query, { set, limit: limit ?? 20 }).map(({ id, title }) => ({ id, title })) }));

  tool('suggest_icons', 'Suggested icons for an entity, from its technologies, name and kind', { entity: z.string() }, ({ entity: id }) => {
    const e = p().entities.get(id)?.entity;
    if (!e) return json({ ok: false, error: `Entity "${id}" does not exist` });
    const techs = (p().catalog.technologies ?? []).filter((t) => e.technologies?.includes(t.id));
    return json({ icons: suggestIcons({ name: e.name, caption: e.caption, description: e.description, kind: e.kind, external: e.external, technologies: techs }, (x) => hasIcon(p(), x), (p().config.icons?.packs ?? []).map((pk) => pk.id)) });
  });

  // ---------- write ----------
  tool('create_entity', 'Creates an entity (and optionally its outgoing connections)', {
    id: z.string(), name: z.string(), kind: Kind, parent: z.string().nullable().optional(), caption: z.string().optional(),
    icon: z.string().optional().describe('<set>:<name>, e.g. lucide:database or si:python; use search_icons'), description: z.string().optional(),
    external: z.boolean().optional(), status: Status.optional(), technologies: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), owner: z.string().optional(),
    links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
    connections: z.array(ConnectionInput).optional(), dryRun,
  }, ({ dryRun: dry, ...entity }) => write([{ op: 'entity.create', entity: entity as any }], dry));

  tool('update_entity', 'Updates entity fields (set) or removes fields (unset)', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'entity.update', id, set, unset }], dry));

  tool('delete_entity', 'Deletes an entity. Without cascade, returns the impact and changes nothing', { id: z.string(), cascade: z.boolean().optional(), dryRun }, ({ id, cascade, dryRun: dry }) =>
    write([{ op: 'entity.delete', id, cascade }], dry));

  tool('move_entity', 'Changes the parent of an entity (null = root)', { id: z.string(), parent: z.string().nullable(), dryRun }, ({ id, parent, dryRun: dry }) =>
    write([{ op: 'entity.move', id, parent }], dry));

  tool('create_connection', 'Creates an outgoing connection on the source entity', { from: z.string(), connection: ConnectionInput, dryRun }, ({ from, connection, dryRun: dry }) =>
    write([{ op: 'connection.create', from, connection: connection as any }], dry));

  tool('update_connection', 'Updates connection fields', { ref: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ ref, set, unset, dryRun: dry }) =>
    write([{ op: 'connection.update', ref, set, unset }], dry));

  tool('delete_connection', 'Deletes a connection. Without cascade, returns the impact', { ref: z.string(), cascade: z.boolean().optional(), dryRun }, ({ ref, cascade, dryRun: dry }) =>
    write([{ op: 'connection.delete', ref, cascade }], dry));

  tool('reverse_connection', 'Reverses source and target, moving the connection to the other file', { ref: z.string(), dryRun }, ({ ref, dryRun: dry }) =>
    write([{ op: 'connection.reverse', ref }], dry));

  tool('create_drawing', 'Creates an empty drawing', { id: z.string(), name: z.string(), description: z.string().optional(), scope: z.string().nullable().optional(), dryRun }, ({ dryRun: dry, ...drawing }) =>
    write([{ op: 'drawing.create', drawing }], dry));

  tool('update_drawing', 'Updates the name, description or scope of a drawing', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'drawing.update', id, set, unset }], dry));

  tool('delete_drawing', 'Deletes a drawing (refused while flows run on it)', { id: z.string(), dryRun }, ({ id, dryRun: dry }) => write([{ op: 'drawing.delete', id }], dry));

  tool('place_entities', 'Places entities in a drawing. Without x and y, uses a free area', {
    drawing: z.string(),
    nodes: z.array(z.object({ id: z.string(), x: z.number().int().optional(), y: z.number().int().optional(), w: z.number().int().optional(), h: z.number().int().optional(), expanded: z.boolean().optional() })),
    dryRun,
  }, ({ drawing, nodes, dryRun: dry }) => write([{ op: 'drawing.place', drawing, nodes }], dry));

  tool('move_nodes', 'Moves or resizes nodes of a drawing', {
    drawing: z.string(), nodes: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int(), w: z.number().int().optional(), h: z.number().int().optional() })), dryRun,
  }, ({ drawing, nodes, dryRun: dry }) => write([{ op: 'drawing.move-nodes', drawing, nodes }], dry));

  tool('remove_nodes', 'Removes entities from the drawing (the model does not change)', { drawing: z.string(), ids: z.array(z.string()), dryRun }, ({ drawing, ids, dryRun: dry }) =>
    write([{ op: 'drawing.remove-nodes', drawing, ids }], dry));

  tool('draw_connections', 'Draws existing connections in a drawing', { drawing: z.string(), edges: z.array(z.object({ ref: z.string(), ...EdgeShape })), dryRun }, ({ drawing, edges, dryRun: dry }) =>
    write([{ op: 'drawing.draw-edges', drawing, edges }], dry));

  tool('update_edge', 'Adjusts how a connection is drawn in a drawing', { drawing: z.string(), ref: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ drawing, ref, set, unset, dryRun: dry }) =>
    write([{ op: 'drawing.update-edge', drawing, ref, set, unset }], dry));

  tool('remove_edges', 'Removes connectors from the drawing (the model does not change)', { drawing: z.string(), refs: z.array(z.string()), dryRun }, ({ drawing, refs, dryRun: dry }) =>
    write([{ op: 'drawing.remove-edges', drawing, refs }], dry));

  tool('auto_layout', 'Re-lays out the whole drawing or a selection', { drawing: z.string(), ids: z.array(z.string()).optional(), dryRun }, ({ drawing, ids, dryRun: dry }) =>
    write([{ op: 'drawing.auto-layout', drawing, ids }], dry));

  tool('fix_label_overlaps', 'Fixes overlapping connection labels (W013): pinned labelAt values that collide return to automatic placement', { drawing: z.string(), dryRun }, ({ drawing, dryRun: dry }) =>
    write([{ op: 'drawing.auto-place-labels', drawing }], dry));

  tool('create_flow', 'Creates a flow on a drawing', { id: z.string(), name: z.string(), drawing: z.string(), description: z.string().optional(), steps: z.array(z.any()).optional(), dryRun }, ({ dryRun: dry, ...flow }) =>
    write([{ op: 'flow.create', flow: flow as any }], dry));

  tool('update_flow', 'Updates flow metadata or replaces its steps', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'flow.update', id, set, unset }], dry));

  tool('delete_flow', 'Deletes a flow', { id: z.string(), dryRun }, ({ id, dryRun: dry }) => write([{ op: 'flow.delete', id }], dry));

  tool('add_steps', 'Adds steps (or parallel/alternatives blocks) to a flow', { flow: z.string(), steps: z.array(z.union([StepInput, z.record(z.string(), z.unknown())])), index: z.number().int().optional(), dryRun }, ({ flow, steps, index, dryRun: dry }) =>
    write([{ op: 'flow.add-steps', flow, steps: steps as any, index }], dry));

  tool('update_step', 'Updates step fields', { flow: z.string(), step: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ flow, step, set, unset, dryRun: dry }) =>
    write([{ op: 'flow.update-step', flow, step, set, unset }], dry));

  tool('move_step', 'Moves a step within its containing list', { flow: z.string(), step: z.string(), index: z.number().int(), dryRun }, ({ flow, step, index, dryRun: dry }) =>
    write([{ op: 'flow.move-step', flow, step, index }], dry));

  tool('remove_steps', 'Removes steps from a flow', { flow: z.string(), steps: z.array(z.string()), dryRun }, ({ flow, steps, dryRun: dry }) =>
    write([{ op: 'flow.remove-steps', flow, steps }], dry));

  tool('apply_changes', 'Atomic batch of core operations (preferred path for agents). E.g. [{"op":"entity.create","entity":{...}},{"op":"drawing.place",...}]', {
    ops: z.array(z.object({ op: z.string() }).passthrough()), dryRun,
  }, ({ ops, dryRun: dry }) => write(ops as unknown as Op[], dry));

  tool('rename_id', 'Changes an id and rewrites every reference', { kind: z.enum(['entity', 'connection', 'drawing', 'flow']), from: z.string(), to: z.string(), dryRun }, ({ kind, from, to, dryRun: dry }) =>
    write([{ op: 'rename-id', kind, from, to }], dry));

  tool('open_pr', 'Opens or updates the PR (GitHub) or MR (GitLab). Without confirm: true it only returns the preview', { title: z.string().optional(), context: z.string().optional(), confirm: z.boolean().optional() }, async ({ title, context, confirm }) => {
    const preview = await service.prPreview({ title, context });
    const summary = { ok: preview.ok, blockers: preview.blockers, branch: preview.branch, base: preview.base, title: preview.title, body: preview.body, files: preview.files, images: preview.images.map((i) => i.path) };
    if (!confirm) return json({ preview: true, ...summary, hint: preview.ok ? 'Review it and call open_pr again with confirm: true.' : `Resolve the blockers before opening the ${preview.provider.noun}.` });
    if (p().config.mcp?.prRequiresUi) return json({ ...summary, ok: false, preview: true, hint: `This project requires confirmation in the UI: use the "Open ${preview.provider.noun}" button in zark dev.` });
    if (!preview.ok) return json(summary);
    const r = await service.createPr({ title, context });
    return json({ ok: true, url: r.url, branch: r.branch, commit: r.commit, updated: r.updated });
  });

  // ---------- resources and prompts ----------
  server.registerResource(
    'schema',
    new ResourceTemplate('zark://schema/{name}', {
      list: async () => ({ resources: ['entity', 'drawing', 'flow'].map((n) => ({ uri: `zark://schema/${n}`, name: `schema-${n}`, mimeType: 'application/json' })) }),
    }),
    { description: 'JSON Schemas of the files', mimeType: 'application/json' },
    async (uri, { name }) => {
      const schemas = jsonSchemas() as Record<string, unknown>;
      const schema = schemas[String(name)];
      if (!schema) throw new Error(`Unknown schema: ${name}`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(schema, null, 2) }] };
    },
  );
  server.registerResource('guide', 'zark://guide', { description: 'Modeling rules', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }],
  }));

  const documentRepository = () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: `Read this repository (README, manifests, docker-compose, IaC, HTTP clients, queues) and document the architecture in Zark.\n\n${GUIDE}\nStep by step: get_overview; propose entities and connections; write everything with apply_changes; place and draw them in a drawing; call render and adjust the layout; finish with validate showing no errors.`,
      },
    }],
  });
  const reviewModel = () => ({
    messages: [{
      role: 'user' as const,
      content: {
        type: 'text' as const,
        text: 'Review the Zark model: call validate and get_overview; read the entities and connections; point out generic labels, connections outside drawings, odd hierarchy, flows going against connections and duplicates. Propose concrete fixes (tools and arguments) and only apply them after confirmation.',
      },
    }],
  });
  server.registerPrompt('document-repository', { description: 'Reads the code and proposes entities and connections' }, documentRepository);
  server.registerPrompt('review-model', { description: 'Validates and looks for semantic inconsistencies' }, reviewModel);
  // Former Portuguese names, kept as aliases so existing client configs keep working.
  server.registerPrompt('documentar-repositorio', { description: 'Alias of document-repository' }, documentRepository);
  server.registerPrompt('revisar-modelo', { description: 'Alias of review-model' }, reviewModel);

  return server;
}
