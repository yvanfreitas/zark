import { describe, expect, it } from 'vitest';
import { extractModule, loadParser, type CallSite } from '../src/code/extract.js';

await loadParser();

const sitesOf = (text: string) => extractModule('src/a.ts', text).sites;
const calls = (sites: CallSite[]) => sites.filter((s) => s.kind === 'calls');

describe('extractModule', () => {
  it('exported pieces of each kind', () => {
    const m = extractModule(
      'src/a.ts',
      `export class Service {
        constructor(private repo: Repo) {}
        save() {}
        get size() { return 1 }
        set size(v) {}
        static create() {}
        private hidden() {}
        protected guarded() {}
        #secret() {}
        another() {}
      }
      export function run() {}
      export const handler = () => 1;
      export const legacy = function () {};
      export const config = { a: 1 };
      export interface Shape { x: number }
      export type Id = string;
      export enum Color { Red }`,
    );
    expect(m.path).toBe('src/a.ts');
    expect(m.parseErrors).toBe(0);
    expect(m.pieces).toEqual([
      { name: 'Service', kind: 'class', members: ['another', 'create', 'save', 'size'] },
      { name: 'run', kind: 'function' },
      { name: 'handler', kind: 'function' },
      { name: 'legacy', kind: 'function' },
      { name: 'config', kind: 'const' },
      { name: 'Shape', kind: 'interface' },
      { name: 'Id', kind: 'type' },
      { name: 'Color', kind: 'enum' },
    ]);
  });

  it('non-exported declarations are not pieces, but export lists make them pieces', () => {
    const m = extractModule(
      'src/a.ts',
      `class Hidden {}
      function helper() {}
      const local = 1;
      function listed() {}
      export { listed, local as renamed };`,
    );
    expect(m.pieces).toEqual([
      { name: 'renamed', kind: 'const' },
      { name: 'listed', kind: 'function' },
    ]);
  });

  it('an exported namespace is not a piece and its calls are module-level', () => {
    const m = extractModule('a.ts', 'export namespace Util { setup() }');
    expect(m.pieces).toEqual([]);
    expect(m.sites).toEqual([{ from: '', kind: 'calls', target: { ref: 'binding', name: 'setup' } }]);
  });

  it('locals map module-scope names to the piece they declare', () => {
    const m = extractModule('a.ts', `import { x } from './x';\nfunction helper() {}\ninterface Shape {}\nexport default class Foo {}\nconst a = 1;\nexport { a as b };`);
    expect([...m.locals].sort()).toEqual([['Foo', 'default'], ['Shape', undefined], ['a', 'b'], ['helper', undefined]]);
  });

  it('default exports', () => {
    expect(extractModule('a.ts', 'export default class { go() {} }').pieces).toEqual([
      { name: 'default', kind: 'class', members: ['go'] },
    ]);
    expect(extractModule('a.ts', 'export default function () { work() }').pieces).toEqual([{ name: 'default', kind: 'function' }]);
    expect(extractModule('a.ts', 'export default () => 1').pieces).toEqual([{ name: 'default', kind: 'function' }]);
    expect(extractModule('a.ts', 'export default { a: 1 }').pieces).toEqual([{ name: 'default', kind: 'const' }]);
    expect(extractModule('a.ts', 'function main() {}\nexport default main;').pieces).toEqual([{ name: 'default', kind: 'function' }]);
    expect(extractModule('a.ts', 'export default function () { work() }').sites).toEqual([
      { from: 'default', kind: 'calls', target: { ref: 'binding', name: 'work' } },
    ]);
  });

  it('direct and namespace calls', () => {
    const sites = sitesOf(
      `import * as ns from './ns';
      import { foo } from './foo';
      export function run() { foo(); ns.bar(); }
      setup();`,
    );
    expect(sites).toEqual([
      { from: 'run', kind: 'calls', target: { ref: 'binding', name: 'foo' } },
      { from: 'run', kind: 'calls', target: { ref: 'binding', name: 'ns', member: 'bar' } },
      { from: '', kind: 'calls', target: { ref: 'binding', name: 'setup' } },
    ]);
  });

  it('new and static calls', () => {
    const sites = sitesOf(
      `import { Repo } from './repo';
      export function make() { const r = Repo.create(); return new Repo(); }`,
    );
    expect(sites).toEqual([
      { from: 'make', kind: 'calls', target: { ref: 'binding', name: 'Repo', member: 'create' } },
      { from: 'make', kind: 'instantiates', target: { ref: 'binding', name: 'Repo' } },
    ]);
  });

  it('this.dep calls via constructor parameter type and class property annotation', () => {
    const sites = sitesOf(
      `export class Service {
        private cache: Cache;
        constructor(private readonly repo: Repo) {}
        save() { this.repo.save(); this.cache.put(); this.log(); this.unknownDep.go(); }
      }`,
    );
    expect(calls(sites)).toEqual([
      { from: 'Service.save', kind: 'calls', target: { ref: 'typed', typeName: 'Repo', member: 'save' } },
      { from: 'Service.save', kind: 'calls', target: { ref: 'typed', typeName: 'Cache', member: 'put' } },
      { from: 'Service.save', kind: 'calls', target: { ref: 'binding', name: 'Service', member: 'log' } },
      { from: 'Service.save', kind: 'calls', target: { ref: 'unknown' } },
    ]);
  });

  it('calls inside a constructor come from Class.constructor', () => {
    expect(sitesOf('export class A { constructor() { init() } }')).toEqual([
      { from: 'A.constructor', kind: 'calls', target: { ref: 'binding', name: 'init' } },
    ]);
  });

  it('local new then member call', () => {
    const sites = sitesOf(
      `export function run() {
        s.go();
        const s = new Store();
        s.save();
      }`,
    );
    expect(calls(sites)).toEqual([
      { from: 'run', kind: 'calls', target: { ref: 'typed', typeName: 'Store', member: 'go' } },
      { from: 'run', kind: 'calls', target: { ref: 'typed', typeName: 'Store', member: 'save' } },
    ]);
  });

  it('annotated parameter member call', () => {
    expect(sitesOf('export const run = (p: Printer<string>) => p.print();')).toEqual([
      { from: 'run', kind: 'calls', target: { ref: 'typed', typeName: 'Printer', member: 'print' } },
    ]);
  });

  it('untyped member call is unknown, and so is a shadowing local', () => {
    const sites = sitesOf(
      `import { foo } from './foo';
      export function run(x, cb: () => void) {
        x.go();
        const foo = pick();
        foo();
        cb();
        getThing().go();
        if (a) { const t = new A(); t.m(); } else { const t = new B(); t.m(); }
      }`,
    );
    expect(calls(sites).map((s) => s.target)).toEqual([
      { ref: 'unknown' },
      { ref: 'binding', name: 'pick' },
      { ref: 'unknown' },
      { ref: 'unknown' },
      { ref: 'unknown' },
      { ref: 'binding', name: 'getThing' },
      // each block's `t` is its own binding
      { ref: 'typed', typeName: 'A', member: 'm' },
      { ref: 'typed', typeName: 'B', member: 'm' },
    ]);
  });

  it('extends and implements', () => {
    expect(sitesOf('export class A extends Base implements One, ns.Two {}')).toEqual([
      { from: 'A', kind: 'extends', target: { ref: 'binding', name: 'Base' } },
      { from: 'A', kind: 'implements', target: { ref: 'binding', name: 'One' } },
      { from: 'A', kind: 'implements', target: { ref: 'binding', name: 'ns', member: 'Two' } },
    ]);
    expect(sitesOf('class B extends mixin(X) {}')).toEqual([
      { from: '', kind: 'extends', target: { ref: 'unknown' } },
      { from: '', kind: 'calls', target: { ref: 'binding', name: 'mixin' } },
    ]);
  });

  it('imports with type-only flagged, and re-exports', () => {
    const m = extractModule(
      'src/a.ts',
      `import type { T } from './t';
      import { type U, V as W } from './u';
      import * as ns from './ns';
      import d from './d';
      export { q as w } from './q';
      export * from './all';
      export * as grouped from './g';`,
    );
    expect(m.imports).toEqual([
      { local: 'T', imported: 'T', from: './t', typeOnly: true },
      { local: 'U', imported: 'U', from: './u', typeOnly: true },
      { local: 'W', imported: 'V', from: './u', typeOnly: false },
      { local: 'ns', imported: '*', from: './ns', typeOnly: false },
      { local: 'd', imported: 'default', from: './d', typeOnly: false },
    ]);
    expect(m.reexports).toEqual([
      { exported: 'w', imported: 'q', from: './q' },
      { exported: '*', imported: '*', from: './all' },
      { exported: 'grouped', imported: '*', from: './g' },
    ]);
  });

  it('imported then exported names become reexports', () => {
    const m = extractModule(
      'a.ts',
      `import { a as b } from './x';
      import d from './d';
      import * as ns from './ns';
      export { b, ns as all };
      export default d;`,
    );
    expect(m.pieces).toEqual([]);
    expect(m.reexports).toEqual([
      { exported: 'b', imported: 'a', from: './x' },
      { exported: 'all', imported: '*', from: './ns' },
      { exported: 'default', imported: 'default', from: './d' },
    ]);
  });

  it('block-scoped declaration does not leak its type', () => {
    const sites = sitesOf(
      `import { client } from './c';
      if (setup) { const db = new Db(); }
      export function f() {
        if (x) { const client = new Mock(); client.go(); }
        for (const item of list) { item.use(); }
        try {} catch (client) { client.log(); }
        client.send();
        db.query();
      }`,
    );
    expect(calls(sites).map((s) => s.target)).toEqual([
      { ref: 'typed', typeName: 'Mock', member: 'go' },
      { ref: 'unknown' },
      { ref: 'unknown' },
      { ref: 'binding', name: 'client', member: 'send' },
      { ref: 'binding', name: 'db', member: 'query' },
    ]);
  });

  it('var hoists to the function, switch cases share one block scope', () => {
    const sites = sitesOf(
      `export function f() {
        { var v = new V(); }
        v.go();
        switch (k) { case 1: const c = new C(); c.z(); }
        c.q();
      }`,
    );
    expect(calls(sites).map((s) => s.target)).toEqual([
      { ref: 'typed', typeName: 'V', member: 'go' },
      { ref: 'typed', typeName: 'C', member: 'z' },
      { ref: 'binding', name: 'c', member: 'q' },
    ]);
  });

  it('named function expression shadows import inside its body', () => {
    expect(sitesOf(`import { retry } from './r';\nexport const run = function retry() { retry(); };`)).toEqual([
      { from: 'run', kind: 'calls', target: { ref: 'unknown' } },
    ]);
    expect(calls(sitesOf(`import { A } from './a';\nexport const K = class A { m() { A.make(); } };`))).toEqual([
      { from: 'K', kind: 'calls', target: { ref: 'unknown' } },
    ]);
  });

  it('abstract methods are members', () => {
    expect(extractModule('a.ts', 'export abstract class Base { abstract run(): void; done() {} }').pieces).toEqual([
      { name: 'Base', kind: 'class', members: ['done', 'run'] },
    ]);
  });

  it('normalizes CRLF and is deterministic', () => {
    const text = 'export function a() { b() }\nexport class C { m() {} }\n';
    const lf = extractModule('a.ts', text);
    expect(extractModule('a.ts', text.replace(/\n/g, '\r\n'))).toEqual(lf);
    expect(JSON.stringify(extractModule('a.ts', text))).toBe(JSON.stringify(lf));
  });

  it('recovers from syntax errors', () => {
    // oxc-parser returns an empty program on a syntax error, so earlier pieces cannot be kept.
    let m;
    expect(() => (m = extractModule('src/a.ts', 'export const a = 1;\nexport function f( {\n'))).not.toThrow();
    expect(m).toMatchObject({ path: 'src/a.ts', imports: [], reexports: [], sites: [] });
    expect(m!.parseErrors).toBeGreaterThan(0);
    expect(Array.isArray(m!.pieces)).toBe(true);
  });
});
