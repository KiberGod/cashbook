import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { getIndex } from '../lib/stats';
import type { Account } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store/store';
import { AccountIcon, AssetAmounts, Avatar, ContactChip, MultiSelect, type Option } from './bits';
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
}

interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** held by the pointer */
  fixed: boolean;
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
const RAY_PULL = 0.045;
const PLACED_PULL = 0.25;
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

/** how far the rays reach beyond the ring */
const RAY = 125;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4;

/** where the bodies were, per graph: coming back to the tab does not shuffle them */
const placed = new Map<string, Map<string, { x: number; y: number }>>();
/** where the user has moved accounts to, per graph: a shift of their place in the sun */
const shifted = new Map<string, Map<string, { x: number; y: number }>>();

export function AccountsGraph({ accounts, stateKey }: { accounts: Account[]; stateKey: string }) {
  const i18n = useI18n();
  const { t, num, locale } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const ownKey = accounts.map((a) => a.id).join();
  const own = useMemo(() => new Set(accounts.map((a) => a.id)), [ownKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // every link that touches an own account; each transaction counted once
  const model = useMemo(() => {
    const links = new Map<string, Link & { txs: Set<string> }>();
    for (const a of own) {
      for (const x of ix.account.get(a)?.txs ?? []) {
        if (!x.fromId || !x.toId || x.fromId === x.toId) continue;
        if (!ix.accounts.has(x.fromId) || !ix.accounts.has(x.toId)) continue;
        const [p, q] = x.fromId < x.toId ? [x.fromId, x.toId] : [x.toId, x.fromId];
        const key = `${p}|${q}`;
        let l = links.get(key);
        if (!l) {
          l = { key, a: p, b: q, ab: 0, ba: 0, txs: new Set() };
          links.set(key, l);
        }
        if (l.txs.has(x.id)) continue;
        l.txs.add(x.id);
        if (x.fromId === p) l.ab++;
        else l.ba++;
      }
    }
    const others = new Set<string>();
    for (const l of links.values()) for (const id of [l.a, l.b]) if (!own.has(id)) others.add(id);
    return { links: [...links.values()], others };
  }, [ix, own]);

  // what is drawn: everything by default; the user's choice hides accounts (own or other)
  const [hiddenList, setHidden] = useViewState<string[]>(`${stateKey}.graph.hidden`, []);
  const hidden = useMemo(() => new Set(hiddenList), [hiddenList]);
  // ---- the sun: where every account belongs, from all of them (hiding some moves nothing) ----
  // own accounts evenly around a ring (the biggest fans opposite each other), each one's other
  // accounts fanned out beyond it as rays (in two rows when there are many)
  const fullSig = `${[...own].join()}#${model.links.map((l) => `${l.key}:${l.ab + l.ba}`).join()}`;
  const layout = useMemo(() => {
    const maxW = Math.max(1, ...model.links.map((l) => l.ab + l.ba));
    // each other account hangs off the own one it shares the most transactions with
    const anchor = new Map<string, { id: string; s: number }>();
    for (const l of model.links) {
      const w = l.ab + l.ba;
      for (const [o, m] of [
        [l.a, l.b],
        [l.b, l.a],
      ]) {
        if (!own.has(m) || own.has(o)) continue;
        const cur = anchor.get(o);
        if (!cur || w / maxW > cur.s ** 2) anchor.set(o, { id: m, s: Math.sqrt(w / maxW) });
      }
    }
    const ownList = [...own];
    const fans = new Map<string, string[]>(ownList.map((id) => [id, []]));
    for (const id of model.others) {
      const a = anchor.get(id);
      if (a) fans.get(a.id)?.push(id);
    }
    const n = ownList.length;
    const ringR = n <= 1 ? 0 : 50 + 18 * n;
    // slots 0, n/2, n/4, 3n/4...: the biggest fans get slots far apart
    const slots: number[] = [];
    for (let step = n; slots.length < n && step >= 1; step = Math.floor(step / 2))
      for (let i = 0; i < n; i += step) if (!slots.includes(i)) slots.push(i);
    for (let i = 0; i < n; i++) if (!slots.includes(i)) slots.push(i);
    const bySize = [...ownList].sort((p, q) => fans.get(q)!.length - fans.get(p)!.length);
    const targets = new Map<string, { x: number; y: number }>();
    bySize.forEach((id, k) => {
      const ang = (slots[k] / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const ox = Math.cos(ang) * ringR;
      const oy = Math.sin(ang) * ringR;
      targets.set(id, { x: ox, y: oy });
      const fan = fans.get(id)!;
      // alone in the middle the rays go all round; on the ring they open outwards, wider with more of them
      const spread = n <= 1 ? (Math.PI * 2 * (fan.length - 1)) / Math.max(1, fan.length) : Math.min(Math.PI * 0.95, 0.3 * fan.length);
      const twoRows = fan.length > 7;
      fan.forEach((o, i) => {
        const a = fan.length > 1 ? ang - spread / 2 + (spread * i) / (fan.length - 1) : ang;
        const r = RAY + (twoRows ? (i % 2) * 55 : 0);
        targets.set(o, { x: ox + Math.cos(a) * r, y: oy + Math.sin(a) * r });
      });
    });
    for (const id of model.others) if (!targets.has(id)) targets.set(id, { x: 0, y: 0 });
    return { maxW, anchor, targets };
  }, [fullSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const { maxW, anchor, targets } = layout;

  // what is drawn: everything by default; the user's choice hides accounts (own or other)
  const fresh = useMemo(() => {
    const ownShown = [...own].filter((id) => !hidden.has(id));
    const shownLinks = model.links.filter((l) => !hidden.has(l.a) && !hidden.has(l.b));
    // another account left without links to the shown own ones is not drawn
    const linked = new Set(shownLinks.flatMap((l) => [l.a, l.b]));
    const othersShown = [...model.others].filter((id) => !hidden.has(id) && linked.has(id));
    return { nodes: [...ownShown, ...othersShown], links: shownLinks };
  }, [own, model, hidden]);
  // the same accounts and the same counts keep the same objects: the data being re-read from the
  // spreadsheet (or anything else re-rendering) does not stir the graph
  const sig = `${fresh.nodes.join()}#${fresh.links.map((l) => `${l.key}:${l.ab + l.ba}`).join()}`;
  const { nodes, links } = useMemo(() => fresh, [sig]); // eslint-disable-line react-hooks/exhaustive-deps
  const nodeKey = nodes.join();

  // ---- the choice: a tree by owner (the contact first), accounts under it ----
  const candidates = useMemo(() => [...own, ...model.others], [own, model]);
  const options = useMemo(() => {
    const ownerOf = (id: string) => ix.accounts.get(id)?.contactId ?? '';
    const contactName = (c: string) => (c ? (ix.contacts.get(c)?.name ?? '?') : t('graph.noContact'));
    const ownOwner = ownerOf([...own][0] ?? '');
    const coll = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
    const sorted = [...candidates].sort((p, q) => {
      const cp = ownerOf(p);
      const cq = ownerOf(q);
      const rank = (c: string, id: string) => (own.has(id) ? 0 : c ? 1 : 2);
      return (
        rank(cp, p) - rank(cq, q) ||
        coll.compare(contactName(cp), contactName(cq)) ||
        coll.compare(ix.accounts.get(p)?.name ?? '', ix.accounts.get(q)?.name ?? '')
      );
    });
    return sorted.map((id): Option => {
      const a = ix.accounts.get(id)!;
      const c = a.contactId ? ix.contacts.get(a.contactId) : undefined;
      const group = own.has(id) ? `own:${ownOwner}` : a.contactId || 'none';
      return {
        value: id,
        label: `${a.name} · ${c?.name ?? t('graph.noContact')}`,
        group,
        groupRender: (
          <span className="ag-opt">
            {c ? <Avatar image={c.image} name={c.name} size={20} /> : <Icon name="users" size={18} />}
            <span className="ag-opt-name">{c?.name ?? t('graph.noContact')}</span>
            {own.has(id) && <span className="badge badge-accent">{t('graph.ownBadge')}</span>}
          </span>
        ),
        depth: 1,
        render: (
          <span className="ag-opt">
            <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={20} />
            <span className="ag-opt-name">{a.name}</span>
          </span>
        ),
      };
    });
  }, [candidates, own, ix, t, locale]);
  const shownChoice = candidates.filter((id) => !hidden.has(id));

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
      const k = 0.01 + 0.03 * s;
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

  const fit = (animate = false) => {
    const list = [...bodies.current.values()];
    if (!list.length) return;
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
    // next to the busiest direction of all (not only the shown ones): hiding accounts changes no rates
    const max = Math.max(1, ...model.links.flatMap((l) => [l.ab, l.ba]));
    return list.filter((f) => f.n > 0).map((f) => ({ ...f, rate: DOT_RATE_MIN + (DOT_RATE_MAX - DOT_RATE_MIN) * (f.n / max) }));
  }, [links, model]);
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
    if (!calm) {
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
      // right on the link's centre line, both ways
      let el = g.children[i] as SVGCircleElement | undefined;
      if (!el) {
        el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        g.appendChild(el);
      }
      const kind = own.has(d.from) ? 'own' : 'other';
      if (el.dataset.kind !== kind) {
        el.dataset.kind = kind;
        el.setAttribute('class', `ag-dot ${kind}`);
        el.setAttribute('r', kind === 'own' ? '4.2' : '3.4');
      }
      el.style.display = '';
      el.setAttribute('cx', (p.x + dx * d.t).toFixed(1));
      el.setAttribute('cy', (p.y + dy * d.t).toFixed(1));
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
        if (autoFit.current && alpha.current < 0.08) {
          autoFit.current = false;
          fitRef.current();
        }
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

  // ---- the card ----
  const card = (() => {
    if (!focus) return null;
    const a = ix.accounts.get(focus.id);
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
      <div ref={tip} className={`ag-card ${focus.pinned ? 'pinned' : ''}`} role="dialog" aria-label={a.name} onPointerDown={(e) => e.stopPropagation()}>
        <div className="ag-card-head">
          <AccountIcon account={a} service={service} size={30} />
          <span className="ag-card-title">
            <a href={href.detail('accounts', a.id)}>{a.name}</a>
            <span className="muted small">
              {t(`form.${a.form}`)}
              {service ? ` · ${service.name}` : ''}
            </span>
          </span>
          {focus.pinned && (
            <button type="button" className="icon-btn ag-card-close" onClick={() => setFocus(null)} aria-label={t('common.close')}>
              <Icon name="close" size={14} />
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
      </div>
    );
  })();

  return (
    <section className="panel ag">
      <div className="bh-head">
        <h2>{t('graph.title')}</h2>
        <div className="bh-tools chart-tools">
          <button type="button" className="btn btn-sm" onClick={resetView} title={t('graph.resetHint')}>
            <Icon name="graph" size={15} />
            {t('graph.reset')}
          </button>
          <MultiSelect
            label={t('graph.accounts')}
            options={options}
            value={shownChoice}
            onChange={(keys) => setHidden(candidates.filter((id) => !keys.includes(id)))}
            summary={shownChoice.length === candidates.length ? t('filter.all') : shownChoice.length === 0 ? t('history.none') : `${num(shownChoice.length)} / ${num(candidates.length)}`}
          />
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
          {!calm && (
            <>
              <span>
                <span className="ag-legend-dot own" />
                {t('graph.legendDotOwn')}
              </span>
              <span>
                <span className="ag-legend-dot other" />
                {t('graph.legendDotOther')}
              </span>
            </>
          )}
        </div>
        {card}
      </div>
    </section>
  );
}
