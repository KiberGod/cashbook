import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { money } from '../lib/format';
import type { Asset } from '../lib/types';
import { extendedSeries, useChartColors } from './charts';

/**
 * One group's share (a contact, an account, a category...). `icon` goes in the hover callout,
 * `chip` (a link to the group's page) in the legend; without them the label is shown as text.
 */
export interface BreakdownSlice {
  key: string;
  label: string;
  icon?: ReactNode;
  chip?: ReactNode;
  value: number;
  /** how many transactions make up the value */
  count: number;
}

/** sectors with their own colour: as many as the extended palette has */
const MAX_SLICES = 15;
/** a group under this share of the total goes into "others" (when there are two or more such) */
const MIN_SHARE = 0.03;
const OTHER = '__other';
const LIFT = 6;
/** room on each side of the ring, and above and below it, for the hover callout */
const SIDE = 120;
const PAD = 56;
/** how far the callout's first leg goes out from the ring before it turns to the side */
const LEG = 22;

/** Ring geometry for a given outer radius, centred at (cx, cy). */
interface Ring {
  cx: number;
  cy: number;
  rOut: number;
  rIn: number;
}

const polar = (g: Ring, r: number, a: number) => [g.cx + r * Math.sin(a), g.cy - r * Math.cos(a)] as const;

/** A ring sector from angle a0 to a1 (radians, clockwise from 12 o'clock). */
function sector(g: Ring, a0: number, a1: number) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = polar(g, g.rOut, a0);
  const [x1, y1] = polar(g, g.rOut, a1);
  const [x2, y2] = polar(g, g.rIn, a1);
  const [x3, y3] = polar(g, g.rIn, a0);
  return `M${x0} ${y0}A${g.rOut} ${g.rOut} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${g.rIn} ${g.rIn} 0 ${large} 0 ${x3} ${y3}Z`;
}

/**
 * Where the money came from / went to, by some grouping: a ring with a coloured sector for every group of 3% and more
 * (15 at most) plus a grey "others" for the smaller ones (when two or more), and
 * the full legend below. Hovering a sector or a legend row lifts that sector, dims the rest
 * and draws a callout from it to the side with the group, its share and amount; the middle
 * always shows the total.
 * `colorOf` keeps one person's colour the same in neighbouring charts.
 */
