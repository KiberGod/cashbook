import { useEffect, useRef, useState } from 'react';
import { saveSetting } from '../lib/ops';
import { mutate, useStore } from '../store/store';

/** How long a change waits before it is written (typing a date changes it many times). */
const WRITE_DELAY_MS = 500;

/**
 * A setting kept in the spreadsheet (see `Setting`): it follows the user to any device. It is
 * applied at once here and written a moment after the last change; one changed elsewhere (the
 * spreadsheet re-read) is taken up while nothing waits to be written. A stored value missing
 * fields (written by an older version) gets them from `fallback`.
 */
export function useSheetSetting<T extends object>(id: string, fallback: T): [T, (next: T | ((prev: T) => T)) => void] {
  const stored = useStore((s) => s.data.settings.find((x) => x.id === id)?.value);
  const parse = (v: string | undefined): T => {
    if (!v) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(v) as Partial<T>) };
    } catch {
      return fallback;
    }
  };
  const [value, setValue] = useState<T>(() => parse(stored));
  const latest = useRef(value);
  const pending = useRef<number | undefined>(undefined);

  const write = (v: T) => mutate((d) => saveSetting(d, id, JSON.stringify(v)));

  useEffect(() => {
    if (pending.current !== undefined || stored === JSON.stringify(latest.current)) return;
    const v = parse(stored);
    latest.current = v;
    setValue(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored, id]);

  // leaving (another contact, the page closed in the app): what waits is written right away
  useEffect(
    () => () => {
      if (pending.current === undefined) return;
      window.clearTimeout(pending.current);
      pending.current = undefined;
      write(latest.current);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [id],
  );

  const set = (next: T | ((prev: T) => T)) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(latest.current) : next;
    latest.current = v;
    setValue(v);
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      write(latest.current);
    }, WRITE_DELAY_MS);
  };
  return [value, set];
}
