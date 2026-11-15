import { useEffect, useRef, type ChangeEvent, type InputHTMLAttributes } from 'react';

// a sum beyond trillions is a typo, and more digits than this lose precision in a JS number
const MAX_INT_DIGITS = 13;

/**
 * Text -> what an amount field may hold: digits and one decimal separator ("," or ".", the one
 * typed is kept), no sign, no spaces, letters or other marks. Leading zeros are dropped ("007" ->
 * "7"), a separator typed first gets its zero (",5" -> "0,5"), and no more decimals than `decimals`.
 */
export function cleanAmount(raw: string, decimals?: number): string {
  const s = raw.replace(/[^\d.,]/g, '');
  const at = s.search(/[.,]/);
  let int = (at < 0 ? s : s.slice(0, at)).replace(/^0+(?=\d)/, '').slice(0, MAX_INT_DIGITS);
  if (at < 0 || decimals === 0) return int;
  if (!int) int = '0';
  let frac = s.slice(at + 1).replace(/[.,]/g, '');
  if (decimals !== undefined) frac = frac.slice(0, decimals);
  return int + s[at] + frac;
}

/**
 * A text field for a sum of money that lets in only what a non-negative number is made of:
 * anything else typed or pasted ("-", letters, a second separator, a currency sign) is left out
 * as it comes, and the caret stays where it was.
 */
export function AmountInput({
  value,
  onChange,
  decimals,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'> & {
  value: string;
  onChange: (v: string) => void;
  /** the asset's decimals: no more digits after the separator than it has */
  decimals?: number;
}) {
  // another asset with fewer decimals cuts the digits it doesn't have (not on opening: a value
  // given to start with, e.g. a balance now, is shown as it is until it is edited)
  const shownDecimals = useRef(decimals);
  useEffect(() => {
    if (shownDecimals.current === decimals) return;
    shownDecimals.current = decimals;
    const clean = cleanAmount(value, decimals);
    if (clean !== value) onChange(clean);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decimals]);

  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const el = e.target;
    const raw = el.value;
    const next = cleanAmount(raw, decimals);
    if (next !== raw) {
      // the caret after what is kept of the text before it
      const caret = Math.min(next.length, cleanAmount(raw.slice(0, el.selectionStart ?? raw.length), decimals).length);
      el.value = next;
      el.setSelectionRange(caret, caret);
    }
    if (next !== value) onChange(next);
  };

  return <input {...rest} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={change} />;
}
