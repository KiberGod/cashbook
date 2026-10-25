import type { Account, Asset, Category, Contact, Data, Debt, Service, Transaction } from './types';

/**
 * Everything derived from the records: balances, turnover, debt remainders, usage
 * (back-links) and lookup maps. Computed in one pass over the data and cached per
 * Data object, so any change - create, edit or delete of any entity - is reflected
 * everywhere at once and nothing derived is ever stored.
 */

/** assetId -> amount */
export type AssetMap = Map<string, number>;

export interface Flow {
  /** received from outside (for a contact: from other contacts) */
  in: AssetMap;
  /** sent outside, fees excluded */
  out: AssetMap;
  fees: AssetMap;
  txIn: number;
  txOut: number;
  /** transfers between accounts of the same contact (contacts only) */
  internal: AssetMap;
  txInternal: number;
  /** all transactions involved */
  tx: number;
}

export interface AccountStats {
  balances: AssetMap;
  flow: Flow;
  /** newest first */
  txs: Transaction[];
}

export interface ContactStats {
  accounts: Account[];
  balances: AssetMap;
  flow: Flow;
  txs: Transaction[];
  debts: Debt[];
  /** what others owe this contact / what it owes, by asset */
  owedToMe: AssetMap;
  iOwe: AssetMap;
  balancesWithDebts: AssetMap;
}

export interface DebtStats {
  /** > 0: debtor owes creditor; < 0: overpaid - creditor owes debtor */
  remaining: number;
  added: number;
  repaid: number;
  txs: Transaction[];
}

export interface Index {
  assets: Map<string, Asset>;
  services: Map<string, Service>;
  contacts: Map<string, Contact>;
  accounts: Map<string, Account>;
  categories: Map<string, Category>;
  transactions: Map<string, Transaction>;
  debts: Map<string, Debt>;
  self: Contact | undefined;
  /** all transactions, newest first */
  txSorted: Transaction[];
  time: Map<string, number>;
  account: Map<string, AccountStats>;
  contact: Map<string, ContactStats>;
  debt: Map<string, DebtStats>;
  categoryChildren: Map<string, Category[]>;
  /** transactions directly marked with a category */
  categoryTx: Map<string, number>;
  assetUsage: Map<string, { accounts: Account[]; txs: number; debts: Debt[] }>;
  serviceAccounts: Map<string, Account[]>;
}

export const add = (m: AssetMap, asset: string, v: number) => m.set(asset, round((m.get(asset) ?? 0) + v));

/** Removes floating point noise (0.1 + 0.2 = 0.30000000000000004) at any magnitude. */
export const round = (n: number) => Number.parseFloat(n.toPrecision(15));

const emptyFlow = (): Flow => ({ in: new Map(), out: new Map(), fees: new Map(), txIn: 0, txOut: 0, internal: new Map(), txInternal: 0, tx: 0 });

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

