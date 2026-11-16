// Syntax-only facts about one module (spec sections 2 and 3): its exported pieces, imports,
// re-exports and call sites with target hints. Pure: no filesystem, no import resolution.
// A site whose target the syntax does not name gets `{ ref: 'unknown' }`, never a guess.
import { parseSync } from 'oxc-parser';
import type { CodePiece } from '../schema.js';

export type ImportFact = { local: string; imported: string /* name, 'default' or '*' */; from: string; typeOnly: boolean };
export type ReexportFact = { exported: string /* or '*' */; imported: string; from: string };
export type TargetHint =
  | { ref: 'binding'; name: string; member?: string }
  | { ref: 'typed'; typeName: string; member: string }
  | { ref: 'unknown' };
export type CallSite = {
  from: string /* piece or Piece.member, or '' for module-level */;
  kind: 'calls' | 'instantiates' | 'extends' | 'implements';
  target: TargetHint;
};
export type ModuleFacts = {
  path: string;
  pieces: CodePiece[];
  imports: ImportFact[];
  reexports: ReexportFact[];
  sites: CallSite[];
  /** Names declared at module scope (not imports) -> the piece each one is, `undefined` when it is not exported. */
  locals: Map<string, string | undefined>;
  parseErrors: number;
};

// The walker reads the ESTree-shaped AST generically; oxc's precise node types would not add safety here.
type N = any;
// A declared name maps to the type named by its annotation or `new X()` initializer; `undefined` = untyped
// (or declared twice with different types in one function).
type Scope = { vars: Map<string, string | undefined>; module: boolean; parent?: Scope };
// `name` is set only for a top-level class, so `this.m()` can be pointed at it.
type ClassCtx = { name?: string; fields: Map<string, string | undefined> };
type Ctx = { from: string; scope: Scope; cls?: ClassCtx };

const FUNCTIONS = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const CLASSES = new Set(['ClassDeclaration', 'ClassExpression']);
const TYPE_KEYS = new Set(['typeAnnotation', 'returnType', 'typeParameters', 'typeArguments', 'superTypeArguments']);
const UNKNOWN: TargetHint = { ref: 'unknown' };

