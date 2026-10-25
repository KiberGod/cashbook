/** Small wrapper over localStorage that never throws (private mode, blocked storage, ...). */
const PREFIX = 'cashbook.';

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown) {
  try {
    if (value === undefined || value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* storage unavailable - settings just won't persist */
  }
}

export interface SheetSettings {
  id: string;
  url: string;
  title?: string;
}

const MAX_RECENT = 5;

export const settings = {
  getSheet: () => readJson<SheetSettings | null>('sheet', null),
  setSheet: (s: SheetSettings | null) => {
    writeJson('sheet', s);
    if (s) {
      const rest = settings.getRecent().filter((r) => r.id !== s.id);
      writeJson('recentSheets', [s, ...rest].slice(0, MAX_RECENT));
    }
  },
  /** spreadsheets connected on this device before, newest first - for quick switching */
  getRecent: () => readJson<SheetSettings[]>('recentSheets', []),
  forgetRecent: (id: string) =>
    writeJson(
      'recentSheets',
      settings.getRecent().filter((r) => r.id !== id),
    ),
};

/** A remembered UI preference (page size, chart mode, ...) - per device. */
export function readPref<T>(key: string, fallback: T): T {
  return readJson<T>(`pref.${key}`, fallback);
}

export function writePref(key: string, value: unknown) {
  writeJson(`pref.${key}`, value);
}
