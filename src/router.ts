/** Hash routing - GitHub Pages has no server-side rewrites. Navigation itself lives in store/tabs. */
export type ListKind = 'assets' | 'services' | 'contacts' | 'accounts' | 'categories' | 'debts';

export type Route =
  | { name: 'dashboard' }
  | { name: 'analytics'; tab: string }
  | { name: 'transactions'; query: URLSearchParams }
  | { name: 'transaction'; id: string }
  | { name: 'list'; kind: ListKind }
  | { name: 'detail'; kind: ListKind; id: string; query: URLSearchParams }
  | { name: 'templates'; query: URLSearchParams }
  | { name: 'settings' }
;

const LIST_KINDS: ListKind[] = ['assets', 'services', 'contacts', 'accounts', 'categories', 'debts'];

export function parseHash(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const q = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const kind = parts[0] as ListKind;
  if (LIST_KINDS.includes(kind)) return parts[1] ? { name: 'detail', kind, id: parts[1], query: q } : { name: 'list', kind };
  switch (parts[0]) {
    case 'analytics':
      return { name: 'analytics', tab: q.get('tab') ?? '' };
    case 'transactions':
      return parts[1] ? { name: 'transaction', id: parts[1] } : { name: 'transactions', query: q };
    case 'templates':
      return { name: 'templates', query: q };
    case 'settings':
      return { name: 'settings' };
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
  /** filters: category, asset, debt, service, form */
  transactions: (filters: Record<string, string | undefined> = {}) => `#/transactions${qs(filters)}`,
  transaction: (id: string) => `#/transactions/${encodeURIComponent(id)}`,
  list: (kind: ListKind) => `#/${kind}`,
  detail: (kind: ListKind, id: string) => `#/${kind}/${encodeURIComponent(id)}`,
  /** q: the search to open the list with (e.g. a template's name) */
  templates: (q?: string) => `#/templates${qs({ q })}`,
  settings: () => '#/settings',
};
