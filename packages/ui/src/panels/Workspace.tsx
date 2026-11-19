import { useEffect, useState } from 'react';
import { getWorkspace, prefix } from '../api';
import { useStore } from '../store';
import { useT } from '../i18n';
import type { Workspace, WorkspaceEntry } from '../types';

const href = (e: WorkspaceEntry) => e.running?.url ?? `${e.prefix}/`;

/** Repo list shown at `/` by a workspace server. */
export function WorkspaceHome({ repos }: { repos: WorkspaceEntry[] }) {
  const theme = useStore((s) => s.theme);
  const t = useT();
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return (
    <div className="min-h-screen bg-[var(--canvas)] p-8 text-[var(--fg)]">
      <main className="mx-auto max-w-xl">
        <h1 className="mb-4 text-[18px] font-semibold">{t('workspace.title')}</h1>
        <ul className="flex flex-col gap-2">
          {repos.map((e) => (
            <li key={e.key}>
              <a href={href(e)} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[14px] hover:border-[var(--accent)]">
                <span className="font-semibold">{e.key}</span>
                {e.name !== e.key && <span className="text-[12.5px] text-[var(--muted)]">{e.name}</span>}
                {e.running ? (
                  <span className="text-[12.5px] text-[var(--muted)]">{t('workspace.runningElsewhere')}</span>
                ) : (
                  <span className="flex gap-3 text-[12.5px] text-[var(--muted)]">
                    <span>{t('workspace.drawings', { n: e.drawings })}</span>
                    {e.errors > 0 && <span className="text-[var(--danger)]">{t('workspace.errors', { n: e.errors })}</span>}
                    {e.warnings > 0 && <span className="text-[var(--warn-fg)]">{t('workspace.warnings', { n: e.warnings })}</span>}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

let workspace: Promise<Workspace | undefined> | undefined;

/** The workspace of a workspace server (fetched once per page), or undefined in single-repo mode. */
export function useWorkspace(): Workspace | undefined {
  const [ws, setWs] = useState<Workspace>();
  useEffect(() => {
    if (prefix === '') return;
    workspace ??= getWorkspace();
    void workspace.then(setWs);
  }, []);
  return ws;
}
