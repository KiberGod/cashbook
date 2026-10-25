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

// "system" keeps following the OS setting while the app is open
media.addEventListener('change', () => apply(getThemePref()));
apply(getThemePref());
