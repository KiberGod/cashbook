import { AppError } from './errors';
import { CIPHER_NAME, KDF_NAME, createKey, decryptText, encryptText, isEncryptedCell, keyMatches, unlockKey } from './crypto';
import { getValidToken } from './googleAuth';
import { migrate, type RawTables } from './migrations';
import {
  APP_NAME,
  ENCRYPTED_HEADER,
  InvalidStructureError,
  SCHEMA_VERSION,
  SHEETS,
  cellsToRecord,
  fromRecord,
  headerOf,
  isBlankRow,
  isBlankSheet,
  metaRows,
  parseMeta,
  recordToCells,
  str,
  toRecord,
  validateData,
  type Cell,
  type MetaInfo,
  type RawRecord,
  type Rows,
  type ValidationIssue,
} from './schema';
import { SheetsApi, quoteSheet, type SheetIO, type SheetInfo } from './sheetsApi';
import { ENTITY_KINDS, EMPTY_DATA, type Data, type EntityKind } from './types';
import { APP_VERSION } from './version';

type SheetKey = EntityKind | 'meta';
const ALL_KEYS: SheetKey[] = ['meta', ...ENTITY_KINDS];
const GRID_STEP = 500;

const colLetter = (n: number) => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export type OpenResult =
  | { status: 'blank'; title: string }
  | { status: 'locked'; title: string }
  | { status: 'ready'; title: string; data: Data };

/** Which entities changed since the last save, per kind. */
export type Dirty = Map<EntityKind, Set<string>>;

/**
 * Reads and writes the spreadsheet. Records are written row by row: a changed entity
 * rewrites only its own row, a new one takes a free row, a deleted one blanks its row
 * (blank rows are reused later). That keeps saves small even with years of
 * transactions and lets every row be encrypted separately.
 */
export class SheetBackend {
  private io: SheetIO;
  private meta: MetaInfo | null = null;
  private key: CryptoKey | null = null;
  private raw: Partial<Record<SheetKey, Rows>> = {};
  private grid = new Map<SheetKey, { sheetId: number; rowCount: number; columnCount: number }>();
  /** spreadsheet row (1-based) of every entity */
  private rowOf = new Map<EntityKind, Map<string, number>>();
  private free = new Map<EntityKind, number[]>();
  private nextRow = new Map<EntityKind, number>();
  /** set when the spreadsheet needs a full rewrite after loading (migration) */
  private needsRewrite = false;

  constructor(io: SheetIO) {
    this.io = io;
  }

  get encrypted() {
    return !!this.meta && this.meta.encryption !== 'none';
  }

  /** The current key (null for a plain or still locked spreadsheet). */
  get cryptoKey(): CryptoKey | null {
    return this.encrypted ? this.key : null;
  }

  /** A key kept from before a page reload; open() checks it against the spreadsheet. */
  adoptKey(key: CryptoKey) {
    this.key ??= key;
  }