export function extractModule(path: string, text: string): ModuleFacts {
  const { program, errors } = parseSync(path, text.replace(/\r\n?/g, '\n'), { sourceType: 'module' });
  const body: N[] = program.body;
  const facts: ModuleFacts = { path, pieces: [], imports: [], reexports: [], sites: [], locals: new Map(), parseErrors: errors.length };
  const moduleScope: Scope = { vars: new Map(), module: true };
  collectDecls(body, moduleScope, 'lexical');
  collectDecls(body, moduleScope, 'var');
  for (const name of moduleScope.vars.keys()) facts.locals.set(name, undefined);
  // The first piece a local name declares wins (overloads, `export { a as b, a as c }`).
  const bindLocal = (local: string | undefined, piece: string | undefined) => {
    if (local && facts.locals.get(local) === undefined) facts.locals.set(local, piece);
  };
  const listed = exportList(body);
  const seen = new Set<string>();
  const addPiece = (piece: CodePiece) => {
    if (seen.has(piece.name)) return; // overloads and declaration merging: keep the first
    seen.add(piece.name);
    facts.pieces.push(piece);
  };
  const walker = new Walker(facts.sites);

  // Records `decl` as pieces named `names` (none = not exported) and walks it. A variable statement
  // names its own pieces: all its declarators when `exportedVars`, else those in an export list.
  const declaration = (decl: N, names: string[], exportedVars = false) => {
    const from = names[0] ?? '';
    const ctx: Ctx = { from, scope: moduleScope };
    if (decl.type !== 'VariableDeclaration') bindLocal(decl.id?.name, names[0]);
    if (CLASSES.has(decl.type)) {
      for (const name of names) addPiece(classPiece(decl, name));
      walker.cls(decl, ctx, from || undefined, decl.id?.name);
    } else if (FUNCTIONS.has(decl.type) || decl.type === 'TSDeclareFunction') {
      for (const name of names) addPiece({ name, kind: 'function' });
      walker.walk(decl, ctx);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        const own = d.id.type === 'Identifier' ? (exportedVars ? [d.id.name] : listed.get(d.id.name) ?? []) : [];
        const kind = d.init && FUNCTIONS.has(d.init.type) ? 'function' : 'const';
        for (const name of own) addPiece({ name, kind });
        if (d.id.type === 'Identifier') bindLocal(d.id.name, own[0]);
        walker.walk(d, { from: own[0] ?? '', scope: moduleScope });
      }
    } else if (decl.type in KIND_OF) {
      for (const name of names) addPiece({ name, kind: KIND_OF[decl.type] });
    } else {
      walker.walk(decl, { from: '', scope: moduleScope }); // not a piece kind (e.g. `export namespace`): module-level
    }
  };

  for (const stmt of body) {
    if (stmt.type === 'ImportDeclaration') {
      for (const s of stmt.specifiers) {
        const imported =
          s.type === 'ImportDefaultSpecifier' ? 'default' : s.type === 'ImportNamespaceSpecifier' ? '*' : nameOf(s.imported);
        const typeOnly = stmt.importKind === 'type' || s.importKind === 'type';
        facts.imports.push({ local: s.local.name, imported, from: stmt.source.value, typeOnly });
      }
    } else if (stmt.type === 'ExportNamedDeclaration' && stmt.source) {
      for (const s of stmt.specifiers) facts.reexports.push({ exported: nameOf(s.exported), imported: nameOf(s.local), from: stmt.source.value });
    } else if (stmt.type === 'ExportAllDeclaration') {
      facts.reexports.push({ exported: stmt.exported ? nameOf(stmt.exported) : '*', imported: '*', from: stmt.source.value });
    } else if (stmt.type === 'ExportNamedDeclaration') {
      if (stmt.declaration) declaration(stmt.declaration, [declaredName(stmt.declaration)], true);
    } else if (stmt.type === 'ExportDefaultDeclaration') {
      const decl = stmt.declaration;
      if (decl.type === 'Identifier') continue; // `export default x`: x's own declaration becomes the piece
      if (CLASSES.has(decl.type) || FUNCTIONS.has(decl.type) || decl.type in KIND_OF) declaration(decl, ['default']);
      else {
        addPiece({ name: 'default', kind: 'const' });
        walker.walk(decl, { from: 'default', scope: moduleScope });
      }
    } else {
      const name = declaredName(stmt);
      declaration(stmt, (name && listed.get(name)) || []);
    }
  }
  // `import { a } ...; export { a }` and `export default a` of an import re-export its origin.
  for (const [local, exportedNames] of listed) {
    const fact = facts.imports.find((i) => i.local === local);
    if (fact) for (const exported of exportedNames) facts.reexports.push({ exported, imported: fact.imported, from: fact.from });
  }
  return facts;
}

const KIND_OF: Record<string, CodePiece['kind']> = {
  TSInterfaceDeclaration: 'interface',
  TSTypeAliasDeclaration: 'type',
  TSEnumDeclaration: 'enum',
};

function nameOf(node: N): string {
  return node.type === 'Identifier' ? node.name : String(node.value);
}
function declaredName(decl: N): string {
  return decl.id?.type === 'Identifier' ? decl.id.name : '';
}

