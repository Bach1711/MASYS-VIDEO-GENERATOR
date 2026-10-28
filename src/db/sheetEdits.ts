import type { DB } from "./index.js";

/** Ô dữ liệu người dùng sửa được trên Bảng (D18). Không bao giờ có ô Video hay Trạng thái. */
export type EditField = "prompt" | "image" | "shirt";
export type EditKind = "edit" | "fill" | "add_row";

export const FIELD_TEXT: Record<EditField, string> = { prompt: "Prompt", image: "Ảnh người mẫu", shirt: "Ảnh áo" };
export const KIND_TEXT: Record<EditKind, string> = { edit: "Sửa ô", fill: "Dải prompt", add_row: "Thêm dòng" };

export interface CellEdit {
  cell: string;
  row: number;
  field: EditField;
  oldValue: string;
  newValue: string;
}

export interface SheetEditEntry extends CellEdit {
  id: number;
  at: string;
  spreadsheetId: string;
  tab: string;
  kind: EditKind;
}

/** Ghi nhật ký các ô vừa ghi lên sheet (ô, giá trị cũ, giá trị mới, giờ). */
export function recordSheetEdits(db: DB, spreadsheetId: string, tab: string, kind: EditKind, edits: CellEdit[]): void {
  const ins = db.prepare(
    "INSERT INTO sheet_edits (spreadsheetId, tab, cell, rowNumber, field, oldValue, newValue, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  db.transaction(() => {
    for (const e of edits) ins.run(spreadsheetId, tab, e.cell, e.row, e.field, e.oldValue, e.newValue, kind);
  })();
}

export function listSheetEdits(db: DB, limit = 300): SheetEditEntry[] {
  return db
    .prepare(
      `SELECT id, at, spreadsheetId, tab, cell, rowNumber AS row, field, oldValue, newValue, kind
       FROM sheet_edits ORDER BY id DESC LIMIT ?`,
    )
    .all(limit) as SheetEditEntry[];
}

/**
 * Giá trị cuối cùng tool ghi vào từng ô của tab từ thời điểm `since`. Bot dùng để không coi ô người dùng
 * vừa sửa trên Bảng là "Muse sửa ô khác" khi so bản chụp tab (F5 bước 6).
 */
export function toolWrittenCells(db: DB, spreadsheetId: string, tab: string, since: string): Map<string, string> {
  const rows = db
    .prepare("SELECT cell, newValue FROM sheet_edits WHERE spreadsheetId = ? AND tab = ? AND at >= ? ORDER BY id")
    .all(spreadsheetId, tab, since) as { cell: string; newValue: string }[];
  return new Map(rows.map((r) => [r.cell, r.newValue]));
}
