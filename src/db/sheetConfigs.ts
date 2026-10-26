import { isColumn } from "../google/a1.js";
import type { DB } from "./index.js";

/** Ánh xạ cột theo (spreadsheetId, tab) — F2, bảng sheet_configs §9. */
export interface SheetConfig {
  spreadsheetId: string;
  tab: string;
  headerRow: number;
  colImage: string;
  colPrompt: string;
  colVideo: string;
  colStatus: string;
}

export function validateSheetConfig(c: SheetConfig): string | null {
  if (!Number.isInteger(c.headerRow) || c.headerRow < 1) return "Dòng tiêu đề phải là số nguyên ≥ 1.";
  const cols = [c.colImage, c.colPrompt, c.colVideo, c.colStatus];
  if (!cols.every(isColumn)) return "Phải chọn đủ 4 cột Ảnh, Prompt, Video, Trạng thái.";
  if (new Set(cols).size !== 4) return "Bốn cột Ảnh, Prompt, Video, Trạng thái phải khác nhau.";
  return null;
}

export function getSheetConfig(db: DB, spreadsheetId: string, tab: string): SheetConfig | undefined {
  return db.prepare("SELECT * FROM sheet_configs WHERE spreadsheetId = ? AND tab = ?").get(spreadsheetId, tab) as
    | SheetConfig
    | undefined;
}

export function listSheetConfigs(db: DB): SheetConfig[] {
  return db.prepare("SELECT * FROM sheet_configs ORDER BY spreadsheetId, tab").all() as SheetConfig[];
}

export function saveSheetConfig(db: DB, c: SheetConfig): void {
  const problem = validateSheetConfig(c);
  if (problem) throw new Error(problem);
  db.prepare(
    `INSERT INTO sheet_configs (spreadsheetId, tab, headerRow, colImage, colPrompt, colVideo, colStatus)
     VALUES (@spreadsheetId, @tab, @headerRow, @colImage, @colPrompt, @colVideo, @colStatus)
     ON CONFLICT (spreadsheetId, tab) DO UPDATE SET
       headerRow = excluded.headerRow, colImage = excluded.colImage, colPrompt = excluded.colPrompt,
       colVideo = excluded.colVideo, colStatus = excluded.colStatus`,
  ).run(c);
}
