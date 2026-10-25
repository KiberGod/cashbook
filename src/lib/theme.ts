import { readJson, writeJson } from './storage';

export type ThemePref = 'system' | 'light' | 'dark';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export const getThemePref = () => readJson<ThemePref>('theme', 'system');

function apply(pref: ThemePref) {
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121417' : '#f6f7f9');
}

export function setThemePref(pref: ThemePref) {
  writeJson('theme', pref);
  apply(pref);
}

export const ACCENTS = ['violet', 'teal', 'blue', 'green', 'orange', 'rose'] as const;
export type Accent = (typeof ACCENTS)[number];

export const getAccent = (): Accent => {
  const a = readJson<Accent>('accent', 'violet');
  return ACCENTS.includes(a) ? a : 'violet';
};

/** Light-theme accent of each palette (same values as in styles.css) - used for the tab icon. */
const ACCENT_COLORS: Record<Accent, string> = {
  violet: '#6741d9',
  blue: '#2860c2',
  teal: '#0f766e',
  green: '#1e7d3a',
  orange: '#c2410c',
  rose: '#be185d',
};

/** public/favicon.svg with the background in the accent colour. */
const faviconSvg = (color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="${color}"/><g fill="none" stroke="#fff" stroke-width="2.2" stroke-linejoin="round" transform="translate(4 4)"><path d="M12 3 3 17.5 12 21l9-3.5z"/><path d="M12 3v18"/></g></svg>`;

function applyFavicon(accent: Accent) {
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (icon) icon.href = `data:image/svg+xml,${encodeURIComponent(faviconSvg(ACCENT_COLORS[accent]))}`;
}

function applyAccent(accent: Accent) {
  // violet is the default palette in styles.css, the others override it
  if (accent === 'violet') delete document.documentElement.dataset.accent;
  else document.documentElement.dataset.accent = accent;
  applyFavicon(accent);
}

export function setAccent(accent: Accent) {
  writeJson('accent', accent);
  applyAccent(accent);
}

// "system" keeps following the OS setting while the app is open
media.addEventListener('change', () => apply(getThemePref()));
apply(getThemePref());
applyAccent(getAccent());