  /**
   * Reads everything in one request. A blank file needs setup, an encrypted one needs
   * the key (see unlock); a plain one is decoded and validated right away.
   * verifyWrite: make a harmless write to prove the account can edit the file.
   */
  async open({ verifyWrite }: { verifyWrite: boolean }): Promise<OpenResult> {
    const info = await this.io.info();
    const byTitle = new Map(info.sheets.map((s) => [s.title, s]));
    const own = new Set(Object.values(SHEETS));
    const present = ALL_KEYS.filter((k) => byTitle.has(SHEETS[k]));
    const foreign = present.length ? [] : info.sheets.filter((s) => !own.has(s.title));

    const ranges = [...present.map((k) => quoteSheet(SHEETS[k])), ...foreign.map((s) => quoteSheet(s.title))];
    const results = await this.io.batchGet(ranges);
    this.raw = {};
    present.forEach((k, i) => (this.raw[k] = results[i]));
    for (const k of present) {
      const s = byTitle.get(SHEETS[k])!;
      this.grid.set(k, { sheetId: s.sheetId, rowCount: s.rowCount, columnCount: s.columnCount });
    }

    if (!present.length) {
      const dirty = foreign.filter((_, i) => !isBlankSheet(results[i]));
      if (dirty.length) {
        throw new AppError('invalid', undefined, dirty.map((s) => ({ sheet: s.title, code: 'foreignData' })));
      }
      this.blankSheets = foreign;
      return { status: 'blank', title: info.title };
    }

    const { meta, ok } = parseMeta(this.raw.meta);
    const issues: ValidationIssue[] = [];
    if (!ok) issues.push({ sheet: SHEETS.meta, code: 'notCashbook' });
    else if (meta.app !== APP_NAME) issues.push({ sheet: SHEETS.meta, code: 'notCashbook', value: meta.app });
    else if (!meta.schema || meta.schema > SCHEMA_VERSION) {
      issues.push({ sheet: SHEETS.meta, code: meta.schema ? 'newerSchema' : 'badMeta', value: String(meta.schema ?? '') });
    }
    for (const k of ENTITY_KINDS) if (!byTitle.has(SHEETS[k])) issues.push({ sheet: SHEETS[k], code: 'missingSheet' });
    const enc = meta.encryption && meta.encryption !== 'none';
    if (ok && enc && (meta.encryption !== CIPHER_NAME || meta.kdf !== KDF_NAME || !meta.salt || !meta.check || !meta.iterations)) {
      issues.push({ sheet: SHEETS.meta, code: 'badMeta', value: 'encryption' });
    }
    if (issues.length) throw new AppError('invalid', undefined, issues);
    this.meta = meta as MetaInfo;

    if (verifyWrite) await this.writeMeta(); // proves edit access before the user starts working

    // a reload reuses the key (kept in memory or adopted), unless the spreadsheet was re-keyed meanwhile
    if (enc && this.key && !(await keyMatches(this.key, this.meta.check))) this.key = null;
    if (enc && !this.key) return { status: 'locked', title: info.title };
    return { status: 'ready', title: info.title, data: await this.decode() };
  }

  private blankSheets: SheetInfo[] = [];

  /** Checks the key; on success decodes (and validates) the data. Returns null for a wrong key. */
  async unlock(password: string): Promise<Data | null> {
    const m = this.meta!;
    const key = await unlockKey(password, { salt: m.salt, iterations: m.iterations }, m.check);
    if (!key) return null;
    this.key = key;
    return this.decode();
  }

  /** True when the password is the current key of the spreadsheet. */
  async verifyKey(password: string): Promise<boolean> {
    const m = this.meta!;
    if (!this.encrypted) return false;
    return !!(await unlockKey(password, { salt: m.salt, iterations: m.iterations }, m.check));
  }

  /** Writes the result of a load that had to be migrated. Call after the data is shown. */
  async finishLoad(data: Data) {
    if (!this.needsRewrite) return;
    this.meta = { ...this.meta!, schema: SCHEMA_VERSION };
    await this.rewriteAll(data, { withMeta: true });
    this.needsRewrite = false;
  }

