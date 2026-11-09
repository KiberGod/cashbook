import { useSyncExternalStore } from 'react';
import { parseHash } from '../router';

/**
 * In-app tabs, like a browser's: each one is a page with its own back history. All of them stay
 * mounted (the hidden ones out of sight), so their filters, scroll, typed text and open dialogs
 * survive switching, and they all read the one data store, so a change made in one shows in all.
 * The address bar shows the active tab; the browser's Back goes back within it.
 */

export const MAX_TABS = 20;
const HOME = '#/';
const STORAGE = 'cashbook.tabs';
/** back history kept per tab */
const MAX_STACK = 50;

export interface Tab {
  id: string;
  /** the pages visited in this tab; `at` is the one shown */
  stack: string[];
  at: number;
}

interface TabsState {
  tabs: Tab[];
  active: string;
}

const newId = () => Math.random().toString(36).slice(2, 10);
const clean = (hash: string) => (hash && hash !== '#' && hash !== '#/' ? hash : HOME);
export const tabHash = (t: Tab) => t.stack[t.at] ?? HOME;

function restore(): TabsState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE);
    if (!raw) return null;
    const s = JSON.parse(raw) as TabsState;
    if (!Array.isArray(s.tabs) || !s.tabs.length) return null;
    const tabs = s.tabs
      .filter((t) => t && typeof t.id === 'string' && Array.isArray(t.stack) && t.stack.length)
      .slice(0, MAX_TABS)
      .map((t) => ({ id: t.id, stack: t.stack.map(String), at: Math.min(Math.max(0, t.at | 0), t.stack.length - 1) }));
    if (!tabs.length) return null;
    return { tabs, active: tabs.some((t) => t.id === s.active) ? s.active : tabs[0].id };
  } catch {
    return null;
  }
}

let state: TabsState = restore() ?? (() => {
  const id = newId();
  return { tabs: [{ id, stack: [clean(location.hash)], at: 0 }], active: id };
})();

