import { useSyncExternalStore } from 'react';
import type { Lang } from '../i18n';
import { createBackend, needsGoogle, type Dirty, type SheetBackend } from '../lib/backend';
import { AppError, toAppError } from '../lib/errors';
import { CLIENT_ID, forgetToken, getValidToken, loadGis, requestToken, signOut } from '../lib/googleAuth';
import { isLocalSheetId } from '../lib/localSheets';
import { presetData } from '../lib/presets';
import { InvalidStructureError } from '../lib/schema';
import { parseSpreadsheetId } from '../lib/sheetsApi';
import { settings } from '../lib/storage';
import { EMPTY_DATA, ENTITY_KINDS, type Data, type EntityKind } from '../lib/types';

/**
 * connect  - no spreadsheet yet (link form)
 * auth     - spreadsheet known, Google sign-in needed
 * loading  - reading the spreadsheet
 * setup    - blank spreadsheet: choose encryption, then preset data is written
 * unlock   - encrypted spreadsheet: waiting for the key
 * ready    - working
 * error    - the spreadsheet could not be loaded
 */
export type Phase = 'connect' | 'auth' | 'loading' | 'setup' | 'unlock' | 'ready' | 'error';
export type SyncState = 'idle' | 'pending' | 'saving' | 'error';

export interface State {
  phase: Phase;
  /** fatal load error (phase = error) or form error (connect / auth / setup) */
  error: AppError | null;
  data: Data;
  title: string;
  encrypted: boolean;
  sync: SyncState;
  syncError: AppError | null;
  refreshing: boolean;
  /** bumps on every successful load, so pages can show a toast */
  loadedAt: number;
}

const SAVE_DEBOUNCE_MS = 500;
const AUTO_REFRESH_AFTER_MS = 60_000;

let state: State = {
  phase: 'loading',
  error: null,
  data: EMPTY_DATA,
  title: '',
  encrypted: false,
  sync: 'idle',
  syncError: null,
  refreshing: false,
  loadedAt: 0,
};

const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}
export const getState = () => state;

// ---------------------------------------------------------------------------

/** One backend per connected spreadsheet - it keeps the encryption key in memory only. */
let backend: SheetBackend | null = null;
let backendFor = '';
let dirty: Dirty = new Map();
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | null = null;

const hasDirty = () => [...dirty.values()].some((s) => s.size > 0);

function backendOf(sheetId: string): SheetBackend {
  if (!backend || backendFor !== sheetId) {
    backend = createBackend(sheetId);
    backendFor = sheetId;
  }
  return backend;
}

export const getBackend = () => backend;

function ready(data: Data, title: string) {
  dirty = new Map();
  set({
    phase: 'ready',
    data,
    title,
    encrypted: backend?.encrypted ?? false,
    error: null,
    sync: 'idle',
    syncError: null,
    refreshing: false,
    loadedAt: Date.now(),
  });
  // a spreadsheet from an older version is upgraded right after it is shown
  void backend?.finishLoad(data).catch((e) => set({ sync: 'error', syncError: toAppError(e) }));
}

/** Opens the spreadsheet and moves to the phase that follows from its state. */
async function open(sheetId: string, verifyWrite: boolean) {
  const b = backendOf(sheetId);
  const r = await b.open({ verifyWrite });
  const sheet = settings.getSheet();
  if (sheet && sheet.id === sheetId && r.title !== sheet.title) settings.setSheet({ ...sheet, title: r.title });
  if (r.status === 'ready') return ready(r.data, r.title);
  if (r.status === 'blank') return set({ phase: 'setup', title: r.title, error: null, refreshing: false });
  // encrypted: a reload in the same session reuses the key that is already in memory
  return set({ phase: 'unlock', title: r.title, encrypted: true, error: null, refreshing: false });
}

function fail(e: unknown) {
  const err = e instanceof InvalidStructureError ? new AppError('invalid', undefined, e.issues) : toAppError(e);
  if (err.code === 'auth') {
    forgetToken();
    return set({ phase: 'auth', refreshing: false, error: null });
  }
  set({ phase: 'error', error: err, refreshing: false });
}