  private async decode(): Promise<Data> {
    const issues: ValidationIssue[] = [];
    const lines = new Map<string, number>();
    const tables = {} as RawTables;
    const rowLists = new Map<EntityKind, { id: string; line: number }[]>();

    for (const kind of ENTITY_KINDS) {
      const sheet = SHEETS[kind];
      const rows = this.raw[kind] ?? [];
      const header = (rows[0] ?? []).map(str);
      const records: RawRecord[] = [];
      const placed: { id: string; line: number }[] = [];
      const free: number[] = [];

      const expected = this.encrypted ? [ENCRYPTED_HEADER] : headerOf(kind);
      const headerOk = this.encrypted
        ? header[0] === ENCRYPTED_HEADER
        : this.meta!.schema < SCHEMA_VERSION
          ? header.includes('id') // older layouts are mapped by column name, migrations fill the rest
          : expected.every((h) => header.includes(h));
      if (!isBlankSheet(rows) && !headerOk) {
        issues.push({ sheet, row: 1, code: 'badHeader' });
        tables[kind] = [];
        continue;
      }

      const body = rows.slice(1);
      const decoded = await Promise.all(
        body.map(async (row, i): Promise<RawRecord | 'blank' | ValidationIssue> => {
          const line = i + 2;
          if (isBlankRow(row)) return 'blank';
          if (!this.encrypted) return cellsToRecord(header, row);
          const cell = row[0];
          if (!isEncryptedCell(cell) || row.slice(1).some((c) => str(c) !== '')) return { sheet, row: line, code: 'notEncrypted' };
          try {
            return JSON.parse(await decryptText(this.key!, cell as string, sheet)) as RawRecord;
          } catch {
            return { sheet, row: line, code: 'decryptFailed' };
          }
        }),
      );
      decoded.forEach((r, i) => {
        const line = i + 2;
        if (r === 'blank') free.push(line);
        else if ('code' in r && 'sheet' in r) issues.push(r as ValidationIssue);
        else {
          records.push(r as RawRecord);
          placed.push({ id: str((r as RawRecord).id), line });
        }
      });
      tables[kind] = records;
      rowLists.set(kind, placed);
      this.free.set(kind, free);
      this.nextRow.set(kind, Math.max(rows.length + 1, 2));
    }
    if (issues.length) throw new AppError('invalid', undefined, issues);

    let migrated = tables;
    if (this.meta!.schema < SCHEMA_VERSION) {
      migrated = migrate(tables, this.meta!.schema);
      this.needsRewrite = true;
    }

    const data = { ...EMPTY_DATA } as Record<EntityKind, unknown[]>;
    for (const kind of ENTITY_KINDS) {
      const sheet = SHEETS[kind];
      const placed = rowLists.get(kind) ?? [];
      const seen = new Set<string>();
      const rowMap = new Map<string, number>();
      const list: unknown[] = [];
      migrated[kind].forEach((rec, i) => {
        const line = placed[i]?.line;
        const { entity, problems } = fromRecord(kind, rec);
        const id = entity.id as string;
        if (!id) return issues.push({ sheet, row: line, code: 'missingId' });
        if (seen.has(id)) return issues.push({ sheet, row: line, code: 'duplicateId', value: id });
        seen.add(id);
        problems.forEach((p) => issues.push({ sheet, row: line, code: 'badValue', value: `${p.column}: ${p.value}` }));
        if (line) {
          rowMap.set(id, line);
          lines.set(`${kind}:${id}`, line);
        }
        list.push(entity);
      });
      data[kind] = list;
      this.rowOf.set(kind, rowMap);
    }
    const typed = data as unknown as Data;
    issues.push(...validateData(typed, lines));
    if (issues.length) throw new InvalidStructureError(issues);
    this.raw = {}; // raw cells are no longer needed
    return typed;
  }

  // ---- first-time setup ----

  /** Creates the Cashbook sheets in a blank file and writes the preset data. */
  async initialize(password: string | null, seed: Data) {
    const now = new Date().toISOString();
    let meta: MetaInfo = {
      app: APP_NAME,
      schema: SCHEMA_VERSION,
      appVersion: APP_VERSION,
      createdAt: now,
      encryption: 'none',
      kdf: '',
      iterations: 0,
      salt: '',
      check: '',
    };
    if (password) {
      const k = await createKey(password);
      this.key = k.key;
      meta = { ...meta, encryption: CIPHER_NAME, kdf: KDF_NAME, iterations: k.iterations, salt: k.salt, check: k.check };
    }
    this.meta = meta;

    const requests: unknown[] = [];
    for (const k of ALL_KEYS) {
      const sheetId = Math.floor(Math.random() * 1e9) + 1;
      const columns = k === 'meta' ? 2 : this.encrypted ? 1 : headerOf(k).length;
      this.grid.set(k, { sheetId, rowCount: 1000, columnCount: Math.max(columns, 2) });
      requests.push(
        {
          addSheet: {
            properties: {
              sheetId,
              title: SHEETS[k],
              gridProperties: { rowCount: 1000, columnCount: Math.max(columns, 2), frozenRowCount: 1 },
            },
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columns },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        },
      );
    }
    // the default empty "Sheet1" is not needed any more
    for (const s of this.blankSheets) requests.push({ deleteSheet: { sheetId: s.sheetId } });
    await this.io.batchUpdate(requests);
    this.blankSheets = [];
    for (const k of ENTITY_KINDS) {
      this.rowOf.set(k, new Map());
      this.free.set(k, []);
      this.nextRow.set(k, 2);
    }
    await this.writeMeta();
    await this.rewriteAll(seed);
  }

