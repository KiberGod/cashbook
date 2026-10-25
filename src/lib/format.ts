import type { I18n } from '../i18n';
import type { AssetMap } from './stats';
import type { Asset } from './types';

/** "1 250.5 ₴" / "12.4 USDT" - symbol when the asset has one, otherwise its code. */
export function money(i18n: Pick<I18n, 'num'>, n: number, asset: Asset | undefined, { sign = false } = {}): string {
  const digits = asset?.decimals ?? 2;
  const abs = i18n.num(Math.abs(n), digits);
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  if (!asset) return `${s}${abs}`;
  return asset.symbol && !asset.image ? `${s}${abs} ${asset.symbol}` : `${s}${abs} ${asset.code}`;
}

/** Non-zero entries of an asset map, ordered by the asset list order. */
export function entries(m: AssetMap, assets: Asset[], { keepZero = false } = {}): [Asset, number][] {
  const out: [Asset, number][] = [];
  for (const a of assets) {
    const v = m.get(a.id);
    if (v === undefined) continue;
    if (v !== 0 || keepZero) out.push([a, v]);
  }
  return out;
}

/** <input type="datetime-local"> value for an ISO date (local time). */
export function toLocalInput(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** <input type="date"> value (local) for a date. */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parses a typed amount: accepts "1 234,5" and "1234.5". Returns null when not a number. */
export function parseAmount(s: string): number | null {
  const v = s.replace(/\s/g, '').replace(',', '.');
  if (!v || !/^-?\d*\.?\d*$/.test(v) || v === '.' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Amount -> text for an input field, without grouping. */
export const amountInput = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
