import { matchesAny } from './search';
import { add, round, withChildren, type AssetMap, type Index } from './stats';
import type { Account, Transaction } from './types';

// ---------------------------------------------------------------------------
// Periods

export type PeriodMode = 'all' | 'day' | 'week' | 'month' | 'year' | 'custom';

export interface Period {
  mode: PeriodMode;
  /** any moment inside the period (for day/week/month/year) */
  anchor: number;
  /** custom range, local dates YYYY-MM-DD */
  from?: string;
  to?: string;
}

/** [start, end) in ms, or null for "all time". */
export function periodRange(p: Period): [number, number] | null {
  const a = new Date(p.anchor);
  switch (p.mode) {
    case 'all':
      return null;
    case 'day': {
      const s = new Date(a.getFullYear(), a.getMonth(), a.getDate());
      return [s.getTime(), new Date(s.getFullYear(), s.getMonth(), s.getDate() + 1).getTime()];
    }
    case 'week': {
      const s = new Date(a.getFullYear(), a.getMonth(), a.getDate() - ((a.getDay() + 6) % 7));
      return [s.getTime(), new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7).getTime()];
    }
    case 'month':
      return [new Date(a.getFullYear(), a.getMonth(), 1).getTime(), new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime()];
    case 'year':
      return [new Date(a.getFullYear(), 0, 1).getTime(), new Date(a.getFullYear() + 1, 0, 1).getTime()];
    case 'custom': {
      const s = p.from ? new Date(`${p.from}T00:00`).getTime() : -Infinity;
      const e = p.to ? new Date(`${p.to}T00:00`).getTime() + 86_400_000 : Infinity;
      return [s, e];
    }
  }
}

/** Moves a day/week/month/year period one step back (-1) or forward (+1). */
export function shiftPeriod(p: Period, dir: -1 | 1): Period {
  const a = new Date(p.anchor);
  switch (p.mode) {
    case 'day':
      a.setDate(a.getDate() + dir);
      break;
    case 'week':
      a.setDate(a.getDate() + 7 * dir);
      break;
    case 'month':
      a.setMonth(a.getMonth() + dir, 1);
      break;
    case 'year':
      a.setFullYear(a.getFullYear() + dir);
      break;
    default:
      return p;
  }
  return { ...p, anchor: a.getTime() };
}

// ---------------------------------------------------------------------------
// Filtering

export const NONE = '__none__';

export interface TxFilter {
  q: string;
  period: Period;
  /** account on either side */
  accounts: string[];
  fromAccounts: string[];
  toAccounts: string[];
  /** contact on either side */
  contacts: string[];
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
  withFee: boolean;
}

export const emptyFilter = (): TxFilter => ({
  q: '',
  period: { mode: 'all', anchor: Date.now() },
  accounts: [],
  fromAccounts: [],
  toAccounts: [],
  contacts: [],
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
  withFee: false,
});

/** Number of filters that differ from the defaults (search and period excluded). */
export function activeFilters(f: TxFilter): number {
  const lists = [f.accounts, f.fromAccounts, f.toAccounts, f.contacts, f.fromContacts, f.toContacts, f.forms, f.assets, f.categories, f.services, f.debts];
  return lists.filter((l) => l.length).length + (f.direction !== 'all' ? 1 : 0) + (f.minAmount || f.maxAmount ? 1 : 0) + (f.withFee ? 1 : 0);
}

export function ownAccountIds(ix: Index): Set<string> {
  const selfId = ix.self?.id;
  return new Set([...ix.accounts.values()].filter((a) => selfId && a.contactId === selfId).map((a) => a.id));
}

