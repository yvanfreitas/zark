import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { useStore } from '../store';

export type MenuItem =
  | { label: string; run: () => void; shortcut?: string; danger?: boolean; disabled?: boolean; /** Shows a check column; `radio` when the checked items exclude each other. */ checked?: boolean; radio?: boolean }
  | { separator: true }
  | { heading: string };

/** Opens the shared menu under (or next to) the element that was clicked. */
export function openMenuAt(el: Element, items: MenuItem[]) {
  const r = el.getBoundingClientRect();
  useStore.getState().set({ menu: { x: r.left, y: r.bottom + 4, items } });
}

/**
 * The single context menu of the app (store `menu`): canvas right-click and the
 * "more actions" buttons open the same lists, so both offer the same actions.
 */
export function MenuHost() {
  const menu = useStore((s) => s.menu);
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const opener = useRef<Element | null>(null);

  // Keep the menu inside the window: measured once it is in the DOM.
  useLayoutEffect(() => {
    if (!menu || !ref.current) return setPos(undefined);
    const box = ref.current.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(menu.x, window.innerWidth - box.width - 8)),
      top: Math.max(8, Math.min(menu.y, window.innerHeight - box.height - 8)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => useStore.getState().set({ menu: undefined });
    const buttons = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])];
    const onKey = (e: KeyboardEvent) => {
      const list = buttons();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      const go = (i: number) => (e.preventDefault(), list[(i + list.length) % list.length]?.focus());
      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        close();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      } else if (e.key === 'ArrowDown') go(at + 1);
      else if (e.key === 'ArrowUp') go(at - 1);
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(list.length - 1);
      else if (e.key !== 'Enter' && e.key !== ' ') return;
      // The menu owns the keyboard while it is open: no canvas shortcut fires.
      e.stopPropagation();
    };
    const onDown = (e: Event) => !ref.current?.contains(e.target as Node) && close();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  // Focus the first item once the menu is placed: it cannot take focus while still hidden.
  const placed = !!pos;
  useEffect(() => {
    if (!menu || !placed) return;
    if (!ref.current?.contains(document.activeElement)) opener.current = document.activeElement;
    ref.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus();
  }, [menu, placed]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t('menu.label')}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-[60] min-w-[220px] max-w-[320px] rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 shadow-xl"
      style={{ left: pos?.left ?? menu.x, top: pos?.top ?? menu.y, visibility: pos ? 'visible' : 'hidden' }}
    >
      {menu.items.map((item, i) => {
        // One check column for the whole menu, so labels stay aligned.
        const checks = menu.items.some((x) => 'checked' in x && x.checked !== undefined);
        if ('separator' in item) return <div key={i} role="separator" className="my-1 h-px bg-[var(--border)]" />;
        if ('heading' in item)
          return (
            <div key={i} className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--muted)]">
              {item.heading}
            </div>
          );
        return (
          <button
            key={i}
            type="button"
            role={item.checked === undefined ? 'menuitem' : item.radio ? 'menuitemradio' : 'menuitemcheckbox'}
            aria-checked={item.checked}
            disabled={item.disabled}
            onClick={() => {
              useStore.getState().set({ menu: undefined });
              item.run();
            }}
            className={`flex w-full items-center gap-3 rounded-md px-2.5 py-1.5 text-left text-[13px] hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-45 ${item.danger ? 'text-[var(--danger)]' : 'text-[var(--fg)]'}`}
          >
            {checks && (
              <span aria-hidden="true" className="w-3 text-[var(--accent)]">
                {item.checked ? '✓' : ''}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.shortcut && <kbd className="shrink-0 font-mono text-[11px] text-[var(--muted)]">{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