// Local names exported through `export { a, b as c }` and `export default a`: local -> exported names.
function exportList(body: N[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (local: string, exported: string) => out.set(local, [...(out.get(local) ?? []), exported]);
  for (const stmt of body) {
    if (stmt.type === 'ExportNamedDeclaration' && !stmt.source && !stmt.declaration) {
      for (const s of stmt.specifiers) add(nameOf(s.local), nameOf(s.exported));
    } else if (stmt.type === 'ExportDefaultDeclaration' && stmt.declaration.type === 'Identifier') {
      add(stmt.declaration.name, 'default');
    }
  }
  return out;
}

const METHODS = new Set(['MethodDefinition', 'TSAbstractMethodDefinition']);
function isPublicMethod(el: N): boolean {
  return METHODS.has(el.type) && el.kind !== 'constructor' && !el.computed && el.key.type === 'Identifier' && !el.accessibility?.match(/private|protected/);
}
function classPiece(decl: N, name: string): CodePiece {
  const members = [...new Set<string>(decl.body.body.filter(isPublicMethod).map((el: N) => el.key.name))].sort();
  return members.length ? { name, kind: 'class', members } : { name, kind: 'class' };
}

// The type name an annotation gives (`X`, `X<T>`); anything else (unions, qualified names, functions) gives none.
function annotatedType(node: N): string | undefined {
  const t = node?.typeAnnotation?.typeAnnotation;
  return t?.type === 'TSTypeReference' && t.typeName.type === 'Identifier' ? t.typeName.name : undefined;
}
function newedType(init: N): string | undefined {
  return init?.type === 'NewExpression' && init.callee.type === 'Identifier' ? init.callee.name : undefined;
}

function declare(scope: Scope, name: string, type: string | undefined): void {
  if (scope.vars.has(name) && scope.vars.get(name) !== type) scope.vars.set(name, undefined);
  else scope.vars.set(name, type);
}
// Every name bound by a pattern (parameters, destructuring), with the type of a plain annotated identifier.
function declarePattern(scope: Scope, p: N, type?: string): void {
  if (!p) return;
  if (p.type === 'Identifier') declare(scope, p.name, type ?? annotatedType(p));
  else if (p.type === 'TSParameterProperty') declarePattern(scope, p.parameter);
  else if (p.type === 'AssignmentPattern') declarePattern(scope, p.left, type ?? newedType(p.right));
  else if (p.type === 'RestElement') declarePattern(scope, p.argument);
  else if (p.type === 'ArrayPattern') for (const e of p.elements) declarePattern(scope, e);
  else if (p.type === 'ObjectPattern') for (const prop of p.properties) declarePattern(scope, prop.type === 'RestElement' ? prop : prop.value);
}
// Nodes that open a block scope for `let`/`const`/function/class declarations.
const BLOCKS = new Set(['BlockStatement', 'ForStatement', 'ForInStatement', 'ForOfStatement', 'SwitchStatement', 'CatchClause', 'StaticBlock']);
// Declarations visible in one scope, collected before its calls are walked so a use before its `const`
// still sees the right binding. 'lexical' takes `let`/`const`/function/class and stops at nested blocks
// (they get their own scope); 'var' hoists `var` through blocks to the function or module. Neither
// enters nested functions or classes.
function collectDecls(node: N, scope: Scope, mode: 'lexical' | 'var'): void {
  if (Array.isArray(node)) return node.forEach((n) => collectDecls(n, scope, mode));
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'VariableDeclaration') {
    if ((node.kind === 'var') !== (mode === 'var')) return;
    for (const d of node.declarations) {
      declarePattern(scope, d.id, d.id.type === 'Identifier' ? annotatedType(d.id) ?? newedType(d.init) : undefined);
    }
    return;
  }
  if (FUNCTIONS.has(node.type) || CLASSES.has(node.type)) {
    if (mode === 'lexical' && node.id && !node.type.endsWith('Expression')) declare(scope, node.id.name, undefined);
    return;
  }
  if (mode === 'lexical' && BLOCKS.has(node.type)) return;
  collectChildren(node, scope, mode);
}
function collectChildren(node: N, scope: Scope, mode: 'lexical' | 'var'): void {
  for (const [key, child] of Object.entries(node)) if (!TYPE_KEYS.has(key) && typeof child === 'object') collectDecls(child, scope, mode);
}

function lookup(scope: Scope | undefined, name: string): { type?: string; module: boolean } | undefined {
  for (let s = scope; s; s = s.parent) if (s.vars.has(name)) return { type: s.vars.get(name), module: s.module };
  return undefined;
}

class Walker {
  constructor(private readonly sites: CallSite[]) {}

