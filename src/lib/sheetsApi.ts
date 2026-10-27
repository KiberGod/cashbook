import { AppError } from './errors';
import type { Rows } from './schema';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

export interface SheetInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetInfo {
  title: string;
  sheets: SheetInfo[];
}

interface ApiErrorBody {
  error?: { code?: number; message?: string; status?: string; details?: { reason?: string }[] };
}

/** Extracts the spreadsheet id from a share link (or accepts a bare id). */
export function parseSpreadsheetId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{30,}$/.test(s) ? s : null;
}

export const quoteSheet = (title: string) => `'${title.replace(/'/g, "''")}'`;

export interface BatchUpdateReply {
  replies?: { addSheet?: { properties: { sheetId: number; title: string } } }[];
}

/** The part of the Sheets API the app uses. */
export interface SheetIO {
  info(): Promise<SpreadsheetInfo>;
  batchGet(ranges: string[]): Promise<Rows[]>;
  writeValues(data: { range: string; values: Rows }[]): Promise<void>;
  batchUpdate(requests: unknown[]): Promise<BatchUpdateReply>;
}

export class SheetsApi implements SheetIO {
  constructor(
    private spreadsheetId: string,
    private getToken: () => string | null,
  ) {}

  private async call<T>(path: string, init?: RequestInit, writing = false): Promise<T> {
    const token = this.getToken();
    if (!token) throw new AppError('auth');
    let res: Response;
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(this.spreadsheetId)}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...init?.headers,
        },
      });
    } catch {
      throw new AppError('network');
    }
    if (res.ok) return (await res.json()) as T;

    const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
    const message = body.error?.message ?? res.statusText;
    const reasons = (body.error?.details ?? []).map((d) => d.reason);
    if (res.status === 401) throw new AppError('auth', message);
    if (res.status === 403) {
      if (reasons.includes('SERVICE_DISABLED') || /has not been used|is disabled/i.test(message)) {
        throw new AppError('apiDisabled', message);
      }
      throw new AppError(writing ? 'readOnly' : 'forbidden', message);
    }
    if (res.status === 404) throw new AppError('notFound', message);
    if (res.status === 400 && /not supported for this document/i.test(message)) {
      // e.g. an .xlsx file opened in Sheets - not a native spreadsheet
      throw new AppError('notFound', message);
    }
    throw new AppError('unknown', `${res.status}: ${message}`);
  }

  async info(): Promise<SpreadsheetInfo> {
    const r = await this.call<{
      properties: { title: string };
      sheets?: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
    }>('?fields=properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))');
    return {
      title: r.properties.title,
      sheets: (r.sheets ?? []).map((s) => ({
        sheetId: s.properties.sheetId,
        title: s.properties.title,
        rowCount: s.properties.gridProperties?.rowCount ?? 0,
        columnCount: s.properties.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  async batchGet(ranges: string[]): Promise<Rows[]> {
    if (!ranges.length) return [];
    const q = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
    const r = await this.call<{ valueRanges?: { values?: Rows }[] }>(
      `/values:batchGet?${q}&valueRenderOption=UNFORMATTED_VALUE&majorDimension=ROWS`,
    );
    return ranges.map((_, i) => r.valueRanges?.[i]?.values ?? []);
  }

  async writeValues(data: { range: string; values: Rows }[]): Promise<void> {
    if (!data.length) return;
    await this.call(
      '/values:batchUpdate',
      { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data }) },
      true,
    );
  }

  async batchUpdate(requests: unknown[]): Promise<BatchUpdateReply> {
    if (!requests.length) return {};
    return this.call(':batchUpdate', { method: 'POST', body: JSON.stringify({ requests }) }, true);
  }
}