/** Applies the filter to the newest-first list of all transactions. */
export function filterTransactions(ix: Index, f: TxFilter): Transaction[] {
  const range = periodRange(f.period);
  const set = (l: string[]) => (l.length ? new Set(l) : null);
  const accounts = set(f.accounts);
  const fromAccounts = set(f.fromAccounts);
  const toAccounts = set(f.toAccounts);
  const contacts = set(f.contacts);
  const fromContacts = set(f.fromContacts);
  const toContacts = set(f.toContacts);
  const forms = set(f.forms);
  const assets = set(f.assets);
  const services = set(f.services);
  const debts = set(f.debts);
  const categories = f.categories.length ? withChildren(ix, f.categories) : null;
  const own = f.direction !== 'all' ? ownAccountIds(ix) : null;
  const min = f.minAmount ? Number(f.minAmount.replace(',', '.')) : null;
  const max = f.maxAmount ? Number(f.maxAmount.replace(',', '.')) : null;
  const contactOf = (id: string) => (id ? ix.accounts.get(id)?.contactId || NONE : NONE);
  const q = f.q.trim();

  return ix.txSorted.filter((t) => {
    if (range) {
      const time = ix.time.get(t.id)!;
      if (time < range[0] || time >= range[1]) return false;
    }
    if (accounts && !accounts.has(t.fromId) && !accounts.has(t.toId)) return false;
    if (fromAccounts && !fromAccounts.has(t.fromId || NONE)) return false;
    if (toAccounts && !toAccounts.has(t.toId || NONE)) return false;
    const fc = contactOf(t.fromId);
    const tc = contactOf(t.toId);
    if (contacts && !contacts.has(fc) && !contacts.has(tc)) return false;
    if (fromContacts && !fromContacts.has(fc)) return false;
    if (toContacts && !toContacts.has(tc)) return false;
    const from = ix.accounts.get(t.fromId);
    const to = ix.accounts.get(t.toId);
    if (forms && !forms.has((from ?? to)?.form ?? '')) return false;
    if (assets && !assets.has(t.assetId)) return false;
    if (categories && !categories.has(t.categoryId || NONE)) return false;
    if (services && !services.has(from?.serviceId ?? '') && !services.has(to?.serviceId ?? '')) return false;
    if (debts && !debts.has(t.debtId || NONE)) return false;
    if (own) {
      const fo = own.has(t.fromId);
      const to_ = own.has(t.toId);
      const dir = fo && to_ ? 'internal' : fo ? 'out' : to_ ? 'in' : 'foreign';
      if (dir !== f.direction) return false;
    }
    if (min !== null && Number.isFinite(min) && t.amount < min) return false;
    if (max !== null && Number.isFinite(max) && t.amount > max) return false;
    if (f.withFee && !t.fee) return false;
    if (q) {
      const cat = ix.categories.get(t.categoryId);
      const parent = cat?.parentId ? ix.categories.get(cat.parentId) : undefined;
      if (
        !matchesAny(
          q,
          t.description,
          from?.name,
          to?.name,
          from?.requisite,
          to?.requisite,
          ix.contacts.get(from?.contactId ?? '')?.name,
          ix.contacts.get(to?.contactId ?? '')?.name,
          cat?.name,
          parent?.name,
          ix.debts.get(t.debtId)?.name,
          String(t.amount),
        )
      )
        return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Perspective: a set of accounts the analytics is seen from (by default all own accounts)

export type Kind = 'in' | 'out' | 'internal' | 'none';

/**
 * in/out = money entering/leaving the selected accounts; internal = moved between two
 * selected accounts (or, with `ownTransfers`, between any two own accounts) - not income
 * or spending.
 */
export function classify(t: Transaction, sel: Set<string>, own: Set<string>, ownTransfers: boolean): Kind {
  const f = sel.has(t.fromId);
  const to = sel.has(t.toId);
  if (f && to) return 'internal';
  if (ownTransfers && own.has(t.fromId) && own.has(t.toId) && (f || to)) return 'internal';
  if (to) return 'in';
  if (f) return 'out';
  return 'none';
}

export interface Totals {
  income: AssetMap;
  expense: AssetMap;
  internal: AssetMap;
  fees: AssetMap;
  /** income - expense - fees */
  net: AssetMap;
  count: { in: number; out: number; internal: number; total: number };
}

export function totals(txs: Transaction[], sel: Set<string>, own: Set<string>, ownTransfers: boolean): Totals {
  const r: Totals = { income: new Map(), expense: new Map(), internal: new Map(), fees: new Map(), net: new Map(), count: { in: 0, out: 0, internal: 0, total: 0 } };
  for (const t of txs) {
    const k = classify(t, sel, own, ownTransfers);
    if (k === 'none') continue;
    r.count.total++;
    if (k === 'in') {
      add(r.income, t.assetId, t.amount);
      add(r.net, t.assetId, t.amount);
      r.count.in++;
    } else if (k === 'out') {
      add(r.expense, t.assetId, t.amount);
      add(r.net, t.assetId, -t.amount);
      r.count.out++;
    } else {
      add(r.internal, t.assetId, t.amount);
      r.count.internal++;
    }
    if (t.fee && sel.has(t.fromId)) {
      add(r.fees, t.feeAssetId, t.fee);
      add(r.net, t.feeAssetId, -t.fee);
    }
  }
  return r;
}

// ---------------------------------------------------------------------------
// Time buckets

export type Granularity = 'day' | 'week' | 'month' | 'year';

export interface Bucket {
  start: number;
  end: number;
}

const startOf = (time: number, g: Granularity) => {
  const d = new Date(time);
  if (g === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (g === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)).getTime();
  if (g === 'month') return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), 0, 1).getTime();
};
const next = (time: number, g: Granularity) => {
  const d = new Date(time);
  if (g === 'day') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  if (g === 'week') return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  if (g === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return new Date(d.getFullYear() + 1, 0, 1).getTime();
};

/** Picks a granularity giving a readable number of buckets for the span. */
export function autoGranularity(start: number, end: number): Granularity {
  const days = (end - start) / 86_400_000;
  if (days <= 45) return 'day';
  if (days <= 120) return 'week';
  if (days <= 365 * 4) return 'month';
  return 'year';
}

/** Effective [start, end) for charts: the period, or from the first transaction to now. */
export function chartRange(ix: Index, p: Period): [number, number] {
  const r = periodRange(p);
  const first = ix.txSorted.length ? ix.time.get(ix.txSorted[ix.txSorted.length - 1].id)! : Date.now();
  const last = Math.max(Date.now(), ix.txSorted.length ? ix.time.get(ix.txSorted[0].id)! : 0);
  if (!r) return [first, last + 1];
  const s = Number.isFinite(r[0]) ? r[0] : first;
  const e = Number.isFinite(r[1]) ? r[1] : last + 1;
  return [s, e];
}

export function buckets(start: number, end: number, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  for (let s = startOf(start, g); s < end && out.length < 2000; s = next(s, g)) out.push({ start: s, end: next(s, g) });
  return out;
}

function bucketIndex(bs: Bucket[], time: number): number {
  let lo = 0;
  let hi = bs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (time < bs[mid].start) hi = mid - 1;
    else if (time >= bs[mid].end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

export interface FlowPoint {
  start: number;
  income: number;
  expense: number;
  fees: number;
  net: number;
  count: number;
}

/** Income / spending / fees per bucket, for one asset. */
export function cashflow(ix: Index, txs: Transaction[], bs: Bucket[], asset: string, sel: Set<string>, own: Set<string>, ownTransfers: boolean): FlowPoint[] {
  const pts = bs.map((b) => ({ start: b.start, income: 0, expense: 0, fees: 0, net: 0, count: 0 }));
  for (const t of txs) {
    const i = bucketIndex(bs, ix.time.get(t.id)!);
    if (i < 0) continue;
    const k = classify(t, sel, own, ownTransfers);
    if (k === 'none') continue;
    const p = pts[i];
    if (t.assetId === asset) {
      if (k === 'in') p.income += t.amount;
      if (k === 'out') p.expense += t.amount;
      p.count++;
    }
    if (t.fee && t.feeAssetId === asset && sel.has(t.fromId)) p.fees += t.fee;
  }
  for (const p of pts) {
    p.income = round(p.income);
    p.expense = round(p.expense);
    p.fees = round(p.fees);
    p.net = round(p.income - p.expense - p.fees);
  }
  return pts;
}

/** Balance of the accounts (one asset) at the end of each bucket. */
export function balanceSeries(ix: Index, accounts: Account[], bs: Bucket[], asset: string): { start: number; balance: number }[] {
  const ids = new Set(accounts.map((a) => a.id));
  let balance = 0;
  for (const a of accounts) balance += a.initialBalances[asset] ?? 0;
  const asc = [...ix.txSorted].reverse();
  const out: { start: number; balance: number }[] = [];
  let i = 0;
  for (const b of bs) {
    for (; i < asc.length && ix.time.get(asc[i].id)! < b.end; i++) balance += delta(asc[i], ids, asset);
    out.push({ start: b.start, balance: round(balance) });
  }
  return out;
}

function delta(t: Transaction, ids: Set<string>, asset: string): number {
  let d = 0;
  if (t.assetId === asset) {
    if (ids.has(t.toId)) d += t.amount;
    if (ids.has(t.fromId)) d -= t.amount;
  }
  if (t.fee && t.feeAssetId === asset && ids.has(t.fromId)) d -= t.fee;
  return d;
}

/** Balances of the accounts at a moment (all assets). */
export function balancesAt(ix: Index, accounts: Account[], time: number): AssetMap {
  const ids = new Set(accounts.map((a) => a.id));
  const m: AssetMap = new Map();
  for (const a of accounts) for (const x of a.assetIds) add(m, x, a.initialBalances[x] ?? 0);
  for (const t of ix.txSorted) {
    if (ix.time.get(t.id)! >= time) continue;
    if (ids.has(t.toId)) add(m, t.assetId, t.amount);
    if (ids.has(t.fromId)) {
      add(m, t.assetId, -t.amount);
      if (t.fee) add(m, t.feeAssetId, -t.fee);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Breakdowns

export interface CategoryRow {
  id: string; // '' = without category
  amount: number;
  count: number;
  children: CategoryRow[];
}

/** Spending (out) or income (in) of one asset grouped by root category, with sub-categories. */
export function byCategory(ix: Index, txs: Transaction[], asset: string, kind: 'in' | 'out', sel: Set<string>, own: Set<string>, ownTransfers: boolean): CategoryRow[] {
  const roots = new Map<string, CategoryRow>();
  const row = (id: string) => {
    if (!roots.has(id)) roots.set(id, { id, amount: 0, count: 0, children: [] });
    return roots.get(id)!;
  };
  for (const t of txs) {
    if (t.assetId !== asset || classify(t, sel, own, ownTransfers) !== kind) continue;
    const c = t.categoryId ? ix.categories.get(t.categoryId) : undefined;
    const root = row(c ? c.parentId || c.id : '');
    root.amount += t.amount;
    root.count++;
    if (c?.parentId) {
      let ch = root.children.find((x) => x.id === c.id);
      if (!ch) root.children.push((ch = { id: c.id, amount: 0, count: 0, children: [] }));
      ch.amount += t.amount;
      ch.count++;
    }
  }
  const list = [...roots.values()];
  for (const r of list) {
    r.amount = round(r.amount);
    const direct = round(r.amount - r.children.reduce((s, c) => s + c.amount, 0));
    if (r.children.length && direct > 0 && r.id) {
      r.children.push({ id: r.id, amount: direct, count: r.count - r.children.reduce((s, c) => s + c.count, 0), children: [] });
    }
    r.children.sort((a, b) => b.amount - a.amount);
  }
  return list.sort((a, b) => b.amount - a.amount);
}

export interface PartyRow {
  /** contact id, or the account id for accounts without contact, '' = untracked side */
  id: string;
  isAccount: boolean;
  sent: AssetMap; // from the selection to them
  received: AssetMap; // from them to the selection
  count: number;
  last: number;
}

/** Counterparties of the selected accounts (by contact; accounts without contact individually). */
export function counterparties(ix: Index, txs: Transaction[], sel: Set<string>, own: Set<string>, ownTransfers: boolean, by: 'contact' | 'account'): PartyRow[] {
  const rows = new Map<string, PartyRow>();
  for (const t of txs) {
    const k = classify(t, sel, own, ownTransfers);
    if (k !== 'in' && k !== 'out') continue;
    const otherId = k === 'out' ? t.toId : t.fromId;
    const other = otherId ? ix.accounts.get(otherId) : undefined;
    const isAccount = by === 'account' || !other?.contactId;
    const key = !other ? '' : isAccount ? other.id : other.contactId;
    let r = rows.get(key);
    if (!r) rows.set(key, (r = { id: key, isAccount: !!other && isAccount, sent: new Map(), received: new Map(), count: 0, last: 0 }));
    add(k === 'out' ? r.sent : r.received, t.assetId, t.amount);
    r.count++;
    r.last = Math.max(r.last, ix.time.get(t.id)!);
  }
  return [...rows.values()];
}

/** Fees paid from the selected accounts, by asset, per account and per service. */
export function feeBreakdown(ix: Index, txs: Transaction[], sel: Set<string>) {
  const total: AssetMap = new Map();
  const perAccount = new Map<string, AssetMap>();
  const perService = new Map<string, AssetMap>();
  let count = 0;
  const top: Transaction[] = [];
  for (const t of txs) {
    if (!t.fee || !sel.has(t.fromId)) continue;
    count++;
    add(total, t.feeAssetId, t.fee);
    const acc = ix.accounts.get(t.fromId)!;
    if (!perAccount.has(acc.id)) perAccount.set(acc.id, new Map());
    add(perAccount.get(acc.id)!, t.feeAssetId, t.fee);
    const sk = acc.serviceId || '';
    if (!perService.has(sk)) perService.set(sk, new Map());
    add(perService.get(sk)!, t.feeAssetId, t.fee);
    top.push(t);
  }
  return { total, perAccount, perService, count, txs: top };
}

/** Transactions per weekday (Mon..Sun) and per hour. */
export function timeOfActivity(ix: Index, txs: Transaction[]) {
  const weekday = Array(7).fill(0) as number[];
  const hour = Array(24).fill(0) as number[];
  for (const t of txs) {
    const d = new Date(ix.time.get(t.id)!);
    weekday[(d.getDay() + 6) % 7]++;
    hour[d.getHours()]++;
  }
  return { weekday, hour };
}

/** The asset used by most of the transactions (default chart asset). */
export function mainAsset(txs: Transaction[], fallback: string): string {
  const n = new Map<string, number>();
  for (const t of txs) n.set(t.assetId, (n.get(t.assetId) ?? 0) + 1);
  let best = fallback;
  let max = 0;
  for (const [k, v] of n) if (v > max) [best, max] = [k, v];
  return best;
}
