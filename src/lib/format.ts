import type { I18n } from '../i18n';
import type { AssetMap } from './stats';
import type { Asset } from './types';

/** "1 250.5 ₴" / "12.4 USDT" - symbol when the asset has one (a picture or not), otherwise its code. */
export function money(i18n: Pick<I18n, 'num'>, n: number, asset: Asset | undefined, { sign = false } = {}): string {
  const digits = asset?.decimals ?? 2;
  const abs = i18n.num(Math.abs(n), digits);
  const s = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  if (!asset) return `${s}${abs}`;
  return asset.symbol ? `${s}${abs} ${asset.symbol}` : `${s}${abs} ${asset.code}`;
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

/** Parses a typed amount: accepts "1 234,5" and "1234.5". Returns null when not a number. */
export function parseAmount(s: string): number | null {
  const v = s.replace(/\s/g, '').replace(',', '.');
  if (!v || !/^-?\d*\.?\d*$/.test(v) || v === '.' || v === '-') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Amount -> text for an input field, without grouping. */
export const amountInput = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/**
 * A requisite as it reads best: a card number in groups of four ("4149 4999 1234 5678"); an IBAN
 * as it is, in one piece ("UA653220010000026006380055097"); a long one that is neither (a crypto
 * address) shortened in the middle ("TQ5rGfP2…q9fXkL"); anything else as it is.
 */
export function formatRequisite(r: string): string {
  const v = r.trim();
  const compact = v.replace(/\s+/g, '');
  if (/^\d{13,19}$/.test(compact)) return compact.replace(/(.{4})(?=.)/g, '$1 ');
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(compact)) return compact;
  if (compact.length > 30 && !/\s/.test(v)) return `${compact.slice(0, 8)}…${compact.slice(-6)}`;
  return v;
}
