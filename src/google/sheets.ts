import type { SheetConfig } from "../db/sheetConfigs.js";
import { cellRange, quoteTab, rowRange } from "./a1.js";
import type { GoogleHttp } from "./http.js";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE = "https://www.googleapis.com/drive/v3/files";

export interface TabInfo {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  tabs: TabInfo[];
}

/** FORMATTED_VALUE: chữ như người dùng thấy. FORMULA: giá trị gốc kèm công thức (dùng cho bản chụp). */
export type ValueRender = "FORMATTED_VALUE" | "FORMULA";

export type Grid = string[][];

const enc = encodeURIComponent;

function toGrid(values: unknown[][] | undefined): Grid {
  return (values ?? []).map((row) => row.map((v) => (v === null || v === undefined ? "" : String(v))));
}

export class SheetsClient {
  constructor(private readonly http: GoogleHttp) {}

  async getSpreadsheet(spreadsheetId: string): Promise<SpreadsheetInfo> {
    type Resp = {
      properties: { title: string };
      sheets: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }[];
    };
    const fields = "properties.title,sheets.properties(sheetId,title,gridProperties(rowCount,columnCount))";
    const r = await this.http<Resp>("GET", `${SHEETS}/${enc(spreadsheetId)}?fields=${enc(fields)}`);
    return {
      spreadsheetId,
      title: r.properties.title,
      tabs: r.sheets.map(({ properties: p }) => ({
        sheetId: p.sheetId,
        title: p.title,
        rowCount: p.gridProperties?.rowCount ?? 0,
        columnCount: p.gridProperties?.columnCount ?? 0,
      })),
    };
  }

  /** Service account có quyền sửa file không (để báo thiếu quyền ngay khi kết nối, F1). */
  async canEdit(spreadsheetId: string): Promise<boolean> {
    const r = await this.http<{ capabilities?: { canEdit?: boolean } }>(
      "GET",
      `${DRIVE}/${enc(spreadsheetId)}?fields=capabilities%2FcanEdit&supportsAllDrives=true`,
    );
    return r.capabilities?.canEdit === true;
  }

  /** Toàn bộ vùng dữ liệu của tab; phần tử [0] là dòng 1. Dòng/cột trống ở cuối bị Google lược bỏ. */
  async readTab(spreadsheetId: string, tab: string, render: ValueRender = "FORMATTED_VALUE"): Promise<Grid> {
    return this.readRange(spreadsheetId, quoteTab(tab), render);
  }

  /** Riêng dòng N; phần tử [0] là cột A. */
  async readRow(spreadsheetId: string, tab: string, row: number, render: ValueRender = "FORMATTED_VALUE"): Promise<string[]> {
    return (await this.readRange(spreadsheetId, rowRange(tab, row), render))[0] ?? [];
  }

  /**
   * Ghi ô Trạng thái dòng N — lệnh ghi duy nhất của tool (D11, §8.1): `values.update` đúng một ô, RAW.
   * Google phải xác nhận đã ghi đúng ô đó và không quá một ô, nếu không thì báo lỗi.
   */
  async writeStatus(config: SheetConfig, row: number, text: string): Promise<void> {
    if (row <= config.headerRow) throw new Error(`Không ghi vào dòng tiêu đề hoặc phía trên (dòng ${row}).`);
    const range = cellRange(config.tab, config.colStatus, row);
    type Resp = { updatedRange?: string; updatedCells?: number; updatedRows?: number; updatedColumns?: number };
    const r = await this.http<Resp>(
      "PUT",
      `${SHEETS}/${enc(config.spreadsheetId)}/values/${enc(range)}?valueInputOption=RAW`,
      { range, majorDimension: "ROWS", values: [[text]] },
    );
    const target = `!${config.colStatus}${row}`;
    if (!r.updatedRange?.endsWith(target) || (r.updatedCells ?? 0) > 1 || (r.updatedRows ?? 0) > 1 || (r.updatedColumns ?? 0) > 1) {
      throw new Error(`Google ghi vào vùng không mong đợi: ${r.updatedRange ?? "?"} (${r.updatedCells ?? "?"} ô)`);
    }
  }

  private async readRange(spreadsheetId: string, range: string, render: ValueRender): Promise<Grid> {
    const r = await this.http<{ values?: unknown[][] }>(
      "GET",
      `${SHEETS}/${enc(spreadsheetId)}/values/${enc(range)}?majorDimension=ROWS&valueRenderOption=${render}`,
    );
    return toGrid(r.values);
  }
}
