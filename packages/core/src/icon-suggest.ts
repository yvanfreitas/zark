// Pure (no Node imports): shared by the server and unit tests.

export interface SuggestInput {
  name: string;
  caption?: string;
  description?: string;
  kind: 'actor' | 'system' | 'app' | 'store' | 'component';
  external?: boolean;
  /** Resolved catalog technologies of the entity. */
  technologies: { id: string; name: string; icon?: string }[];
}

/** Vendor prefixes stripped when matching a technology against icon pack file names. */
const VENDOR = /^(amazon|aws|azure|microsoft|google|gcp|cloud)[-_ ]*/;

/** Word in name/caption/description -> generic Lucide icon. Portuguese and English. */
const KEYWORDS: [RegExp, string][] = [
  [/\b(fila|queue|sqs|dlq)s?\b/, 'lucide:list-ordered'],
  [/\b(t[óo]pico|topic|sns|pub\/?sub|event bus|eventbridge|kafka)s?\b/, 'lucide:radio-tower'],
  [/\b(evento|event)s?\b/, 'lucide:zap'],
  [/\b(bucket|s3|storage|anexo|attachment|arquivo|file|blob)s?\b/, 'lucide:archive'],
  [/\b(cache|redis|memcached)\b/, 'lucide:zap'],
  [/\b(gateway|api)\b/, 'lucide:network'],
  [/\b(websocket|socket|realtime|tempo real)\b/, 'lucide:radio'],
  [/\b(lambda|fun[çc][ãa]o|function|serverless|handler|worker)s?\b/, 'lucide:square-function'],
  [/\b(auth|autentica[çc][ãa]o|login|identity|identidade|cognito|oauth|sso)\b/, 'lucide:key-round'],
  [/\b(seguran[çc]a|security|firewall|waf)\b/, 'lucide:shield'],
  [/\b(e-?mail|ses|smtp)\b/, 'lucide:mail'],
  [/\b(notifica[çc][ãa]o|notification|push|sms)s?\b/, 'lucide:bell'],
  [/\b(pagamento|payment|checkout|billing|cobran[çc]a|gateway de pagamento)s?\b/, 'lucide:credit-card'],
  [/\b(chat|mensage[mn]s?|message|conversa)\b/, 'lucide:message-square'],
  [/\b(bot|assistente|assistant)s?\b/, 'lucide:bot'],
  [/\b(ia|ai|llm|ml|modelo|model|gpt|intelig[êe]ncia)\b/, 'lucide:brain'],
  [/\b(modera[çc][ãa]o|moderation)\b/, 'lucide:shield-check'],
  [/\b(busca|search|elastic|opensearch)\b/, 'lucide:search'],
  [/\b(analytics|m[ée]tricas?|metrics|dashboard|bi)\b/, 'lucide:chart-column'],
  [/\b(log|logs|observabilidade|observability|monitor|monitoring|cloudwatch)\b/, 'lucide:activity'],
  [/\b(banco|database|db|dynamo|dynamodb|postgres|mysql|tabela|table|rds)s?\b/, 'lucide:database'],
  [/\b(cdn|cloudfront|edge)\b/, 'lucide:globe'],
  [/\b(web|site|frontend|front)\b/, 'lucide:monitor'],
  [/\b(mobile|app m[óo]vel|ios|android|celular)\b/, 'lucide:smartphone'],
  [/\b(erp|estoque|inventory|warehouse|invent[áa]rio)\b/, 'lucide:warehouse'],
  [/\b(transporte|shipping|transportadora|log[íi]stica|delivery|entrega)s?\b/, 'lucide:truck'],
  [/\b(pedido|order|carrinho|cart|loja|store|ecommerce|e-commerce)s?\b/, 'lucide:shopping-cart'],
  [/\b(container|docker|kubernetes|k8s|ecs|eks)s?\b/, 'lucide:container'],
  [/\b(servidor|server|vm|ec2|compute)s?\b/, 'lucide:server'],
  [/\b(scheduler|agendador|cron|timer)\b/, 'lucide:clock'],
  [/\b(workflow|orquestra[çc][ãa]o|orchestrator|orquestrador|step functions?)\b/, 'lucide:workflow'],
];

const KIND_DEFAULT: Record<SuggestInput['kind'], string> = {
  actor: 'lucide:user',
  system: 'lucide:boxes',
  app: 'lucide:app-window',
  store: 'lucide:database',
  component: 'lucide:box',
};

/** Ids the suggestion logic may emit without `has` (for tests asserting they exist). */
export const STATIC_SUGGESTIONS = [...new Set([...KEYWORDS.map(([, id]) => id), ...Object.values(KIND_DEFAULT), 'lucide:users', 'lucide:cloud'])];

const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

/**
 * Icon ids that fit an entity, best first: icons of its technologies (explicit,
 * then by name in Simple Icons and the user packs), then words in its name and
 * caption, then its kind. `has` filters to icons that exist.
 */
export function suggestIcons(input: SuggestInput, has: (id: string) => boolean, packs: string[] = [], limit = 8): string[] {
  const out: string[] = [];
  const add = (id: string | undefined) => {
    if (id && !out.includes(id) && has(id)) out.push(id);
  };

  for (const tech of input.technologies) {
    if (tech.icon && /^[a-z0-9-]+:/.test(tech.icon)) add(tech.icon);
    const names = [...new Set([tech.id, tech.name].flatMap((n) => [slug(n), slug(n.toLowerCase().replace(VENDOR, ''))]).filter(Boolean))];
    // Official packs first (an `aws:sqs` beats a generic brand), then Simple Icons.
    for (const pack of packs) for (const n of names) {
      add(`${pack}:${n}`);
      add(`${pack}:${tech.id.toLowerCase()}`);
    }
    for (const n of names) add(`si:${n}`);
  }

  // Technology names count as words too: "AWS Lambda" says function even when the entity name doesn't.
  const text = `${input.name} ${input.caption ?? ''} ${input.description ?? ''} ${input.technologies.map((t) => `${t.id} ${t.name}`).join(' ')}`.toLowerCase();
  for (const [re, id] of KEYWORDS) if (re.test(text)) add(id);

  if (input.kind === 'actor' && /\b(usu[áa]rios|users|clientes|customers|people|pessoas)\b/.test(text)) add('lucide:users');
  add(KIND_DEFAULT[input.kind]);
  if (input.external && input.kind === 'system') add('lucide:cloud');
  return out.slice(0, limit);
}