export const txTime = (t: Transaction) => {
  const n = Date.parse(t.date);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * How a transaction changes a debt: +1 increases it (creditor gives more), -1 repays it,
 * 0 = it does not fit the debt (other asset, other contacts or contradicting sides).
 */
export function debtEffect(debt: Debt, t: Pick<Transaction, 'fromId' | 'toId' | 'assetId'>, accounts: Map<string, Account>): -1 | 0 | 1 {
  if (t.assetId !== debt.assetId) return 0;
  const fromC = t.fromId ? accounts.get(t.fromId)?.contactId || '' : '';
  const toC = t.toId ? accounts.get(t.toId)?.contactId || '' : '';
  const repay = fromC === debt.debtorId || toC === debt.creditorId;
  const lend = fromC === debt.creditorId || toC === debt.debtorId;
  if (repay && !lend) return -1;
  if (lend && !repay) return 1;
  return 0;
}

const cache = new WeakMap<Data, Index>();

export function getIndex(d: Data): Index {
  let ix = cache.get(d);
  if (!ix) {
    ix = build(d);
    cache.set(d, ix);
  }
  return ix;
}

function build(d: Data): Index {
  const accounts = byId(d.accounts);
  const time = new Map(d.transactions.map((t) => [t.id, txTime(t)]));
  const txSorted = [...d.transactions].sort(
    (a, b) => time.get(b.id)! - time.get(a.id)! || b.createdAt.localeCompare(a.createdAt),
  );

  // accounts
  const account = new Map<string, AccountStats>();
  for (const a of d.accounts) {
    const balances: AssetMap = new Map(a.assetIds.map((x) => [x, a.initialBalances[x] ?? 0]));
    account.set(a.id, { balances, flow: emptyFlow(), txs: [] });
  }
  // contacts
  const contact = new Map<string, ContactStats>();
  for (const c of d.contacts) {
    contact.set(c.id, {
      accounts: [],
      balances: new Map(),
      flow: emptyFlow(),
      txs: [],
      debts: [],
      owedToMe: new Map(),
      iOwe: new Map(),
      balancesWithDebts: new Map(),
    });
  }
  for (const a of d.accounts) if (a.contactId) contact.get(a.contactId)?.accounts.push(a);

  const categoryTx = new Map<string, number>();
  const assetUsage = new Map(d.assets.map((a) => [a.id, { accounts: [] as Account[], txs: 0, debts: [] as Debt[] }]));
  for (const a of d.accounts) for (const x of a.assetIds) assetUsage.get(x)?.accounts.push(a);
  for (const debt of d.debts) assetUsage.get(debt.assetId)?.debts.push(debt);

  for (const t of txSorted) {
    const from = t.fromId ? account.get(t.fromId) : undefined;
    const to = t.toId ? account.get(t.toId) : undefined;
    const fee = t.fee ?? 0;
    if (from) {
      add(from.balances, t.assetId, -t.amount);
      add(from.flow.out, t.assetId, t.amount);
      from.flow.txOut++;
      from.flow.tx++;
      from.txs.push(t);
      if (fee) {
        add(from.balances, t.feeAssetId, -fee);
        add(from.flow.fees, t.feeAssetId, fee);
      }
    }
    if (to) {
      add(to.balances, t.assetId, t.amount);
      add(to.flow.in, t.assetId, t.amount);
      to.flow.txIn++;
      to.flow.tx++;
      to.txs.push(t);
    }

    const fromC = t.fromId ? accounts.get(t.fromId)?.contactId || '' : '';
    const toC = t.toId ? accounts.get(t.toId)?.contactId || '' : '';
    if (fromC && fromC === toC) {
      const c = contact.get(fromC);
      if (c) {
        add(c.flow.internal, t.assetId, t.amount);
        c.flow.txInternal++;
        c.flow.tx++;
        if (fee) add(c.flow.fees, t.feeAssetId, fee);
        c.txs.push(t);
      }
    } else {
      const fc = fromC ? contact.get(fromC) : undefined;
      const tc = toC ? contact.get(toC) : undefined;
      if (fc) {
        add(fc.flow.out, t.assetId, t.amount);
        if (fee) add(fc.flow.fees, t.feeAssetId, fee);
        fc.flow.txOut++;
        fc.flow.tx++;
        fc.txs.push(t);
      }
      if (tc) {
        add(tc.flow.in, t.assetId, t.amount);
        tc.flow.txIn++;
        tc.flow.tx++;
        tc.txs.push(t);
      }
    }

    if (t.categoryId) categoryTx.set(t.categoryId, (categoryTx.get(t.categoryId) ?? 0) + 1);
    const u = assetUsage.get(t.assetId);
    if (u) u.txs++;
    if (fee && t.feeAssetId !== t.assetId) {
      const fu = assetUsage.get(t.feeAssetId);
      if (fu) fu.txs++;
    }
  }

  for (const c of contact.values()) {
    for (const a of c.accounts) for (const [x, v] of account.get(a.id)!.balances) add(c.balances, x, v);
  }

  // debts
  const debt = new Map<string, DebtStats>();
  for (const x of d.debts) debt.set(x.id, { remaining: x.amount, added: 0, repaid: 0, txs: [] });
  const debtsById = byId(d.debts);
  for (const t of txSorted) {
    if (!t.debtId) continue;
    const x = debtsById.get(t.debtId);
    const s = debt.get(t.debtId);
    if (!x || !s) continue;
    s.txs.push(t);
    const e = debtEffect(x, t, accounts);
    if (e > 0) s.added = round(s.added + t.amount);
    if (e < 0) s.repaid = round(s.repaid + t.amount);
    s.remaining = round(s.remaining + e * t.amount);
  }
  for (const x of d.debts) {
    const s = debt.get(x.id)!;
    contact.get(x.debtorId)?.debts.push(x);
    contact.get(x.creditorId)?.debts.push(x);
    const [owes, owed, v] = s.remaining >= 0 ? [x.debtorId, x.creditorId, s.remaining] : [x.creditorId, x.debtorId, -s.remaining];
    if (!v) continue;
    const ow = contact.get(owes);
    const od = contact.get(owed);
    if (ow) add(ow.iOwe, x.assetId, v);
    if (od) add(od.owedToMe, x.assetId, v);
  }
  for (const c of contact.values()) {
    const m: AssetMap = new Map(c.balances);
    for (const [x, v] of c.owedToMe) add(m, x, v);
    for (const [x, v] of c.iOwe) add(m, x, -v);
    c.balancesWithDebts = m;
  }

  const categoryChildren = new Map<string, Category[]>();
  for (const c of d.categories) {
    if (!c.parentId) continue;
    categoryChildren.set(c.parentId, [...(categoryChildren.get(c.parentId) ?? []), c]);
  }
  const serviceAccounts = new Map<string, Account[]>();
  for (const a of d.accounts) {
    if (a.serviceId) serviceAccounts.set(a.serviceId, [...(serviceAccounts.get(a.serviceId) ?? []), a]);
  }

  return {
    assets: byId(d.assets),
    services: byId(d.services),
    contacts: byId(d.contacts),
    accounts,
    categories: byId(d.categories),
    transactions: byId(d.transactions),
    debts: debtsById,
    self: d.contacts.find((c) => c.isSelf),
    txSorted,
    time,
    account,
    contact,
    debt,
    categoryChildren,
    categoryTx,
    assetUsage,
    serviceAccounts,
  };
}

/** The category with its sub-categories (a parent filter includes its children). */
export function withChildren(ix: Index, categoryIds: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const id of categoryIds) {
    out.add(id);
    for (const c of ix.categoryChildren.get(id) ?? []) out.add(c.id);
  }
  return out;
}

/** Transactions marked with the category or any of its sub-categories. */
export function categoryTxTotal(ix: Index, id: string): number {
  let n = ix.categoryTx.get(id) ?? 0;
  for (const c of ix.categoryChildren.get(id) ?? []) n += ix.categoryTx.get(c.id) ?? 0;
  return n;
}

/** Own accounts first, then by contact and name - for account pickers. */
export function sortAccountsForPicker(ix: Index, list: Account[], locale: string): Account[] {
  const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const selfId = ix.self?.id;
  const contactName = (a: Account) => (a.contactId ? (ix.contacts.get(a.contactId)?.name ?? '') : '￿');
  return [...list].sort((a, b) => {
    const sa = a.contactId === selfId ? 0 : 1;
    const sb = b.contactId === selfId ? 0 : 1;
    return sa - sb || coll.compare(contactName(a), contactName(b)) || coll.compare(a.name, b.name);
  });
}
