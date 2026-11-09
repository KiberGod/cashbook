import { useEffect, useState, type ReactNode } from 'react';

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

/** a + (b - a) * t for two #rrggbb colours */
function mixHex(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * 15 colours for charts with many groups: the 8 validated series, then the first 7 of them
 * faded towards the surface (lighter in the light theme, deeper in the dark one). The faded
 * ones are told apart by their place and the legend / hover, not by hue alone.
 */
export function extendedSeries(c: ChartColors): string[] {
  return [...c.series, ...c.series.slice(0, 7).map((x) => mixHex(x, c.surface, 0.5))];
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

export function ChartCard({ title, children, actions, note }: { title: ReactNode; children: ReactNode; actions?: ReactNode; note?: ReactNode }) {
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