export async function init() {
  if (CLIENT_ID) loadGis().catch(() => {}); // preload so the sign-in popup opens instantly on click
  const sheet = settings.getSheet();
  if (!sheet) return set({ phase: 'connect', error: CLIENT_ID ? null : new AppError('noClientId') });
  if (needsGoogle(sheet.id) && !getValidToken()) return set({ phase: 'auth', title: sheet.title ?? '' });
  await reload({ initial: true });
}

/** First connection of a spreadsheet link. Must be called from a click handler. */
export async function connect(link: string) {
  const id = parseSpreadsheetId(link) ?? (isLocalSheetId(link.trim()) ? link.trim() : null);
  if (!id) return set({ error: new AppError('badLink') });
  set({ error: null, refreshing: true });
  try {
    if (needsGoogle(id) && !getValidToken()) await requestToken();
    backend = null;
    settings.setSheet({ id, url: link.trim() });
    await open(id, true);
  } catch (e) {
    backend = null;
    const err = e instanceof InvalidStructureError ? new AppError('invalid', undefined, e.issues) : toAppError(e);
    set({ phase: 'connect', error: err, refreshing: false });
  }
}

/** Sign-in for an already connected spreadsheet. Must be called from a click handler. */
export async function signIn() {
  try {
    await requestToken();
  } catch (e) {
    const err = toAppError(e);
    if (state.phase === 'ready') return set({ sync: 'error', syncError: err });
    return set({ phase: 'auth', error: err });
  }
  if (state.phase === 'ready') {
    // session renewed mid-work: push what's queued, then continue
    set({ syncError: null });
    if (hasDirty()) await flush();
    if (!hasDirty() && state.sync !== 'error') await reload();
  } else {
    await reload({ initial: true });
  }
}

/** Re-reads the spreadsheet. Pending local changes are saved first. */
export async function reload({ initial = false } = {}) {
  const sheet = settings.getSheet();
  if (!sheet) return set({ phase: 'connect' });
  if (needsGoogle(sheet.id) && !getValidToken()) {
    if (initial || state.phase !== 'ready') return set({ phase: 'auth', title: sheet.title ?? '' });
    return set({ sync: 'error', syncError: new AppError('auth') });
  }
  if (!initial && hasDirty()) {
    await flush();
    if (state.sync === 'error') return; // don't overwrite unsaved changes with remote data
  }

  if (state.phase === 'ready') set({ refreshing: true });
  else set({ phase: 'loading', error: null });

  try {
    await open(sheet.id, false);
  } catch (e) {
    fail(e);
  }
}

/** Encrypted spreadsheet: checks the key. Returns false when it does not fit. */
export async function unlock(password: string): Promise<boolean> {
  if (!backend) return false;
  try {
    const data = await backend.unlock(password);
    if (!data) return false;
    ready(data, state.title);
    return true;
  } catch (e) {
    fail(e);
    return true;
  }
}

/** Blank spreadsheet: creates the structure (optionally encrypted) with preset data. */
export async function setupSpreadsheet(password: string | null, lang: Lang) {
  if (!backend) return;
  set({ refreshing: true, error: null });
  try {
    const data = presetData(lang);
    await backend.initialize(password, data);
    ready(data, state.title);
  } catch (e) {
    set({ refreshing: false, error: toAppError(e) });
  }
}

export async function disconnect() {
  if (hasDirty()) await flush(); // best effort - don't lose the last edits
  clearTimeout(saveTimer);
  dirty = new Map();
  backend = null;
  backendFor = '';
  settings.setSheet(null);
  set({ phase: 'connect', data: EMPTY_DATA, title: '', encrypted: false, error: null, sync: 'idle', syncError: null, refreshing: false });
}

export async function logout() {
  await disconnect();
  signOut();
}

// ---- mutations & saving ----

