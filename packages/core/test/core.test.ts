import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  applyOps,
  buildProject,
  errorsOf,
  fileKind,
  formatText,
  readTexts,
  validate,
  type Project,
} from '../src/index.js';

const EXAMPLE = fileURLToPath(new URL('../../../examples/ecommerce/architecture', import.meta.url));
const base = await readTexts(EXAMPLE);

function project(edit?: (t: Map<string, string>) => void): Project {
  const texts = new Map(base);
  edit?.(texts);
  return buildProject(EXAMPLE, texts);
}
const replace = (t: Map<string, string>, path: string, from: string | RegExp, to: string) => {
  const text = t.get(path)!;
  const next = text.replace(from, to);
  if (next === text) throw new Error(`replace had no effect in ${path}: ${from}`);
  t.set(path, next);
};
const codes = (p: Project) => validate(p).map((x) => x.code);
const lineDiff = (a: string, b: string) => {
  const la = a.split('\n'), lb = b.split('\n');
  return la.length === lb.length ? la.filter((l, i) => l !== lb[i]).length : Infinity;
};

describe('phase 1 acceptance: appendix model', () => {
  it('loads 13 entities, 17 connections, 2 drawings, 1 flow with no problems', () => {
    const p = project();
    expect([p.entities.size, p.connections.size, p.drawings.size, p.flows.size]).toEqual([13, 17, 2, 1]);
    expect(validate(p)).toEqual([]);
  });

  it('is already canonical: fmt produces no diff', () => {
    for (const [path, text] of base) expect(formatText(fileKind(path)!, text), path).toBe(text);
  });
});

