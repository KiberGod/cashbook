import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { graphSettingId } from '../lib/ops';
import { matchesAny } from '../lib/search';
import { getIndex, type Index } from '../lib/stats';
import type { Account } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store/store';
import { openLink } from '../store/tabs';
import { AccountIcon, AssetAmounts, AssetIcon, Avatar, ContactChip, Money, SearchField, Switch } from './bits';
import { DateTimeField } from './DateTimeField';
import { useSheetSetting } from './sheetSetting';
import { useViewState } from './viewState';

/**
 * The contact's accounts and the accounts they had transactions with, as a graph that moves on its
 * own (like Obsidian's): accounts push each other away, links pull them together - the more
 * transactions, the stronger and shorter the link - and everything drifts to the middle. Links
 * between two other accounts are not shown: only what touches the contact's own accounts.
 */

interface Link {
  key: string;
  a: string;
  b: string;
  /** transactions a -> b and b -> a */
  ab: number;
  ba: number;
  /** the transactions themselves */
  txs: Set<string>;
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** held by the pointer */
  fixed: boolean;
}

/** What runs along the links for each transaction: a dot, or an arrow pointing the way the money went. */
type Cursor = 'dot' | 'arrow';

/**
 * A contact's graph view, kept in the spreadsheet (it follows the user): what is left out (accounts,
 * whole contacts, assets, services; '-' = no contact / no service), the time range looked at, and
 * how the transactions show. Everything is shown when the lists are empty.
 */
interface GraphView {
  hiddenAccounts: string[];
  hiddenContacts: string[];
  hiddenAssets: string[];
  hiddenServices: string[];
  /** local "YYYY-MM-DDTHH:mm", '' = open */
  from: string;
  to: string;
  /** transactions run along the links */
  motion: boolean;
  cursor: Cursor;
}

const DEFAULT_VIEW: GraphView = { hiddenAccounts: [], hiddenContacts: [], hiddenAssets: [], hiddenServices: [], from: '', to: '', motion: true, cursor: 'dot' };
/** no contact / no service, in the lists of what is left out */
const NONE = '-';

/**
 * Every link that touches an own account; each transaction counted once. With a filter: only the
 * transactions in the time range and not in a left-out asset (so a link may have none, and go).
 */
function buildModel(ix: Index, own: Set<string>, f?: { hiddenAssets: Set<string>; from: number; to: number }) {
  const links = new Map<string, Link>();
  const assets = new Set<string>();
  for (const a of own) {
    for (const x of ix.account.get(a)?.txs ?? []) {
      if (!x.fromId || !x.toId || x.fromId === x.toId) continue;
      if (!ix.accounts.has(x.fromId) || !ix.accounts.has(x.toId)) continue;
      if (f) {
        if (f.hiddenAssets.has(x.assetId)) continue;
        const at = ix.time.get(x.id) ?? 0;
        if (at < f.from || at > f.to) continue;
      }
      const [p, q] = x.fromId < x.toId ? [x.fromId, x.toId] : [x.toId, x.fromId];
      const key = `${p}|${q}`;
      let l = links.get(key);
      if (!l) {
        l = { key, a: p, b: q, ab: 0, ba: 0, txs: new Set() };
        links.set(key, l);
      }
      if (l.txs.has(x.id)) continue;
      l.txs.add(x.id);
      assets.add(x.assetId);
      if (x.fromId === p) l.ab++;
      else l.ba++;
    }
  }
  const others = new Set<string>();
  for (const l of links.values()) for (const id of [l.a, l.b]) if (!own.has(id)) others.add(id);
  return { links: [...links.values()], others, assets };
}

/** the physics, in world pixels */
const REPEL = 3200;
const DAMPING = 0.6;
const ALPHA_DECAY = 0.975;
const ALPHA_MIN = 0.005;
/** below this speed (px per frame) everywhere, a cooling graph is stopped for good */
const REST_SPEED = 0.02;
/** the sun: own accounts are pulled to their places on a ring, the others to their places on the rays */
const OWN_PULL = 0.08;
const RAY_PULL = 0.07;
/** a link to another account pulls this much of a link between two own ones: a contact's cluster keeps together */
const OTHER_LINK = 0.45;
const PLACED_PULL = 0.25;
/** the transactions panel: its width on the right, or (a narrow box) a sheet over the lower part */
const PANEL_W = 340;
const PANEL_BOTTOM_BELOW = 640;
/** rows shown at first (and added by "show more") */
const PANEL_PAGE = 60;

/** transactions running along the links: world px per second, dots per second at the busiest direction */
const DOT_SPEED = 110;
const DOT_RATE_MIN = 0.2;
const DOT_RATE_MAX = 2;

interface Dot {
  key: string;
  from: string;
  to: string;
  /** 0..1 along the way */
  t: number;
  /** seconds for the whole way */
  dur: number;
}

/** how far the contacts' clusters stand beyond the disc of own accounts */
const RAY = 110;
/** the room between accounts in a cluster: own ones (a group of one service), others (one contact's) */
const OWN_GAP = 68;
const OTHER_GAP = 50;
/** the room between two groups of own accounts, and between two contacts' clusters */
const GROUP_GAP = 34;
const CLUSTER_GAP = 46;

/**
 * Places for n accounts packed round a middle (hexagonal rings: 1, 6, 12...), nearest the middle
 * first; `gap` between neighbours.
 */
function pack(n: number, gap: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  if (n <= 0) return out;
  // two: one above the other (side by side their names would run into each other); three: a triangle
  if (n === 2) return [{ x: 0, y: -gap / 2 }, { x: 0, y: gap / 2 }];
  const unit = [{ x: 0, y: 0 }];
  if (n === 3) unit.splice(0, 1, ...[0, 1, 2].map((i) => ({ x: Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * 0.58, y: Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 3) * 0.58 })));
  else
    for (let ring = 1; unit.length < n; ring++) {
      const count = 6 * ring;
      for (let i = 0; i < count && unit.length < n; i++) {
        const a = (i / count) * Math.PI * 2 - Math.PI / 2;
        unit.push({ x: Math.cos(a) * ring, y: Math.sin(a) * ring });
      }
    }
  // wider than tall: the names under the accounts need room side by side
  for (const u of unit) out.push({ x: u.x * gap * NAME_ROOM, y: u.y * gap });
  return out;
}

/** names are wider than accounts: a cluster is this much wider than tall */
const NAME_ROOM = 1.6;

/** How far the places of `pack(n, gap)` reach from the middle, at the widest (plus a margin). */
function packRadius(n: number, gap: number) {
  if (n <= 1) return gap / 2;
  if (n === 2) return gap;
  if (n === 3) return gap * 0.58 * NAME_ROOM + gap / 2;
  let ring = 0;
  for (let placed = 1; placed < n; ) placed += 6 * ++ring;
  return ring * gap * NAME_ROOM + gap / 2;
}
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

/** where the bodies were, per graph: coming back to the tab does not shuffle them */
const placed = new Map<string, Map<string, { x: number; y: number }>>();
/** where the user has moved accounts to, per graph: a shift of their place in the sun */
const shifted = new Map<string, Map<string, { x: number; y: number }>>();

/**
 * What an account is (the hover card and the transactions panel's head): its name and form, whose
 * it is, its balance, its transactions with the linked accounts on the graph (and, for the contact's
 * own one, how many accounts it is linked to). `onClose` adds a close button.
 */
