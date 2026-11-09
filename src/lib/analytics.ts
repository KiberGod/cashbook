import { parseAmount } from './format';
import { matchesAny } from './search';
import { withChildren, type Index } from './stats';
import type { Template, Transaction } from './types';

// ---------------------------------------------------------------------------
// Transaction filters (the transactions page, templates, histories)

export const NONE = '__none__';

export interface TxFilter {
  q: string;
  fromAccounts: string[];
  toAccounts: string[];
  fromContacts: string[];
  toContacts: string[];
  forms: string[];
  assets: string[];
  /** a parent includes its sub-categories; NONE = without category */
  categories: string[];
  services: string[];
  debts: string[];
  /** relative to the user's own accounts */
  direction: 'all' | 'in' | 'out' | 'internal' | 'foreign';
  minAmount: string;
  maxAmount: string;
  /** a date-time range (local, as a datetime-local input gives it; the "to" minute included) */
  from: string;
  to: string;
}

export const emptyFilter = (): TxFilter => ({
  q: '',
  fromAccounts: [],
  toAccounts: [],
  fromContacts: [],
  toContacts: [],
  forms: [],
  assets: [],
  categories: [],
  services: [],
  debts: [],
  direction: 'all',
  minAmount: '',
  maxAmount: '',
  from: '',
  to: '',
});

/** Number of filters that differ from the defaults (search excluded). */
export function activeFilters(f: TxFilter): number {
  const lists = [f.fromAccounts, f.toAccounts, f.fromContacts, f.toContacts, f.forms, f.assets, f.categories, f.services, f.debts];
  return lists.filter((l) => l.length).length + (f.direction !== 'all' ? 1 : 0) + (f.minAmount || f.maxAmount ? 1 : 0) + (f.from || f.to ? 1 : 0);
}

export function ownAccountIds(ix: Index): Set<string> {
  const selfId = ix.self?.id;
  return new Set([...ix.accounts.values()].filter((a) => selfId && a.contactId === selfId).map((a) => a.id));
}

/** What the filter looks at: a transaction, or a template (whose amount may be unset). */
type Filterable = Pick<Transaction, 'fromId' | 'toId' | 'assetId' | 'categoryId' | 'debtId' | 'description'> & { amount: number | null };

/**
 * The filter's checks on everything but the date, shared by transactions and templates.
 * `texts`: more texts the search looks in (e.g. a template's name).
 */
function matcher(ix: Index, f: TxFilter) {
  const set = (l: string[]) => (l.length ? new Set(l) : null);
  const fromAccounts = set(f.fromAccounts);
  const toAccounts = set(f.toAccounts);
  const fromContacts = set(f.fromContacts);
  const toContacts = set(f.toContacts);
  const forms = set(f.forms);
  const assets = set(f.assets);
  const services = set(f.services);
  const debts = set(f.debts);
  const categories = f.categories.length ? withChildren(ix, f.categories) : null;
  const own = f.direction !== 'all' ? ownAccountIds(ix) : null;
  const min = f.minAmount.trim() ? parseAmount(f.minAmount) : null;
  const max = f.maxAmount.trim() ? parseAmount(f.maxAmount) : null;
  const contactOf = (id: string) => (id ? ix.accounts.get(id)?.contactId || NONE : NONE);
  const q = f.q.trim();

  return (t: Filterable, texts: string[] = []) => {
    if (fromAccounts && !fromAccounts.has(t.fromId || NONE)) return false;
    if (toAccounts && !toAccounts.has(t.toId || NONE)) return false;
    if (fromContacts && !fromContacts.has(contactOf(t.fromId))) return false;
    if (toContacts && !toContacts.has(contactOf(t.toId))) return false;
    const fromAcc = ix.accounts.get(t.fromId);
    const toAcc = ix.accounts.get(t.toId);
    if (forms && !forms.has((fromAcc ?? toAcc)?.form ?? '')) return false;
    if (assets && !assets.has(t.assetId)) return false;
    if (categories && !categories.has(t.categoryId || NONE)) return false;
    if (services && !services.has(fromAcc?.serviceId ?? '') && !services.has(toAcc?.serviceId ?? '')) return false;
    if (debts && !debts.has(t.debtId || NONE)) return false;
    if (own) {
      const fo = own.has(t.fromId);
      const to_ = own.has(t.toId);
      const dir = fo && to_ ? 'internal' : fo ? 'out' : to_ ? 'in' : 'foreign';
      if (dir !== f.direction) return false;
    }
    // an amount range leaves out what has no amount (a template entered each time)
    if ((min !== null || max !== null) && t.amount === null) return false;
    if (min !== null && t.amount! < min) return false;
    if (max !== null && t.amount! > max) return false;
    if (q && !matchesAny(q, ...texts, ...searchTexts(ix, t))) return false;
    return true;
  };
}

/**
 * What the search looks in for a transaction (or a template), wherever transactions are searched:
 * its description, both accounts with their requisites and contacts, the category with its parent,
 * and the debt.
 */
export function searchTexts(ix: Index, t: Pick<Transaction, 'fromId' | 'toId' | 'categoryId' | 'debtId' | 'description'>): (string | undefined)[] {
  const fromAcc = ix.accounts.get(t.fromId);
  const toAcc = ix.accounts.get(t.toId);
  const cat = ix.categories.get(t.categoryId);
  const parent = cat?.parentId ? ix.categories.get(cat.parentId) : undefined;
  return [
    t.description,
    fromAcc?.name,
    toAcc?.name,
    fromAcc?.requisite,
    toAcc?.requisite,
    ix.contacts.get(fromAcc?.contactId ?? '')?.name,
    ix.contacts.get(toAcc?.contactId ?? '')?.name,
    cat?.name,
    parent?.name,
    ix.debts.get(t.debtId)?.name,
  ];
}

/** The filter without its dates: what the activity calendar shows. */
export function filterUndated(ix: Index, f: TxFilter): Transaction[] {
  const fits = matcher(ix, f);
  return ix.txSorted.filter((t) => fits(t));
}

/** The filter's dates alone: its range (both ends included to the minute). */
export function inDates(ix: Index, f: Pick<TxFilter, 'from' | 'to'>): (t: Transaction) => boolean {
  const from = f.from ? new Date(f.from).getTime() : null;
  const to = f.to ? new Date(f.to).getTime() + 60_000 : null;
  return (t) => {
    const time = ix.time.get(t.id) ?? new Date(t.date).getTime();
    if (from !== null && time < from) return false;
    if (to !== null && time >= to) return false;
    return true;
  };
}

/** Applies the filter (its date fields aside) to the templates, in the user's order; the search also looks at their names. */
export function filterTemplates(ix: Index, f: TxFilter): Template[] {
  const fits = matcher(ix, f);
  return ix.templateList.filter((x) => fits(x, [x.name]));
}
