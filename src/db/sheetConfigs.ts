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
  /** Cột Ảnh áo (tuỳ chọn, v4.4); null/trống = sheet không có ảnh áo. */
  colShirt?: string | null;
  /** Tên file sheet, chỉ để hiển thị; có thể chưa biết. */
  spreadsheetTitle?: string | null;
}

export function validateSheetConfig(c: SheetConfig): string | null {
  if (!Number.isInteger(c.headerRow) || c.headerRow < 1) return "Dòng tiêu đề phải là số nguyên ≥ 1.";
  const cols = [c.colImage, c.colPrompt, c.colVideo, c.colStatus];
  if (!cols.every(isColumn)) return "Phải chọn đủ 4 cột Ảnh, Prompt, Video, Trạng thái.";
  if (new Set(cols).size !== 4) return "Bốn cột Ảnh, Prompt, Video, Trạng thái phải khác nhau.";
  if (c.colShirt) {
    if (!isColumn(c.colShirt)) return "Cột Ảnh áo không hợp lệ.";
    if (cols.includes(c.colShirt)) return "Cột Ảnh áo phải khác bốn cột Ảnh, Prompt, Video, Trạng thái.";
  }
  return null;
}

/** Tên hiển thị của file sheet; chưa biết tên thì dùng đầu mã file. */
export function sheetName(c: Pick<SheetConfig, "spreadsheetId" | "spreadsheetTitle">): string {
  return c.spreadsheetTitle || `${c.spreadsheetId.slice(0, 8)}…`;
}

export function getSheetConfig(db: DB, spreadsheetId: string, tab: string): SheetConfig | undefined {
  return db.prepare("SELECT * FROM sheet_configs WHERE spreadsheetId = ? AND tab = ?").get(spreadsheetId, tab) as
    | SheetConfig
    | undefined;
}

export function listSheetConfigs(db: DB): SheetConfig[] {
  return db
    .prepare("SELECT * FROM sheet_configs ORDER BY COALESCE(spreadsheetTitle, spreadsheetId), spreadsheetId, tab")
    .all() as SheetConfig[];
}

export function saveSheetConfig(db: DB, c: SheetConfig): void {
  const problem = validateSheetConfig(c);
  if (problem) throw new Error(problem);
  db.prepare(
    `INSERT INTO sheet_configs (spreadsheetId, tab, headerRow, colImage, colPrompt, colVideo, colStatus, colShirt, spreadsheetTitle)
     VALUES (@spreadsheetId, @tab, @headerRow, @colImage, @colPrompt, @colVideo, @colStatus, @colShirt, @spreadsheetTitle)
     ON CONFLICT (spreadsheetId, tab) DO UPDATE SET
       headerRow = excluded.headerRow, colImage = excluded.colImage, colPrompt = excluded.colPrompt,
       colVideo = excluded.colVideo, colStatus = excluded.colStatus, colShirt = excluded.colShirt,
       spreadsheetTitle = COALESCE(excluded.spreadsheetTitle, sheet_configs.spreadsheetTitle)`,
  ).run({ ...c, colShirt: c.colShirt || null, spreadsheetTitle: c.spreadsheetTitle ?? null });
  if (c.spreadsheetTitle) setSpreadsheetTitle(db, c.spreadsheetId, c.spreadsheetTitle);
}

/** Cập nhật tên file cho mọi tab của cùng một sheet. */
export function setSpreadsheetTitle(db: DB, spreadsheetId: string, title: string): void {
  db.prepare("UPDATE sheet_configs SET spreadsheetTitle = ? WHERE spreadsheetId = ?").run(title, spreadsheetId);
}

/** Điền tên cho các sheet đã lưu từ trước khi có cột tên. Lỗi thì bỏ qua, lần sau thử lại. */
export async function fillMissingTitles(db: DB, getTitle: (spreadsheetId: string) => Promise<string>): Promise<void> {
  const ids = (
    db.prepare("SELECT DISTINCT spreadsheetId FROM sheet_configs WHERE spreadsheetTitle IS NULL").all() as {
      spreadsheetId: string;
    }[]
  ).map((r) => r.spreadsheetId);
  await Promise.all(
    ids.map(async (id) => {
      try {
        setSpreadsheetTitle(db, id, await getTitle(id));
      } catch {
        // không có quyền hoặc mất mạng: vẫn hiện bằng mã file
      }
    }),
  );
}

/** Gom các tab theo file sheet, giữ thứ tự của danh sách. */
export function groupBySheet(configs: SheetConfig[]): { spreadsheetId: string; name: string; tabs: SheetConfig[] }[] {
  const groups = new Map<string, { spreadsheetId: string; name: string; tabs: SheetConfig[] }>();
  for (const c of configs) {
    let g = groups.get(c.spreadsheetId);
    if (!g) groups.set(c.spreadsheetId, (g = { spreadsheetId: c.spreadsheetId, name: sheetName(c), tabs: [] }));
    g.tabs.push(c);
  }
  return [...groups.values()];
}
