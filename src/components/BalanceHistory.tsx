import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons/ui';
import { useI18n } from '../i18n';
import { money } from '../lib/format';
import { lastValue, linesOf, valueAt, type BalanceLine } from '../lib/history';
import { getIndex, round, type AssetMap } from '../lib/stats';
import type { Account, Asset } from '../lib/types';
import { href } from '../router';
import { useStore } from '../store/store';
import { AccountIcon, AssetIcon, HelpPopover, Money, MultiSelect, Segmented, Switch } from './bits';
import { extendedSeries, useChartColors } from './charts';
import { useViewState } from './viewState';

/** lines shown by default when there are more: the biggest balances */
const MAX_DEFAULT = 16;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** room for the value axis on the left, the time axis below */
const M = { top: 18, right: 22, bottom: 26, left: 62 };
const NAV_H = 38;

type Preset = '1m' | '3m' | '6m' | '1y' | 'all' | 'custom';
interface ChartState {
  preset: Preset;
  /** the time shown, null = all of it */
  view: { x0: number; x1: number } | null;
  /** the value range set by hand, null = fitted to the lines */
  yManual: { y0: number; y1: number } | null;
  /** the pinned moment, null = now */
  pinT: number | null;
}
const PRESET_MONTHS: Record<Exclude<Preset, 'all' | 'custom'>, number> = { '1m': 1, '3m': 3, '6m': 6, '1y': 12 };

