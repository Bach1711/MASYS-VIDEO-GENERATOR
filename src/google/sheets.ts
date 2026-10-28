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
   * Ghi ô Trạng thái dòng N — lệnh ghi duy nhất của bot khi chạy lô (D11, §8.1): `values.update` đúng một ô, RAW.
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

  /** Giá trị gốc (FORMULA) của từng ô, theo thứ tự `cells`; ô trống là "". */
  async readCells(spreadsheetId: string, tab: string, cells: { col: string; row: number }[]): Promise<string[]> {
    if (cells.length === 0) return [];
    const ranges = cells.map((c) => `ranges=${enc(cellRange(tab, c.col, c.row))}`).join("&");
    const r = await this.http<{ valueRanges?: { values?: unknown[][] }[] }>(
      "GET",
      `${SHEETS}/${enc(spreadsheetId)}/values:batchGet?${ranges}&majorDimension=ROWS&valueRenderOption=FORMULA`,
    );
    return cells.map((_, i) => toGrid(r.valueRanges?.[i]?.values)[0]?.[0] ?? "");
  }

  /**
   * Ghi các ô dữ liệu người dùng sửa trên Bảng (D18): chỉ cột Prompt, Ảnh người mẫu, Ảnh áo; không bao giờ
   * ô Video hay Trạng thái, không ghi dòng tiêu đề. Một lệnh `values.batchUpdate`, RAW, mỗi ô một lần;
   * Google phải xác nhận ghi đúng từng ô, nếu không thì báo lỗi.
   */
  async writeDataCells(config: SheetConfig, cells: { col: string; row: number; value: string }[]): Promise<void> {
    if (cells.length === 0) return;
    const allowed = new Set([config.colPrompt, config.colImage, config.colShirt].filter((c): c is string => !!c));
    const seen = new Set<string>();
    for (const c of cells) {
      if (c.col === config.colVideo || c.col === config.colStatus || !allowed.has(c.col)) throw new Error(`Tool không được ghi cột ${c.col}.`);
      if (c.row <= config.headerRow) throw new Error(`Không ghi vào dòng tiêu đề hoặc phía trên (dòng ${c.row}).`);
      const key = `${c.col}${c.row}`;
      if (seen.has(key)) throw new Error(`Ô ${key} bị ghi hai lần trong cùng một lệnh.`);
      seen.add(key);
    }
    type Resp = { responses?: { updatedRange?: string; updatedCells?: number }[] };
    const r = await this.http<Resp>("POST", `${SHEETS}/${enc(config.spreadsheetId)}/values:batchUpdate`, {
      valueInputOption: "RAW",
      data: cells.map((c) => ({ range: cellRange(config.tab, c.col, c.row), majorDimension: "ROWS", values: [[c.value]] })),
    });
    const res = r.responses ?? [];
    cells.forEach((c, i) => {
      const got = res[i];
      if (!got?.updatedRange?.endsWith(`!${c.col}${c.row}`) || (got.updatedCells ?? 0) > 1) {
        throw new Error(`Google ghi vào vùng không mong đợi: ${got?.updatedRange ?? "?"} (${got?.updatedCells ?? "?"} ô)`);
      }
    });
  }

  /** Tab có ít nhất `row` dòng; thiếu thì thêm dòng trống vào CUỐI tab (không chèn giữa, D18). */
  async ensureRows(spreadsheetId: string, tab: string, row: number): Promise<void> {
    const t = (await this.getSpreadsheet(spreadsheetId)).tabs.find((x) => x.title === tab);
    if (!t) throw new Error(`Không thấy trang tính "${tab}".`);
    if (t.rowCount >= row) return;
    await this.http("POST", `${SHEETS}/${enc(spreadsheetId)}:batchUpdate`, {
      requests: [{ appendDimension: { sheetId: t.sheetId, dimension: "ROWS", length: row - t.rowCount } }],
    });
  }

  private async readRange(spreadsheetId: string, range: string, render: ValueRender): Promise<Grid> {
    const r = await this.http<{ values?: unknown[][] }>(
      "GET",
      `${SHEETS}/${enc(spreadsheetId)}/values/${enc(range)}?majorDimension=ROWS&valueRenderOption=${render}`,
    );
    return toGrid(r.values);
  }
}