const listeners = new Set<() => void>();
function set(next: TabsState) {
  state = next;
  try {
    sessionStorage.setItem(STORAGE, JSON.stringify(state));
  } catch {
    /* the tabs still live for this page session */
  }
  syncUrl();
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getTabs = () => state;
export const useTabs = () => useSyncExternalStore(subscribe, getTabs);
const activeTab = () => state.tabs.find((t) => t.id === state.active)!;

/** What makes two pages "the same tab": the record or section, not its sub-tab or scroll. */
export function tabKey(hash: string): string {
  const r = parseHash(hash);
  const sorted = (q: URLSearchParams) => [...q].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  switch (r.name) {
    case 'detail':
      return `${r.kind}/${r.id}`;
    case 'transaction':
      return `transaction/${r.id}`;
    case 'list':
      return r.kind;
    case 'transactions':
      return `transactions?${sorted(r.query)}`;
    case 'templates':
      return `templates?${sorted(r.query)}`;
    default:
      return r.name;
  }
}

// ---- scroll: remembered per tab, put back when it is shown again ----

const scrolls = new Map<string, number>();
let pendingScroll: number | null = null;
/** where the page should scroll to after this render (a tab switch or a new page), once */
export function takePendingScroll(): number | null {
  const s = pendingScroll;
  pendingScroll = null;
  return s;
}

// ---- the tabs ----

/** Shows a tab. */
export function activate(id: string) {
  if (id === state.active || !state.tabs.some((t) => t.id === id)) return;
  scrolls.set(state.active, window.scrollY);
  pendingScroll = scrolls.get(id) ?? 0;
  set({ ...state, active: id });
}

const pathOf = (h: string) => h.split('?')[0];

/** Goes to a page within a tab (a new step in its history, or in place of the current one). */
export function navigateTab(id: string, to: string, { replace = false } = {}) {
  const t = state.tabs.find((x) => x.id === id);
  if (!t) return;
  to = clean(to);
  const from = tabHash(t);
  if (to === from) return;
  const stack = replace ? t.stack.map((h, i) => (i === t.at ? to : h)) : [...t.stack.slice(0, t.at + 1), to].slice(-MAX_STACK);
  const at = replace ? t.at : stack.length - 1;
  if (id === state.active && pathOf(to) !== pathOf(from)) pendingScroll = 0;
  set({ ...state, tabs: state.tabs.map((x) => (x.id === id ? { ...x, stack, at } : x)) });
}

/** One step back within a tab; without one, to `fallback` (if given). True when it went somewhere. */
export function backTab(id: string, fallback?: string): boolean {
  const t = state.tabs.find((x) => x.id === id);
  if (!t) return false;
  if (t.at > 0) {
    if (id === state.active) pendingScroll = 0;
    set({ ...state, tabs: state.tabs.map((x) => (x.id === id ? { ...x, at: x.at - 1 } : x)) });
    return true;
  }
  if (fallback) {
    navigateTab(id, fallback, { replace: true });
    return true;
  }
  return false;
}

let onLimit: (() => void) | null = null;
/** what to tell the user when no more tabs can be opened (set by the app, it knows the words) */
export function setTabLimitNotice(f: () => void) {
  onLimit = f;
}

/** A new tab with this page, right after the active one; `background` keeps the active one shown. */
export function newTab(to: string = HOME, { background = false } = {}): string | null {
  if (state.tabs.length >= MAX_TABS) {
    onLimit?.();
    return null;
  }
  const tab: Tab = { id: newId(), stack: [clean(to)], at: 0 };
  const i = state.tabs.findIndex((t) => t.id === state.active);
  const tabs = [...state.tabs.slice(0, i + 1), tab, ...state.tabs.slice(i + 1)];
  if (!background) {
    scrolls.set(state.active, window.scrollY);
    pendingScroll = 0;
  }
  set({ tabs, active: background ? state.active : tab.id });
  return tab.id;
}

/**
 * Shows the tab that already has this page (the same record or section), or opens a new one.
 * With every tab taken: a new tab asked for on purpose (`explicit`: Ctrl / middle click) brings the
 * notice; one that would only have opened by itself goes to the page in the active tab, silently.
 */
export function openTab(to: string, { background = false, explicit = false } = {}) {
  const key = tabKey(to);
  const found = state.tabs.find((t) => tabKey(tabHash(t)) === key);
  if (found) {
    if (!background) activate(found.id);
    return;
  }
  if (state.tabs.length >= MAX_TABS && !explicit) return navigateTab(state.active, to);
  newTab(to, { background });
}

/** A section's list and the record pages under it ("transactions" for the list and a transaction). */
function sectionOf(hash: string): { section: string; record: boolean } | null {
  const r = parseHash(hash);
  if (r.name === 'list') return { section: r.kind, record: false };
  if (r.name === 'detail') return { section: r.kind, record: true };
  if (r.name === 'transactions') return { section: 'transactions', record: false };
  if (r.name === 'transaction') return { section: 'transactions', record: true };
  return null;
}

/**
 * Follows an in-app link. Within the active tab: when it only changes the current page's view (e.g.
 * its sub-tab), or goes from a section's list to one of its records (the accounts list to an
 * account). Anything else - a related record elsewhere - goes to the tab with that page or a new one.
 */
export function openLink(to: string) {
  const here = tabHash(activeTab());
  const from = sectionOf(here);
  const dest = sectionOf(to);
  const down = !!from && !!dest && !from.record && dest.record && from.section === dest.section;
  if (down || tabKey(to) === tabKey(here)) navigateTab(state.active, to);
  else openTab(to);
}

/** Closes a tab; the last one closed leaves a fresh one, as in a browser. */
export function closeTab(id: string) {
  const i = state.tabs.findIndex((t) => t.id === id);
  if (i < 0) return;
  scrolls.delete(id);
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const fresh: Tab = { id: newId(), stack: [HOME], at: 0 };
    pendingScroll = 0;
    return set({ tabs: [fresh], active: fresh.id });
  }
  if (id !== state.active) return set({ ...state, tabs });
  // the active one: its right neighbour takes over (or the left one at the end)
  const next = tabs[Math.min(i, tabs.length - 1)];
  pendingScroll = scrolls.get(next.id) ?? 0;
  set({ tabs, active: next.id });
}

