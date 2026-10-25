import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import en, { type Dict, type DictKey, type Plural } from './en';
import ru from './ru';
import uk from './uk';
import { readJson, writeJson } from '../lib/storage';

export const LANGUAGES = [
  { code: 'uk', label: 'Українська' },
  { code: 'en', label: 'English' },
  { code: 'ru', label: 'Русский' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];

const DICTS: Record<Lang, Dict> = { en, ru, uk };

function detectLang(): Lang {
  const saved = readJson<string | null>('lang', null);
  if (saved && saved in DICTS) return saved as Lang;
  for (const l of navigator.languages ?? [navigator.language]) {
    const code = l.slice(0, 2).toLowerCase();
    if (code in DICTS) return code as Lang;
  }
  return 'en';
}

type Params = Record<string, string | number>;
const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (k in p ? String(p[k]) : m)) : s);

export interface I18n {
  lang: Lang;
  /** BCP 47 locale for Intl formatting */
  locale: string;
  setLang: (l: Lang) => void;
  t: (key: DictKey, params?: Params) => string;
  /** plural-aware: picks the form for n and fills {n} */
  tn: (key: DictKey, n: number, params?: Params) => string;
  num: (n: number, maxDigits?: number) => string;
  date: (iso: string | number) => string;
  dateTime: (iso: string | number) => string;
  month: (iso: string | number) => string;
}

const Ctx = createContext<I18n | null>(null);

const LOCALES: Record<Lang, string> = { uk: 'uk-UA', en: 'en-GB', ru: 'ru-RU' };

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang];
    const locale = LOCALES[lang];
    const rules = new Intl.PluralRules(lang);
    const nfs = new Map<number, Intl.NumberFormat>();
    const nf = (digits: number) => {
      if (!nfs.has(digits)) nfs.set(digits, new Intl.NumberFormat(locale, { maximumFractionDigits: digits }));
      return nfs.get(digits)!;
    };
    const df = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' });
    const dtf = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const mf = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' });
    const raw = (key: DictKey) => dict[key] ?? en[key];
    document.documentElement.lang = lang;
    const toDate = (v: string | number) => (typeof v === 'number' ? new Date(v) : new Date(v));
    return {
      lang,
      locale,
      setLang: (l) => {
        writeJson('lang', l);
        setLangState(l);
      },
      t: (key, params) => {
        const v = raw(key);
        return fill(typeof v === 'string' ? v : v.other, params);
      },
      tn: (key, n, params) => {
        const v = raw(key);
        const p = { ...params, n: nf(3).format(n) };
        if (typeof v === 'string') return fill(v, p);
        const form = (v as Plural)[rules.select(n) as keyof Plural] ?? v.other;
        return fill(form, p);
      },
      num: (n, maxDigits = 3) => nf(maxDigits).format(n),
      date: (v) => df.format(toDate(v)),
      dateTime: (v) => dtf.format(toDate(v)),
      month: (v) => mf.format(toDate(v)),
    };
  }, [lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
