import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const inputClass =
  'w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-[13px] text-[var(--fg)] placeholder:text-[var(--subtle)] focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20';

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle';

/** `safe`: works without a server, so it stays in the read-only `zark build` site. */
export function Button({ variant = 'primary', className = '', safe, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; safe?: boolean }) {
  const styles: Record<Variant, string> = {
    primary: 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-strong)]',
    ghost: 'text-[var(--fg-soft)] hover:bg-[var(--hover)]',
    subtle: 'border border-[var(--border)] bg-[var(--surface)] text-[var(--fg-soft)] hover:bg-[var(--hover)]',
    danger: 'bg-[var(--danger-solid)] text-white hover:brightness-95',
  };
  return (
    <button
      type="button"
      {...props}
      data-edit={safe ? undefined : ''}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
    />
  );
}

export function IconButton({ label, children, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`grid size-8 place-items-center rounded-md text-[var(--muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11.5px] font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--subtle)]">{hint}</span>}
    </label>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1 pb-1.5 pt-3">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--muted)]">{children}</h3>
      {action}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div role="tablist" className="flex gap-1 rounded-lg bg-[var(--tabs)] p-0.5">
      {items.map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={value === id}
          onClick={() => onChange(id)}
          className={`flex-1 rounded-md px-2 py-1 text-[12.5px] font-medium transition-colors ${value === id ? 'bg-[var(--surface)] text-[var(--fg)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--fg)]'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/** Small inline SVG icons; stroke follows currentColor. */
export const Icon = {
  plus: <path d="M8 3v10M3 8h10" />,
  undo: <path d="M5 4 2 7l3 3M2 7h7a4 4 0 0 1 0 8H7" />,
  redo: <path d="m11 4 3 3-3 3M14 7H7a4 4 0 0 0 0 8h2" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3.5 3.5" />
    </>
  ),
  layout: <path d="M2 3h5v4H2zM9 9h5v4H9zM7 5h3v4" />,
  play: <path d="M5 3v10l8-5z" />,
  drawing: (
    <>
      <rect x="1.5" y="2" width="6" height="4.5" rx="1" />
      <rect x="8.5" y="9.5" width="6" height="4.5" rx="1" />
      <path d="M4.5 6.5v3.5a1.5 1.5 0 0 0 1.5 1.5h2.5" />
    </>
  ),
  pause: <path d="M5 3v10M11 3v10" />,
  prev: <path d="M10 3 5 8l5 5" />,
  next: <path d="m6 3 5 5-5 5" />,
  first: <path d="M4 3v10M12 3 7 8l5 5" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
  trash: <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6L11.5 4" />,
  sun: (
    <>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" />
    </>
  ),
  moon: <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z" />,
  branch: (
    <>
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="5.5" r="1.5" />
      <path d="M4 5v6M12 7c0 3-8 2-8 4" />
    </>
  ),
  swap: <path d="M3 5h10l-3-3M13 11H3l3 3" />,
  grip: <path d="M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01" />,
  pencil: <path d="M11 2.5 13.5 5 6 12.5H3.5V10z" />,
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" strokeWidth="2.4" />,
  up: <path d="m4 10 4-4 4 4" />,
  down: <path d="m4 6 4 4 4-4" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
};

export function Svg({ icon, size = 16 }: { icon: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icon}
    </svg>
  );
}