  // ---- writing ----

  private async writeMeta() {
    const m = { ...this.meta!, appVersion: APP_VERSION };
    const rows = metaRows(m);
    await this.io.writeValues([{ range: `${quoteSheet(SHEETS.meta)}!A1:B${rows.length}`, values: rows }]);
  }

  private width(kind: EntityKind) {
    return this.encrypted ? 1 : headerOf(kind).length;
  }

  private async encode(kind: EntityKind, entity: object): Promise<Cell[]> {
    const rec = toRecord(kind, entity);
    if (!this.encrypted) return recordToCells(kind, rec);
    return [await encryptText(this.key!, JSON.stringify(rec), SHEETS[kind])];
  }

  /** Requests that grow a sheet's grid to fit lastRow x lastCol (empty when it already fits). */
  private growRequests(kind: SheetKey, lastRow: number, lastCol: number) {
    const g = this.grid.get(kind);
    if (!g) return [];
    const out: { request: unknown; apply: () => void }[] = [];
    if (lastRow > g.rowCount) {
      const add = lastRow - g.rowCount + GRID_STEP;
      out.push({ request: { appendDimension: { sheetId: g.sheetId, dimension: 'ROWS', length: add } }, apply: () => (g.rowCount += add) });
    }
    if (lastCol > g.columnCount) {
      const add = lastCol - g.columnCount;
      out.push({ request: { appendDimension: { sheetId: g.sheetId, dimension: 'COLUMNS', length: add } }, apply: () => (g.columnCount += add) });
    }
    return out;
  }

  private async grow(items: { request: unknown; apply: () => void }[], extra: unknown[] = []) {
    if (!items.length && !extra.length) return;
    await this.io.batchUpdate([...items.map((i) => i.request), ...extra]);
    items.forEach((i) => i.apply());
  }

  private async ensureRows(kind: SheetKey, lastRow: number) {
    await this.grow(this.growRequests(kind, lastRow, 0));
  }

  /**
   * Makes sure nobody switched the encryption (or the key) on another device since
   * this one loaded: writing rows in the old format would corrupt the spreadsheet.
   */
  private async checkFormat() {
    const [rows] = await this.io.batchGet([quoteSheet(SHEETS.meta)]);
    const { meta } = parseMeta(rows);
    if (meta.encryption !== this.meta!.encryption || meta.check !== this.meta!.check) throw new AppError('formatChanged');
  }

  /** Writes rows grouped into contiguous ranges (one request for the whole save). */
  private async writeRows(kind: EntityKind, rows: Map<number, Cell[]>) {
    if (!rows.size) return [];
    const width = this.width(kind);
    const sorted = [...rows.keys()].sort((a, b) => a - b);
    const ranges: { range: string; values: Rows }[] = [];
    let start = sorted[0];
    let block: Rows = [];
    const push = () =>
      ranges.push({
        range: `${quoteSheet(SHEETS[kind])}!A${start}:${colLetter(width)}${start + block.length - 1}`,
        values: block,
      });
    sorted.forEach((r, i) => {
      if (i > 0 && r !== sorted[i - 1] + 1) {
        push();
        start = r;
        block = [];
      }
      block.push(rows.get(r)!);
    });
    push();
    await this.ensureRows(kind, sorted[sorted.length - 1]);
    return ranges;
  }

  /** Saves the given entities (written if present in data, blanked if deleted). */
  async save(data: Data, dirty: Dirty) {
    await this.checkFormat();
    const all: { range: string; values: Rows }[] = [];
    const commits: (() => void)[] = [];
    for (const [kind, ids] of dirty) {
      const byId = new Map((data[kind] as { id: string }[]).map((e) => [e.id, e]));
      const rowMap = new Map(this.rowOf.get(kind));
      const free = [...(this.free.get(kind) ?? [])].sort((a, b) => a - b);
      let next = this.nextRow.get(kind) ?? 2;
      const rows = new Map<number, Cell[]>();
      const blank = Array<Cell>(this.width(kind)).fill('');

      await Promise.all(
        [...ids].map(async (id) => {
          const entity = byId.get(id);
          const row = rowMap.get(id);
          if (entity) {
            const r = row ?? free.shift() ?? next++;
            rowMap.set(id, r);
            rows.set(r, await this.encode(kind, entity));
          } else if (row) {
            rowMap.delete(id);
            free.push(row);
            rows.set(row, blank);
          }
        }),
      );
      all.push(...(await this.writeRows(kind, rows)));
      commits.push(() => {
        this.rowOf.set(kind, rowMap);
        this.free.set(kind, free);
        this.nextRow.set(kind, next);
      });
    }
    await this.io.writeValues(all);
    commits.forEach((c) => c()); // only after the write succeeded
  }