function AccountInfo({ id, own, links, onClose }: { id: string; own: Set<string>; links: Link[]; onClose?: () => void }) {
  const { t, num } = useI18n();
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const a = ix.accounts.get(id);
  if (!a) return null;
  const as = ix.account.get(a.id);
  const owner = a.contactId ? ix.contacts.get(a.contactId) : undefined;
  const service = a.serviceId ? ix.services.get(a.serviceId) : undefined;
  const mine = own.has(a.id);
  const ls = links.filter((l) => l.a === a.id || l.b === a.id);
  // from this account's side: what came in from / went out to the linked accounts
  let inN = 0;
  let outN = 0;
  for (const l of ls) {
    inN += l.a === a.id ? l.ba : l.ab;
    outN += l.a === a.id ? l.ab : l.ba;
  }
  return (
    <>
      <div className="ag-card-head">
        <AccountIcon account={a} service={service} size={30} />
        <span className="ag-card-title">
          <a href={href.detail('accounts', a.id)}>{a.name}</a>
          <span className="muted small">
            {t(`form.${a.form}`)}
            {service ? ` · ${service.name}` : ''}
          </span>
        </span>
        {onClose && (
          <button type="button" className="icon-btn ag-card-close" onClick={onClose} aria-label={t('common.close')} title={t('common.close')}>
            <Icon name="close" size={15} />
          </button>
        )}
      </div>
      {mine && <span className="badge badge-accent">{t('graph.ownAccount')}</span>}
      <div className="ag-card-row">
        <span className="muted">{t('graph.owner')}</span>
        {owner ? <ContactChip contact={owner} href={href.detail('contacts', owner.id)} /> : <span className="muted">{t('graph.noContact')}</span>}
      </div>
      <div className="ag-card-row">
        <span className="muted">{t('accounts.balance')}</span>
        {as ? <AssetAmounts map={as.balances} assets={data.assets} column /> : <span className="muted">—</span>}
      </div>
      <div className="ag-card-row" title={mine ? t('graph.links') : t('graph.withContact')}>
        <span className="muted">{t('stats.transactions')}</span>
        <span className="tx-split">
          {num(inN + outN)}
          <span className="muted">
            (<Icon name="arrowIn" size={13} className="flow-in" />
            {num(inN)}
            <Icon name="arrowOut" size={13} className="flow-out" />
            {num(outN)})
          </span>
        </span>
      </div>
      {mine && (
        <div className="ag-card-row">
          <span className="muted">{t('graph.linkedAccounts')}</span>
          <span>{num(ls.length)}</span>
        </div>
      )}
    </>
  );
}

/**
 * A clicked account's transactions with the accounts it is linked to on the graph, newest first:
 * which way the money went (seen from the account), with whom, when, and how much. A row opens the
 * transaction.
 */
function TxPanel({ id, links, own, onClose }: { id: string; links: Link[]; own: Set<string>; onClose: () => void }) {
  const i18n = useI18n();
  const { t, num } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const [limit, setLimit] = useState(PANEL_PAGE);
  const a = ix.accounts.get(id);
  const txs = useMemo(() => {
    const ids = new Set<string>();
    for (const l of links) if (l.a === id || l.b === id) for (const x of l.txs) ids.add(x);
    return [...ids]
      .map((x) => ix.transactions.get(x))
      .filter((x) => !!x)
      .sort((p, q) => ix.time.get(q.id)! - ix.time.get(p.id)!);
  }, [links, id, ix]);
  if (!a) return null;
  return (
    <aside className="ag-panel" aria-label={`${a.name}: ${t('graph.txTitle')}`} onPointerDown={(e) => e.stopPropagation()}>
      {/* what the hover card shows, as the head */}
      <div className="ag-panel-head">
        <AccountInfo id={id} own={own} links={links} onClose={onClose} />
      </div>
      <div className="ag-panel-sub">
        {t('graph.txTitle')} <span className="count">{num(txs.length)}</span>
      </div>
      <div className="ag-panel-list">
        {txs.length === 0 && <p className="muted ag-panel-empty">{t('graph.noTx')}</p>}
        {txs.slice(0, limit).map((x) => {
          const out = x.fromId === id;
          const otherId = out ? x.toId : x.fromId;
          const other = ix.accounts.get(otherId);
          const asset = ix.assets.get(x.assetId);
          const cat = x.categoryId ? ix.categories.get(x.categoryId) : undefined;
          const to = href.transaction(x.id);
          return (
            <div
              key={x.id}
              className="ag-tx"
              role="link"
              tabIndex={0}
              data-href={to}
              onClick={() => openLink(to)}
              onKeyDown={(e) => e.key === 'Enter' && openLink(to)}
            >
              <Icon name={out ? 'arrowOut' : 'arrowIn'} size={15} className={out ? 'flow-out' : 'flow-in'} />
              <span className="ag-tx-main">
                <span className="ag-tx-who">
                  {other && <AccountIcon account={other} service={other.serviceId ? ix.services.get(other.serviceId) : undefined} size={18} />}
                  <span className="ellipsis">{other?.name ?? t('tx.external')}</span>
                </span>
                <span className="muted small ellipsis">
                  {i18n.dateTime(x.date)}
                  {cat ? ` · ${cat.name}` : ''}
                </span>
              </span>
              <span className="amount-chip">
                <AssetIcon asset={asset} size={15} />
                <Money value={out ? -x.amount : x.amount} asset={asset} sign colored />
              </span>
            </div>
          );
        })}
        {txs.length > limit && (
          <button type="button" className="btn btn-sm btn-ghost ag-panel-more" onClick={() => setLimit((n) => n + PANEL_PAGE)}>
            {t('graph.more', { n: num(Math.min(PANEL_PAGE, txs.length - limit)) })}
          </button>
        )}
      </div>
    </aside>
  );
}

