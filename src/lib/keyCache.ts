/**
 * Keeps the encryption key in this browser for a while, so reloads and new tabs
 * don't ask for it again.
 *
 * The key is a non-extractable CryptoKey: IndexedDB stores the object itself, its
 * bytes can't be read back by any script, they never reach localStorage or the
 * spreadsheet. Every open tab of the app keeps extending the record; once nothing
 * has extended it for TTL (all tabs closed, browser quit or crashed) it is dead and
 * gets deleted on the next start.
 *
 * Each remember() gets its own token, and a tab only extends the record that still
 * carries its token: a tab holding an old key (re-keyed or signed out elsewhere)
 * never brings a deleted or replaced record back.
 */
const DB = 'cashbook-keys';
const STORE = 'keys';
const TTL_MS = 60 * 60_000;
const HEARTBEAT_MS = 60_000;

interface KeyRecord {
  key: CryptoKey;
  token: string;
  expiresAt: number;
}

let current: { sheetId: string; key: CryptoKey; token: string } | null = null;
let heartbeat: ReturnType<typeof setInterval> | undefined;

// one connection, so transactions run in the order they were asked for (a put never lands after a delete)
let conn: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  conn ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      // v1 kept per-tab records - drop them
      if (r.result.objectStoreNames.contains(STORE)) r.result.deleteObjectStore(STORE);
      r.result.createObjectStore(STORE);
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      conn = null;
      reject(r.error);
    };
  });
  return conn;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db();
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const quiet = (p: Promise<unknown>) => void p.catch(() => {});

/** Moves the expiry of this tab's record forward, if the record is still the one it wrote. */
function extend() {
  const c = current;
  if (!c) return;
  quiet(
    run('readwrite', (s) => {
      const req = s.get(c.sheetId);
      req.onsuccess = () => {
        const rec = req.result as KeyRecord | undefined;
        if (rec?.token === c.token) s.put({ ...rec, expiresAt: Date.now() + TTL_MS }, c.sheetId);
        else if (current === c) stop();
      };
    }),
  );
}

function stop() {
  current = null;
  clearInterval(heartbeat);
}

/** Deletes records whose time is up. */
function sweep() {
  const now = Date.now();
  quiet(
    run('readwrite', (s) => {
      const req = s.openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        if ((c.value as KeyRecord).expiresAt <= now) c.delete();
        c.continue();
      };
    }),
  );
}

/** The key kept for the spreadsheet, if it is still alive. This tab then keeps it alive too. */
export async function recallKey(sheetId: string): Promise<CryptoKey | null> {
  try {
    sweep();
    const rec = await run<KeyRecord | undefined>('readonly', (s) => s.get(sheetId));
    if (!rec || rec.expiresAt <= Date.now() || !(rec.key instanceof CryptoKey)) return null;
    follow(sheetId, rec.key, rec.token);
    return rec.key;
  } catch {
    return null; // IndexedDB unavailable - the key is just asked again
  }
}

function follow(sheetId: string, key: CryptoKey, token: string) {
  current = { sheetId, key, token };
  extend();
  clearInterval(heartbeat);
  heartbeat = setInterval(extend, HEARTBEAT_MS);
}

/** Keeps the key for reloads and other tabs while any tab of the app stays open. */
export function rememberKey(sheetId: string, key: CryptoKey) {
  if (key.extractable) return; // only keys whose bytes can't leave WebCrypto are kept
  if (current?.sheetId === sheetId && current.key === key) return extend(); // recalled or remembered already
  const token = crypto.randomUUID();
  const rec: KeyRecord = { key, token, expiresAt: Date.now() + TTL_MS };
  quiet(run('readwrite', (s) => s.put(rec, sheetId)));
  follow(sheetId, key, token);
}

/** Drops every kept key (sign-out, other spreadsheet, encryption off, key no longer fits). */
export function forgetKey() {
  stop();
  quiet(run('readwrite', (s) => s.clear()));
}