describe('validation codes', () => {
  const cases: [string, (t: Map<string, string>) => void][] = [
    ['E001', (t) => replace(t, 'entities/deco.yaml', 'kind: system', 'kind: banana')],
    ['E001', (t) => t.set('entities/broken.yaml', 'id: [unclosed')],
    ['E002', (t) => t.set('entities/x.yaml', 'id: y\nname: Y\nkind: system\n')],
    ['E003', (t) => replace(t, 'entities/gateway.yaml', 'id: pedido', 'id: autoriza')],
    ['E010', (t) => replace(t, 'entities/gateway.yaml', 'parent: vtex', 'parent: nada')],
    ['E011', (t) => replace(t, 'entities/gateway.yaml', 'parent: vtex', 'parent: cliente')],
    ['E012', (t) => {
      t.set('entities/a.yaml', 'id: a\nname: A\nkind: app\nparent: b\n');
      t.set('entities/b.yaml', 'id: b\nname: B\nkind: app\nparent: a\n');
    }],
    ['E020', (t) => replace(t, 'entities/cliente.yaml', 'to: deco', 'to: nada')],
    ['E021', (t) => replace(t, 'entities/cliente.yaml', 'to: deco', 'to: cliente')],
    ['E022', (t) => replace(t, 'entities/sintese.yaml', 'owner: time-oms', 'owner: time-x')],
    ['E030', (t) => replace(t, 'drawings/vtex.yaml', 'nodes:\n', 'nodes:\n  fantasma: { x: 800, y: 800 }\n')],
    ['E031', (t) => replace(t, 'drawings/vtex.yaml', 'edges:\n', 'edges:\n  cliente.nada: { shape: straight }\n')],
    ['E032', (t) => replace(t, 'drawings/vtex.yaml', 'edges:\n', 'edges:\n  cliente.navega: { shape: straight }\n')],
    ['E033', (t) => replace(t, 'drawings/vtex.yaml', 'scope: vtex', 'scope: nada')],
    ['E034', (t) => replace(t, 'drawings/vtex.yaml', 'members: [ seller-phg, seller-jardins ]', 'members: [ seller-phg, linx ]')],
    ['E040', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', 'via: deco.checkout', 'via: deco.nada')],
    ['E041', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', '    text: Atualiza o inventário', '    text: Atualiza o inventário\n          reverse: true')],
    ['E042', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', '    text: Atualiza o inventário', '    text: Atualiza o inventário\n          reply: true\n          reverse: true')],
    ['E043', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', 'drawing: contexto', 'drawing: nada')],
    ['E044', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', 'via: deco.checkout', 'via: gateway.pedido')],
    ['E045', (t) => {
      t.set('flows/a.yaml', 'id: a\nname: A\ndrawing: contexto\nsteps:\n  - subflow: b\n');
      t.set('flows/b.yaml', 'id: b\nname: B\ndrawing: contexto\nsteps:\n  - subflow: a\n');
    }],
    ['W001', (t) => t.set('entities/trin.yaml', 'id: trin\nname: trin\nkind: system\n')],
    ['W002', (t) => t.set('entities/novo.yaml', 'id: novo\nname: Novo\nkind: system\nconnections:\n  - id: x\n    to: deco\n    label: Chama\n')],
    ['W003', (t) => replace(t, 'drawings/contexto.yaml', /  cliente\.navega: .*\n/, '')],
    ['W004', (t) => replace(t, 'entities/cliente.yaml', 'label: Navega e compra', 'label: Sends data to')],
    ['W005', (t) => replace(t, 'entities/sintese.yaml', 'label: Baixa de estoque', 'label: Inventário')],
    ['W006', (t) => replace(t, 'entities/stone.yaml', 'external: true', 'external: true\nstatus: removed')],
    ['W010', (t) => replace(t, 'drawings/contexto.yaml', 'stone: { x: 360, y: -272 }', 'stone: { x: 400, y: -40 }')],
    ['W011', (t) => replace(t, 'drawings/contexto.yaml', 'stone: { x: 360, y: -272 }', 'stone: { x: 361, y: -272 }')],
    ['W012', (t) => {
      replace(t, 'drawings/vtex.yaml', 'nodes:\n', 'nodes:\n  vtex: { x: -48, y: -48, w: 256, h: 128, expanded: true }\n');
    }],
    ['W020', (t) => t.set('flows/curto.yaml', 'id: curto\nname: Curto\ndrawing: contexto\nsteps:\n  - id: a\n    via: cliente.navega\n    text: oi\n')],
    ['W021', (t) => replace(t, 'flows/compra-com-estoque-da-loja.yaml', '  - id: atualiza-estoque', '  - parallel:\n      - []\n      - - id: x\n          via: cliente.navega\n          text: x\n  - id: atualiza-estoque')],
  ];
  it.each(cases)('%s', (code, edit) => {
    expect(codes(project(edit))).toContain(code);
  });

  it('reports file and line', () => {
    const problems = validate(project((t) => replace(t, 'entities/cliente.yaml', 'to: deco', 'to: nada')));
    const p = problems.find((x) => x.code === 'E020')!;
    expect(p.file).toBe('entities/cliente.yaml');
    expect(base.get('entities/cliente.yaml')!.split('\n')[p.line! - 1]).toContain('to: deco');
  });

  it('honours rules overrides from zark.yaml', () => {
    const p = project((t) => {
      replace(t, 'drawings/contexto.yaml', /  cliente\.navega: .*\n/, '');
      replace(t, 'zark.yaml', 'grid: 8', 'grid: 8\nrules: { W003: error }');
    });
    expect(errorsOf(validate(p)).map((x) => x.code)).toContain('W003');
  });

  it('tolerates an invalid file and still loads the rest', () => {
    const p = project((t) => t.set('entities/deco.yaml', ': : :'));
    expect(p.entities.size).toBe(12);
    expect(codes(p)).toContain('E001');
  });
});

describe('operations', () => {
  it('moving a box changes exactly one YAML line', async () => {
    const p = project();
    const r = await applyOps(p, [{ op: 'drawing.move-nodes', drawing: 'contexto', nodes: [{ id: 'stone', x: 360, y: -296 }] }]);
    expect(r.ok).toBe(true);
    const after = r.files.get('drawings/contexto.yaml')!;
    expect(lineDiff(base.get('drawings/contexto.yaml')!, after)).toBe(1);
    expect(r.changes.map((c) => c.text)).toEqual(['Contexto: 1 caixa reposicionada']);
  });

  it('preserves comments when editing', async () => {
    const p = project((t) => replace(t, 'entities/sintese.yaml', 'caption: OrderMS e WarehouseMS', 'caption: OrderMS e WarehouseMS # nome interno\n# comentário solto'));
    const r = await applyOps(p, [{ op: 'entity.update', id: 'sintese', set: { caption: 'OMS' } }]);
    expect(r.ok).toBe(true);
    const text = r.files.get('entities/sintese.yaml')!;
    expect(text).toContain('caption: OMS # nome interno');
    expect(text).toContain('# comentário solto');
  });

  it('refuses an operation that introduces an error, with explanation', async () => {
    const r = await applyOps(project(), [{ op: 'connection.create', from: 'cliente', connection: { id: 'x', to: 'nada', label: 'X' } }]);
    expect(r.ok).toBe(false);
    expect(r.newErrors.map((e) => e.code)).toEqual(['E020']);
  });

  it('delete without cascade returns impact and changes nothing; with cascade leaves no broken refs', async () => {
    const p = project();
    const dry = await applyOps(p, [{ op: 'entity.delete', id: 'linx' }]);
    expect(dry.ok).toBe(false);
    expect(dry.impact!.join('\n')).toMatch(/sintese\.baixa-estoque/);
    expect(dry.files.size).toBe(0);
    const r = await applyOps(p, [{ op: 'entity.delete', id: 'linx', cascade: true }]);
    expect(r.ok).toBe(true);
    expect(r.files.get('entities/linx.yaml')).toBeNull();
    expect(errorsOf(r.problems)).toEqual([]);
    expect(r.files.get('flows/compra-com-estoque-da-loja.yaml')).not.toContain('baixa-estoque');
  });

  it('children block entity deletion unless cascaded', async () => {
    const dry = await applyOps(project(), [{ op: 'entity.delete', id: 'vtex' }]);
    expect(dry.impact!.join('\n')).toMatch(/Filhos impedem/);
    const r = await applyOps(project(), [{ op: 'entity.delete', id: 'vtex', cascade: true }]);
    expect(r.ok).toBe(true);
    expect([...r.project.entities.keys()]).not.toContain('gateway');
    expect(errorsOf(r.problems)).toEqual([]);
  });

  it('rename-id rewrites every reference in one step', async () => {
    const r = await applyOps(project(), [{ op: 'rename-id', kind: 'entity', from: 'sintese', to: 'oms' }]);
    expect(r.ok).toBe(true);
    expect(r.files.get('entities/sintese.yaml')).toBeNull();
    expect(r.project.connections.has('oms.coleta')).toBe(true);
    expect(r.files.get('drawings/contexto.yaml')).toContain('oms.inventario-phg');
    expect(r.files.get('flows/compra-com-estoque-da-loja.yaml')).toContain('via: oms.baixa-estoque');
    expect(validate(r.project)).toEqual([]);
  });

  it('reverse moves the connection to the other file and is refused when a flow step would go against it', async () => {
    const ok = await applyOps(project(), [{ op: 'connection.reverse', ref: 'transportadora.rastreio' }]);
    expect(ok.ok).toBe(true);
    expect(ok.project.connections.get('intelipost.rastreio')?.conn.to).toBe('transportadora');
    expect(ok.changes.map((c) => c.text)).toContain('Conexão invertida: agora Intelipost -> Transportadora');
    const refused = await applyOps(project(), [{ op: 'connection.reverse', ref: 'deco.checkout' }]);
    expect(refused.ok).toBe(false);
    expect(refused.newErrors.map((e) => e.code)).toContain('E041');
  });

  it('apply batch: create, connect, place, draw and add a flow step validated as a whole', async () => {
    const r = await applyOps(project(), [
      { op: 'entity.create', entity: { id: 'antifraude', name: 'Antifraude', kind: 'system', external: true } },
      { op: 'connection.create', from: 'antifraude', connection: { id: 'score', to: 'trinio', label: 'Devolve score' } },
      { op: 'drawing.place', drawing: 'contexto', nodes: [{ id: 'antifraude' }] },
      { op: 'drawing.draw-edges', drawing: 'contexto', edges: [{ ref: 'antifraude.score', shape: 'straight' }] },
      { op: 'flow.add-steps', flow: 'compra-com-estoque-da-loja', index: 3, steps: [{ id: 'score', via: 'antifraude.score', text: 'Consulta antifraude' }] },
    ]);
    expect(r.ok, r.error).toBe(true);
    expect(errorsOf(r.problems)).toEqual([]);
    expect(r.files.get('entities/antifraude.yaml')).toMatch(/^# yaml-language-server/);
    const changes = r.changes.map((c) => c.text);
    expect(changes).toContain('Entidade adicionada: Antifraude (system, externo)');
    expect(changes).toContain('Nova conexão: Antifraude -> Trinio ("Devolve score")');
    expect(changes).toContain('Compra com estoque da loja: 1 passo adicionado');
    // New files are canonical too.
    for (const [path, text] of r.files) if (text) expect(formatText(fileKind(path)!, text), path).toBe(text);
  });

  it('detects hash conflicts', async () => {
    const r = await applyOps(project(), [{ op: 'entity.update', id: 'deco', set: { caption: 'x' } }], { expect: { 'entities/deco.yaml': 'stale' } });
    expect(r.conflict?.file).toBe('entities/deco.yaml');
  });

  it('auto-layout snaps to the grid without overlaps', async () => {
    const r = await applyOps(project(), [{ op: 'drawing.auto-layout', drawing: 'contexto' }]);
    expect(r.ok).toBe(true);
    const nodes = r.project.drawings.get('contexto')!.drawing.nodes!;
    for (const n of Object.values(nodes)) expect(n.x % 8 + n.y % 8).toBe(0);
    expect(validate(r.project).map((p) => p.code)).not.toContain('W010');
  });
});

import { flowToMermaid, numberSteps, playbackFrames } from '../src/index.js';

describe('flow text', () => {
  const p = project();
  const flow = p.flows.get('compra-com-estoque-da-loja')!.flow;
  const lookup = {
    connection: (ref: string) => {
      const c = p.connections.get(ref);
      return c && { from: c.from, to: c.conn.to, direction: c.conn.direction };
    },
    name: (id: string) => p.entities.get(id)?.entity.name ?? id,
  };

  it('numbers steps 1, 2, 3a, 3b', () => {
    expect(numberSteps(flow.steps).map((s) => s.number)).toEqual(['1', '2', '3', '4', '5a', '5b', '6a', '6b', '7']);
  });

  it('plays parallel branches together and picks one alternative', () => {
    const frames = playbackFrames(flow.steps);
    expect(frames.map((f) => f.map((s) => s.id).join('+'))).toEqual([
      'dados-da-compra', 'redireciona', 'pagamento', 'cria-pedido', 'pedido-transporte+baixa-erp', 'solicita-coleta', 'atualiza-estoque',
    ]);
    expect(playbackFrames(flow.steps, { 'r.5': 1 })[5][0].id).toBe('avisa-falha');
  });

  it('exports an equivalent Mermaid sequenceDiagram', () => {
    const text = flowToMermaid(flow, lookup);
    expect(text).toContain('par\n');
    expect(text).toContain('alt Coleta agendada');
    expect(text).toContain('intelipost-->>sintese: Devolve erro de cotação');
    expect(text).toContain('participant seller_phg as PHG');
  });
});

import { CURRENT_SCHEMA, migrate, MigrationError } from '../src/index.js';

describe('format migration', () => {
  it('does nothing on a current project', () => {
    const r = migrate(new Map(base));
    expect(r.steps).toEqual([]);
    expect(r.files.size).toBe(0);
    expect(r.from).toBe(CURRENT_SCHEMA);
  });

  it('applies the chain of steps and bumps schema', () => {
    const texts = new Map(base);
    texts.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 0'));
    const r = migrate(texts, [
      { from: 0, to: 1, describe: 'renomeia caption', apply: (t) => new Map([['entities/deco.yaml', t.get('entities/deco.yaml')!.replace('caption: Front', 'caption: Frontend')]]) },
    ]);
    expect(r.steps).toEqual(['0 -> 1: renomeia caption']);
    expect(r.files.get('entities/deco.yaml')).toContain('caption: Frontend');
    expect(r.files.get('zark.yaml')).toContain('schema: 1');
  });

  it('refuses a newer format and a missing step', () => {
    const newer = new Map(base);
    newer.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 7'));
    expect(() => migrate(newer)).toThrow(MigrationError);
    const older = new Map(base);
    older.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 0'));
    expect(() => migrate(older, [])).toThrow(/Não há migração do schema 0/);
  });

  it('explains an unsupported schema when loading', () => {
    const p = project((t) => t.set('zark.yaml', base.get('zark.yaml')!.replace('schema: 1', 'schema: 2')));
    expect(validate(p).find((x) => x.code === 'E001')?.message).toMatch(/mais novo que este Zark/);
  });
});