export function AccountsGraph({ accounts, stateKey, contactId }: { accounts: Account[]; stateKey: string; contactId: string }) {
  const i18n = useI18n();
  const { t, num, locale } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const ownKey = accounts.map((a) => a.id).join();
  const own = useMemo(() => new Set(accounts.map((a) => a.id)), [ownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // the view, from the spreadsheet: what is left out, the time range, how transactions show
  const [cfg, setCfg] = useSheetSetting<GraphView>(graphSettingId(contactId), DEFAULT_VIEW);
  const cfgKey = JSON.stringify([cfg.hiddenAccounts, cfg.hiddenContacts, cfg.hiddenAssets, cfg.hiddenServices, cfg.from, cfg.to]);

  // every link, from all the transactions: where accounts stand, what can be chosen
  const modelAll = useMemo(() => buildModel(ix, own), [ix, own]);
  // what is looked at: the transactions in the range and the assets left in
  const model = useMemo(() => {
    const from = cfg.from ? Date.parse(cfg.from) : -Infinity;
    // the "to" minute is included
    const to = cfg.to ? Date.parse(cfg.to) + 59_999 : Infinity;
    return buildModel(ix, own, { hiddenAssets: new Set(cfg.hiddenAssets), from, to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ix, own, cfgKey]);

  // what is left out: accounts one by one, or all of a contact's, or of a service's
  const contactKey = (id: string) => ix.accounts.get(id)?.contactId || NONE;
  const serviceKey = (id: string) => ix.accounts.get(id)?.serviceId || NONE;
  const isHidden = useMemo(() => {
    const acc = new Set(cfg.hiddenAccounts);
    const con = new Set(cfg.hiddenContacts);
    const svc = new Set(cfg.hiddenServices);
    return (id: string) => acc.has(id) || con.has(contactKey(id)) || svc.has(serviceKey(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfgKey, ix]);
  // ---- the sun: where every account belongs, from all of them (hiding some moves nothing) ----
  // own accounts fill a disc, grouped by financial service (cash by form): the groups with no or
  // little business outside sit in the middle, the busiest on the rim, and inside a group its
  // busiest accounts face outwards. The other accounts gather by contact; each contact's group
  // stands outside the disc, across from the own accounts it deals with most, apart from the others.
  const ownerSig = [...own, ...modelAll.others].map((id) => `${ix.accounts.get(id)?.contactId}/${ix.accounts.get(id)?.serviceId}/${ix.accounts.get(id)?.form}`).join();
  const fullSig = `${[...own].join()}#${modelAll.links.map((l) => `${l.key}:${l.ab + l.ba}`).join()}#${ownerSig}`;
  const layout = useMemo(() => {
    const maxW = Math.max(1, ...modelAll.links.map((l) => l.ab + l.ba));
    const weight = (l: Link) => l.ab + l.ba;
    // each other account hangs off the own one it shares the most transactions with (it moves with it when that one is dragged)
    const anchor = new Map<string, { id: string; s: number }>();
    // how busy each own account is outside (transactions with other accounts)
    const outside = new Map<string, number>([...own].map((id) => [id, 0]));
    for (const l of modelAll.links) {
      const w = weight(l);
      for (const [o, m] of [
        [l.a, l.b],
        [l.b, l.a],
      ]) {
        if (!own.has(m) || own.has(o)) continue;
        outside.set(m, (outside.get(m) ?? 0) + w);
        const cur = anchor.get(o);
        if (!cur || w / maxW > cur.s ** 2) anchor.set(o, { id: m, s: Math.sqrt(w / maxW) });
      }
    }
    const targets = new Map<string, { x: number; y: number }>();

    // ---- own accounts: groups by service, the quiet ones in the middle, the busy ones on the rim ----
    const groupOf = (id: string) => {
      const a = ix.accounts.get(id);
      return a?.serviceId ? `s:${a.serviceId}` : `f:${a?.form ?? ''}`;
    };
    const groups = new Map<string, string[]>();
    for (const id of own) groups.set(groupOf(id), [...(groups.get(groupOf(id)) ?? []), id]);
    const act = (g: string[]) => g.reduce((sum, id) => sum + (outside.get(id) ?? 0), 0);
    const list = [...groups.values()].sort((p, q) => act(p) - act(q) || p.length - q.length);
    const maxAct = Math.max(0, ...list.map(act));
    // the middle: groups with nothing (or very little) outside; the busiest one is always on the rim.
    // No business outside at all: no middle, the groups simply go round
    const core = maxAct > 0 ? list.filter((g) => act(g) <= maxAct * 0.12) : [];
    const rim = list.filter((g) => !core.includes(g));

    // a group's own little cluster: the quiet accounts first (inwards), the busy ones last (outwards)
    const byQuiet = (g: string[]) => [...g].sort((p, q) => (outside.get(p) ?? 0) - (outside.get(q) ?? 0));
    let coreR = 0;
    if (core.length === 1) {
      const offs = pack(core[0].length, OWN_GAP);
      byQuiet(core[0]).forEach((id, i) => targets.set(id, offs[i]));
      coreR = packRadius(core[0].length, OWN_GAP);
    } else if (core.length > 1) {
      // several quiet groups: their clusters round the middle, touching
      const radii = core.map((g) => packRadius(g.length, OWN_GAP));
      const ringR = Math.max(...radii) + 10 + radii.reduce((sum, r) => sum + 2 * r + GROUP_GAP, 0) / (2 * Math.PI);
      let ang = -Math.PI / 2;
      const total = radii.reduce((sum, r) => sum + 2 * r + GROUP_GAP, 0);
      core.forEach((g, k) => {
        const span = ((2 * radii[k] + GROUP_GAP) / total) * Math.PI * 2;
        const mid = ang + span / 2;
        ang += span;
        const cx = Math.cos(mid) * ringR;
        const cy = Math.sin(mid) * ringR;
        const offs = pack(g.length, OWN_GAP);
        byQuiet(g).forEach((id, i) => targets.set(id, { x: cx + offs[i].x, y: cy + offs[i].y }));
      });
      coreR = ringR + Math.max(...radii);
    }

    // the rim: the busy groups round the middle, a heavy one next to a light one (room for their contacts)
    const sorted = [...rim].sort((p, q) => act(q) - act(p));
    const order: string[][] = [];
    while (sorted.length) {
      order.push(sorted.shift()!);
      if (sorted.length) order.push(sorted.pop()!);
    }
    const rimRadii = order.map((g) => packRadius(g.length, OWN_GAP));
    const rimTotal = rimRadii.reduce((sum, r) => sum + 2 * r + GROUP_GAP, 0);
    const maxRimR = Math.max(0, ...rimRadii);
    const R = order.length === 0 ? coreR : core.length === 0 && order.length === 1 ? 0 : Math.max(coreR + maxRimR + 70, rimTotal / (2 * Math.PI), 60);
    let ang = -Math.PI / 2;
    order.forEach((g, k) => {
      const span = ((2 * rimRadii[k] + GROUP_GAP) / Math.max(1, rimTotal)) * Math.PI * 2;
      const mid = order.length === 1 && R === 0 ? -Math.PI / 2 : ang + span / 2;
      ang += span;
      const cx = Math.cos(mid) * R;
      const cy = Math.sin(mid) * R;
      // the cluster's places, the outermost (along the ray from the middle) for the busiest accounts
      const offs = pack(g.length, OWN_GAP).sort((p, q) => p.x * Math.cos(mid) + p.y * Math.sin(mid) - (q.x * Math.cos(mid) + q.y * Math.sin(mid)));
      byQuiet(g).forEach((id, i) => targets.set(id, { x: cx + offs[i].x, y: cy + offs[i].y }));
    });
    const discR = Math.max(coreR, R + maxRimR);

    // ---- the other accounts: one cluster per contact (an account with no contact stands alone) ----
    const clusters = new Map<string, string[]>();
    for (const id of modelAll.others) {
      const c = ix.accounts.get(id)?.contactId;
      const key = c ? `c:${c}` : `a:${id}`;
      clusters.set(key, [...(clusters.get(key) ?? []), id]);
    }
    // where each cluster would like to be: across from the own accounts it deals with, by how much
    const pull = new Map<string, { x: number; y: number; w: number }>();
    const strength = new Map<string, number>();
    const clusterOf = new Map<string, string>();
    for (const [key, ids] of clusters) for (const id of ids) clusterOf.set(id, key);
    for (const l of modelAll.links) {
      const [o, m] = own.has(l.a) ? [l.b, l.a] : [l.a, l.b];
      if (own.has(o) || !own.has(m)) continue;
      const key = clusterOf.get(o)!;
      const at = targets.get(m) ?? { x: 0, y: 0 };
      const cur = pull.get(key) ?? { x: 0, y: 0, w: 0 };
      const w = weight(l);
      const len = Math.hypot(at.x, at.y);
      // a direction from the middle; an own account in the very middle gives none
      if (len > 1) pull.set(key, { x: cur.x + (at.x / len) * w, y: cur.y + (at.y / len) * w, w: cur.w + w });
      else pull.set(key, { ...cur, w: cur.w + w });
      strength.set(o, (strength.get(o) ?? 0) + w);
    }
    const keys = [...clusters.keys()].sort((p, q) => (pull.get(q)?.w ?? 0) - (pull.get(p)?.w ?? 0));
    const undirected = keys.filter((k) => {
      const v = pull.get(k);
      return !v || Math.hypot(v.x, v.y) < 1e-6;
    });
    const wanted = new Map<string, number>();
    for (const k of keys) {
      const v = pull.get(k);
      if (v && Math.hypot(v.x, v.y) >= 1e-6) wanted.set(k, Math.atan2(v.y, v.x));
    }
    // the ones with no direction (all around a single account in the middle): spread evenly
    undirected.forEach((k, i) => wanted.set(k, -Math.PI / 2 + (i / Math.max(1, undirected.length)) * Math.PI * 2));
    const cr = new Map(keys.map((k) => [k, packRadius(clusters.get(k)!.length, OTHER_GAP)]));
    // each cluster on a circle beyond the disc (a bigger cluster a bit further out), then parted
    // along it so none overlaps its neighbours; too many for one round: the circle grows
    let out = discR + RAY;
    const angles = new Map(wanted);
    for (let round = 0; round < 6; round++) {
      const half = (k: string) => (cr.get(k)! + CLUSTER_GAP / 2) / (out + cr.get(k)!);
      const need = keys.reduce((sum, k) => sum + 2 * half(k), 0);
      if (need > Math.PI * 2 * 0.98) {
        out *= (need / (Math.PI * 2)) * 1.05;
        continue;
      }
      // relax: neighbours closer than their half-widths push each other apart (kept in order)
      const ring = [...keys].sort((p, q) => angles.get(p)! - angles.get(q)!);
      for (let it = 0; it < 200 && ring.length > 1; it++) {
        let moved = false;
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i];
          const q = ring[(i + 1) % ring.length];
          let gap = angles.get(q)! - angles.get(p)!;
          if (i === ring.length - 1) gap += Math.PI * 2;
          const min = half(p) + half(q);
          if (gap < min) {
            const d = (min - gap) / 2 + 1e-4;
            angles.set(p, angles.get(p)! - d);
            angles.set(q, angles.get(q)! + d);
            moved = true;
          }
        }
        if (!moved) break;
      }
      break;
    }
    for (const k of keys) {
      const ids = clusters.get(k)!;
      const a = angles.get(k)!;
      const r = out + cr.get(k)!;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      // inside the cluster the accounts it deals with most face the disc
      const offs = pack(ids.length, OTHER_GAP).sort((p, q) => p.x * Math.cos(a) + p.y * Math.sin(a) - (q.x * Math.cos(a) + q.y * Math.sin(a)));
      [...ids].sort((p, q) => (strength.get(q) ?? 0) - (strength.get(p) ?? 0)).forEach((id, i) => targets.set(id, { x: cx + offs[i].x, y: cy + offs[i].y }));
    }
    for (const id of modelAll.others) if (!targets.has(id)) targets.set(id, { x: 0, y: 0 });
    return { maxW, anchor, targets };
  }, [fullSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const { maxW, anchor, targets } = layout;

  // what is drawn: everything by default; the user's choice hides accounts (own or other)
  const fresh = useMemo(() => {
    const ownShown = [...own].filter((id) => !isHidden(id));
    const shownLinks = model.links.filter((l) => !isHidden(l.a) && !isHidden(l.b));
    // another account left without links to the shown own ones (none in the range, say) is not drawn
    const linked = new Set(shownLinks.flatMap((l) => [l.a, l.b]));
    const othersShown = [...model.others].filter((id) => !isHidden(id) && linked.has(id));
    return { nodes: [...ownShown, ...othersShown], links: shownLinks };
  }, [own, model, isHidden]);
  // the same accounts and the same counts keep the same objects: the data being re-read from the
  // spreadsheet (or anything else re-rendering) does not stir the graph
  const sig = `${fresh.nodes.join()}#${fresh.links.map((l) => `${l.key}:${l.ab + l.ba}`).join()}`;
  const { nodes, links } = useMemo(() => fresh, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeKey = nodes.join();

  // ---- the choice (the settings panel): contacts, their accounts, assets, services ----
  // every account that has ever been linked: one with nothing in the range stays to be chosen
  const candidates = useMemo(() => [...own, ...modelAll.others], [own, modelAll]);
  const choices = useMemo(() => {
    const coll = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const ownContact = contactKey([...own][0] ?? '');
    const contactName = (c: string) => (c === NONE ? t('graph.noContact') : (ix.contacts.get(c)?.name ?? '?'));
    // contacts: this one first, then by name, "no contact" last
    const contactKeys = [...new Set(candidates.map(contactKey))].sort(
      (p, q) => Number(q === ownContact) - Number(p === ownContact) || Number(p === NONE) - Number(q === NONE) || coll.compare(contactName(p), contactName(q)),
    );
    const contacts: Choice[] = contactKeys.map((c) => {
      const ct = ix.contacts.get(c);
      // the user's own contact says so; on another contact's graph, that contact is "this contact"
      return { value: c, label: contactName(c), icon: ct ? <Avatar image={ct.image} name={ct.name} size={20} /> : <Icon name="users" size={18} />, badge: ct?.isSelf ? t('contacts.me') : c === ownContact ? t('graph.ownBadge') : undefined };
    });
    // accounts, under their contacts (in the same order)
    const accounts: Choice[] = [...candidates]
      .sort((p, q) => contactKeys.indexOf(contactKey(p)) - contactKeys.indexOf(contactKey(q)) || coll.compare(ix.accounts.get(p)?.name ?? '', ix.accounts.get(q)?.name ?? ''))
      .map((id) => {
        const a = ix.accounts.get(id)!;
        return { value: id, label: a.name, group: contactKey(id), groupLabel: contactName(contactKey(id)), icon: <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={20} /> };
      });
    const assets: Choice[] = data.assets.filter((x) => modelAll.assets.has(x.id)).map((x) => ({ value: x.id, label: x.code, icon: <AssetIcon asset={x} size={18} /> }));
    const serviceKeys = [...new Set(candidates.map(serviceKey))].sort((p, q) => Number(p === NONE) - Number(q === NONE) || coll.compare(ix.services.get(p)?.name ?? '', ix.services.get(q)?.name ?? ''));
    const services: Choice[] = serviceKeys.map((k) => {
      const sv = ix.services.get(k);
      return { value: k, label: sv?.name ?? t('graph.noService'), icon: sv ? <Avatar image={sv.image} name={sv.name} size={20} /> : <Icon name="cash" size={18} /> };
    });
    return { contacts, accounts, assets, services };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, own, ix, data.assets, modelAll, t, locale]);
  // a contact left out takes its accounts out of the accounts' list as well (and brings them back)
  const accountChoices = choices.accounts.filter((o) => !cfg.hiddenContacts.includes(o.group!));
  const activeFilters =
    Number(cfg.hiddenContacts.length > 0) +
    Number(cfg.hiddenAccounts.some((id) => candidates.includes(id))) +
    Number(cfg.hiddenAssets.length > 0) +
    Number(cfg.hiddenServices.length > 0) +
    Number(!!(cfg.from || cfg.to));
  const resetFilters = () => setCfg((c) => ({ ...c, hiddenAccounts: [], hiddenContacts: [], hiddenAssets: [], hiddenServices: [], from: '', to: '' }));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const periodText = `${cfg.from ? i18n.dateTime(Date.parse(cfg.from)) : '…'} – ${cfg.to ? i18n.dateTime(Date.parse(cfg.to)) : '…'}`;

  // ---- the world: bodies, the view (pan and zoom) ----
  const box = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 460 });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const [storedView, setStoredView] = useViewState<{ x: number; y: number; k: number } | null>(`${stateKey}.graph.view`, null);
  const view = useRef(storedView ?? { x: 0, y: 0, k: 1 });
  // the first settling fits everything in, unless the user has already looked around
  const autoFit = useRef(storedView === null);

  const bodies = useRef(new Map<string, Body>());
  const alpha = useRef(1);
  const nodeEls = useRef(new Map<string, HTMLDivElement>());
  const linkEls = useRef(new Map<string, SVGLineElement>());
  const tip = useRef<HTMLDivElement>(null);

  // an account's place: its place in the sun, moved where the user dragged it; the other accounts
  // also move with the own account they hang off, so a dragged account takes its rays along
  const shifts = (() => {
    let m = shifted.get(stateKey);
    if (!m) shifted.set(stateKey, (m = new Map()));
    return m;
  })();
  const placeOf = (id: string) => {
    const base = targets.get(id) ?? { x: 0, y: 0 };
    const own_ = shifts.get(id);
    const a = anchor.get(id);
    const up = a ? shifts.get(a.id) : undefined;
    return { x: base.x + (own_?.x ?? 0) + (up?.x ?? 0), y: base.y + (own_?.y ?? 0) + (up?.y ?? 0) };
  };

  // where a new body starts: its place in the sun (or where it was, when coming back)
  const placeAll = (map: Map<string, Body>, keep: boolean) => {
    const memory = placed.get(stateKey) ?? new Map();
    placed.set(stateKey, memory);
    for (const id of [...map.keys()]) if (!nodes.includes(id)) map.delete(id);
    let added = 0;
    for (const id of nodes) {
      if (map.has(id)) continue;
      added++;
      const at = (keep ? memory.get(id) : undefined) ?? placeOf(id);
      map.set(id, { x: at.x, y: at.y, vx: 0, vy: 0, fixed: false });
    }
    return added;
  };

  // new accounts get their place, gone ones leave; the physics wakes only when something changed
  useLayoutEffect(() => {
    const first = bodies.current.size === 0;
    const added = placeAll(bodies.current, true);
    // the first layout settles in; showing or hiding accounts later only nudges the rest
    alpha.current = Math.max(alpha.current, first && added ? 1 : 0.08);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // back to the default: the sun laid out afresh and fitted in once it settles
  const resetView = () => {
    placed.get(stateKey)?.clear();
    shifts.clear();
    bodies.current.clear();
    placeAll(bodies.current, false);
    // settle it right away (out of sight, a few hundred quick steps), then fit the view once:
    // the zoom and the centring are the default ones at once, with no second adjustment
    alpha.current = 1;
    for (let i = 0; i < 600 && alpha.current > ALPHA_MIN; i++) {
      const speed = stepRef.current();
      alpha.current *= ALPHA_DECAY;
      if (alpha.current < 0.1 && speed < REST_SPEED) alpha.current = 0;
    }
    alpha.current = 0;
    const memory = placed.get(stateKey);
    if (memory) for (const [id, b] of bodies.current) memory.set(id, { x: b.x, y: b.y });
    autoFit.current = false;
    fitRef.current();
  };

  // ---- hover / pinned account: its links and neighbours stand out, the card shows it ----
  const [focus, setFocus] = useState<{ id: string; pinned: boolean } | null>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const neighbours = useMemo(() => {
    if (!focus) return null;
    const n = new Set([focus.id]);
    for (const l of links) if (l.a === focus.id || l.b === focus.id) n.add(l.a === focus.id ? l.b : l.a);
    return n;
  }, [focus, links]);
  // the dots keep to the focused account's links too
  const focusRef = useRef<Set<string> | null>(null);
  focusRef.current = neighbours;
  useEffect(() => {
    if (focus && !nodes.includes(focus.id)) setFocus(null);
  }, [focus, nodeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- applying positions and the view to the page (every frame, without re-rendering) ----
  const apply = () => {
    const v = view.current;
    if (world.current) world.current.style.transform = `translate(${size.w / 2 + v.x}px, ${size.h / 2 + v.y}px) scale(${v.k})`;
    box.current?.classList.toggle('ag-far', v.k < 0.55);
    for (const [id, el] of nodeEls.current) {
      const b = bodies.current.get(id);
      if (b) el.style.transform = `translate(${b.x}px, ${b.y}px)`;
    }
    for (const l of links) {
      const el = linkEls.current.get(l.key);
      const p = bodies.current.get(l.a);
      const q = bodies.current.get(l.b);
      if (!el || !p || !q) continue;
      el.setAttribute('x1', p.x.toFixed(1));
      el.setAttribute('y1', p.y.toFixed(1));
      el.setAttribute('x2', q.x.toFixed(1));
      el.setAttribute('y2', q.y.toFixed(1));
    }
    // the card follows its account, inside the box
    const card = tip.current;
    const fb = focus ? bodies.current.get(focus.id) : undefined;
    if (card && fb) {
      const sx = size.w / 2 + v.x + fb.x * v.k;
      const sy = size.h / 2 + v.y + fb.y * v.k;
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const gap = 26 * v.k + 10;
      let left = sx + gap;
      if (left + w > size.w - 6) left = sx - gap - w;
      left = Math.max(6, Math.min(size.w - w - 6, left));
      const top = Math.max(6, Math.min(size.h - h - 6, sy - h / 2));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
    }
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // ---- the physics ----
  const step = () => {
    const map = bodies.current;
    const list = [...map.entries()];
    const a = alpha.current;
    let speed = 0;
    const fx = new Map<string, { x: number; y: number }>(list.map(([id]) => [id, { x: 0, y: 0 }]));
    // every two accounts push each other away (own ones a bit more: they hold the middle)
    for (let i = 0; i < list.length; i++) {
      const [ida, p] = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const [idb, q] = list[j];
        let dx = q.x - p.x;
        let dy = q.y - p.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          // on top of each other: part them along a fixed direction (no randomness, no trembling)
          dx = i - j;
          dy = 1;
          d2 = dx * dx + 1;
        }
        const d = Math.sqrt(d2);
        const charge = (own.has(ida) ? 1.5 : 1) * (own.has(idb) ? 1.5 : 1);
        const f = (REPEL * charge) / Math.max(d2, 400);
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        fx.get(ida)!.x -= ux;
        fx.get(ida)!.y -= uy;
        fx.get(idb)!.x += ux;
        fx.get(idb)!.y += uy;
      }
    }
    // links pull: the more transactions, the stronger and the shorter
    for (const l of links) {
      const p = map.get(l.a);
      const q = map.get(l.b);
      if (!p || !q) continue;
      const s = Math.sqrt((l.ab + l.ba) / maxW);
      const rest = 160 - 60 * s;
      const k = (0.01 + 0.03 * s) * (own.has(l.a) && own.has(l.b) ? 1 : OTHER_LINK);
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const f = k * (d - rest);
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      fx.get(l.a)!.x += ux;
      fx.get(l.a)!.y += uy;
      fx.get(l.b)!.x -= ux;
      fx.get(l.b)!.y -= uy;
    }
    for (const [id, b] of list) {
      if (b.fixed) {
        b.vx = 0;
        b.vy = 0;
        continue;
      }
      const f = fx.get(id)!;
      // every account is pulled to its place in the sun (own ones harder: they hold the shape)
      const at = placeOf(id);
      {
        // an account put somewhere by hand holds that spot firmly
        const k = shifts.has(id) ? PLACED_PULL : own.has(id) ? OWN_PULL : RAY_PULL;
        f.x += (at.x - b.x) * k;
        f.y += (at.y - b.y) * k;
      }
      b.vx = (b.vx + f.x * a) * DAMPING;
      b.vy = (b.vy + f.y * a) * DAMPING;
      b.x += b.vx;
      b.y += b.vy;
      speed = Math.max(speed, Math.abs(b.vx), Math.abs(b.vy));
    }
    return speed;
  };

  const stepRef = useRef(step);
  stepRef.current = step;

  /** Fits everything in view; false when it cannot be done yet (no accounts, or a hidden tab) */
  const fit = (animate = false): boolean => {
    const list = [...bodies.current.values()];
    // in a tab that is not shown the box has no size: fit once it is shown
    if (!list.length || !box.current?.clientWidth) return false;
    const xs = list.map((b) => b.x);
    const ys = list.map((b) => b.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = 40;
    // the legend sits at the bottom: keep the graph above it
    const below = (box.current?.querySelector<HTMLElement>('.ag-legend')?.offsetHeight ?? 0) + 8;
    const h = size.h - pad * 2 - below;
    const k = Math.max(ZOOM_MIN, Math.min(1.6, (size.w - pad * 2) / Math.max(1, x1 - x0), h / Math.max(1, y1 - y0)));
    view.current = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k - below / 2 };
    if (!animate) applyRef.current();
    setStoredView(view.current);
    return true;
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // ---- the transactions running along the links ----
  // each direction of each link sends dots as often as it had transactions, next to the busiest one
  const flows = useMemo(() => {
    const list = links.flatMap((l) => [
      { key: l.key, from: l.a, to: l.b, n: l.ab },
      { key: l.key, from: l.b, to: l.a, n: l.ba },
    ]);
    // next to the busiest direction of all (not only the shown ones): filters change no rates
    const max = Math.max(1, ...modelAll.links.flatMap((l) => [l.ab, l.ba]));
    return list.filter((f) => f.n > 0).map((f) => ({ ...f, rate: DOT_RATE_MIN + (DOT_RATE_MAX - DOT_RATE_MIN) * (f.n / max) }));
  }, [links, modelAll]);
  const dotsG = useRef<SVGGElement>(null);
  const dots = useRef<Dot[]>([]);
  const dueIn = useRef(new Map<string, number>());
  // not on screen, a hidden tab, or "reduce motion": no dots
  const onScreen = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => (onScreen.current = e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const calm = useMemo(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches, []);

  const runDots = (dt: number) => {
    const g = dotsG.current;
    if (!g) return;
    const list = dots.current;
    // the motion turned off: nothing runs (the ones under way are dropped)
    if (!cfg.motion) list.length = 0;
    if (!calm && cfg.motion) {
      // new ones: at random-ish intervals around each direction's rate
      for (const f of flows) {
        const id = `${f.from}>${f.to}`;
        let left = (dueIn.current.get(id) ?? Math.random() / f.rate) - dt;
        while (left <= 0) {
          const p = bodies.current.get(f.from);
          const q = bodies.current.get(f.to);
          const len = p && q ? Math.hypot(q.x - p.x, q.y - p.y) : 100;
          list.push({ key: f.key, from: f.from, to: f.to, t: Math.min(1, -left / Math.max(0.5, len / DOT_SPEED)), dur: Math.max(0.5, Math.min(4, len / DOT_SPEED)) });
          left += (0.5 + Math.random()) / f.rate;
        }
        dueIn.current.set(id, left);
      }
    }
    // move them; the arrived ones go
    let n = 0;
    for (const d of list) {
      d.t += dt / d.dur;
      if (d.t < 1) list[n++] = d;
    }
    list.length = n;
    // draw: a pool of circles, as many as needed
    const focusOn = focusRef.current;
    let i = 0;
    for (const d of list) {
      if (focusOn && !(focusOn.has(d.from) && focusOn.has(d.to))) continue;
      const p = bodies.current.get(d.from);
      const q = bodies.current.get(d.to);
      if (!p || !q) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      // right on the link's centre line, both ways: a dot, or an arrow pointing the way it goes
      const shape = cfg.cursor === 'arrow' ? 'path' : 'circle';
      let el = g.children[i] as SVGElement | undefined;
      if (el && el.tagName !== shape) {
        const next = document.createElementNS('http://www.w3.org/2000/svg', shape);
        g.replaceChild(next, el);
        el = next;
      }
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', shape);
        g.appendChild(el);
      }
      const kind = own.has(d.from) ? 'own' : 'other';
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.setAttribute('class', `${shape === 'path' ? 'ag-arrow' : 'ag-dot'} ${kind}`);
        if (shape === 'path') el.setAttribute('d', kind === 'own' ? 'M-5.5,-4.4 L5.5,0 L-5.5,4.4 Z' : 'M-4.6,-3.7 L4.6,0 L-4.6,3.7 Z');
        else el.setAttribute('r', kind === 'own' ? '4.2' : '3.4');
      }
      el.style.display = '';
      const x = (p.x + dx * d.t).toFixed(1);
      const y = (p.y + dy * d.t).toFixed(1);
      if (shape === 'path') el.setAttribute('transform', `translate(${x} ${y}) rotate(${((Math.atan2(dy, dx) * 180) / Math.PI).toFixed(1)})`);
      else {
        el.setAttribute('cx', x);
        el.setAttribute('cy', y);
      }
      i++;
    }
    for (; i < g.children.length; i++) (g.children[i] as SVGElement).style.display = 'none';
  };
  const runDotsRef = useRef(runDots);
  runDotsRef.current = runDots;

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      // a long pause (another tab) does not send a burst of dots
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (onScreen.current && !document.hidden) runDotsRef.current(dt);
      const dragging = [...bodies.current.values()].some((b) => b.fixed);
      if (alpha.current > ALPHA_MIN || dragging) {
        const speed = step();
        alpha.current = dragging ? Math.max(alpha.current, 0.25) : alpha.current * ALPHA_DECAY;
        // settled: stop for good (nothing keeps creeping)
        if (!dragging && alpha.current < 0.1 && speed < REST_SPEED) alpha.current = 0;
        // once it has mostly settled, the first time: everything in view
        if (autoFit.current && alpha.current < 0.08 && fitRef.current()) autoFit.current = false;
        // remember where things are for the next visit
        const memory = placed.get(stateKey);
        if (memory) for (const [id, b] of bodies.current) memory.set(id, { x: b.x, y: b.y });
        applyRef.current();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, own, stateKey, targets]);
  // settled while its tab was hidden: fit it in as soon as it gets a size
  useEffect(() => {
    if (autoFit.current && alpha.current < 0.08 && fitRef.current()) autoFit.current = false;
  }, [size]);
  // after every render (focus, size, new nodes): put things where they are
  useLayoutEffect(() => applyRef.current());

  // ---- the pointer: drag an account, pan the background, pinch / wheel to zoom ----
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'node' | 'pan' | 'pinch'; id?: string; x: number; y: number; moved: boolean; dist?: number; k?: number; vx?: number; vy?: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toWorld = (p: { x: number; y: number }) => {
    const v = view.current;
    return { x: (p.x - size.w / 2 - v.x) / v.k, y: (p.y - size.h / 2 - v.y) / v.k };
  };
  const zoomAt = (p: { x: number; y: number }, k: number) => {
    const nk = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, k));
    const w = toWorld(p);
    view.current = { k: nk, x: p.x - size.w / 2 - w.x * nk, y: p.y - size.h / 2 - w.y * nk };
    autoFit.current = false;
    applyRef.current();
  };

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    box.current!.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      // two fingers: zoom
      const [a, b] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k };
      return;
    }
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-node]')?.dataset.node;
    if (id) {
      const b = bodies.current.get(id);
      if (b) b.fixed = true;
      gesture.current = { kind: 'node', id, x: p.x, y: p.y, moved: false };
    } else {
      gesture.current = { kind: 'pan', x: p.x, y: p.y, moved: false, vx: view.current.x, vy: view.current.y };
    }
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = local(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      zoomAt({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, g.k! * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist!));
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.x, p.y - g.y) > 4) g.moved = true;
    if (!g.moved) return;
    if (g.kind === 'node') {
      const b = bodies.current.get(g.id!);
      if (!b) return;
      const w = toWorld(p);
      b.x = w.x;
      b.y = w.y;
      // its place moves with it: dropped, it stays there (and an own account's rays follow it)
      const base = targets.get(g.id!) ?? { x: 0, y: 0 };
      const a = anchor.get(g.id!);
      const up = a ? shifts.get(a.id) : undefined;
      shifts.set(g.id!, { x: w.x - base.x - (up?.x ?? 0), y: w.y - base.y - (up?.y ?? 0) });
      alpha.current = Math.max(alpha.current, 0.3);
      applyRef.current();
    } else if (g.kind === 'pan') {
      view.current = { ...view.current, x: g.vx! + p.x - g.x, y: g.vy! + p.y - g.y };
      autoFit.current = false;
      applyRef.current();
    }
  };
  const onUp = (e: ReactPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (pointers.current.size === 0) gesture.current = null;
      setStoredView(view.current);
      return;
    }
    gesture.current = null;
    if (g.kind === 'node') {
      const b = bodies.current.get(g.id!);
      if (b) b.fixed = false;
      // a click (no drag) opens the account's card and keeps it; a second click closes it
      if (!g.moved) {
        window.clearTimeout(hoverTimer.current);
        setFocus((f) => (f && f.id === g.id && f.pinned ? null : { id: g.id!, pinned: true }));
        setSettingsOpen(false);
        revealBeside(g.id!);
      }
    } else {
      if (!g.moved) setFocus(null);
      else setStoredView(view.current);
    }
  };

  // the wheel zooms around the pointer (the page does not scroll over the graph)
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let save = 0;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest?.('.ag-panel')) return;
      e.preventDefault();
      zoomAtRef.current(local(e), view.current.k * Math.exp(-(e.deltaY || e.deltaX) * 0.0015));
      window.clearTimeout(save);
      save = window.setTimeout(() => setStoredView(view.current), 250);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const zoomAtRef = useRef(zoomAt);
  zoomAtRef.current = zoomAt;

  // hovering an account a moment shows its card (a mouse); leaving hides it unless it was clicked
  const onNodeEnter = (id: string) => (e: ReactPointerEvent) => {
    if (e.pointerType !== 'mouse' || gesture.current) return;
    window.clearTimeout(hoverTimer.current);
    setFocus((f) => (f?.pinned ? f : { id, pinned: false }));
  };
  const onNodeLeave = () => {
    window.clearTimeout(hoverTimer.current);
    setFocus((f) => (f?.pinned ? f : null));
  };

  // the side panel covers the right part (a phone: the lower part): the clicked account moves into
  // the part left free
  const revealBeside = (id: string) => {
    const b = bodies.current.get(id);
    if (!b) return;
    const v = view.current;
    const sx = size.w / 2 + v.x + b.x * v.k;
    const sy = size.h / 2 + v.y + b.y * v.k;
    if (size.w < PANEL_BOTTOM_BELOW) {
      const free = size.h * 0.34;
      if (sy > free - 30) view.current = { ...v, y: v.y + (free / 2 - sy) };
    } else {
      const free = size.w - PANEL_W - 16;
      if (sx > free - 40) view.current = { ...v, x: v.x + (free / 2 - sx) };
    }
    autoFit.current = false;
    applyRef.current();
    setStoredView(view.current);
  };

  // ---- the hover card ----
  const card = (() => {
    if (!focus || focus.pinned || !ix.accounts.has(focus.id)) return null;
    const a = ix.accounts.get(focus.id)!;
    return (
      <div ref={tip} className="ag-card" role="dialog" aria-label={a.name} onPointerDown={(e) => e.stopPropagation()}>
        <AccountInfo id={a.id} own={own} links={links} />
      </div>
    );
  })();

  return (
    <section className="panel ag">
      <div className="bh-head">
        <h2>{t('graph.title')}</h2>
        <div className="bh-tools chart-tools">
          {/* the view's settings and filters, in a panel on the right */}
          <button
            type="button"
            className={`btn btn-sm ${settingsOpen ? 'btn-active' : ''}`}
            onClick={() => {
              setSettingsOpen(!settingsOpen);
              setFocus(null);
            }}
            aria-expanded={settingsOpen}
          >
            <Icon name="settings" size={15} />
            {t('graph.settings')}
            {activeFilters > 0 && <span className="badge badge-accent">{num(activeFilters)}</span>}
          </button>
        </div>
      </div>

      <div
        ref={box}
        className={`ag-box ${neighbours ? 'ag-focus' : ''}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="img"
        aria-label={t('graph.title')}
      >
        <div ref={world} className="ag-world">
          <svg className="ag-links" width="1" height="1" aria-hidden="true">
            {links.map((l) => {
              const s = Math.sqrt((l.ab + l.ba) / maxW);
              const inner = own.has(l.a) && own.has(l.b);
              const on = neighbours && neighbours.has(l.a) && neighbours.has(l.b) && (l.a === focus!.id || l.b === focus!.id);
              const na = ix.accounts.get(l.a)?.name ?? '?';
              const nb = ix.accounts.get(l.b)?.name ?? '?';
              return (
                <line
                  key={l.key}
                  ref={(el) => {
                    if (el) linkEls.current.set(l.key, el);
                    else linkEls.current.delete(l.key);
                  }}
                  className={`ag-link ${inner ? 'inner' : ''} ${on ? 'on' : ''}`}
                  strokeWidth={1 + 5 * s}
                  strokeOpacity={on ? 1 : 0.25 + 0.6 * s}
                >
                  <title>{`${na} → ${nb}: ${num(l.ab)} · ${nb} → ${na}: ${num(l.ba)}`}</title>
                </line>
              );
            })}
            {/* transactions running along the links (drawn every frame) */}
            <g ref={dotsG} className="ag-dots" />
          </svg>
          {nodes.map((id) => {
            const a = ix.accounts.get(id)!;
            const mine = own.has(id);
            const owner = a.contactId ? ix.contacts.get(a.contactId) : undefined;
            const on = !neighbours || neighbours.has(id);
            return (
              <div
                key={id}
                ref={(el) => {
                  if (el) nodeEls.current.set(id, el);
                  else nodeEls.current.delete(id);
                }}
                data-node={id}
                className={`ag-node ${mine ? 'own' : ''} ${on ? '' : 'dim'} ${focus?.id === id ? 'focused' : ''}`}
                onPointerEnter={onNodeEnter(id)}
                onPointerLeave={onNodeLeave}
              >
                <span className="ag-node-pic">
                  <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={mine ? 36 : 26} />
                  {/* whose it is: the owner's picture in the corner, "?" without one */}
                  <span className={`ag-node-owner ${owner ? '' : 'none'}`} title={owner?.name ?? t('graph.noContact')}>
                    {owner ? <Avatar image={owner.image} name={owner.name} size={mine ? 18 : 14} /> : '?'}
                  </span>
                </span>
                <span className="ag-node-label">{a.name}</span>
              </div>
            );
          })}
        </div>
        {nodes.length === 0 && <p className="bh-empty muted">{t('graph.empty')}</p>}
        <div className="ag-legend" aria-hidden="true">
          <span>
            <span className="ag-legend-own" />
            {t('graph.legendOwn')}
          </span>
          <span>
            <span className="ag-legend-other" />
            {t('graph.legendOther')}
          </span>
          <span>
            <span className="ag-legend-link" />
            {t('graph.legendLink')}
          </span>
          {cfg.motion && !calm && (
            <>
              <span>
                <span className={cfg.cursor === 'dot' ? 'ag-legend-dot own' : 'ag-legend-arrow own'} />
                {t('graph.legendDotOwn')}
              </span>
              <span>
                <span className={cfg.cursor === 'dot' ? 'ag-legend-dot other' : 'ag-legend-arrow other'} />
                {t('graph.legendDotOther')}
              </span>
            </>
          )}
        </div>
        {card}
        {focus?.pinned && <TxPanel key={focus.id} id={focus.id} links={links} own={own} onClose={() => setFocus(null)} />}
        {settingsOpen && (
          <aside className="ag-panel ag-settings" aria-label={t('graph.settings')} onPointerDown={(e) => e.stopPropagation()}>
            <div className="ag-settings-head">
              <h3>{t('graph.settings')}</h3>
              <button type="button" className="icon-btn" onClick={() => setSettingsOpen(false)} aria-label={t('common.close')} title={t('common.close')}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <div className="ag-settings-body">
              <section className="ag-settings-sec ag-settings-look">
                <div className="ag-settings-sec-head">
                  <h4>{t('graph.look')}</h4>
                </div>
                <button type="button" className="btn btn-primary ag-settings-reset-view" onClick={resetView} title={t('graph.resetHint')}>
                  <Icon name="graph" size={18} />
                  {t('graph.reset')}
                </button>
                <Switch checked={cfg.motion} onChange={(motion) => setCfg((c) => ({ ...c, motion }))} label={t('graph.motion')} />
                {cfg.motion && calm && <p className="muted small">{t('graph.motionCalm')}</p>}
                {/* what runs along the links: two buttons, each showing its cursor */}
                <div className={`ag-cursor ${cfg.motion ? '' : 'off'}`}>
                  <span className="ag-cursor-title">{t('graph.cursor')}</span>
                  <div className="ag-cursor-btns" role="radiogroup" aria-label={t('graph.cursor')}>
                    {(['dot', 'arrow'] as const).map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={cfg.cursor === k}
                        aria-label={k === 'dot' ? t('graph.cursorDot') : t('graph.cursorArrow')}
                        title={k === 'dot' ? t('graph.cursorDot') : t('graph.cursorArrow')}
                        className={`ag-cursor-opt ${cfg.cursor === k ? 'chosen' : ''}`}
                        onClick={() => setCfg((c) => ({ ...c, cursor: k }))}
                        disabled={!cfg.motion}
                      >
                        <svg viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true">
                          {/* the arrow on a slant, pointing up and to the right */}
                          {k === 'dot' ? <circle r="4.6" className="ag-dot own" /> : <path d="M-5.5,-4.6 L5.5,0 L-5.5,4.6 Z" transform="rotate(-45)" className="ag-arrow own" />}
                        </svg>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="ag-settings-sec">
                <div className="ag-settings-sec-head">
                  <h4>{t('graph.filters')}</h4>
                  {activeFilters > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters}>
                      {t('filter.reset')}
                    </button>
                  )}
                </div>
                <Fold title={t('graph.period')} summary={cfg.from || cfg.to ? periodText : t('filter.all')} active={!!(cfg.from || cfg.to)}>
                  <div className="ag-period">
                    <DateTimeField value={cfg.from} onChange={(v) => setCfg((c) => ({ ...c, from: v }))} placeholder={t('filter.min')} defaultTime="00:00" ariaLabel={`${t('graph.period')}, ${t('filter.min')}`} />
                    <DateTimeField value={cfg.to} onChange={(v) => setCfg((c) => ({ ...c, to: v }))} placeholder={t('filter.max')} defaultTime="23:59" ariaLabel={`${t('graph.period')}, ${t('filter.max')}`} />
                  </div>
                </Fold>
                <CheckList title={t('graph.contacts')} options={choices.contacts} hidden={cfg.hiddenContacts} onChange={(h) => setCfg((c) => ({ ...c, hiddenContacts: h }))} />
                <CheckList title={t('graph.accounts')} options={accountChoices} hidden={cfg.hiddenAccounts} onChange={(h) => setCfg((c) => ({ ...c, hiddenAccounts: h }))} />
                <CheckList title={t('filter.asset')} options={choices.assets} hidden={cfg.hiddenAssets} onChange={(h) => setCfg((c) => ({ ...c, hiddenAssets: h }))} />
                <CheckList title={t('filter.service')} options={choices.services} hidden={cfg.hiddenServices} onChange={(h) => setCfg((c) => ({ ...c, hiddenServices: h }))} />
              </section>
            </div>
          </aside>
        )}
      </div>
    </section>
  );
}

/** One choice in the settings' lists; `group` puts it under a heading (`groupLabel`). */
interface Choice {
  value: string;
  label: string;
  icon?: ReactNode;
  badge?: string;
  group?: string;
  groupLabel?: string;
}

/**
 * A list of what is shown, as checkboxes (in the settings panel, in its flow: nothing floats out of
 * it): unchecked = left out. `hidden` may hold values not offered here (kept as they are).
 */
function CheckList({ title, options, hidden, onChange }: { title: string; options: Choice[]; hidden: string[]; onChange: (hidden: string[]) => void }) {
  const { t, num } = useI18n();
  const [q, setQ] = useState('');
  const off = new Set(hidden);
  const values = options.map((o) => o.value);
  const shown = values.filter((v) => !off.has(v)).length;
  const found = options.filter((o) => matchesAny(q, o.label, o.groupLabel));
  // the values not offered here stay as they were
  const others = hidden.filter((v) => !values.includes(v));
  const setAll = (on: boolean) => onChange(on ? others : [...others, ...values]);
  const toggle = (v: string) => onChange(off.has(v) ? hidden.filter((x) => x !== v) : [...hidden, v]);
  let lastGroup: string | undefined;
  return (
    <Fold
      title={title}
      summary={shown === options.length ? t('filter.all') : `${num(shown)} / ${num(options.length)}`}
      active={shown < options.length}
      extra={
        options.length > 1 && (
          <button type="button" className="ag-check-all" onClick={() => setAll(shown < options.length)}>
            {shown < options.length ? t('graph.checkAll') : t('graph.checkNone')}
          </button>
        )
      }
    >
      {options.length > 8 && <SearchField value={q} onChange={setQ} placeholder={t('filter.search')} />}
      <div className="ag-check-list">
        {options.length === 0 && <p className="muted small">{t('graph.nothingToChoose')}</p>}
        {found.map((o) => {
          const head = o.group !== undefined && o.group !== lastGroup ? o.groupLabel : null;
          lastGroup = o.group;
          return (
            <div key={o.value}>
              {head && <div className="multiselect-group">{head}</div>}
              <label className="multiselect-item">
                <input type="checkbox" checked={!off.has(o.value)} onChange={() => toggle(o.value)} />
                {o.icon}
                <span className="ellipsis">{o.label}</span>
                {o.badge && <span className="badge badge-accent">{o.badge}</span>}
              </label>
            </div>
          );
        })}
      </div>
    </Fold>
  );
}

/**
 * One filter of the settings panel, folded by default: its name and what it is set to on a header
 * that opens it; `active` marks a filter that leaves something out.
 */
function Fold({ title, summary, active, extra, children }: { title: string; summary: string; active?: boolean; extra?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`ag-check ag-fold ${open ? 'open' : ''}`}>
      <div className="ag-check-head">
        <button type="button" className="ag-fold-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Icon name="chevronRight" size={15} className="ag-fold-chevron" />
          <span>{title}</span>
          <span className={active ? 'ag-fold-sum active' : 'ag-fold-sum muted'}>{summary}</span>
        </button>
        {open && extra}
      </div>
      {open && children}
    </div>
  );
}
