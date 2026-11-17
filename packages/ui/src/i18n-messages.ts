// Portuguese templates for the keyed messages the core sends (problems,
// semantic changes, cascade impact). Keys must match core/src/messages.ts;
// a parity test enforces it. English comes from the core itself.
import { validSuffix, type Template } from '@core/messages';

const list = (v: unknown, max = 12) => {
  const all = Array.isArray(v) ? v : [];
  return `${all.slice(0, max).join(', ')}${all.length > max ? ', ...' : ''}`;
};
const iconSets = (v: unknown) => (Array.isArray(v) && v.length ? `. Conjuntos: ${list(v)} (pacotes próprios em zark.yaml icons.packs)` : '');
const plural = (n: unknown, one: string, many: string) => `${n} ${Number(n) === 1 ? one : many}`;
const andList = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`);
const root = (v: unknown) => (Array.isArray(v) ? v.map((k) => (k === 'root' ? 'raiz' : k)) : v);

export const PROBLEM_PT: Record<string, Template> = {
  'E001.raw': (p) => `${p.detail}`,
  'E001.alias': () => 'anchors e aliases não são permitidos',
  'E001.schemaNewer': (p) => `schema ${p.schema} é mais novo que este Zark (suporta ${p.supported}). Atualize o Zark`,
  'E001.schemaOlder': (p) => `schema ${p.schema} é antigo. Rode "zark migrate"`,
  'E001.nesting': (p) => `aninhamento acima de ${p.max} níveis`,
  E002: (p) => `id "${p.id}" diferente do nome do arquivo (${p.file})`,
  E003: (p) => `${p.kind} "${p.id}" duplicado`,
  'E003.step': (p) => `passo "${p.id}" duplicado`,
  E010: (p) => `parent "${p.parent}" não existe`,
  E011: (p) => `${p.kind} não pode ficar dentro de ${p.parentKind} (${p.parent}). Pais aceitos: ${list(root(p.allowed))}`,
  'E011.needsParent': (p) => `${p.kind} precisa de parent (${list(root(p.allowed))})`,
  E012: (p) => `ciclo na hierarquia: ${(p.chain as string[]).join(' -> ')}`,
  E020: (p) => `conexão ${p.ref}: destino "${p.target}" não existe`,
  'E020.via': (p) => `conexão ${p.ref}: via "${p.via}" não existe`,
  E021: (p) => `conexão ${p.ref} liga ${p.entity} a ele mesmo`,
  'E022.technology': (p) => `tecnologia "${p.id}" não existe em catalog.yaml${validSuffix('Válidos', p.valid)}`,
  'E022.tag': (p) => `tag "${p.id}" não existe em catalog.yaml${validSuffix('Válidos', p.valid)}`,
  'E022.team': (p) => `time "${p.id}" não existe em catalog.yaml${validSuffix('Válidos', p.valid)}`,
  E030: (p) => `desenho posiciona "${p.id}", que não existe`,
  E031: (p) => `desenho traça "${p.ref}", que não existe${validSuffix(`Conexões de ${p.from}`, p.siblings)}`,
  E032: (p) => `${p.ref}: ${p.missing} nem um ancestral estão no desenho`,
  E033: (p) => `scope "${p.scope}" não existe`,
  E034: (p) => `grupo ${p.group}: membro "${p.member}" não está em nodes`,
  E013: (p) => `${p.id} é ${p.kind}: só componentes podem ter source`,
  E014: (p) => `${p.id}: source "${p.source}" não corresponde a nenhum arquivo ou pasta`,
  'E014.outside': (p) => `${p.id}: source "${p.source}" precisa ser um caminho dentro do repositório (sem caminho absoluto, sem "..")`,
  E015: (p) => `${p.file} é reivindicado por ${(p.components as string[]).join(', ')} com sources igualmente específicos`,
  E040: (p) => `passo ${p.step}: conexão "${p.via}" não existe${validSuffix(`Conexões de ${p.from}`, p.siblings)}`,
  E041: (p) => `passo ${p.step} anda na contramão de ${p.via} (${p.source} -> ${p.target}). Inverta a conexão ou marque reply: true`,
  E042: (p) => `passo ${p.step}: reverse em ${p.via}, que não é bidirectional`,
  E043: (p) => `fluxo aponta para desenho "${p.drawing}", que não existe${validSuffix('Válidos', p.valid)}`,
  'E043.subflow': (p) => `subflow "${p.subflow}" não existe`,
  E044: (p) => `passo ${p.step}: ${p.via} não está traçada no desenho ${p.drawing}`,
  E045: (p) => `ciclo entre subfluxos: ${(p.chain as string[]).join(' -> ')}`,
  W001: (p) => `${p.id} sem conexões e fora de qualquer desenho (órfã)`,
  W002: (p) => `${p.id} não aparece em nenhum desenho`,
  W003: (p) => `${p.ref}: fora de qualquer desenho`,
  W004: (p) => `conexão ${p.ref} com rótulo genérico ("${p.label}")`,
  'W004.empty': (p) => `conexão ${p.ref} com rótulo vazio`,
  W005: (p) => `conexões ${p.first} e ${p.second} entre o mesmo par com o mesmo rótulo "${p.label}"`,
  W006: (p) => `${p.id} tem status removed e ainda aparece no desenho`,
  W010: (p) => `${p.a} e ${p.b} sobrepostas`,
  W011: (p) => `${p.id} fora do grid de ${p.grid}px`,
  W012: (p) => `${p.id} fora da moldura de ${p.parent}`,
  W020: (p) => `fluxo ${p.id} vazio`,
  'W020.single': (p) => `fluxo ${p.id} com um único passo`,
  'W021.parallel': (p) => `ramo ${p.branch} de parallel vazio`,
  'W021.alternative': (p) => `alternativa "${p.name}" vazia`,
  'W030.orphan': (p) => `${p.file} não corresponde a nenhum desenho ou fluxo`,
  W030: (p) => `${p.file} desatualizado. Rode "zark render"`,
  'W013.label': (p) => `rótulo de ${p.ref} sobreposto ao rótulo de ${p.other}`,
  'W013.box': (p) => `rótulo de ${p.ref} sobreposto à caixa ${p.box}`,
  W014: (p) => `${p.id} tem source mas nenhum grafo de código gerado. Rode "zark scan"`,
  W015: (p) => `${p.file} pertence ao componente "${p.id}", que ${p.reason === 'noSource' ? 'não tem source' : 'não existe'}`,
  W040: (p) => `ícone "${p.icon}" não existe${iconSets(p.sets)}`,
  'W040.technology': (p) => `tecnologia ${p.id}: ícone "${p.icon}" não existe${iconSets(p.sets)}`,
};

export const CHANGE_PT: Record<string, Template> = {
  'entity.added': (p) => `Entidade adicionada: ${p.name} (${p.kind}${p.external ? ', externo' : ''})`,
  'entity.removed': (p) => `Entidade removida: ${p.name}`,
  'entity.moved': (p) => `${p.name} movido para dentro de ${p.parent}`,
  'entity.movedRoot': (p) => `${p.name} movido para a raiz`,
  'entity.changed': (p) => {
    const fields = (p.fields as string[]).map((f) => (f === 'name' ? `nome "${p.oldName}" -> "${p.newName}"` : f));
    return `${p.name}: ${andList(fields)} ${fields.length === 1 ? 'alterado' : 'alterados'}`;
  },
  'connection.added': (p) => `Nova conexão: ${p.from} -> ${p.to} ("${p.label}")`,
  'connection.removed': (p) => `Conexão removida: ${p.from} -> ${p.to} ("${p.label}")`,
  'connection.reversed': (p) => `Conexão invertida: agora ${p.from} -> ${p.to}`,
  'connection.changed': (p) => {
    const parts = (p.fields as string[]).map((f) => (f === 'label' ? `rótulo "${p.oldLabel}" -> "${p.newLabel}"` : `${f} alterado`));
    return `${p.from} -> ${p.to}: ${parts.join(', ')}`;
  },
  'drawing.added': (p) => `Novo desenho: ${p.name}`,
  'drawing.removed': (p) => `Desenho removido: ${p.name}`,
  'drawing.content': (p) =>
    `${p.name}: ${[
      Number(p.plusN) && `+${plural(p.plusN, 'entidade', 'entidades')}`,
      Number(p.minusN) && `-${plural(p.minusN, 'entidade', 'entidades')}`,
      Number(p.plusE) && `+${plural(p.plusE, 'conexão', 'conexões')}`,
      Number(p.minusE) && `-${plural(p.minusE, 'conexão', 'conexões')}`,
    ]
      .filter(Boolean)
      .join(', ')}`,
  'drawing.layout': (p) =>
    `${p.name}: ${[
      Number(p.moved) && plural(p.moved, 'caixa reposicionada', 'caixas reposicionadas'),
      Number(p.reshaped) && plural(p.reshaped, 'conector ajustado', 'conectores ajustados'),
      Number(p.visual) && 'metadados, grupos ou notas alterados',
    ]
      .filter(Boolean)
      .join(', ')}`,
  'flow.added': (p) => `Novo fluxo: ${p.name} (${plural(p.steps, 'passo', 'passos')})`,
  'flow.removed': (p) => `Fluxo removido: ${p.name}`,
  'flow.steps': (p) => {
    const parts = [
      Number(p.plus) && plural(p.plus, 'passo adicionado', 'passos adicionados'),
      Number(p.minus) && plural(p.minus, 'passo removido', 'passos removidos'),
      Number(p.reordered) && plural(p.reordered, 'reordenado', 'reordenados'),
      Number(p.edited) && plural(p.edited, 'passo alterado', 'passos alterados'),
    ].filter(Boolean);
    return `${p.name}: ${parts.length ? parts.join(', ') : 'metadados alterados'}`;
  },
};

export const IMPACT_PT: Record<string, Template> = {
  children: (p) => `Filhos impedem a exclusão: ${list(p.ids, 50)}`,
  incoming: (p) => `Conexões removidas: ${list(p.refs, 50)}`,
  nodes: (p) => `Desenho ${p.drawing}: remove ${list(p.ids, 50)}`,
  edges: (p) => `Desenho ${p.drawing}: remove traçados ${list(p.refs, 50)}`,
  scope: (p) => `Desenho ${p.drawing}: perde o scope ${p.scope}`,
  steps: (p) => `Fluxo ${p.flow}: remove passos sobre ${list(p.refs, 50)}`,
  via: (p) => `${p.entity}: remove via de ${list(p.ids, 50)}`,
  edge: (p) => `Desenho ${p.drawing}: remove o traçado`,
  stepsOn: (p) => `Fluxo ${p.flow}: remove os passos sobre ${p.ref}`,
};
