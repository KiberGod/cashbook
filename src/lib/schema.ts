import {
  FORMS,
  SERVICE_FORMS,
  type Data,
  type EntityKind,
  type FormId,
} from './types';

/**
 * Spreadsheet layout (schema v2). Row 1 of every sheet is a header.
 *
 *   Meta          key | value    (app, schema, encryption parameters, ...)
 *   Assets        id | name | description | code | symbol | image | decimals | forms | createdAt | updatedAt
 *   Services      id | name | description | image | forms | order | createdAt | updatedAt
 *   Contacts      id | name | description | image | isSelf | createdAt | updatedAt
 *   Accounts      id | name | description | form | assetIds | initialBalances | requisite | contactId | serviceId | createdAt | updatedAt
 *   Categories    id | name | description | image | parentId | createdAt | updatedAt
 *   Transactions  id | date | fromId | toId | assetId | amount | fee | feeAssetId | categoryId | debtId | description | createdAt | updatedAt
 *   Debts         id | name | description | assetId | debtorId | creditorId | amount | createdAt | updatedAt
 *
 * In an encrypted spreadsheet every data sheet has a single column "data":
 * each row is the JSON record of one entity, encrypted (see lib/crypto.ts).
 * Lists are comma-separated in plain sheets, JSON arrays inside encrypted rows.
 */
export const SCHEMA_VERSION = 2;
export const APP_NAME = 'Cashbook';
export const ENCRYPTED_HEADER = 'data';

export const SHEETS: Record<EntityKind | 'meta', string> = {
  meta: 'Meta',
  assets: 'Assets',
  services: 'Services',
  contacts: 'Contacts',
  accounts: 'Accounts',
  categories: 'Categories',
  transactions: 'Transactions',
  debts: 'Debts',
};

type ColType = 'text' | 'number' | 'numberOrNull' | 'int' | 'bool' | 'list' | 'balances';
type Spec = [name: string, type: ColType][];

const STAMPS: Spec = [
  ['createdAt', 'text'],
  ['updatedAt', 'text'],
];

export const COLUMNS: Record<EntityKind, Spec> = {
  assets: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['code', 'text'],
    ['symbol', 'text'],
    ['image', 'text'],
    ['decimals', 'int'],
    ['forms', 'list'],
    ...STAMPS,
  ],
  services: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['image', 'text'],
    ['forms', 'list'],
    ['order', 'int'],
    ...STAMPS,
  ],
  contacts: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['image', 'text'],
    ['isSelf', 'bool'],
    ...STAMPS,
  ],
  accounts: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['form', 'text'],
    ['assetIds', 'list'],
    ['initialBalances', 'balances'],
    ['requisite', 'text'],
    ['contactId', 'text'],
    ['serviceId', 'text'],
    ...STAMPS,
  ],
  categories: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['image', 'text'],
    ['parentId', 'text'],
    ...STAMPS,
  ],
  transactions: [
    ['id', 'text'],
    ['date', 'text'],
    ['fromId', 'text'],
    ['toId', 'text'],
    ['assetId', 'text'],
    ['amount', 'number'],
    ['fee', 'numberOrNull'],
    ['feeAssetId', 'text'],
    ['categoryId', 'text'],
    ['debtId', 'text'],
    ['description', 'text'],
    ...STAMPS,
  ],
  debts: [
    ['id', 'text'],
    ['name', 'text'],
    ['description', 'text'],
    ['assetId', 'text'],
    ['debtorId', 'text'],
    ['creditorId', 'text'],
    ['amount', 'number'],
    ...STAMPS,
  ],
};

export const headerOf = (kind: EntityKind) => COLUMNS[kind].map(([n]) => n);

export type Cell = string | number | boolean | null | undefined;
export type Rows = Cell[][];
/** One entity as a plain JSON object (column name -> value). */
export type RawRecord = Record<string, unknown>;

export interface ValidationIssue {
  sheet: string;
  row?: number; // 1-based spreadsheet row
  code:
    | 'foreignData'
    | 'notCashbook'
    | 'missingSheet'
    | 'badHeader'
    | 'badMeta'
    | 'newerSchema'
    | 'notEncrypted'
    | 'decryptFailed'
    | 'missingId'
    | 'duplicateId'
    | 'badValue'
    | 'brokenRef'
    | 'noSelfContact'
    | 'manySelfContacts';
  value?: string;
}

export class InvalidStructureError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super('Invalid spreadsheet structure');
  }
}

export const str = (c: unknown) => (c === null || c === undefined ? '' : String(c).trim());
export const isBlankRow = (row: Cell[] | undefined) => !row || row.every((c) => str(c) === '');
export const isBlankSheet = (rows: Rows | undefined) => !rows || rows.every(isBlankRow);

