import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
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
  if (result?.impact) return 'A exclusão afeta outros itens (veja impact). Repita com cascade: true para confirmar.';
  if (result?.conflict) return 'Arquivo mudou no disco. Leia de novo e repita.';
  const p = problems[0];
  if (!p) return undefined;
  switch (p.code) {
    case 'W003': return `Use draw_connections para traçar ${p.ref} em um desenho.`;
    case 'W001':
    case 'W002': return `Use place_entities para posicionar ${p.ref} em um desenho.`;
    case 'W010': return 'Caixas sobrepostas: use move_nodes ou auto_layout e confira com render.';
    case 'W004': return `Dê um rótulo descritivo à conexão ${p.ref} com update_connection.`;
    case 'E041': return 'O passo anda na contramão: use reverse_connection ou marque o passo com reply: true.';
    case 'E044': return 'Trace a conexão no desenho do fluxo com draw_connections.';
    case 'E032': return 'Posicione uma das pontas (ou um ancestral) no desenho antes de traçar.';
    case 'E011': return 'Hierarquia: actor/system na raiz, app/store dentro de system, component dentro de app/store.';
    default: return p.code.startsWith('E') ? 'Corrija o erro e repita; a mensagem lista os valores válidos.' : undefined;
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
const dryRun = z.boolean().optional().describe('Valida sem gravar');
const fields = z.record(z.string(), z.unknown());
const EdgeShape = {
  shape: z.enum(['straight', 'step', 'curved']).optional(),
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
  via: z.string().describe('<origem>.<conexão>'),
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

export const GUIDE = `# Zark: regras de modelagem

- Entidades: actor e system na raiz; app e store dentro de system; component dentro de app ou store.
- Ids são slugs (a-z, 0-9, hífen). Id de entidade é único no projeto; conexão é \`<origem>.<id>\`.
- Conexões pertencem à entidade de origem. Rótulos descritivos ("Cria o pedido"), nunca "Sends data to".
- Desenhos só posicionam e traçam o que existe no modelo. Uma conexão só aparece se estiver em edges.
- Uma conexão entre filhos pode ser traçada num desenho que só mostra os pais (conexão herdada).
- Fluxos são passos sobre conexões; reply: true para mensagens de volta.
- Prefira apply_changes: crie, conecte, posicione e trace numa única chamada validada.
- Depois de escrever, chame render e corrija sobreposições ou setas cruzadas.
- open_pr é a única ação que sai da máquina: primeiro a prévia, depois confirm: true.
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
  tool('get_overview', 'Contagens, desenhos, fluxos, problemas e status do git', {}, async () => {
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

  tool('list_entities', 'Entidades resumidas, com filtros opcionais', { kind: Kind.optional(), parent: z.string().optional(), tag: z.string().optional(), query: z.string().optional() }, ({ kind, parent, tag, query }) => {
    const q = query?.toLowerCase();
    const out = [...p().entities.values()]
      .filter(({ entity: e }) => (!kind || e.kind === kind) && (parent === undefined || (e.parent ?? '') === parent) && (!tag || e.tags?.includes(tag)) && (!q || e.name.toLowerCase().includes(q) || e.id.includes(q)))
      .map(({ entity }) => entitySummary(p(), entity.id));
    return json(out);
  });

  tool('get_entity', 'Entidade completa, conexões de entrada e saída, uso em desenhos e fluxos', { id: z.string() }, ({ id }) => {
    const proj = p();
    const e = proj.entities.get(id);
    if (!e) return json({ ok: false, error: `Entidade "${id}" não existe. Válidas: ${[...proj.entities.keys()].join(', ')}` });
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

  tool('list_connections', 'Conexões com refs completas', { entity: z.string().optional(), between: z.tuple([z.string(), z.string()]).optional() }, ({ entity, between }) => {
    const out = [...p().connections.values()]
      .filter((c) => !entity || c.from === entity || c.conn.to === entity)
      .filter((c) => !between || (c.from === between[0] && c.conn.to === between[1]) || (c.from === between[1] && c.conn.to === between[0]))
      .map((c) => ({ ref: c.ref, from: c.from, ...c.conn }));
    return json(out);
  });

  tool('list_drawings', 'Desenhos do projeto', {}, () =>
    json([...p().drawings.values()].map(({ drawing }) => ({ id: drawing.id, name: drawing.name, scope: drawing.scope ?? null, nodes: Object.keys(drawing.nodes ?? {}).length, edges: Object.keys(drawing.edges ?? {}).length }))),
  );

  tool('get_drawing', 'Nós, traçados, grupos e conexões disponíveis não traçadas', { id: z.string() }, ({ id }) => {
    const d = p().drawings.get(id);
    if (!d) return json({ ok: false, error: `Desenho "${id}" não existe. Válidos: ${[...p().drawings.keys()].join(', ')}` });
    return json({ ...d.drawing, file: d.file, available: availableConnections(p(), id) });
  });

  tool('list_flows', 'Fluxos do projeto', {}, () =>
    json([...p().flows.values()].map(({ flow }) => ({ id: flow.id, name: flow.name, drawing: flow.drawing, steps: allSteps(flow).length }))),
  );

  tool('get_flow', 'Passos numerados de um fluxo, em JSON ou Mermaid', { id: z.string(), format: z.enum(['json', 'mermaid']).optional() }, ({ id, format }) => {
    const proj = p();
    const f = proj.flows.get(id);
    if (!f) return json({ ok: false, error: `Fluxo "${id}" não existe. Válidos: ${[...proj.flows.keys()].join(', ')}` });
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

  tool('search', 'Entidades, conexões, desenhos e fluxos que casam com o texto', { query: z.string() }, ({ query }) => {
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

  tool('validate', 'Lista de problemas de validação', {}, () => {
    const problems = service.store.problems;
    return json({ errors: errorsOf(problems).map(fmtProblem), warnings: warningsOf(problems).map(fmtProblem) });
  });

  tool('diff', 'Diff semântico contra uma ref git (padrão: baseBranch)', { base: z.string().optional() }, async ({ base }) => {
    const r = await service.diff(base);
    return json({ base: r.base, changes: r.changes.map((c) => c.text) });
  });

  tool('render', 'PNG de um desenho ou de um passo de fluxo, como imagem', { drawing: z.string().optional(), flow: z.string().optional(), step: z.string().optional() }, async ({ drawing, flow, step }) => {
    const png = await service.renderPng({ drawing, flow, step });
    return { content: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }] };
  });

  // ---------- write ----------
  tool('create_entity', 'Cria uma entidade (e opcionalmente suas conexões de saída)', {
    id: z.string(), name: z.string(), kind: Kind, parent: z.string().nullable().optional(), caption: z.string().optional(), description: z.string().optional(),
    external: z.boolean().optional(), status: Status.optional(), technologies: z.array(z.string()).optional(), tags: z.array(z.string()).optional(), owner: z.string().optional(),
    connections: z.array(ConnectionInput).optional(), dryRun,
  }, ({ dryRun: dry, ...entity }) => write([{ op: 'entity.create', entity: entity as any }], dry));

  tool('update_entity', 'Atualiza campos de uma entidade (set) ou remove campos (unset)', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'entity.update', id, set, unset }], dry));

  tool('delete_entity', 'Exclui uma entidade. Sem cascade, devolve o impacto e não altera nada', { id: z.string(), cascade: z.boolean().optional(), dryRun }, ({ id, cascade, dryRun: dry }) =>
    write([{ op: 'entity.delete', id, cascade }], dry));

  tool('move_entity', 'Troca o parent de uma entidade (null = raiz)', { id: z.string(), parent: z.string().nullable(), dryRun }, ({ id, parent, dryRun: dry }) =>
    write([{ op: 'entity.move', id, parent }], dry));

  tool('create_connection', 'Cria uma conexão de saída na entidade de origem', { from: z.string(), connection: ConnectionInput, dryRun }, ({ from, connection, dryRun: dry }) =>
    write([{ op: 'connection.create', from, connection: connection as any }], dry));

  tool('update_connection', 'Atualiza campos de uma conexão', { ref: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ ref, set, unset, dryRun: dry }) =>
    write([{ op: 'connection.update', ref, set, unset }], dry));

  tool('delete_connection', 'Exclui uma conexão. Sem cascade, devolve o impacto', { ref: z.string(), cascade: z.boolean().optional(), dryRun }, ({ ref, cascade, dryRun: dry }) =>
    write([{ op: 'connection.delete', ref, cascade }], dry));

  tool('reverse_connection', 'Inverte origem e destino, movendo a conexão de arquivo', { ref: z.string(), dryRun }, ({ ref, dryRun: dry }) =>
    write([{ op: 'connection.reverse', ref }], dry));

  tool('create_drawing', 'Cria um desenho vazio', { id: z.string(), name: z.string(), description: z.string().optional(), scope: z.string().nullable().optional(), dryRun }, ({ dryRun: dry, ...drawing }) =>
    write([{ op: 'drawing.create', drawing }], dry));

  tool('update_drawing', 'Atualiza nome, descrição ou scope de um desenho', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'drawing.update', id, set, unset }], dry));

  tool('delete_drawing', 'Exclui um desenho (recusa se houver fluxos sobre ele)', { id: z.string(), dryRun }, ({ id, dryRun: dry }) => write([{ op: 'drawing.delete', id }], dry));

  tool('place_entities', 'Posiciona entidades num desenho. Sem x e y, usa uma área livre', {
    drawing: z.string(),
    nodes: z.array(z.object({ id: z.string(), x: z.number().int().optional(), y: z.number().int().optional(), w: z.number().int().optional(), h: z.number().int().optional(), expanded: z.boolean().optional() })),
    dryRun,
  }, ({ drawing, nodes, dryRun: dry }) => write([{ op: 'drawing.place', drawing, nodes }], dry));

  tool('move_nodes', 'Reposiciona ou redimensiona nós de um desenho', {
    drawing: z.string(), nodes: z.array(z.object({ id: z.string(), x: z.number().int(), y: z.number().int(), w: z.number().int().optional(), h: z.number().int().optional() })), dryRun,
  }, ({ drawing, nodes, dryRun: dry }) => write([{ op: 'drawing.move-nodes', drawing, nodes }], dry));

  tool('remove_nodes', 'Remove entidades do desenho (o modelo não muda)', { drawing: z.string(), ids: z.array(z.string()), dryRun }, ({ drawing, ids, dryRun: dry }) =>
    write([{ op: 'drawing.remove-nodes', drawing, ids }], dry));

  tool('draw_connections', 'Traça conexões existentes num desenho', { drawing: z.string(), edges: z.array(z.object({ ref: z.string(), ...EdgeShape })), dryRun }, ({ drawing, edges, dryRun: dry }) =>
    write([{ op: 'drawing.draw-edges', drawing, edges }], dry));

  tool('update_edge', 'Ajusta o traçado de uma conexão num desenho', { drawing: z.string(), ref: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ drawing, ref, set, unset, dryRun: dry }) =>
    write([{ op: 'drawing.update-edge', drawing, ref, set, unset }], dry));

  tool('remove_edges', 'Remove traçados do desenho (o modelo não muda)', { drawing: z.string(), refs: z.array(z.string()), dryRun }, ({ drawing, refs, dryRun: dry }) =>
    write([{ op: 'drawing.remove-edges', drawing, refs }], dry));

  tool('auto_layout', 'Reorganiza o desenho inteiro ou uma seleção', { drawing: z.string(), ids: z.array(z.string()).optional(), dryRun }, ({ drawing, ids, dryRun: dry }) =>
    write([{ op: 'drawing.auto-layout', drawing, ids }], dry));

  tool('create_flow', 'Cria um fluxo sobre um desenho', { id: z.string(), name: z.string(), drawing: z.string(), description: z.string().optional(), steps: z.array(z.any()).optional(), dryRun }, ({ dryRun: dry, ...flow }) =>
    write([{ op: 'flow.create', flow: flow as any }], dry));

  tool('update_flow', 'Atualiza metadados ou substitui steps de um fluxo', { id: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ id, set, unset, dryRun: dry }) =>
    write([{ op: 'flow.update', id, set, unset }], dry));

  tool('delete_flow', 'Exclui um fluxo', { id: z.string(), dryRun }, ({ id, dryRun: dry }) => write([{ op: 'flow.delete', id }], dry));

  tool('add_steps', 'Adiciona passos (ou blocos parallel/alternatives) a um fluxo', { flow: z.string(), steps: z.array(z.union([StepInput, z.record(z.string(), z.unknown())])), index: z.number().int().optional(), dryRun }, ({ flow, steps, index, dryRun: dry }) =>
    write([{ op: 'flow.add-steps', flow, steps: steps as any, index }], dry));

  tool('update_step', 'Atualiza campos de um passo', { flow: z.string(), step: z.string(), set: fields.optional(), unset: z.array(z.string()).optional(), dryRun }, ({ flow, step, set, unset, dryRun: dry }) =>
    write([{ op: 'flow.update-step', flow, step, set, unset }], dry));

  tool('move_step', 'Move um passo dentro da lista que o contém', { flow: z.string(), step: z.string(), index: z.number().int(), dryRun }, ({ flow, step, index, dryRun: dry }) =>
    write([{ op: 'flow.move-step', flow, step, index }], dry));

  tool('remove_steps', 'Remove passos de um fluxo', { flow: z.string(), steps: z.array(z.string()), dryRun }, ({ flow, steps, dryRun: dry }) =>
    write([{ op: 'flow.remove-steps', flow, steps }], dry));

  tool('apply_changes', 'Lote atômico de operações do core (caminho preferido para agentes). Ex.: [{"op":"entity.create","entity":{...}},{"op":"drawing.place",...}]', {
    ops: z.array(z.object({ op: z.string() }).passthrough()), dryRun,
  }, ({ ops, dryRun: dry }) => write(ops as unknown as Op[], dry));

  tool('rename_id', 'Troca um id e reescreve todas as referências', { kind: z.enum(['entity', 'connection', 'drawing', 'flow']), from: z.string(), to: z.string(), dryRun }, ({ kind, from, to, dryRun: dry }) =>
    write([{ op: 'rename-id', kind, from, to }], dry));

  tool('open_pr', 'Abre ou atualiza o PR. Sem confirm: true devolve só a prévia', { title: z.string().optional(), context: z.string().optional(), confirm: z.boolean().optional() }, async ({ title, context, confirm }) => {
    const preview = await service.prPreview({ title, context });
    const summary = { ok: preview.ok, blockers: preview.blockers, branch: preview.branch, base: preview.base, title: preview.title, body: preview.body, files: preview.files, images: preview.images.map((i) => i.path) };
    if (!confirm) return json({ preview: true, ...summary, hint: preview.ok ? 'Revise e chame open_pr de novo com confirm: true.' : 'Resolva os bloqueios antes de abrir o PR.' });
    if (p().config.mcp?.prRequiresUi) return json({ ...summary, ok: false, preview: true, hint: 'Este projeto exige confirmação na UI: use o botão "Abrir PR" no zark dev.' });
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
    { description: 'JSON Schemas dos arquivos', mimeType: 'application/json' },
    async (uri, { name }) => {
      const schemas = jsonSchemas() as Record<string, unknown>;
      const schema = schemas[String(name)];
      if (!schema) throw new Error(`Schema desconhecido: ${name}`);
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(schema, null, 2) }] };
    },
  );
  server.registerResource('guide', 'zark://guide', { description: 'Regras de modelagem', mimeType: 'text/markdown' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }],
  }));

  server.registerPrompt('documentar-repositorio', { description: 'Lê o código e propõe entidades e conexões' }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `Leia este repositório (README, manifests, docker-compose, IaC, clientes HTTP, filas) e documente a arquitetura no Zark.\n\n${GUIDE}\nPasso a passo: get_overview; proponha entidades e conexões; grave tudo com apply_changes; posicione e trace num desenho; chame render e ajuste o layout; termine com validate sem erros.`,
      },
    }],
  }));
  server.registerPrompt('revisar-modelo', { description: 'Valida e procura inconsistências semânticas' }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: 'Revise o modelo Zark: chame validate e get_overview; leia as entidades e conexões; aponte rótulos genéricos, conexões fora de desenhos, hierarquia estranha, fluxos na contramão e duplicações. Proponha correções concretas (tools e argumentos) e só aplique com confirmação.',
      },
    }],
  }));

  return server;
}
