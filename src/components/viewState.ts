import { useCallback, useState } from 'react';

/**
 * A page's view state (search, filters, list page) that survives leaving the page and
 * coming back, e.g. opening a record and pressing Back. It lives for this tab's session:
 * kept in memory and in sessionStorage (so a reload keeps it too), never in localStorage.
 */
const PREFIX = 'cashbook.view.';
const memory = new Map<string, unknown>();

function load<T>(key: string, initial: T | (() => T)): T {
  if (memory.has(key)) return memory.get(key) as T;
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (raw !== null) {
      const v = JSON.parse(raw) as T;
      memory.set(key, v);
      return v;
    }
  } catch {
    /* storage unavailable or a broken value - start from the default */
  }
  return typeof initial === 'function' ? (initial as () => T)() : initial;
}

function save(key: string, value: unknown) {
  memory.set(key, value);
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* memory still has it for this page session */
  }
}

/** Like useState, remembered under `key`; a new key (another record, another link) starts from its own value. */
export function useViewState<T>(key: string, initial: T | (() => T)): [T, (v: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState(() => ({ key, value: load(key, initial) }));
  let current = state;
  if (state.key !== key) {
    current = { key, value: load(key, initial) };
    setState(current);
  }
  const set = useCallback(
    (v: T | ((prev: T) => T)) =>
      setState((s) => {
        const value = typeof v === 'function' ? (v as (prev: T) => T)(s.value) : v;
        save(s.key, value);
        return { key: s.key, value };
      }),
    [],
  );
  return [current.value, set];
}