  walk(node: N, ctx: Ctx): void {
    if (Array.isArray(node)) return node.forEach((n) => this.walk(n, ctx));
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const kind = node.type === 'CallExpression' ? 'calls' : 'instantiates';
      this.sites.push({ from: ctx.from, kind, target: this.hint(node.callee, ctx) });
    } else if (FUNCTIONS.has(node.type)) {
      // A non-arrow function rebinds `this`, so class context is lost inside it.
      return this.fn(node, { ...ctx, cls: node.type === 'ArrowFunctionExpression' ? ctx.cls : undefined });
    } else if (CLASSES.has(node.type)) {
      return this.cls(node, ctx, undefined, undefined);
    } else if (BLOCKS.has(node.type)) {
      const scope: Scope = { vars: new Map(), module: false, parent: ctx.scope };
      if (node.type === 'CatchClause') declarePattern(scope, node.param);
      collectChildren(node, scope, 'lexical');
      ctx = { ...ctx, scope };
    }
    for (const [key, child] of Object.entries(node)) if (!TYPE_KEYS.has(key) && typeof child === 'object') this.walk(child, ctx);
  }

  fn(node: N, ctx: Ctx): void {
    const scope: Scope = { vars: new Map(), module: false, parent: ctx.scope };
    if (node.type === 'FunctionExpression' && node.id) declare(scope, node.id.name, undefined); // own name shadows outer bindings
    for (const p of node.params) declarePattern(scope, p);
    collectDecls(node.body, scope, 'var'); // the body block collects its own `let`/`const` when walked
    const inner = { ...ctx, scope };
    this.walk(node.params, inner);
    this.walk(node.body, inner);
  }

  // `piece` is the exported piece name for a top-level class (calls come from `piece.method`);
  // `name` is the declared name of a top-level class, for `this.m()` hints.
  cls(node: N, ctx: Ctx, piece: string | undefined, name: string | undefined): void {
    const from = piece ?? ctx.from;
    if (node.superClass) this.sites.push({ from, kind: 'extends', target: this.hint(node.superClass, ctx) });
    for (const i of node.implements ?? []) this.sites.push({ from, kind: 'implements', target: this.hint(i.expression, ctx) });
    const fields = new Map<string, string | undefined>();
    for (const el of node.body.body) {
      if (el.type === 'PropertyDefinition' && !el.computed && el.key.type === 'Identifier') fields.set(el.key.name, annotatedType(el) ?? newedType(el.value));
      if (el.type === 'MethodDefinition' && el.kind === 'constructor') {
        for (const p of el.value.params) if (p.type === 'TSParameterProperty') {
          const id = p.parameter.type === 'AssignmentPattern' ? p.parameter.left : p.parameter;
          fields.set(id.name, annotatedType(id));
        }
      }
    }
    // A class expression's own name is bound only inside its body.
    const scope: Scope = node.type === 'ClassExpression' && node.id ? { vars: new Map([[node.id.name, undefined]]), module: false, parent: ctx.scope } : ctx.scope;
    const inner: Ctx = { from, scope, cls: { name, fields } };
    this.walk(node.decorators, { ...inner, cls: ctx.cls });
    this.walk(node.superClass, ctx);
    for (const el of node.body.body) {
      const member = piece && (el.kind === 'constructor' || isPublicMethod(el)) ? `${piece}.${el.key.name}` : from;
      if (METHODS.has(el.type)) this.fn(el.value, { ...inner, from: member });
      else this.walk(el, inner);
    }
  }

  hint(expr: N, ctx: Ctx): TargetHint {
    while (expr.type === 'ParenthesizedExpression' || expr.type === 'TSNonNullExpression') expr = expr.expression;
    if (expr.type === 'Identifier') {
      const found = lookup(ctx.scope, expr.name);
      return found && !found.module ? UNKNOWN : { ref: 'binding', name: expr.name };
    }
    if (expr.type !== 'MemberExpression' || expr.computed || expr.property.type !== 'Identifier') return UNKNOWN;
    const member: string = expr.property.name;
    let object = expr.object;
    while (object.type === 'ParenthesizedExpression' || object.type === 'TSNonNullExpression') object = object.expression;
    if (object.type === 'Identifier') {
      const found = lookup(ctx.scope, object.name);
      if (found?.type) return { ref: 'typed', typeName: found.type, member };
      return found && !found.module ? UNKNOWN : { ref: 'binding', name: object.name, member };
    }
    if (object.type === 'ThisExpression') return ctx.cls?.name ? { ref: 'binding', name: ctx.cls.name, member } : UNKNOWN;
    if (object.type === 'MemberExpression' && object.object.type === 'ThisExpression' && !object.computed && object.property.type === 'Identifier') {
      const type = ctx.cls?.fields.get(object.property.name);
      return type ? { ref: 'typed', typeName: type, member } : UNKNOWN;
    }
    return UNKNOWN;
  }
}