/** Ids of entities that differ between two Data snapshots (by object identity). */
function diff(prev: Data, next: Data, into: Dirty) {
  for (const kind of ENTITY_KINDS) {
    const a = prev[kind] as { id: string }[];
    const b = next[kind] as { id: string }[];
    if (a === b) continue;
    const ids = into.get(kind) ?? new Set<string>();
    const before = new Map(a.map((x) => [x.id, x]));
    const after = new Set<string>();
    for (const x of b) {
      after.add(x.id);
      if (before.get(x.id) !== x) ids.add(x.id);
    }
    for (const id of before.keys()) if (!after.has(id)) ids.add(id);
    if (ids.size) into.set(kind, ids);
  }
}

/** Applies a local change immediately and schedules writing the changed rows. */
export function mutate(fn: (d: Data) => Data) {
  if (state.phase !== 'ready') return;
  const next = fn(state.data);
  if (next === state.data) return;
  diff(state.data, next, dirty);
  set({ data: next, sync: state.sync === 'error' ? 'error' : 'pending' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

export async function flush(): Promise<void> {
  clearTimeout(saveTimer);
  if (saving) {
    await saving;
    if (!hasDirty()) return;
  }
  if (!backend || !hasDirty()) return;
  const sheet = settings.getSheet();
  if (sheet && needsGoogle(sheet.id) && !getValidToken()) {
    return set({ sync: 'error', syncError: new AppError('auth') });
  }

  const batch = dirty;
  dirty = new Map();
  set({ sync: 'saving' });
  saving = backend
    .save(state.data, batch)
    .then(() => set({ sync: hasDirty() ? 'pending' : 'idle', syncError: null }))
    .catch((e) => {
      for (const [k, ids] of batch) {
        const into = dirty.get(k) ?? new Set<string>();
        ids.forEach((id) => into.add(id));
        dirty.set(k, into);
      }
      const err = toAppError(e);
      if (err.code === 'auth') forgetToken();
      set({ sync: 'error', syncError: err });
    })
    .finally(() => (saving = null));
  await saving;
  if (hasDirty() && state.sync !== 'error') {
    saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }
}

/**
 * Turns encryption on (password = the new key) or off (null). Pending edits are saved
 * first; saves wait until the spreadsheet has been rewritten in the new format.
 */
export async function setEncryption(password: string | null) {
  if (!backend || state.phase !== 'ready') return;
  await flush();
  if (state.sync === 'error') throw state.syncError ?? new AppError('unknown');
  const b = backend;
  const run = b.setEncryption(state.data, password);
  saving = run.catch(() => {}).finally(() => (saving = null));
  set({ sync: 'saving' });
  try {
    await run;
    set({ encrypted: b.encrypted });
  } finally {
    set({ sync: hasDirty() ? 'pending' : 'idle' });
  }
  if (hasDirty()) saveTimer = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
}

/** Encryption was switched on another device: local edits can't be written - drop them and re-read. */
export async function discardAndReload() {
  clearTimeout(saveTimer);
  dirty = new Map();
  set({ sync: 'idle', syncError: null });
  await reload();
}

/** True when the password is the current key (asked again before encryption is turned off). */
export const verifyKey = (password: string) => backend?.verifyKey(password) ?? Promise.resolve(false);

export const hasUnsavedChanges = () => hasDirty() || saving !== null;

/** Dev only: replaces everything in the spreadsheet (test data generator). */
export async function replaceAllData(data: Data) {
  if (!backend || state.phase !== 'ready') return;
  await flush();
  set({ sync: 'saving' });
  try {
    await backend.rewriteAll(data);
    ready(data, state.title);
  } catch (e) {
    set({ sync: 'error', syncError: toAppError(e) });
  }
}

export type { EntityKind };

// ---- lifecycle hooks ----

window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    void flush();
    e.preventDefault();
  }
});

document.addEventListener('visibilitychange', () => {
  // Coming back to the tab (e.g. phone after using the PC): pick up remote edits.
  if (document.visibilityState !== 'visible') return;
  if (state.phase !== 'ready' || state.refreshing || hasUnsavedChanges() || state.sync === 'error') return;
  const sheet = settings.getSheet();
  if (!sheet || (needsGoogle(sheet.id) && !getValidToken())) return;
  if (Date.now() - state.loadedAt > AUTO_REFRESH_AFTER_MS) void reload();
});
