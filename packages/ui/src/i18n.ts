// UI strings. English is the default; Portuguese is a per-browser choice
// (EN | PT in the top bar, stored in localStorage "zark-lang").
// The render route always draws in English: PNGs are committed artifacts.
import { useCallback } from 'react';
import { CHANGE_EN, IMPACT_EN, PROBLEM_EN, renderMessage, type Params } from '@core/messages';
import { en, pt } from './i18n-dict';
import { CHANGE_PT, IMPACT_PT, PROBLEM_PT } from './i18n-messages';
import { useStore } from './store';

export { en, pt };
export type Lang = 'en' | 'pt';

const DICTS: Record<Lang, Record<string, string>> = { en, pt };

export function format(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in params ? String(params[k]) : m));
}

/** Translate outside React (store actions, toasts). */
export function tr(key: string, params?: Record<string, string | number>): string {
  const lang = useStore.getState().lang;
  return format(DICTS[lang][key] ?? en[key] ?? key, params);
}

/** Translate inside components; re-renders when the language changes. */
export function useT() {
  const lang = useStore((s) => s.lang);
  return useCallback((key: string, params?: Record<string, string | number>) => format(DICTS[lang][key] ?? en[key] ?? key, params), [lang]);
}

export function initialLang(): Lang {
  try {
    return localStorage.getItem('zark-lang') === 'pt' ? 'pt' : 'en';
  } catch {
    return 'en';
  }
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem('zark-lang', lang);
  } catch {
    /* storage may be blocked; the choice still applies to this tab */
  }
  useStore.getState().set({ lang });
}

interface Keyed {
  key?: string;
  params?: Params;
}

/** Localized text of a problem; English message when a key or param is missing. */
export function problemText(p: Keyed & { message: string }): string {
  const lang = useStore.getState().lang;
  return renderMessage(lang === 'pt' ? PROBLEM_PT : PROBLEM_EN, p.key, p.params, p.message);
}

/** Localized text of a semantic change. */
export function changeText(c: Keyed & { text: string }): string {
  const lang = useStore.getState().lang;
  return renderMessage(lang === 'pt' ? CHANGE_PT : CHANGE_EN, c.key, c.params, c.text);
}

/** Localized line of a cascade-delete impact. */
export function impactText(i: Keyed): string {
  const lang = useStore.getState().lang;
  const fallback = renderMessage(IMPACT_EN, i.key, i.params, i.key ?? '');
  return lang === 'pt' ? renderMessage(IMPACT_PT, i.key, i.params, fallback) : fallback;
}
