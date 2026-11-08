import { round, type Index } from './stats';
import type { Account } from './types';

/**
 * Balance history, computed from the records themselves: an account's starting balances, then a
 * step at every transaction and balance correction touching it. Nothing is stored, so editing or
 * deleting a transaction (even an old one) or an account always gives the right history at once.
 */

/** The balance from `t` on (until the next point). */
export interface HistoryPoint {
  t: number;
  v: number;
}

/** One line of the history: one asset of one account. */
export interface BalanceLine {
  key: string;
  accountId: string;
  assetId: string;
  /** when the account appears: its creation, or its first record if that is earlier */
  start: number;
  /** ascending; the first one is the starting balance at `start` */
  points: HistoryPoint[];
}

export const lineKey = (accountId: string, assetId: string) => `${accountId}:${assetId}`;

const cache = new WeakMap<Index, Map<string, BalanceLine>>();

/** Every account's lines (one per asset), keyed by `lineKey`. Computed once per data. */
export function balanceLines(ix: Index): Map<string, BalanceLine> {
  const hit = cache.get(ix);
  if (hit) return hit;

  const events = new Map<string, { t: number; d: number }[]>();
  const push = (accountId: string, assetId: string, t: number, d: number) => {
    const k = lineKey(accountId, assetId);
    const list = events.get(k);
    if (list) list.push({ t, d });
    else events.set(k, [{ t, d }]);
  };
  for (const x of ix.txSorted) {
    const t = ix.time.get(x.id)!;
    if (x.fromId && ix.accounts.has(x.fromId)) {
      push(x.fromId, x.assetId, t, -x.amount);
      if (x.fee) push(x.fromId, x.feeAssetId, t, -x.fee);
    }
    if (x.toId && ix.accounts.has(x.toId)) push(x.toId, x.assetId, t, x.amount);
  }
  for (const a of ix.accounts.values()) for (const x of a.adjustments) push(a.id, x.assetId, Date.parse(x.date), x.delta);

  const lines = new Map<string, BalanceLine>();
  for (const a of ix.accounts.values()) {
    const assets = new Set(a.assetIds);
    for (const k of events.keys()) if (k.startsWith(`${a.id}:`)) assets.add(k.slice(a.id.length + 1));
    const own = [...assets].flatMap((x) => events.get(lineKey(a.id, x)) ?? []);
    const created = Date.parse(a.createdAt);
    const first = Math.min(Number.isNaN(created) ? Infinity : created, ...own.map((e) => e.t));
    const start = Number.isFinite(first) ? first : Date.now();
    for (const assetId of assets) {
      const list = (events.get(lineKey(a.id, assetId)) ?? []).sort((p, q) => p.t - q.t);
      let v = a.initialBalances[assetId] ?? 0;
      const points: HistoryPoint[] = [{ t: start, v }];
      for (const e of list) {
        v = round(v + e.d);
        // several records at one moment make one step
        const last = points[points.length - 1];
        if (last.t === e.t) last.v = v;
        else points.push({ t: e.t, v });
      }
      lines.set(lineKey(a.id, assetId), { key: lineKey(a.id, assetId), accountId: a.id, assetId, start, points });
    }
  }
  cache.set(ix, lines);
  return lines;
}

/** The lines of some accounts, in the accounts' order and their assets' order. */
export function linesOf(ix: Index, accounts: Account[]): BalanceLine[] {
  const all = balanceLines(ix);
  return accounts.flatMap((a) => [...all.values()].filter((l) => l.accountId === a.id).sort((p, q) => a.assetIds.indexOf(p.assetId) - a.assetIds.indexOf(q.assetId)));
}

/** The balance at a moment, or undefined before the account existed. */
export function valueAt(line: BalanceLine, t: number): number | undefined {
  const p = line.points;
  if (t < p[0].t) return undefined;
  // the last point at or before t
  let lo = 0;
  let hi = p.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (p[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return p[lo].v;
}

/** The current balance (the last point). */
export const lastValue = (line: BalanceLine) => line.points[line.points.length - 1].v;
