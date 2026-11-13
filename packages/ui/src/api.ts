import type { Model, Problem } from './types';

/** Session token: passed once in the URL by the CLI, kept for the tab. */
function readToken(): string {
  const url = new URL(location.href);
  const fromUrl = url.searchParams.get('token');
  if (fromUrl) {
    try {
      sessionStorage.setItem('zark-token', fromUrl);
    } catch {
      /* storage may be blocked; the URL still works */
    }
    if (!url.pathname.startsWith('/render/')) {
      url.searchParams.delete('token');
      history.replaceState(null, '', url);
    }
    return fromUrl;
  }
  try {
    return sessionStorage.getItem('zark-token') ?? '';
  } catch {
    return '';
  }
}

export const token = readToken();

export interface WriteResult {
  ok: boolean;
  error?: string;
  changes?: string[];
  changedFiles?: string[];
  hashes?: Record<string, string | null>;
  problems?: Problem[];
  impact?: string[];
  conflict?: { file: string };
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: any) {
    super(message);
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-zark-token': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (res.status === 401) throw new ApiError('Sessão inválida. Abra a URL que o "zark dev" imprimiu no terminal.', 401, data);
  if (!res.ok && res.status !== 409 && res.status !== 422) throw new ApiError(data.error ?? `${res.status} ${res.statusText}`, res.status, data);
  return data as T;
}

/** `zark build` output: no server, no token; the snapshot sits next to index.html. */
export const readOnly = !token && !location.pathname.startsWith('/render/');

export const getModel = async (): Promise<Model> => {
  if (!readOnly) return api<Model>('GET', '/api/model');
  const res = await fetch('./model.json');
  if (!res.ok) throw new Error('Sessão ausente. Abra a URL que o "zark dev" imprimiu no terminal.');
  return res.json();
};

export function subscribe(handlers: Record<string, (data: any) => void>, onState: (connected: boolean) => void) {
  let source: EventSource | undefined;
  let retry: number | undefined;
  const open = () => {
    source = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    source.addEventListener('hello', () => onState(true));
    for (const [event, fn] of Object.entries(handlers)) source.addEventListener(event, (e) => fn(JSON.parse((e as MessageEvent).data)));
    source.onerror = () => {
      onState(false);
      source?.close();
      retry = window.setTimeout(open, 1500);
    };
  };
  open();
  return () => {
    clearTimeout(retry);
    source?.close();
  };
}
