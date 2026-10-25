import { useSyncExternalStore } from 'react';

/** Hash routing - GitHub Pages has no server-side rewrites. */
export type ListKind = 'assets' | 'services' | 'contacts' | 'accounts' | 'categories' | 'debts';

export type Route =
  | { name: 'dashboard' }
  | { name: 'analytics'; tab: string }
  | { name: 'transactions'; query: URLSearchParams }
  | { name: 'list'; kind: ListKind }
  | { name: 'detail'; kind: ListKind; id: string }
  | { name: 'settings' }
  | { name: 'raw' };

const LIST_KINDS: ListKind[] = ['assets', 'services', 'contacts', 'accounts', 'categories', 'debts'];

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const kind = parts[0] as ListKind;
  if (LIST_KINDS.includes(kind)) return parts[1] ? { name: 'detail', kind, id: parts[1] } : { name: 'list', kind };
  switch (parts[0]) {
    case 'analytics':
      return { name: 'analytics', tab: q.get('tab') ?? '' };
    case 'transactions':
      return { name: 'transactions', query: q };
    case 'settings':
      return { name: 'settings' };
    case 'raw':
      return { name: 'raw' };
    default:
      return { name: 'dashboard' };
  }
}

const qs = (params: Record<string, string | undefined>) => {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const href = {
  dashboard: () => '#/',
  analytics: (tab = '') => `#/analytics${qs({ tab })}`,
  /** filters: account, contact, category, asset, debt, service, form */
  transactions: (filters: Record<string, string | undefined> = {}) => `#/transactions${qs(filters)}`,
  list: (kind: ListKind) => `#/${kind}`,
  detail: (kind: ListKind, id: string) => `#/${kind}/${encodeURIComponent(id)}`,
  settings: () => '#/settings',
  raw: () => '#/raw',
};

// How many history entries the app itself pushed in this page session.
let depth = 0;
let replacing = false;
window.addEventListener('hashchange', () => {
  if (!replacing) depth++;
  replacing = false;
});
window.addEventListener('popstate', () => (depth = Math.max(0, depth - 2))); // hashchange follows and adds 1 back

// ---- leave guard (e.g. a form with unsaved changes) ----

interface LeaveGuard {
  /** the guarded page's hash */
  hash: string;
  /** true while leaving should be confirmed */
  active: () => boolean;
  /** ask the user; call proceed() to leave anyway */
  confirm: (proceed: () => void) => void;
}

let guard: LeaveGuard | null = null;

export function setLeaveGuard(g: Omit<LeaveGuard, 'hash'> | null) {
  guard = g && { ...g, hash: location.hash };
}

/** Runs `leave` right away, or after the user confirms leaving a guarded page. */
function guarded(leave: () => void) {
  if (!guard?.active()) return leave();
  guard.confirm(() => {
    guard = null;
    leave();
  });
}

// In-app links: intercept before the browser changes the hash.
document.addEventListener(
  'click',
  (e) => {
    if (!guard?.active() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const link = (e.target as Element).closest?.('a[href^="#"]');
    const to = link?.getAttribute('href');
    if (!to || to === location.hash || link?.getAttribute('target')) return;
    e.preventDefault();
    guarded(() => (location.hash = to));
  },
  true,
);

// Browser/phone "back": the URL has already changed - put the guarded page back, then ask.
window.addEventListener('popstate', () => {
  if (!guard?.active() || location.hash === guard.hash) return;
  history.pushState(history.state, '', guard.hash);
  depth++;
  guarded(() => history.back());
});

export function navigate(to: string, { replace = false } = {}) {
  guarded(() => {
    if (replace) {
      replacing = true;
      history.replaceState(history.state, '', to);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    } else {
      location.hash = to;
    }
  });
}

/** Goes back within the app if possible, otherwise to the fallback. */
export function goBack(fallback: string) {
  guarded(() => {
    if (depth > 0) history.back();
    else navigate(fallback, { replace: true });
  });
}

const subscribe = (l: () => void) => {
  window.addEventListener('hashchange', l);
  return () => window.removeEventListener('hashchange', l);
};

export function useHash() {
  return useSyncExternalStore(subscribe, () => location.hash);
}
