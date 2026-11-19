import { useEffect, useState } from 'react';
import { getWorkspace } from '../api';
import { useStore } from '../store';
import { useT } from '../i18n';
import type { WorkspaceEntry } from '../types';

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

/** Top-bar dropdown to jump to another repo of the workspace; the session token stays in sessionStorage. */
export function RepoSwitcher() {
  const [repos, setRepos] = useState<WorkspaceEntry[]>();
  const t = useT();
  useEffect(() => {
    void getWorkspace().then(setRepos);
  }, []);
  if (!repos) return null;
  const current = repos.find((e) => !e.running && decodeURI(location.pathname).startsWith(`${decodeURI(e.prefix)}/`));
  return (
    <select
      aria-label={t('workspace.switch')}
      value={current?.key ?? ''}
      onChange={(ev) => {
        const e = repos.find((r) => r.key === ev.target.value);
        if (!e) return;
        if (e.running) location.assign(e.running.url);
        else location.assign(`${e.prefix}/`);
      }}
      className="max-w-[140px] rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-[12.5px] text-[var(--fg-soft)]"
    >
      {repos.map((e) => (
        <option key={e.key} value={e.key}>
          {e.running ? `${e.key} (${t('workspace.runningElsewhere')})` : e.key}
        </option>
      ))}
    </select>
  );
}