function toNumber(c: unknown): number | null {
  if (typeof c === 'number') return Number.isFinite(c) ? c : null;
  const s = str(c).replace(',', '.').replace(/\s/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- record <-> cells ----

/** Entity -> JSON record (native types) - the encrypted form and the base for plain cells. */
export function toRecord(kind: EntityKind, entity: object): RawRecord {
  const src = entity as RawRecord;
  const out: RawRecord = {};
  for (const [name] of COLUMNS[kind]) out[name] = src[name];
  return out;
}

/** JSON record -> plain sheet cells (lists comma-separated, balances as JSON). */
export function recordToCells(kind: EntityKind, rec: RawRecord): Cell[] {
  return COLUMNS[kind].map(([name, type]) => {
    const v = rec[name];
    switch (type) {
      case 'list':
        return Array.isArray(v) ? v.join(',') : str(v);
      case 'balances':
        return JSON.stringify(v ?? {});
      case 'bool':
        return v ? 'TRUE' : 'FALSE';
      case 'numberOrNull':
        return v === null || v === undefined ? '' : (v as number);
      default:
        return v as Cell;
    }
  });
}

/** Plain sheet row -> JSON record, using the sheet's header to find columns. */
export function cellsToRecord(header: string[], row: Cell[]): RawRecord {
  const rec: RawRecord = {};
  header.forEach((h, i) => {
    if (h) rec[h] = row[i];
  });
  return rec;
}

type FieldProblem = { column: string; value: string };

/**
 * JSON record -> typed entity. Tolerant to both encodings (plain cells and JSON).
 * Returns the problems found instead of throwing so all of them can be reported.
 */
export function fromRecord(kind: EntityKind, rec: RawRecord): { entity: RawRecord; problems: FieldProblem[] } {
  const entity: RawRecord = {};
  const problems: FieldProblem[] = [];
  for (const [name, type] of COLUMNS[kind]) {
    const v = rec[name];
    switch (type) {
      case 'text':
        entity[name] = str(v);
        break;
      case 'number': {
        const n = toNumber(v);
        if (n === null) problems.push({ column: name, value: str(v) });
        entity[name] = n ?? 0;
        break;
      }
      case 'numberOrNull': {
        const n = str(v) === '' ? null : toNumber(v);
        if (str(v) !== '' && n === null) problems.push({ column: name, value: str(v) });
        entity[name] = n;
        break;
      }
      case 'int': {
        const n = toNumber(v);
        if (n === null || !Number.isInteger(n) || n < 0) problems.push({ column: name, value: str(v) });
        entity[name] = n ?? 0;
        break;
      }
      case 'bool':
        entity[name] = v === true || /^(true|1|yes)$/i.test(str(v));
        break;
      case 'list':
        entity[name] = Array.isArray(v)
          ? v.map(str).filter(Boolean)
          : str(v)
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean);
        break;
      case 'balances': {
        let obj: unknown = v;
        if (typeof v === 'string') {
          try {
            obj = v.trim() ? JSON.parse(v) : {};
          } catch {
            obj = null;
          }
        }
        const out: Record<string, number> = {};
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          for (const [k, x] of Object.entries(obj)) {
            const n = toNumber(x);
            if (n === null) problems.push({ column: name, value: `${k}=${str(x)}` });
            else out[k] = n;
          }
        } else if (v !== undefined && str(v) !== '') {
          problems.push({ column: name, value: str(v) });
        }
        entity[name] = out;
        break;
      }
    }
  }
  return { entity, problems };
}

// ---- semantic validation ----

const isForm = (f: string): f is FormId => (FORMS as string[]).includes(f);

/**
 * Checks values and references between entities. `lines` maps an entity id to its
 * spreadsheet row so issues point at the right place.
 */