/** ~count round steps between lo and hi (1, 2, 5 x 10^k) */
function niceTicks(lo: number, hi: number, count: number): number[] {
  const span = hi - lo;
  if (!(span > 0)) return [lo];
  const raw = span / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? 10 * p;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

type TimeUnit = 'hour' | 'day' | 'month' | 'year';
const TIME_STEPS: [TimeUnit, number, number][] = [
  ['hour', 1, HOUR],
  ['hour', 3, 3 * HOUR],
  ['hour', 6, 6 * HOUR],
  ['hour', 12, 12 * HOUR],
  ['day', 1, DAY],
  ['day', 2, 2 * DAY],
  ['day', 7, 7 * DAY],
  ['day', 14, 14 * DAY],
  ['month', 1, 30 * DAY],
  ['month', 2, 61 * DAY],
  ['month', 3, 91 * DAY],
  ['month', 6, 182 * DAY],
  ['year', 1, 365 * DAY],
  ['year', 2, 730 * DAY],
  ['year', 5, 1826 * DAY],
  ['year', 10, 3652 * DAY],
];

/** Calendar-aligned time ticks between t0 and t1, at most ~max of them. */
function timeTicks(t0: number, t1: number, max: number): { ticks: number[]; unit: TimeUnit } {
  const [unit, n] = TIME_STEPS.find(([, , ms]) => (t1 - t0) / ms <= max) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const d = new Date(t0);
  const ticks: number[] = [];
  if (unit === 'hour') {
    d.setMinutes(0, 0, 0);
    d.setHours(Math.ceil(d.getHours() / n) * n);
  } else if (unit === 'day') {
    d.setHours(0, 0, 0, 0);
  } else if (unit === 'month') {
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    d.setMonth(Math.ceil(d.getMonth() / n) * n);
  } else {
    d.setHours(0, 0, 0, 0);
    d.setMonth(0, 1);
    d.setFullYear(Math.ceil(d.getFullYear() / n) * n);
  }
  for (let guard = 0; guard < 200; guard++) {
    if (d.getTime() >= t0 && d.getTime() <= t1) ticks.push(d.getTime());
    if (d.getTime() > t1) break;
    if (unit === 'hour') d.setHours(d.getHours() + n);
    else if (unit === 'day') d.setDate(d.getDate() + n);
    else if (unit === 'month') d.setMonth(d.getMonth() + n);
    else d.setFullYear(d.getFullYear() + n);
  }
  return { ticks, unit };
}

/** the line's colour and whether it is drawn dashed (past the palette's colours) */
interface Look {
  color: string;
  dashed: boolean;
}

/** a line's key: a dot of its colour (a dash for the dashed ones) */
function LineKey({ look, off = false }: { look: Look; off?: boolean }) {
  return (
    <svg className={`bh-key-mark ${off ? 'off' : ''}`} width="16" height="10" viewBox="0 0 16 10" aria-hidden="true">
      <line x1="1" y1="5" x2="15" y2="5" stroke={look.color} strokeWidth="2.5" strokeLinecap="round" strokeDasharray={look.dashed ? '4 3' : undefined} />
    </svg>
  );
}

/** a line's flag in the table: its colour (an outline for the dashed lines) on a pole */
function LineFlag({ look }: { look: Look }) {
  return (
    <svg className="bh-flag-mark" width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
      <line x1="1.5" y1="1" x2="1.5" y2="15" className="bh-flag-pole" />
      <path d="M2 1.5H11L8.4 5L11 8.5H2Z" fill={look.dashed ? 'none' : look.color} stroke={look.color} strokeWidth="1.3" strokeDasharray={look.dashed ? '2 1.5' : undefined} />
    </svg>
  );
}

/** Flow of an account up to a moment (inclusive): what it received and sent, how many transactions. */
function flowUntil(txs: { id: string; fromId: string; toId: string; assetId: string; amount: number }[], accountId: string, time: Map<string, number>, t: number) {
  const inMap: AssetMap = new Map();
  const outMap: AssetMap = new Map();
  let txIn = 0;
  let txOut = 0;
  for (const x of txs) {
    if (time.get(x.id)! > t) continue;
    if (x.toId === accountId) {
      inMap.set(x.assetId, round((inMap.get(x.assetId) ?? 0) + x.amount));
      txIn++;
    }
    if (x.fromId === accountId) {
      outMap.set(x.assetId, round((outMap.get(x.assetId) ?? 0) + x.amount));
      txOut++;
    }
  }
  // counted like the account's own statistics: once per side
  return { in: inMap, out: outMap, txIn, txOut, tx: txIn + txOut };
}

/** The difference of a value at the moment from the current one, when there is any. */
function Diff({ value, asset }: { value: number; asset: Asset | undefined }) {
  const i18n = useI18n();
  if (value === 0) return null;
  return <DiffMark value={value}>{money(i18n, Math.abs(value), asset)}</DiffMark>;
}

/**
 * A difference without a sign: a red arrow down when the value at the moment is smaller than
 * now, a green arrow up when it is bigger.
 */
function DiffMark({ value, children }: { value: number; children: ReactNode }) {
  const { t } = useI18n();
  const up = value >= 0;
  return (
    <span className={`bh-diff ${up ? 'up' : 'down'}`} title={t('history.diffTitle')}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
      {children}
    </span>
  );
}

/** The difference of a count at the moment from the current one, when there is any. */
function CountDiff({ value }: { value: number }) {
  const i18n = useI18n();
  if (value === 0) return null;
  return <DiffMark value={value}>{i18n.num(Math.abs(value))}</DiffMark>;
}

/** Amounts in the chosen assets (received, sent, the totals): at the moment, with the difference from now. */
function AmountsDiff({ assetIds, then, now, atNow }: { assetIds: string[]; then: AssetMap; now: AssetMap; atNow: boolean }) {
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const list = assetIds.filter((x) => (then.get(x) ?? 0) !== 0 || (now.get(x) ?? 0) !== 0);
  if (!list.length) return <span className="muted">—</span>;
  return (
    <div className="bh-amounts">
      {list.map((x) => {
        const asset = ix.assets.get(x);
        const v = then.get(x) ?? 0;
        return (
          <span key={x} className="bh-amount">
            <span className="amount-chip">
              <AssetIcon asset={asset} size={16} />
              <Money value={v} asset={asset} />
            </span>
            <Diff value={atNow ? 0 : round(v - (now.get(x) ?? 0))} asset={asset} />
          </span>
        );
      })}
    </div>
  );
}

/**
 * Accounts with their balance history above them: a line per asset of each account on one time
 * axis. Hovering moves a vertical line over the chart and the table below shows the balances at
 * that moment (with the difference from now); a click pins the moment, leaving the chart returns
 * to it (or to now). Both axes zoom: the period buttons and the strip under the chart, Ctrl + wheel
 * for time, Shift + wheel or the ± buttons for the value; dragging pans (the value axis: dragging it).
 */
export function AccountsHistory({ accounts, stateKey }: { accounts: Account[]; stateKey: string }) {
  const i18n = useI18n();
  const { t, num, locale } = i18n;
  const data = useStore((s) => s.data);
  const ix = getIndex(data);
  const colors = useChartColors();
  const clipId = `bh-clip-${stateKey.replace(/[^\w-]/g, '-')}`;
  const palette = useMemo(() => extendedSeries(colors), [colors]);
  // "now" moves with the data, so a new transaction shows at the right edge
  const now = useMemo(() => Date.now(), [data]);

  // the same accounts give the same lines (the list itself is often rebuilt on every render)
  const ids = accounts.map((a) => a.id).join();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => linesOf(ix, accounts), [ix, ids]);
  const looks = useMemo(() => new Map(lines.map((l, i) => [l.key, { color: palette[i % palette.length], dashed: i >= palette.length } as Look])), [lines, palette]);

  // which lines are drawn: all of them, or the biggest 16; the user's choice overrides per line
  const [overrides, setOverrides] = useViewState<Record<string, boolean>>(`${stateKey}.lines`, {});
  const defaultOn = useMemo(() => {
    if (lines.length <= MAX_DEFAULT) return new Set(lines.map((l) => l.key));
    return new Set([...lines].sort((a, b) => Math.abs(lastValue(b)) - Math.abs(lastValue(a))).slice(0, MAX_DEFAULT).map((l) => l.key));
  }, [lines]);
  const isOn = (k: string) => overrides[k] ?? defaultOn.has(k);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => lines.filter((l) => isOn(l.key)), [lines, overrides, defaultOn]);
  const setShown = (keys: string[]) => setOverrides(Object.fromEntries(lines.map((l) => [l.key, keys.includes(l.key)])));
  const toggle = (k: string) => setOverrides({ ...overrides, [k]: !isOn(k) });

  // the whole time range: from the first account's appearance to now (a day at least)
  const fullX0 = Math.min(now - DAY, ...lines.map((l) => l.start));

  // size
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const height = width < 560 ? 240 : 300;
  const pw = Math.max(10, width - M.left - M.right);
  const ph = height - M.top - M.bottom;

  // time view: all by default; a preset or zooming / panning narrows it
  // what the user set up (period, zoom, pinned moment) stays while moving between the page's tabs
  const [chart, setChart] = useViewState<ChartState>(`${stateKey}.chart`, { preset: 'all', view: null, yManual: null, pinT: null });
  const { preset, view, yManual, pinT } = chart;
  const setPreset = (v: Preset) => setChart((c) => ({ ...c, preset: v }));
  const setView = (v: ChartState['view']) => setChart((c) => ({ ...c, view: v }));
  const setYManual = (v: ChartState['yManual']) => setChart((c) => ({ ...c, yManual: v }));
  const setPinT = (v: number | null) => setChart((c) => ({ ...c, pinT: v }));
  const clampX = (x0: number, x1: number) => {
    const full = now - fullX0;
    let span = Math.max(HOUR, x1 - x0);
    if (span >= full) return null;
    span = Math.min(span, full);
    let a = x0;
    if (a < fullX0) a = fullX0;
    if (a + span > now) a = now - span;
    return { x0: a, x1: a + span };
  };
  const x0 = view?.x0 ?? fullX0;
  const x1 = view?.x1 ?? now;
  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p === 'all' || p === 'custom') return setView(null);
    const d = new Date(now);
    d.setMonth(d.getMonth() - PRESET_MONTHS[p]);
    setView(clampX(d.getTime(), now));
  };
  const setViewCustom = (v: { x0: number; x1: number } | null) => {
    setPreset(v ? 'custom' : 'all');
    setView(v);
  };

  // value view: fitted to what is drawn in the time view, unless zoomed or panned by hand
  const auto = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const l of shown) {
      if (l.start > x1) continue;
      const first = valueAt(l, Math.max(x0, l.start));
      if (first !== undefined) {
        lo = Math.min(lo, first);
        hi = Math.max(hi, first);
      }
      for (const p of l.points) {
        if (p.t <= x0 || p.t > x1) continue;
        lo = Math.min(lo, p.v);
        hi = Math.max(hi, p.v);
      }
    }
    if (!Number.isFinite(lo)) return { y0: -1, y1: 1 };
    const pad = hi > lo ? (hi - lo) * 0.08 : Math.abs(hi) * 0.1 || 1;
    return { y0: lo - pad, y1: hi + pad };
  }, [shown, x0, x1]);
  const { y0, y1 } = yManual ?? auto;

  const xs = (tm: number) => M.left + ((tm - x0) / (x1 - x0)) * pw;
  const ys = (v: number) => M.top + ((y1 - v) / (y1 - y0)) * ph;
  const timeAt = (px: number) => Math.min(Math.min(x1, now), Math.max(x0, x0 + ((px - M.left) / pw) * (x1 - x0)));

  // the moment: under the pointer, else the pinned one, else now
  const [hoverT, setHoverT] = useState<number | null>(null);
  const momentT = hoverT ?? pinT ?? now;
  const atNow = hoverT === null && pinT === null;

  // the lines' paths: steps, each from its appearance (or the view's left edge) to the right edge
  const paths = useMemo(
    () =>
      shown.map((l) => {
        const s = Math.max(l.start, x0);
        if (s > x1) return { key: l.key, d: '', start: null as null | [number, number] };
        const r = (n: number) => Math.round(n * 10) / 10;
        let d = `M${r(xs(s))} ${r(ys(valueAt(l, s)!))}`;
        for (const p of l.points) if (p.t > s && p.t <= x1) d += `H${r(xs(p.t))}V${r(ys(p.v))}`;
        d += `H${r(xs(x1))}`;
        return { key: l.key, d, start: l.start >= x0 ? ([r(xs(l.start)), r(ys(l.points[0].v))] as [number, number]) : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, x0, x1, y0, y1, pw, ph],
  );

  const yTicks = niceTicks(y0, y1, Math.max(3, Math.round(ph / 55)));
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 });
  const { ticks: xTicks, unit } = timeTicks(x0, x1, Math.max(2, Math.floor(pw / 90)));
  const xLabel = (tm: number) => {
    const d = new Date(tm);
    if (unit === 'hour') return new Intl.DateTimeFormat(locale, d.getHours() === 0 ? { day: 'numeric', month: 'short' } : { hour: '2-digit', minute: '2-digit' }).format(d);
    if (unit === 'day') return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
    if (unit === 'month') return d.getMonth() === 0 ? String(d.getFullYear()) : new Intl.DateTimeFormat(locale, { month: 'short' }).format(d);
    return String(d.getFullYear());
  };

  // ---- pointer: hover / pin / pan on the chart, pan on the value axis ----
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ kind: 'plot' | 'axis' | 'value'; x: number; y: number; moved: boolean; x0: number; x1: number; y0: number; y1: number } | null>(null);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (kind: 'plot' | 'axis') => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = local(e);
    // Ctrl (⌘) + drag on the chart moves the value, like dragging the value axis
    const k = kind === 'plot' && (e.ctrlKey || e.metaKey) ? 'value' : kind;
    drag.current = { kind: k, x: p.x, y: p.y, moved: false, x0, x1, y0, y1 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (k === 'plot') setHoverT(timeAt(p.x));
  };
  const onMove = (e: ReactPointerEvent) => {
    const p = local(e);
    const g = drag.current;
    if (g) {
      const dx = p.x - g.x;
      const dy = p.y - g.y;
      if (!g.moved && Math.hypot(dx, dy) > 4) g.moved = true;
      if (g.kind !== 'plot' && g.moved) {
        const dv = (dy / ph) * (g.y1 - g.y0);
        setYManual({ y0: g.y0 + dv, y1: g.y1 + dv });
        return;
      }
      // a mouse drags the time; a finger scrubs the moment
      if (g.kind === 'plot' && g.moved && e.pointerType === 'mouse') {
        const dt = (-dx / pw) * (g.x1 - g.x0);
        const v = clampX(g.x0 + dt, g.x1 + dt);
        if (v) setViewCustom(v);
        return;
      }
    }
    if (p.x >= M.left && p.x <= M.left + pw) setHoverT(timeAt(p.x));
  };
  const onUp = (e: ReactPointerEvent) => {
    const g = drag.current;
    drag.current = null;
    if (!g || g.kind !== 'plot') return;
    // a click (or a tap, or a finger lifted after scrubbing) pins the moment
    if (!g.moved || e.pointerType !== 'mouse') setPinT(timeAt(local(e).x));
    if (e.pointerType !== 'mouse') setHoverT(null);
  };
  const onLeave = (e: ReactPointerEvent) => {
    if (!drag.current && e.pointerType === 'mouse') setHoverT(null);
  };

  // wheel: Ctrl / pinch zooms the time, Shift the value, around the pointer; plain wheel scrolls the page
  const live = useRef({ x0, x1, y0, y1, pw, ph, now, fullX0 });
  live.current = { x0, x1, y0, y1, pw, ph, now, fullX0 };
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const zoomTime = e.ctrlKey || e.metaKey;
      if (!zoomTime && !e.shiftKey) return;
      e.preventDefault();
      const L = live.current;
      const r = el.getBoundingClientRect();
      const delta = e.deltaY || e.deltaX;
      const f = delta > 0 ? 1.25 : 0.8;
      if (zoomTime) {
        const at = L.x0 + ((e.clientX - r.left - M.left) / L.pw) * (L.x1 - L.x0);
        const a = at - (at - L.x0) * f;
        const b = at + (L.x1 - at) * f;
        const full = L.now - L.fullX0;
        if (b - a >= full) return setViewCustom(null);
        let span = Math.max(HOUR, b - a);
        let s = Math.max(L.fullX0, a);
        if (s + span > L.now) s = L.now - span;
        span = Math.min(span, full);
        setViewCustom({ x0: s, x1: s + span });
      } else {
        const at = L.y1 - ((e.clientY - r.top - M.top) / L.ph) * (L.y1 - L.y0);
        setYManual({ y0: at - (at - L.y0) * f, y1: at + (L.y1 - at) * f });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ± buttons: around zero when it is in view (small balances sit near it), else around the middle
  const zoomY = (f: number) => {
    const at = y0 < 0 && y1 > 0 ? 0 : (y0 + y1) / 2;
    setYManual({ y0: at - (at - y0) * f, y1: at + (y1 - at) * f });
  };

  // ---- the strip under the chart: the whole time range and the view on it ----
  const nx = (tm: number) => M.left + ((tm - fullX0) / (now - fullX0)) * pw;
  const nt = (px: number) => fullX0 + ((px - M.left) / pw) * (now - fullX0);
  const navPaths = useMemo(
    () =>
      shown.map((l) => {
        const vs = l.points.map((p) => p.v);
        const lo = Math.min(...vs);
        const hi = Math.max(...vs);
        const y = (v: number) => (hi > lo ? 4 + (1 - (v - lo) / (hi - lo)) * (NAV_H - 8) : NAV_H / 2);
        let d = `M${nx(l.start).toFixed(1)} ${y(l.points[0].v).toFixed(1)}`;
        for (const p of l.points.slice(1)) d += `H${nx(p.t).toFixed(1)}V${y(p.v).toFixed(1)}`;
        return { key: l.key, d: `${d}H${nx(now).toFixed(1)}` };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, fullX0, now, pw],
  );
  const nav = useRef<SVGSVGElement>(null);
  const navDrag = useRef<{ mode: 'a' | 'b' | 'move'; x: number; x0: number; x1: number } | null>(null);
  const onNavDown = (e: ReactPointerEvent) => {
    const r = nav.current!.getBoundingClientRect();
    const px = e.clientX - r.left;
    const a = nx(x0);
    const b = nx(x1);
    let mode: 'a' | 'b' | 'move' = 'move';
    if (Math.abs(px - a) <= 10) mode = 'a';
    else if (Math.abs(px - b) <= 10) mode = 'b';
    else if (px < a || px > b) {
      // outside the window: move it there, centred
      const span = x1 - x0;
      const v = clampX(nt(px) - span / 2, nt(px) + span / 2);
      setViewCustom(v);
      navDrag.current = { mode: 'move', x: px, x0: v?.x0 ?? fullX0, x1: v?.x1 ?? now };
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
      return;
    }
    navDrag.current = { mode, x: px, x0, x1 };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onNavMove = (e: ReactPointerEvent) => {
    const g = navDrag.current;
    if (!g) return;
    const r = nav.current!.getBoundingClientRect();
    const dt = ((e.clientX - r.left - g.x) / pw) * (now - fullX0);
    if (g.mode === 'move') return setViewCustom(clampX(g.x0 + dt, g.x1 + dt) ?? null);
    if (g.mode === 'a') return setViewCustom(clampX(Math.min(g.x0 + dt, g.x1 - HOUR), g.x1));
    setViewCustom(clampX(g.x0, Math.max(g.x1 + dt, g.x0 + HOUR)));
  };
  const onNavUp = () => {
    navDrag.current = null;
  };

  // ---- the moment's values ----
  const accountName = (l: BalanceLine) => ix.accounts.get(l.accountId)?.name ?? '?';
  const momentX = xs(Math.min(Math.max(momentT, x0), x1));
  const momentInView = momentT >= x0 && momentT <= x1;
  const tipRows = shown
    .map((l) => ({ l, v: valueAt(l, momentT) }))
    .filter((r): r is { l: BalanceLine; v: number } => r.v !== undefined)
    .sort((a, b) => b.v - a.v);
  const nameOf = (l: BalanceLine) => `${ix.accounts.get(l.accountId)?.name ?? '?'} · ${ix.assets.get(l.assetId)?.code ?? '?'}`;
  // the callout stands beside the line, on the side with room, and never leaves the chart
  const tip = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = tip.current;
    if (!el) return;
    const w = el.offsetWidth;
    const right = momentX + 12;
    const left = momentX - 12 - w;
    el.style.left = `${Math.max(0, Math.min(width - w, right + w <= width ? right : left >= 0 ? left : right))}px`;
  });

  // a tree: the account (a heading), its assets under it with the checkboxes
  const options = lines.map((l) => {
    const a = ix.accounts.get(l.accountId)!;
    const asset = ix.assets.get(l.assetId);
    return {
      value: l.key,
      // the search finds an asset by its code or by its account's name
      label: nameOf(l),
      group: a.id,
      groupRender: (
        <span className="bh-opt">
          <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={20} />
          <span className="bh-opt-name">{a.name}</span>
        </span>
      ),
      depth: 1,
      render: (
        <span className="bh-opt">
          <AssetIcon asset={asset} size={16} />
          <span className="bh-opt-code">{asset?.code ?? '?'}</span>
          <LineFlag look={looks.get(l.key)!} />
        </span>
      ),
    };
  });
  const shownKeys = shown.map((l) => l.key);
  // the table lists only the chosen assets; an account with none of them chosen is left out
  const listed = accounts.map((a) => ({ a, own: shown.filter((l) => l.accountId === a.id) })).filter((x) => x.own.length > 0);
  // each listed account at the moment and now (in its chosen assets)
  const rows = listed.map(({ a, own }) => {
    const as = ix.account.get(a.id)!;
    return {
      a,
      own,
      existed: atNow || own.some((l) => momentT >= l.start),
      flow: atNow ? as.flow : flowUntil(as.txs, a.id, ix.time, momentT),
      nowFlow: as.flow,
      assetIds: own.map((l) => l.assetId),
    };
  });
  // the totals: balances, received and sent added up per asset; the transactions counted once each
  // (a transfer between two listed accounts is one, "internal")
  const totals = (() => {
    const add = (m: AssetMap, k: string, v: number) => m.set(k, round((m.get(k) ?? 0) + v));
    const balance: AssetMap = new Map();
    const balanceNow: AssetMap = new Map();
    const inT: AssetMap = new Map();
    const inNow: AssetMap = new Map();
    const outT: AssetMap = new Map();
    const outNow: AssetMap = new Map();
    for (const r of rows) {
      for (const l of r.own) {
        add(balance, l.assetId, valueAt(l, momentT) ?? 0);
        add(balanceNow, l.assetId, lastValue(l));
      }
      for (const x of r.assetIds) {
        add(inT, x, r.flow.in.get(x) ?? 0);
        add(inNow, x, r.nowFlow.in.get(x) ?? 0);
        add(outT, x, r.flow.out.get(x) ?? 0);
        add(outNow, x, r.nowFlow.out.get(x) ?? 0);
      }
    }
    const ids = new Set(rows.map((r) => r.a.id));
    const seen = new Set<string>();
    const tx = { all: 0, in: 0, out: 0, internal: 0 };
    let txNow = 0;
    for (const r of rows)
      for (const x of ix.account.get(r.a.id)!.txs) {
        if (seen.has(x.id)) continue;
        seen.add(x.id);
        txNow++;
        if (!atNow && ix.time.get(x.id)! > momentT) continue;
        tx.all++;
        const from = ids.has(x.fromId);
        const to = ids.has(x.toId);
        if (from && to) tx.internal++;
        else if (to) tx.in++;
        else tx.out++;
      }
    const used = new Set(rows.flatMap((r) => r.assetIds));
    return { assetIds: data.assets.map((x) => x.id).filter((x) => used.has(x)), balance, balanceNow, in: inT, inNow, out: outT, outNow, tx, txNow };
  })();

  return (
    <div className="bh">
      <section className="panel bh-chart">
        <div className="bh-head">
          <h2>{t('history.title')}</h2>
          <div className="bh-tools chart-tools">
            <Segmented<Preset>
              value={preset}
              onChange={choosePreset}
              label={t('history.period')}
              options={[
                { value: '1m', label: t('history.p1m') },
                { value: '3m', label: t('history.p3m') },
                { value: '6m', label: t('history.p6m') },
                { value: '1y', label: t('history.p1y') },
                { value: 'all', label: t('history.pAll') },
              ]}
            />
            <span className="bh-yzoom" role="group" aria-label={t('history.yScale')}>
              <button type="button" className="icon-btn" onClick={() => zoomY(1.6)} title={t('history.zoomOut')} aria-label={t('history.zoomOut')}>
                <Icon name="minus" size={16} />
              </button>
              <button type="button" className="icon-btn" onClick={() => zoomY(0.625)} title={t('history.zoomIn')} aria-label={t('history.zoomIn')}>
                <Icon name="plus" size={16} />
              </button>
            </span>
            {/* on: the value scale follows what is drawn; off: it stays where it is (also after zooming by hand) */}
            <Switch checked={!yManual} onChange={(on) => setYManual(on ? null : { y0, y1 })} label={t('history.autoScale')} title={t('history.autoHint')} />
            <MultiSelect
              label={t('history.lines')}
              options={options}
              value={shownKeys}
              onChange={setShown}
              summary={shown.length === lines.length ? t('filter.all') : shown.length === 0 ? t('history.none') : `${num(shown.length)} / ${num(lines.length)}`}
            />
            <HelpPopover
              label={t('history.helpTitle')}
              items={[t('history.helpClick'), t('history.helpDrag'), t('history.helpCtrlDrag'), t('history.helpCtrlWheel'), t('history.helpShiftWheel'), t('history.helpTouch')]}
            />
          </div>
        </div>

        <div className="bh-plot" ref={wrap}>
          <svg ref={svg} width={width} height={height} className="bh-svg" role="img" aria-label={t('history.title')}>
            <defs>
              <clipPath id={clipId}>
                <rect x={M.left} y={M.top} width={pw} height={ph} />
              </clipPath>
            </defs>
            {/* grid and value axis */}
            {yTicks.map((v) => (
              <g key={v}>
                <line x1={M.left} x2={M.left + pw} y1={ys(v)} y2={ys(v)} className={v === 0 ? 'bh-zero' : 'bh-grid'} />
                <text x={M.left - 8} y={ys(v)} className="bh-tick" textAnchor="end" dominantBaseline="middle">
                  {compact.format(v)}
                </text>
              </g>
            ))}
            {xTicks.map((tm) => (
              <g key={tm}>
                <line x1={xs(tm)} x2={xs(tm)} y1={M.top} y2={M.top + ph} className="bh-grid bh-grid-x" />
                <text x={xs(tm)} y={M.top + ph + 17} className="bh-tick" textAnchor="middle">
                  {xLabel(tm)}
                </text>
              </g>
            ))}
            {/* the lines */}
            <g clipPath={`url(#${clipId})`}>
              {paths.map((p) => {
                const look = looks.get(p.key)!;
                return (
                  <g key={p.key}>
                    <path d={p.d} className="bh-line" stroke={look.color} strokeDasharray={look.dashed ? '6 4' : undefined} />
                    {p.start && <circle cx={p.start[0]} cy={p.start[1]} r={3} fill={look.color} className="bh-start" />}
                  </g>
                );
              })}
              {/* the pinned moment while another one is looked at */}
              {pinT !== null && hoverT !== null && pinT >= x0 && pinT <= x1 && <line x1={xs(pinT)} x2={xs(pinT)} y1={M.top} y2={M.top + ph} className="bh-pin" />}
              {momentInView && (
                <>
                  <line x1={momentX} x2={momentX} y1={M.top} y2={M.top + ph} className={`bh-cursor ${atNow ? 'now' : ''}`} />
                  {!atNow &&
                    tipRows.map(({ l, v }) => <circle key={l.key} cx={momentX} cy={ys(v)} r={4} fill={looks.get(l.key)!.color} className="bh-dot" />)}
                </>
              )}
            </g>
            {/* each line ends with its flag, as in the list below */}
            {shown.map((l) => {
              if (l.start > x1) return null;
              const v = valueAt(l, x1);
              if (v === undefined || v < y0 || v > y1) return null;
              const look = looks.get(l.key)!;
              const fx = Math.round(xs(x1));
              const fy = Math.round(ys(v));
              return (
                <g key={l.key} className="bh-end-flag" transform={`translate(${fx} ${fy})`}>
                  <line x1={0} y1={0} x2={0} y2={-15} className="bh-flag-pole" />
                  <path d="M0.5 -15H10L7.6 -11.8L10 -8.6H0.5Z" fill={look.dashed ? 'var(--surface)' : look.color} stroke={look.color} strokeWidth="1.3" strokeDasharray={look.dashed ? '2 1.5' : undefined} />
                </g>
              );
            })}
            {/* the value axis can be dragged; the chart takes hover, clicks and drags */}
            <rect x={0} y={M.top} width={M.left} height={ph} className="bh-axis-hit" onPointerDown={onDown('axis')} onPointerMove={onMove} onPointerUp={onUp} />
            <rect
              x={M.left}
              y={M.top}
              width={pw}
              height={ph}
              className="bh-hit"
              onPointerDown={onDown('plot')}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onLeave}
              onPointerCancel={() => {
                drag.current = null;
                setHoverT(null);
              }}
            />
          </svg>
          {shown.length === 0 && <p className="bh-empty muted">{t('history.empty')}</p>}
          {/* the pinned moment, and the way back to now */}
          {pinT !== null && (
            <button type="button" className="bh-pinned" style={{ left: M.left + 6, maxWidth: width - M.left - 12 }} onClick={() => setPinT(null)} title={t('history.unpinHint')}>
              <Icon name="clock" size={13} />
              <span className="ellipsis">{t('history.pinnedAt', { date: i18n.dateTime(pinT) })}</span>
              <Icon name="close" size={13} />
            </button>
          )}
          {!atNow && momentInView && tipRows.length > 0 && (
            <div ref={tip} className="chart-tip bh-tip" style={{ top: pinT !== null ? 34 : M.top + 4 }}>
              <div className="chart-tip-title">{i18n.dateTime(momentT)}</div>
              {tipRows.map(({ l, v }) => (
                <div key={l.key} className="chart-tip-row">
                  <LineKey look={looks.get(l.key)!} />
                  <span className="ellipsis">{accountName(l)}</span>
                  <strong>{money(i18n, v, ix.assets.get(l.assetId))}</strong>
                </div>
              ))}
            </div>
          )}
        </div>

        <svg ref={nav} width={width} height={NAV_H} className="bh-nav" onPointerDown={onNavDown} onPointerMove={onNavMove} onPointerUp={onNavUp} aria-label={t('history.period')}>
          <rect x={M.left} y={0} width={pw} height={NAV_H} rx={6} className="bh-nav-bg" />
          {navPaths.map((p) => (
            <path key={p.key} d={p.d} className="bh-nav-line" stroke={looks.get(p.key)!.color} />
          ))}
          <rect x={nx(x0)} y={0} width={Math.max(2, nx(x1) - nx(x0))} height={NAV_H} rx={6} className="bh-nav-window" />
          <rect x={nx(x0) - 4} y={8} width={8} height={NAV_H - 16} rx={3} className="bh-nav-handle" />
          <rect x={nx(x1) - 4} y={8} width={8} height={NAV_H - 16} rx={3} className="bh-nav-handle" />
        </svg>

      </section>

      {/* the accounts, right under their chart: their state at the moment, flags that take an asset off */}
      <div className="table-wrap bh-table">
        <table className="table">
          <thead>
            <tr>
              <th>{t('accounts.one')}</th>
              <th>{t('accounts.balance')}</th>
              <th className="num">{t('stats.transactions')}</th>
              <th>{t('stats.received')}</th>
              <th>{t('stats.sent')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted bh-table-empty">
                  {t('history.noAssets')}
                </td>
              </tr>
            )}
            {rows.map(({ a, own, existed, flow, nowFlow, assetIds }) => (
              <tr key={a.id} className={existed ? '' : 'bh-row-absent'}>
                <td>
                  <span className="table-account">
                    <AccountIcon account={a} service={a.serviceId ? ix.services.get(a.serviceId) : undefined} size={32} />
                    <span className="table-account-main">
                      <a href={href.detail('accounts', a.id)}>{a.name}</a>
                      <span className="muted small">{existed ? t(`form.${a.form}`) : t('history.notYet')}</span>
                    </span>
                  </span>
                </td>
                <td>
                  <div className="bh-amounts">
                    {own.map((l) => {
                      const asset = ix.assets.get(l.assetId);
                      const v = valueAt(l, momentT);
                      return (
                        <span key={l.key} className="bh-amount">
                          {/* the asset's flag, as at its line's end; a click takes it off the chart and this list */}
                          <button
                            type="button"
                            className="bh-flag"
                            onClick={() => toggle(l.key)}
                            title={`${asset?.code ?? '?'}: ${t('history.hideLine')}`}
                            aria-label={`${a.name}, ${asset?.code ?? '?'}: ${t('history.hideLine')}`}
                          >
                            <LineFlag look={looks.get(l.key)!} />
                          </button>
                          <span className="amount-chip">
                            <AssetIcon asset={asset} size={16} />
                            {v === undefined ? <span className="muted">—</span> : <Money value={v} asset={asset} />}
                          </span>
                          <Diff value={v === undefined || atNow ? 0 : round(v - lastValue(l))} asset={asset} />
                        </span>
                      );
                    })}
                  </div>
                </td>
                <td className="num" title={t('stats.inOutCount', { in: num(flow.txIn), out: num(flow.txOut) })}>
                  <span className="bh-count">
                    <CountDiff value={atNow ? 0 : flow.tx - nowFlow.tx} />
                    {num(flow.tx)}
                  </span>
                  <div className="tx-split">
                    <span className="muted">
                      <Icon name="arrowIn" size={13} className="flow-in" />
                      {num(flow.txIn)}
                      <Icon name="arrowOut" size={13} className="flow-out" />
                      {num(flow.txOut)}
                    </span>
                  </div>
                </td>
                <td>
                  <AmountsDiff assetIds={assetIds} then={flow.in} now={nowFlow.in} atNow={atNow} />
                </td>
                <td>
                  <AmountsDiff assetIds={assetIds} then={flow.out} now={nowFlow.out} atNow={atNow} />
                </td>
              </tr>
            ))}
          </tbody>
          {/* everything listed above, the same assets added up */}
          {rows.length > 0 && (
            <tfoot>
              <tr className="bh-total">
                <td>{t('history.total')}</td>
                <td className="bh-total-balance">
                  <AmountsDiff assetIds={totals.assetIds} then={totals.balance} now={totals.balanceNow} atNow={atNow} />
                </td>
                <td
                  className="num"
                  title={t('stats.inOutInternal', { in: num(totals.tx.in), out: num(totals.tx.out), internal: num(totals.tx.internal) })}
                >
                  <span className="bh-count">
                    <CountDiff value={atNow ? 0 : totals.tx.all - totals.txNow} />
                    {num(totals.tx.all)}
                  </span>
                  <div className="tx-split">
                    <span className="muted">
                      <Icon name="arrowIn" size={13} className="flow-in" />
                      {num(totals.tx.in)}
                      <Icon name="arrowOut" size={13} className="flow-out" />
                      {num(totals.tx.out)}
                    </span>
                  </div>
                </td>
                <td>
                  <AmountsDiff assetIds={totals.assetIds} then={totals.in} now={totals.inNow} atNow={atNow} />
                </td>
                <td>
                  <AmountsDiff assetIds={totals.assetIds} then={totals.out} now={totals.outNow} atNow={atNow} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
