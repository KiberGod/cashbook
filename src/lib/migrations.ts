import { SCHEMA_VERSION, type RawRecord } from './schema';
import type { EntityKind } from './types';

/**
 * Spreadsheet schema migrations.
 *
 * The schema version is stored in Meta. When a spreadsheet written by an older app
 * version is opened, its records (already decrypted, as JSON objects) are passed
 * through every step from its version up to SCHEMA_VERSION, then the whole
 * spreadsheet is rewritten in the current layout and Meta is updated.
 * A spreadsheet with a newer schema than the app is refused.
 *
 * To change the layout: bump SCHEMA_VERSION in schema.ts, update COLUMNS, and add
 * a step here keyed by the version it upgrades FROM, e.g.
 *
 *   1: (t) => ({ ...t, assets: t.assets.map((a) => ({ ...a, decimals: a.decimals ?? 2 })) }),
 */
export type RawTables = Record<EntityKind, RawRecord[]>;
type Step = (tables: RawTables) => RawTables;

const STEPS: Record<number, Step> = {
  // services got a user-defined position; start from the order of the rows
  1: (t) => ({ ...t, services: t.services.map((s, i) => ({ ...s, order: i })) }),
  // categories got a position among their siblings; start from the alphabetical order they were shown in
  2: (t) => {
    const next = new Map<string, number>();
    const order = new Map<RawRecord, number>();
    for (const c of [...t.categories].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))) {
      const parent = String(c.parentId ?? '');
      const i = next.get(parent) ?? 0;
      order.set(c, i);
      next.set(parent, i + 1);
    }
    return { ...t, categories: t.categories.map((c) => ({ ...c, order: order.get(c) })) };
  },
};

export function migrate(tables: RawTables, from: number): RawTables {
  let t = tables;
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`No migration from schema ${v}`);
    t = step(t);
  }
  return t;
}
