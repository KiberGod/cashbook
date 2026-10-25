// Development-only spreadsheet (link "demo" / "demo-<name>" in `npm run dev`): emulates the
// few Sheets API calls the app makes and keeps the cells in localStorage, so the real
// backend code - encryption included - runs without a Google account.
import type { Rows } from './schema';
import type { BatchUpdateReply, SheetIO, SpreadsheetInfo } from './sheetsApi';
import { readJson, writeJson } from './storage';

interface LocalSheet {
  sheetId: number;
  title: string;
  rowCount: number;
  /** absent in books created before columns were tracked */
  columnCount?: number;
  values: Rows;
}

interface LocalBook {
  title: string;
  sheets: LocalSheet[];
}

const DEFAULT_COLUMNS = 26;
const columnsOf = (s: LocalSheet) => s.columnCount ?? DEFAULT_COLUMNS;

const delay = () => new Promise((r) => setTimeout(r, 120));

/** "'Sheet name'!A1:C10" | "'Sheet name'" -> parts (0-based start row/col). */
function parseRange(range: string): { title: string; row: number; col: number } {
  const m = range.match(/^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::[A-Z]+\d+)?)?$/);
  if (!m) throw new Error(`Unsupported range ${range}`);
  const title = m[1].replace(/''/g, "'");
  if (!m[2]) return { title, row: 0, col: 0 };
  const col = [...m[2]].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { title, row: Number(m[3]) - 1, col };
}

const trimRows = (rows: Rows): Rows => {
  const out = rows.map((r) => {
    const copy = [...r];
    while (copy.length && (copy[copy.length - 1] === '' || copy[copy.length - 1] == null)) copy.pop();
    return copy;
  });
  while (out.length && out[out.length - 1].length === 0) out.pop();
  return out;
};

export class LocalSheets implements SheetIO {
  private key: string;

  constructor(name: string) {
    this.key = `localSheet.${name}`;
  }

  private read(): LocalBook {
    return readJson<LocalBook | null>(this.key, null) ?? { title: 'Demo', sheets: [{ sheetId: 0, title: 'Sheet1', rowCount: 1000, columnCount: DEFAULT_COLUMNS, values: [] }] };
  }

  private write(book: LocalBook) {
    writeJson(this.key, book);
  }

  /** raw cells of every sheet - shown on the dev "raw data" view */
  raw(): LocalBook {
    return this.read();
  }

  async info(): Promise<SpreadsheetInfo> {
    await delay();
    const b = this.read();
    return { title: b.title, sheets: b.sheets.map((s) => ({ sheetId: s.sheetId, title: s.title, rowCount: s.rowCount, columnCount: columnsOf(s) })) };
  }

  async batchGet(ranges: string[]): Promise<Rows[]> {
    await delay();
    const b = this.read();
    return ranges.map((r) => {
      const { title } = parseRange(r);
      return trimRows(b.sheets.find((s) => s.title === title)?.values ?? []);
    });
  }

  async writeValues(data: { range: string; values: Rows }[]): Promise<void> {
    await delay();
    const b = this.read();
    for (const { range, values } of data) {
      const { title, row, col } = parseRange(range);
      const sheet = b.sheets.find((s) => s.title === title);
      if (!sheet) throw new Error(`No sheet ${title}`);
      const width = Math.max(0, ...values.map((r) => r.length));
      if (row + values.length > sheet.rowCount || col + width > columnsOf(sheet)) throw new Error(`Range ${range} exceeds grid limits`);
      values.forEach((cells, i) => {
        const target = (sheet.values[row + i] ??= []);
        cells.forEach((c, j) => (target[col + j] = c));
      });
      for (let i = 0; i < sheet.values.length; i++) sheet.values[i] ??= [];
    }
    for (const s of b.sheets) s.values = trimRows(s.values);
    this.write(b);
  }

  async batchUpdate(requests: unknown[]): Promise<BatchUpdateReply> {
    await delay();
    const b = this.read();
    for (const req of requests as Record<string, any>[]) {
      if (req.addSheet) {
        const p = req.addSheet.properties;
        b.sheets.push({
          sheetId: p.sheetId,
          title: p.title,
          rowCount: p.gridProperties?.rowCount ?? 1000,
          columnCount: p.gridProperties?.columnCount ?? DEFAULT_COLUMNS,
          values: [],
        });
      } else if (req.deleteSheet) {
        b.sheets = b.sheets.filter((s) => s.sheetId !== req.deleteSheet.sheetId);
      } else if (req.appendDimension) {
        const s = b.sheets.find((x) => x.sheetId === req.appendDimension.sheetId);
        if (s && req.appendDimension.dimension === 'COLUMNS') s.columnCount = columnsOf(s) + req.appendDimension.length;
        else if (s) s.rowCount += req.appendDimension.length;
      }
      // formatting requests (repeatCell, ...) have no effect here
    }
    this.write(b);
    return {};
  }
}

export const isLocalSheetId = (id: string) => import.meta.env.DEV && /^demo(-[\w-]+)?$/.test(id);