export function BreakdownDonut({
  slices: input,
  asset,
  colorOf,
  empty,
  measure = 'sum',
  ariaLabel,
}: {
  slices: BreakdownSlice[];
  asset: Asset | undefined;
  colorOf: (key: string) => string;
  empty: string;
  /** what the sectors measure: the amount of the asset, or how many transactions */
  measure?: 'sum' | 'count';
  ariaLabel: string;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const c = useChartColors();
  const [hover, setHover] = useState<string | null>(null);
  // in "count" mode the sizes are the transaction counts; everything below works on `value`
  const slices = useMemo(() => (measure === 'count' ? input.map((x) => ({ ...x, value: x.count })) : input), [input, measure]);
  const fmt = (v: number) => (measure === 'count' ? i18n.tn('counts.transactions', v) : money(i18n, v, asset));
  const all = useMemo(() => [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value), [slices]);
  const total = all.reduce((s, x) => s + x.value, 0);
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // the ring and the callouts are laid out for the space the card gives
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [total > 0]);
  const label = useRef<HTMLDivElement>(null);
  const [labelW, setLabelW] = useState(0);
  // the callout's width decides where it can stand; measured each time it shows something else
  useLayoutEffect(() => setLabelW(label.current?.offsetWidth ?? 0), [hover, width]);
  // groups of 3% and more get their own coloured sectors (15 at most); the smaller ones are folded
  // into a grey "others" - unless there is only one of them, which then keeps its own sector
  // compared as shown (one decimal), so a group the legend calls "3%" is never folded
  const big = all.filter((x) => Math.round((x.value / (total || 1)) * 1000) / 10 >= MIN_SHARE * 100).slice(0, MAX_SLICES);
  const tail = all.slice(big.length);
  const [shown, rest] = tail.length === 1 && big.length < MAX_SLICES ? [all, [] as BreakdownSlice[]] : [big, tail];
  const restValue = rest.reduce((s, x) => s + x.value, 0);
  const ring =
    rest.length > 1
      ? [...shown, { key: OTHER, label: t('analytics.other'), value: restValue, count: rest.reduce((n, x) => n + x.count, 0) } as BreakdownSlice]
      : [...shown, ...rest];
  const inRing = new Set(shown.map((s) => s.key));
  // the wished colour of each sector, unless another sector of this ring already has it (with more
  // groups than colours): then the first colour still free here
  const series = useMemo(() => extendedSeries(c), [c]);
  const palette = useMemo(() => {
    const used = new Set<string>();
    const m = new Map<string, string>();
    for (const x of shown) {
      let col = colorOf(x.key);
      if (used.has(col)) col = series.find((s) => !used.has(s)) ?? col;
      used.add(col);
      m.set(x.key, col);
    }
    return m;
  }, [shown, colorOf, series]);
  const color = (key: string) => (key === OTHER || !inRing.has(key) ? c.muted : (palette.get(key) ?? c.muted));

  if (!total) return <p className="muted chart-empty">{empty}</p>;

  // the ring takes what the callouts leave free on both sides, 120..280px across
  const diameter = Math.max(120, Math.min(280, (width || 520) - 2 * SIDE));
  const small = diameter < 200;
  const height = diameter + 2 * PAD;
  const g: Ring = { cx: (width || diameter) / 2, cy: height / 2, rOut: diameter / 2 - LIFT, rIn: (diameter / 2 - LIFT) * (small ? 0.52 : 0.46) };

  let angle = 0;
  const arcs = ring.map((s) => {
    // a lone slice is drawn as a full ring
    const span = ring.length === 1 ? 2 * Math.PI - 0.0001 : (s.value / total) * 2 * Math.PI;
    const a = { ...s, a0: angle, a1: angle + span };
    angle += span;
    return a;
  });
  // the legend's rest rows point at the "others" sector
  const ringKey = (key: string) => (inRing.has(key) ? key : OTHER);
  const focused = hover ? arcs.find((a) => a.key === hover) : undefined;
  const pct = (v: number) => `${i18n.num((v / total) * 100, 1)}%`;

  // the callout: out of the sector's middle, then flat to the side of the ring it is on
  let callout = null;
  if (focused) {
    const mid = (focused.a0 + focused.a1) / 2;
    const right = Math.sin(mid) >= 0;
    // the first leg goes straight out, so the elbow is outside the ring; the second one runs away
    // from the centre, so it can never cross the ring
    const [x0, y0] = polar(g, g.rOut + LIFT + 2, mid);
    const [x1, y1] = polar(g, g.rOut + LIFT + LEG, mid);
    const reach = small ? 6 : 24;
    const xEnd = right ? Math.max(x1 + 10, g.cx + g.rOut + reach) : Math.min(x1 - 10, g.cx - g.rOut - reach);
    callout = { path: `M${x0} ${y0}L${x1} ${y1}L${xEnd} ${y1}`, x: xEnd, y: y1, right, slice: focused };
  }

  return (
    <div className="cdonut">
      <div className="cdonut-chart" ref={box} style={{ height }} onMouseLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label={ariaLabel}>
            {arcs.map((a) => {
              const mid = (a.a0 + a.a1) / 2;
              const lifted = hover === a.key;
              const [dx, dy] = lifted ? [LIFT * Math.sin(mid), -LIFT * Math.cos(mid)] : [0, 0];
              return (
                <path
                  key={a.key}
                  d={sector(g, a.a0, a.a1)}
                  fill={color(a.key)}
                  stroke={c.surface}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  className="cdonut-sector"
                  style={{ transform: `translate(${dx}px, ${dy}px)`, opacity: hover && !lifted ? 0.35 : 1 }}
                  onMouseEnter={() => setHover(a.key)}
                />
              );
            })}
            {callout && <path d={callout.path} fill="none" stroke={color(callout.slice.key)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="cdonut-line" />}
          </svg>
        )}
        <div className={`cdonut-center ${small ? 'small' : ''}`} style={{ left: g.cx - g.rIn, top: g.cy - g.rIn, width: 2 * g.rIn, height: 2 * g.rIn }}>
          {measure === 'count' ? (
            // the number, and the word under it: fits the hole of a small ring too
            <span className="cdonut-count">
              <strong>{i18n.num(total)}</strong>
              <span className="muted">{i18n.tn('counts.transactions', total).replace(i18n.num(total), '').trim()}</span>
            </span>
          ) : (
            <strong>{fmt(total)}</strong>
          )}
        </div>
        {callout && (
          <div
            ref={label}
            className={`cdonut-callout ${callout.right ? 'right' : 'left'}`}
            // after the line's end; a label wider than the space left moves back over the ring
            // (on one line rather than wrapped), but never past the card's edge
            style={{
              left: callout.right ? Math.max(4, Math.min(callout.x + 6, width - labelW - 4)) : Math.max(4, callout.x - 6 - labelW),
              top: callout.y,
              maxWidth: width - 8,
              visibility: labelW ? undefined : 'hidden',
            }}
          >
            <span className="cdonut-callout-who">
              {callout.slice.icon}
              <span className="cdonut-callout-name">{callout.slice.label}</span>
            </span>
            <span className="cdonut-callout-pct">{pct(callout.slice.value)}</span>
            <span className="cdonut-callout-pct">{fmt(callout.slice.value)}</span>
          </div>
        )}
      </div>
      <ul className="cdonut-legend">
        {all.map((s) => (
          <li
            key={s.key}
            className={hover && ringKey(s.key) === hover ? 'active' : ''}
            onMouseEnter={() => setHover(ringKey(s.key))}
            onMouseLeave={() => setHover(null)}
          >
            <span className="chart-tip-key" style={{ background: color(s.key) }} />
            {s.chip ?? <span className="muted">{s.label}</span>}
            <span className="cdonut-legend-pct muted">{pct(s.value)}</span>
            <strong>{fmt(s.value)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