export function validateData(data: Data, lines: Map<string, number>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (kind: EntityKind, id: string) => ({ sheet: SHEETS[kind], row: lines.get(`${kind}:${id}`) });
  const bad = (kind: EntityKind, id: string, value: string) => issues.push({ ...at(kind, id), code: 'badValue', value });
  const broken = (kind: EntityKind, id: string, value: string) => issues.push({ ...at(kind, id), code: 'brokenRef', value });

  const ids = <T extends { id: string }>(list: T[]) => new Set(list.map((x) => x.id));
  const assetIds = ids(data.assets);
  const contactIds = ids(data.contacts);
  const serviceIds = ids(data.services);
  const categoryIds = ids(data.categories);
  const debtIds = ids(data.debts);
  const accounts = new Map(data.accounts.map((a) => [a.id, a]));

  for (const a of data.assets) {
    if (!a.name) bad('assets', a.id, 'name');
    if (!a.code) bad('assets', a.id, 'code');
    if (a.forms.some((f) => !isForm(f))) bad('assets', a.id, 'forms');
  }
  for (const s of data.services) {
    if (!s.name) bad('services', s.id, 'name');
    if (s.forms.some((f) => !(SERVICE_FORMS as string[]).includes(f))) bad('services', s.id, 'forms');
  }
  const selfs = data.contacts.filter((c) => c.isSelf);
  if (selfs.length === 0) issues.push({ sheet: SHEETS.contacts, code: 'noSelfContact' });
  if (selfs.length > 1) issues.push({ sheet: SHEETS.contacts, code: 'manySelfContacts' });
  for (const c of data.contacts) if (!c.name) bad('contacts', c.id, 'name');

  for (const a of data.accounts) {
    if (!a.name) bad('accounts', a.id, 'name');
    if (!isForm(a.form)) bad('accounts', a.id, 'form');
    if (a.assetIds.length === 0 || (a.form !== 'crypto' && a.assetIds.length > 1)) bad('accounts', a.id, 'assetIds');
    for (const id of a.assetIds) if (!assetIds.has(id)) broken('accounts', a.id, `assetIds: ${id}`);
    for (const id of Object.keys(a.initialBalances)) if (!a.assetIds.includes(id)) bad('accounts', a.id, 'initialBalances');
    if (a.contactId && !contactIds.has(a.contactId)) broken('accounts', a.id, `contactId: ${a.contactId}`);
    if (a.serviceId && !serviceIds.has(a.serviceId)) broken('accounts', a.id, `serviceId: ${a.serviceId}`);
    if (a.serviceId && a.form === 'cash') bad('accounts', a.id, 'serviceId');
  }

  const parents = new Map(data.categories.map((c) => [c.id, c.parentId]));
  for (const c of data.categories) {
    if (!c.name) bad('categories', c.id, 'name');
    if (c.parentId) {
      if (!categoryIds.has(c.parentId)) broken('categories', c.id, `parentId: ${c.parentId}`);
      else if (parents.get(c.parentId)) bad('categories', c.id, 'parentId'); // only two levels
    }
  }

  for (const d of data.debts) {
    if (!d.name) bad('debts', d.id, 'name');
    if (!assetIds.has(d.assetId)) broken('debts', d.id, `assetId: ${d.assetId}`);
    if (!contactIds.has(d.debtorId)) broken('debts', d.id, `debtorId: ${d.debtorId}`);
    if (!contactIds.has(d.creditorId)) broken('debts', d.id, `creditorId: ${d.creditorId}`);
    if (d.debtorId === d.creditorId) bad('debts', d.id, 'creditorId');
  }

  for (const t of data.transactions) {
    if (!t.fromId && !t.toId) bad('transactions', t.id, 'fromId/toId');
    if (Number.isNaN(Date.parse(t.date))) bad('transactions', t.id, 'date');
    if (!(t.amount > 0)) bad('transactions', t.id, 'amount');
    if (!assetIds.has(t.assetId)) broken('transactions', t.id, `assetId: ${t.assetId}`);
    const from = t.fromId ? accounts.get(t.fromId) : undefined;
    const to = t.toId ? accounts.get(t.toId) : undefined;
    if (t.fromId && !from) broken('transactions', t.id, `fromId: ${t.fromId}`);
    if (t.toId && !to) broken('transactions', t.id, `toId: ${t.toId}`);
    if (from && to && from.form !== to.form) bad('transactions', t.id, 'form');
    if ((from && !from.assetIds.includes(t.assetId)) || (to && !to.assetIds.includes(t.assetId))) {
      bad('transactions', t.id, 'assetId');
    }
    if (t.fee !== null) {
      if (!from || t.fee < 0) bad('transactions', t.id, 'fee');
      else if (!from.assetIds.includes(t.feeAssetId)) bad('transactions', t.id, 'feeAssetId');
    }
    if (t.categoryId && !categoryIds.has(t.categoryId)) broken('transactions', t.id, `categoryId: ${t.categoryId}`);
    if (t.debtId && !debtIds.has(t.debtId)) broken('transactions', t.id, `debtId: ${t.debtId}`);
  }
  return issues;
}

// ---- meta ----

export interface MetaInfo {
  app: string;
  schema: number;
  encryption: 'none' | string;
  kdf: string;
  iterations: number;
  salt: string;
  check: string;
  createdAt: string;
  appVersion: string;
}

export function parseMeta(rows: Rows | undefined): { meta: Partial<MetaInfo>; ok: boolean } {
  if (!rows || isBlankSheet(rows)) return { meta: {}, ok: false };
  const head = rows[0] ?? [];
  if (str(head[0]).toLowerCase() !== 'key' || str(head[1]).toLowerCase() !== 'value') return { meta: {}, ok: false };
  const map = new Map(rows.slice(1).map((r) => [str(r[0]), r[1]]));
  return {
    ok: true,
    meta: {
      app: str(map.get('app')),
      schema: toNumber(map.get('schema')) ?? 0,
      encryption: str(map.get('encryption')) || 'none',
      kdf: str(map.get('kdf')),
      iterations: toNumber(map.get('iterations')) ?? 0,
      salt: str(map.get('salt')),
      check: str(map.get('check')),
      createdAt: str(map.get('createdAt')),
      appVersion: str(map.get('appVersion')),
    },
  };
}

export function metaRows(m: MetaInfo): Rows {
  return [
    ['key', 'value'],
    ['app', m.app],
    ['schema', m.schema],
    ['appVersion', m.appVersion],
    ['createdAt', m.createdAt],
    ['encryption', m.encryption],
    ['kdf', m.kdf],
    ['iterations', m.iterations || ''],
    ['salt', m.salt],
    ['check', m.check],
  ];
}