export function closeOtherTabs(id: string) {
  const keep = state.tabs.find((t) => t.id === id);
  if (!keep) return;
  for (const t of state.tabs) if (t.id !== id) scrolls.delete(t.id);
  if (id !== state.active) pendingScroll = scrolls.get(id) ?? 0;
  set({ tabs: [keep], active: id });
}

/** Closes every tab; a fresh one is left, as in a browser. */
export function closeAllTabs() {
  scrolls.clear();
  const fresh: Tab = { id: newId(), stack: [HOME], at: 0 };
  pendingScroll = 0;
  set({ tabs: [fresh], active: fresh.id });
}

/** Drag and drop: a tab takes another one's place. */
export function moveTab(id: string, overId: string) {
  const from = state.tabs.findIndex((t) => t.id === id);
  const to = state.tabs.findIndex((t) => t.id === overId);
  if (from < 0 || to < 0 || from === to) return;
  const tabs = [...state.tabs];
  tabs.splice(to, 0, ...tabs.splice(from, 1));
  set({ ...state, tabs });
}

/** The active tab goes to a page (sidebar, breadcrumbs, a page leaving itself). */
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  navigateTab(state.active, to, opts);
}

// ---- the address bar and the browser's Back ----

/**
 * The browser history holds just two entries for the app: a base and a top one. Back from the top
 * lands on the base: the active tab steps back and the top entry is put back. With nowhere to go
 * back to in the tab, Back leaves the app, as usual.
 */
function syncUrl() {
  const h = tabHash(activeTab());
  if (location.hash !== h || !history.state?.cb) history.replaceState({ cb: history.state?.cb ?? 'top' }, '', h);
}

declare global {
  interface Window {
    __cashbookTabs?: boolean;
  }
}

if (!window.__cashbookTabs) {
  window.__cashbookTabs = true;
  const h = tabHash(activeTab());
  // a link opened from outside (or a reload on another page): that page, in its tab
  const asked = clean(location.hash);
  history.replaceState({ cb: 'base' }, '', h);
  history.pushState({ cb: 'top' }, '', h);
  if (asked !== h) openTab(asked);

  window.addEventListener('popstate', (e) => {
    if ((e.state as { cb?: string } | null)?.cb !== 'base') return;
    if (backTab(state.active)) history.pushState({ cb: 'top' }, '', tabHash(activeTab()));
    else history.back();
  });
  // the address typed or changed by hand: that page, in its tab
  window.addEventListener('hashchange', () => {
    if (history.state?.cb) return;
    const to = clean(location.hash);
    history.replaceState({ cb: 'top' }, '', to);
    openLink(to);
  });

  // in-app links: the sidebar, the logo and breadcrumbs move the active tab, as does a list's link to
  // one of its records; any other link goes to its own tab (an open one, or a new one);
  // Ctrl / ⌘ / Shift or the middle button: a new tab behind
  document.addEventListener(
    'click',
    (e) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const target = e.target as Element | null;
      const link = target?.closest?.('a[href^="#"]');
      const to = link?.getAttribute('href');
      if (!link || !to || link.getAttribute('target')) return;
      // a control inside a link card (a chip leading elsewhere, its "⋮" menu, a button) handles its own click
      const inner = target?.closest?.('button, [role="button"], [role="link"], [data-href], input, select, textarea, label');
      if (inner && inner !== link && link.contains(inner)) return;
      e.preventDefault();
      if (e.ctrlKey || e.metaKey || e.shiftKey) return openTab(to, { background: true, explicit: true });
      if (link.closest('.side-nav, .brand, .crumbs')) return navigate(to);
      openLink(to);
    },
    true,
  );
  document.addEventListener(
    'auxclick',
    (e) => {
      if (e.button !== 1) return;
      const el = (e.target as Element | null)?.closest?.('a[href^="#"], [data-href]');
      const to = el?.getAttribute('href') ?? el?.getAttribute('data-href');
      if (!el || !to) return;
      e.preventDefault();
      openTab(to, { background: true, explicit: true });
    },
    true,
  );
}
