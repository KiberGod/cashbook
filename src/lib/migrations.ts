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

const STEPS: Record<number, Step> = {};

export function migrate(tables: RawTables, from: number): RawTables {
  let t = tables;
  for (let v = from; v < SCHEMA_VERSION; v++) {
    const step = STEPS[v];
    if (!step) throw new Error(`No migration from schema ${v}`);
    t = step(t);
  }
  return t;
}
