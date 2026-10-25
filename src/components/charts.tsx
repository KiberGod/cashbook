import { useEffect, useState, type ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useI18n } from '../i18n';
import type { Granularity } from '../lib/analytics';
import { money } from '../lib/format';
import type { Asset } from '../lib/types';

/** Chart colours come from CSS tokens (validated palette, separate light/dark steps). */
export interface ChartColors {
  series: string[];
  grid: string;
  axis: string;
  muted: string;
  surface: string;
  text: string;
}

function readColors(): ChartColors {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    series: Array.from({ length: 8 }, (_, i) => v(`--series-${i + 1}`)),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    muted: v('--muted'),
    surface: v('--surface'),
    text: v('--text'),
  };
}

export function useChartColors(): ChartColors {
  const [c, setC] = useState(readColors);
  useEffect(() => {
    const mo = new MutationObserver(() => setC(readColors()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return c;
}

export function useBucketLabel() {
  const { locale } = useI18n();
  return (time: number, g: Granularity, long = false) => {
    const d = new Date(time);
    if (g === 'year') return String(d.getFullYear());
    if (g === 'month') return new Intl.DateTimeFormat(locale, long ? { month: 'long', year: 'numeric' } : { month: 'short', year: '2-digit' }).format(d);
    return new Intl.DateTimeFormat(locale, long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' }).format(d);
  };
}

function compact(n: number, locale: string) {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

function TipBox({ title, rows }: { title: string; rows: { color?: string; label: string; value: string }[] }) {
  return (
    <div className="chart-tip">
      <div className="chart-tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="chart-tip-row">
          {r.color && <span className="chart-tip-key" style={{ background: r.color }} />}
          <span>{r.label}</span>
          <strong>{r.value}</strong>
        </div>
      ))}
    </div>
  );
}

export function ChartCard({ title, children, actions, note }: { title: string; children: ReactNode; actions?: ReactNode; note?: ReactNode }) {
  return (
    <section className="panel chart-card">
      <div className="chart-card-head">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
      {note && <p className="field-hint">{note}</p>}
    </section>
  );
}

// ---- income / spending per period ----

export interface FlowDatum {
  start: number;
  income: number;
  expense: number;
  fees: number;
  net: number;
}

export function CashflowChart({ points, g, asset, height = 280 }: { points: FlowDatum[]; g: Granularity; asset: Asset | undefined; height?: number }) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const c = useChartColors();
  const label = useBucketLabel();
  const series = [
    { key: 'income', name: t('stats.income'), color: c.series[0] },
    { key: 'expense', name: t('stats.expense'), color: c.series[1] },
    { key: 'fees', name: t('stats.fees'), color: c.series[2] },
  ] as const;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%" barGap={2}>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="start" tickFormatter={(v) => label(v, g)} tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.axis }} tickLine={false} minTickGap={16} />
        <YAxis tickFormatter={(v) => compact(v, locale)} tick={{ fill: c.muted, fontSize: 12 }} axisLine={false} tickLine={false} width={48} />
        <Tooltip
          cursor={{ fill: c.grid, opacity: 0.5 }}
          content={({ active, payload, label: l }) =>
            active && payload?.length ? (
              <TipBox
                title={label(Number(l), g, true)}
                rows={[
                  ...series.map((s) => ({ color: s.color, label: s.name, value: money(i18n, Number(payload[0].payload[s.key]), asset) })),
                  { label: t('stats.net'), value: money(i18n, Number(payload[0].payload.net), asset, { sign: true }) },
                ]}
              />
            ) : null
          }
        />
        <Legend itemSorter={null} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 13, color: c.text }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- balance over time ----

export function BalanceChart({
  points,
  g,
  asset,
  height = 280,
}: {
  points: { start: number; balance: number }[];
  g: Granularity;
  asset: Asset | undefined;
  height?: number;
}) {
  const i18n = useI18n();
  const { t, locale } = i18n;
  const c = useChartColors();
  const label = useBucketLabel();
  const color = c.series[0];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="balFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="start" tickFormatter={(v) => label(v, g)} tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.axis }} tickLine={false} minTickGap={20} />
        <YAxis tickFormatter={(v) => compact(v, locale)} tick={{ fill: c.muted, fontSize: 12 }} axisLine={false} tickLine={false} width={48} domain={['auto', 'auto']} />
        <Tooltip
          cursor={{ stroke: c.axis, strokeWidth: 1 }}
          content={({ active, payload, label: l }) =>
            active && payload?.length ? (
              <TipBox
                title={label(Number(l), g, true)}
                rows={[{ color, label: t('stats.balance'), value: money(i18n, Number(payload[0].value), asset) }]}
              />
            ) : null
          }
        />
        <Area type="monotone" dataKey="balance" stroke={color} strokeWidth={2} fill="url(#balFill)" dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: c.surface }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ---- share of a whole (categories, ...) ----

export interface Slice {
  key: string;
  label: string;
  value: number;
}

const MAX_SLICES = 7;

/** Donut with at most 7 named slices + "Other", legend with values next to it. */
export function Donut({ slices, asset, otherLabel, onPick }: { slices: Slice[]; asset: Asset | undefined; otherLabel: string; onPick?: (key: string) => void }) {
  const i18n = useI18n();
  const c = useChartColors();
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, MAX_SLICES);
  const rest = sorted.slice(MAX_SLICES).reduce((s, x) => s + x.value, 0);
  const data = rest > 0 ? [...shown, { key: '__other', label: otherLabel, value: rest }] : shown;
  const total = data.reduce((s, x) => s + x.value, 0);
  if (!total) return <p className="muted chart-empty">{i18n.t('analytics.noData')}</p>;
  const color = (i: number) => (data[i].key === '__other' ? c.muted : c.series[i % 8]);
  return (
    <div className="donut">
      <div className="donut-chart">
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="92%"
              paddingAngle={1}
              stroke={c.surface}
              strokeWidth={2}
              isAnimationActive={false}
              onClick={(d) => onPick && (d as unknown as Slice).key !== '__other' && onPick((d as unknown as Slice).key)}
            >
              {data.map((d, i) => (
                <Cell key={d.key} fill={color(i)} cursor={onPick && d.key !== '__other' ? 'pointer' : undefined} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <TipBox
                    title={String(payload[0].name)}
                    rows={[
                      {
                        label: `${Math.round((Number(payload[0].value) / total) * 1000) / 10}%`,
                        value: money(i18n, Number(payload[0].value), asset),
                      },
                    ]}
                  />
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="donut-center">
          <strong>{money(i18n, total, asset)}</strong>
        </div>
      </div>
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.key}>
            <span className="chart-tip-key" style={{ background: color(i) }} />
            <span className="donut-legend-label">{d.label}</span>
            <span className="muted">{Math.round((d.value / total) * 100)}%</span>
            <strong>{money(i18n, d.value, asset)}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- single series bars (weekday / hour distribution) ----

export function CountBars({ labels, values, height = 200, name }: { labels: string[]; values: number[]; height?: number; name: string }) {
  const c = useChartColors();
  const data = labels.map((l, i) => ({ l, v: values[i] }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke={c.grid} />
        <XAxis dataKey="l" tick={{ fill: c.muted, fontSize: 12 }} axisLine={{ stroke: c.axis }} tickLine={false} interval="preserveStartEnd" />
        <YAxis allowDecimals={false} tick={{ fill: c.muted, fontSize: 12 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip
          cursor={{ fill: c.grid, opacity: 0.5 }}
          content={({ active, payload }) =>
            active && payload?.length ? <TipBox title={String(payload[0].payload.l)} rows={[{ color: c.series[0], label: name, value: String(payload[0].value) }]} /> : null
          }
        />
        <Bar dataKey="v" name={name} fill={c.series[0]} radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal bar list (rankings) - plain HTML, value labels in text ink. */
export function BarList({ rows, color }: { rows: { key: string; label: ReactNode; value: number; text: string; href?: string }[]; color?: string }) {
  const c = useChartColors();
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="bar-list">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="bar-list-label">{r.label}</span>
            <span className="bar-list-track">
              <span className="bar-list-fill" style={{ width: `${(Math.abs(r.value) / max) * 100}%`, background: color ?? c.series[0] }} />
            </span>
            <span className="bar-list-value">{r.text}</span>
          </>
        );
        return <li key={r.key}>{r.href ? <a href={r.href}>{inner}</a> : <div>{inner}</div>}</li>;
      })}
    </ul>
  );
}
