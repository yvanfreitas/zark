import { useStore } from '../store';
import { useT } from '../i18n';
import { SectionTitle } from '../panels/ui';
import { parseNodeId, type CodeLevelEdge } from './codeGraph';
import { useCodeLevel, useNodeSub } from './CodeView';

/** Read-only right panel of the code view: the selected module or piece, else the component. */
export function CodePanel() {
  const code = useStore((s) => s.code);
  const selected = useStore((s) => s.selection.nodes[0]);
  const index = useStore((s) => s.index)!;
  const { graph, level } = useCodeLevel();
  const sub = useNodeSub();
  const t = useT();
  if (!code || !graph || !level) return null;

  const node = level.nodes.find((n) => n.id === selected);
  const labelOf = (id: string) => level.nodes.find((n) => n.id === id)?.label ?? id;
  const links = (edges: CodeLevelEdge[], end: 'from' | 'to') =>
    edges.length ? (
      <ul className="flex flex-col gap-1 px-1 text-[12.5px]">
        {edges.map((e) => (
          <li key={`${e.from}->${e.to}`} className="flex items-baseline justify-between gap-2">
            <button type="button" onClick={() => useStore.getState().select([e[end]])} className="truncate font-mono text-[var(--fg)] hover:text-[var(--accent)]" title={e[end]}>
              {labelOf(e[end])}
            </button>
            <span className="shrink-0 text-[11px] text-[var(--muted)]">
              {e.kinds.join(', ')} ×{e.count}
            </span>
          </li>
        ))}
      </ul>
    ) : (
      <p className="px-1 text-[12.5px] text-[var(--subtle)]">{t('code.none')}</p>
    );

  const at = node && parseNodeId(node.id, code.component);
  const piece = at?.piece ? index.codeGraphs.get(at.component)?.modules.find((m) => m.path === at.path)?.pieces.find((p) => p.name === at.piece) : undefined;
  const u = graph.unresolved;
  return (
    <div className="flex flex-col gap-1 px-4 py-3">
      {node && at ? (
        <>
          <h2 className="break-all font-mono text-[15px] font-semibold text-[var(--fg)]">{node.label}</h2>
          <p className="text-[12px] text-[var(--muted)]">{sub(node.id)}</p>
          <SectionTitle>{t('code.file')}</SectionTitle>
          <p className="break-all px-1 font-mono text-[12px] text-[var(--fg-soft)]">{at.path}</p>
          {piece?.members?.length ? (
            <>
              <SectionTitle>{t('code.members')}</SectionTitle>
              <ul className="px-1 font-mono text-[12px] text-[var(--fg-soft)]">
                {piece.members.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </>
          ) : null}
          <SectionTitle>{t('code.outgoing')}</SectionTitle>
          {links(level.edges.filter((e) => e.from === node.id), 'to')}
          <SectionTitle>{t('code.incoming')}</SectionTitle>
          {links(level.edges.filter((e) => e.to === node.id), 'from')}
        </>
      ) : (
        <>
          <h2 className="text-[15px] font-semibold text-[var(--fg)]">{index.name(code.component)}</h2>
          <p className="text-[12.5px] text-[var(--muted)]">{t('code.select')}</p>
        </>
      )}
      <SectionTitle>{t('code.unresolved', { name: index.name(code.component) })}</SectionTitle>
      <p className="px-1 text-[12.5px] text-[var(--fg-soft)]">{t('code.unresolvedCounts', { calls: u.calls, external: u.external, unowned: u.unowned })}</p>
    </div>
  );
}
