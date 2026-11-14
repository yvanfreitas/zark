import { useStore } from './store';
import { tr } from './i18n';

/** Opens a file picker and imports a Structurizr workspace or IcePanel model (format detected by the server). */
export function pickAndImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.yaml,.yml,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const s = useStore.getState();
    const r = (await s.write('POST', '/api/import', { format: 'auto', content: await file.text() })) as
      | (Awaited<ReturnType<typeof s.write>> & { format?: string; warnings?: string[] })
      | undefined;
    if (!r?.ok) return;
    const source = r.format === 'structurizr' ? 'Structurizr' : 'IcePanel';
    const warnings = r.warnings ?? [];
    s.toast(`${tr('import.done', { source, n: r.changes?.length ?? 0 })}${warnings.length ? `${tr('import.warning', { warning: warnings[0] })}${warnings.length > 1 ? ` (+${warnings.length - 1})` : ''}` : ''}`, 'success');
    const first = useStore.getState().model?.drawings.at(-1);
    if (first) s.openDrawing(first.id);
  };
  input.click();
}