  /**
   * Rewrites every data sheet from scratch (setup, migration, bulk import, encryption
   * change). All cells go out in one request, together with Meta when withMeta is set,
   * so the spreadsheet never ends up half in one format and half in another.
   * clearWidth: columns used by the previous format, blanked when the new one is narrower.
   */
  async rewriteAll(data: Data, { withMeta = false, clearWidth }: { withMeta?: boolean; clearWidth?: Map<EntityKind, number> } = {}) {
    const writes: { range: string; values: Rows }[] = [];
    const growth: { request: unknown; apply: () => void }[] = [];
    const commits: (() => void)[] = [];
    for (const kind of ENTITY_KINDS) {
      const list = data[kind] as { id: string }[];
      const width = Math.max(this.width(kind), clearWidth?.get(kind) ?? 0);
      const pad = (cells: Cell[]) => [...cells, ...Array<Cell>(width - cells.length).fill('')];
      const header = this.encrypted ? [ENCRYPTED_HEADER] : headerOf(kind);
      const body = await Promise.all(list.map((e) => this.encode(kind, e)));
      const used = Math.max((this.nextRow.get(kind) ?? 2) - 1, 1);
      const total = Math.max(body.length + 1, used);
      const values: Rows = [header, ...body, ...Array.from({ length: total - body.length - 1 }, (): Cell[] => [])].map(pad);
      growth.push(...this.growRequests(kind, total, width));
      writes.push({ range: `${quoteSheet(SHEETS[kind])}!A1:${colLetter(width)}${total}`, values });
      commits.push(() => {
        this.rowOf.set(kind, new Map(list.map((e, i) => [e.id, i + 2])));
        this.free.set(kind, []);
        this.nextRow.set(kind, body.length + 2);
      });
    }
    if (withMeta) {
      const rows = metaRows({ ...this.meta!, appVersion: APP_VERSION });
      writes.push({ range: `${quoteSheet(SHEETS.meta)}!A1:B${rows.length}`, values: rows });
    }
    // header rows of the new layout are bold, like after setup
    const bold = clearWidth
      ? ENTITY_KINDS.map((k) => ({
          repeatCell: {
            range: { sheetId: this.grid.get(k)!.sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true } } },
            fields: 'userEnteredFormat.textFormat.bold',
          },
        }))
      : [];
    await this.grow(growth, bold);
    await this.io.writeValues(writes);
    commits.forEach((c) => c()); // only after the write succeeded
  }

  /**
   * Turns encryption on (password = the new key) or off (null) for a working
   * spreadsheet: every record is rewritten in the new format.
   */
  async setEncryption(data: Data, password: string | null) {
    await this.checkFormat();
    const before = { meta: this.meta!, key: this.key };
    const clearWidth = new Map(ENTITY_KINDS.map((k) => [k, this.width(k)]));
    if (password) {
      const k = await createKey(password);
      this.key = k.key;
      this.meta = { ...before.meta, encryption: CIPHER_NAME, kdf: KDF_NAME, iterations: k.iterations, salt: k.salt, check: k.check };
    } else {
      this.key = null;
      this.meta = { ...before.meta, encryption: 'none', kdf: '', iterations: 0, salt: '', check: '' };
    }
    try {
      await this.rewriteAll(data, { withMeta: true, clearWidth });
    } catch (e) {
      this.meta = before.meta;
      this.key = before.key;
      throw e;
    }
  }
}

export function createBackend(spreadsheetId: string): SheetBackend {
  return new SheetBackend(new SheetsApi(spreadsheetId, getValidToken));
}
