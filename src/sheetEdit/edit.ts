import type { DB } from "../db/index.js";
import { recordSheetEdits, type CellEdit, type EditField } from "../db/sheetEdits.js";
import type { SheetConfig } from "../db/sheetConfigs.js";
import { parseDriveLink, type DriveClient } from "../google/drive.js";
import { GoogleApiError } from "../google/http.js";
import type { SheetsClient } from "../google/sheets.js";
import { labelRows, type ScannedRow } from "../scan/labels.js";
import { checkImageFile } from "../scan/scan.js";

// Sửa ngay trên Bảng (spec v5.0 mục 16.3, D18): ghi ô Prompt / Ảnh người mẫu / Ảnh áo lên sheet,
// dải prompt, thêm dòng ở cuối. Trước khi ghi luôn đọc lại ô; ô đã bị người khác đổi thì không ghi.

export interface EditDeps {
  db: DB;
  sheets: SheetsClient;
  drive: DriveClient;
}

export const CONFLICT_TEXT = "Ô này vừa được người khác sửa";
const FORMULA_TEXT = "Ô này đang là công thức trong sheet; sửa trực tiếp trên Google Sheet để không mất công thức.";
const FINAL_STATES = ["done", "failed", "needs_review", "skipped_has_video", "canceled"];

export function fieldColumn(cfg: SheetConfig, field: EditField): string | undefined {
  if (field === "prompt") return cfg.colPrompt;
  if (field === "image") return cfg.colImage;
  return cfg.colShirt || undefined;
}

export function isEditField(v: unknown): v is EditField {
  return v === "prompt" || v === "image" || v === "shirt";
}

/** Dòng đang trong lô (từ lúc bấm Tạo video tới khi lượt của dòng đó xong): khoá sửa. */
export function lockedRows(db: DB, spreadsheetId: string, tab: string): Set<number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT r.rowNumber AS row FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE b.spreadsheetId = ? AND b.tab = ? AND b.status IN ('queued', 'running', 'paused')
         AND r.state NOT IN (${FINAL_STATES.map(() => "?").join(", ")})`,
    )
    .all(spreadsheetId, tab, ...FINAL_STATES) as { row: number }[];
  return new Set(rows.map((r) => r.row));
}

/** Bỏ khoảng trắng hai đầu, đổi xuống dòng kiểu Windows về một ký tự. */
function clean(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

/** Kiểm tra link ảnh như F3 (link file Drive, service account mở được, là ảnh). null = được; ô trống cũng được. */
export async function checkImageLink(drive: DriveClient, value: string, what: string): Promise<string | null> {
  const link = parseDriveLink(value);
  if (!link) return null;
  if (link.kind === "not_drive") return `Link ${what} không phải link Google Drive.`;
  if (link.kind === "folder") return `Link ${what} là thư mục, cần link tới file ảnh.`;
  try {
    const check = checkImageFile(await drive.getFile(link.id));
    return check.ok ? null : `${check.reason}.`;
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 403 || e.status === 404)) {
      return `Tool không mở được ${what}: file chưa chia sẻ (đặt "Bất kỳ ai có đường liên kết" hoặc chia sẻ cho tool) hoặc đã bị xoá.`;
    }
    throw e;
  }
}

/** Dòng đang chạy ở nơi khác (ô Trạng thái) hoặc đang trong lô của tool. */
function rowBusy(r: ScannedRow | undefined, locked: Set<number>, row: number): boolean {
  return locked.has(row) || r?.label === "running";
}

async function readRows(sheets: SheetsClient, cfg: SheetConfig): Promise<{ grid: string[][]; rows: ScannedRow[] }> {
  const grid = await sheets.readTab(cfg.spreadsheetId, cfg.tab);
  return { grid, rows: labelRows(grid, cfg, new Map()) };
}

export type EditResult =
  | { ok: true; changed: boolean }
  | { ok: false; conflict: true; current: string; message: string }
  | { ok: false; conflict?: false; message: string };

/**
 * Sửa một ô. `expected` là giá trị người dùng thấy lúc bắt đầu sửa: sheet đã khác thì không ghi,
 * trả về giá trị mới để hiện lại.
 */
export async function editCell(
  deps: EditDeps,
  cfg: SheetConfig,
  input: { row: number; field: EditField; expected: string; value: string },
): Promise<EditResult> {
  const col = fieldColumn(cfg, input.field);
  if (!col) return { ok: false, message: "Trang tính này chưa có cột Ảnh áo (đặt ở ⚙ Nâng cao → Kết nối sheet)." };
  if (!Number.isInteger(input.row) || input.row <= cfg.headerRow) return { ok: false, message: "Dòng không hợp lệ." };
  const value = clean(input.value);
  const expected = input.expected.trim();
  if (value === expected) return { ok: true, changed: false };

  const { rows } = await readRows(deps.sheets, cfg);
  if (rowBusy(rows.find((r) => r.row === input.row), lockedRows(deps.db, cfg.spreadsheetId, cfg.tab), input.row)) {
    return { ok: false, message: `Dòng ${input.row} đang tạo video, chưa sửa được. Đợi dòng này xong rồi sửa.` };
  }
  if (input.field !== "prompt") {
    const problem = await checkImageLink(deps.drive, value, input.field === "image" ? "ảnh người mẫu" : "ảnh áo");
    if (problem) return { ok: false, message: problem };
  }

  const [current = ""] = await deps.sheets.readCells(cfg.spreadsheetId, cfg.tab, [{ col, row: input.row }]);
  if (current.startsWith("=")) return { ok: false, message: FORMULA_TEXT };
  if (current.trim() !== expected) {
    return { ok: false, conflict: true, current, message: `${CONFLICT_TEXT}. Giá trị mới trên sheet đang hiện trong ô; bấm Lưu lần nữa để ghi nội dung của bạn đè lên.` };
  }
  await deps.sheets.writeDataCells(cfg, [{ col, row: input.row, value }]);
  recordSheetEdits(deps.db, cfg.spreadsheetId, cfg.tab, "edit", [
    { cell: `${col}${input.row}`, row: input.row, field: input.field, oldValue: current, newValue: value },
  ]);
  return { ok: true, changed: true };
}

/** "3-6, 9" → [3, 4, 5, 6, 9]. Trả về null khi sai cú pháp. */
export function parseRowList(text: string): number[] | null {
  const out = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (b < a || b - a > 5000) return null;
    for (let n = a; n <= b; n++) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

export interface FillInput {
  source: number;
  /** "rows": các dòng trong `rows`; "down": mọi dòng dữ liệu bên dưới dòng nguồn. */
  mode: "rows" | "down";
  rows?: number[];
  /** Thay cả dòng đã có video (mặc định bỏ qua). */
  includeVideo?: boolean;
}

export interface FillPlan {
  prompt: string;
  targets: { row: number; old: string }[];
  skipped: { row: number; why: string }[];
}

/** Dải prompt, bước xem trước: dòng nào sẽ bị thay, dòng nào bỏ qua và vì sao. Chưa ghi gì. */
export async function planFill(deps: EditDeps, cfg: SheetConfig, input: FillInput): Promise<{ ok: true; plan: FillPlan } | { ok: false; message: string }> {
  const { rows } = await readRows(deps.sheets, cfg);
  const src = rows.find((r) => r.row === input.source);
  if (!src?.prompt) return { ok: false, message: `Dòng ${input.source} chưa có prompt để dải.` };
  const locked = lockedRows(deps.db, cfg.spreadsheetId, cfg.tab);
  const byRow = new Map(rows.map((r) => [r.row, r]));

  let wanted: number[];
  if (input.mode === "down") wanted = rows.filter((r) => r.row > input.source).map((r) => r.row);
  else wanted = (input.rows ?? []).filter((n) => n !== input.source);
  if (wanted.length === 0) {
    return { ok: false, message: input.mode === "down" ? `Không có dòng nào bên dưới dòng ${input.source}.` : "Chưa chọn dòng nào để áp prompt." };
  }

  const plan: FillPlan = { prompt: src.prompt, targets: [], skipped: [] };
  for (const n of wanted) {
    const r = byRow.get(n);
    if (n <= cfg.headerRow) plan.skipped.push({ row: n, why: "dòng tiêu đề" });
    else if (!r) plan.skipped.push({ row: n, why: "dòng trống (dùng Thêm dòng)" });
    else if (rowBusy(r, locked, n)) plan.skipped.push({ row: n, why: "đang tạo video" });
    else if (r.label === "has_video" && !input.includeVideo) plan.skipped.push({ row: n, why: "đã có video" });
    else if (r.prompt === src.prompt) plan.skipped.push({ row: n, why: "đã cùng prompt" });
    else plan.targets.push({ row: n, old: r.prompt });
  }
  return { ok: true, plan };
}

export interface FillResult {
  written: number[];
  conflicts: { row: number; current: string }[];
  skipped: { row: number; why: string }[];
}

/**
 * Dải prompt, bước ghi: chỉ những dòng người dùng vừa xác nhận. Mỗi ô đọc lại trước khi ghi:
 * khác giá trị lúc xem trước (người khác vừa sửa) hoặc là công thức thì bỏ qua, các ô còn lại ghi một lần.
 */
export async function applyFill(deps: EditDeps, cfg: SheetConfig, input: { prompt: string; targets: { row: number; old: string }[] }): Promise<FillResult> {
  const prompt = clean(input.prompt);
  const out: FillResult = { written: [], conflicts: [], skipped: [] };
  if (!prompt) throw new Error("Prompt nguồn đang trống.");
  const targets = input.targets.filter((t) => Number.isInteger(t.row) && t.row > cfg.headerRow);
  if (targets.length === 0) return out;

  const { rows } = await readRows(deps.sheets, cfg);
  const byRow = new Map(rows.map((r) => [r.row, r]));
  const locked = lockedRows(deps.db, cfg.spreadsheetId, cfg.tab);
  const current = await deps.sheets.readCells(cfg.spreadsheetId, cfg.tab, targets.map((t) => ({ col: cfg.colPrompt, row: t.row })));
  const edits: CellEdit[] = [];
  targets.forEach((t, i) => {
    const now = current[i] ?? "";
    if (rowBusy(byRow.get(t.row), locked, t.row)) out.skipped.push({ row: t.row, why: "đang tạo video" });
    else if (now.startsWith("=")) out.skipped.push({ row: t.row, why: "ô prompt là công thức" });
    else if (now.trim() !== t.old.trim()) out.conflicts.push({ row: t.row, current: now });
    else edits.push({ cell: `${cfg.colPrompt}${t.row}`, row: t.row, field: "prompt", oldValue: now, newValue: prompt });
  });
  if (edits.length) {
    await deps.sheets.writeDataCells(cfg, edits.map((e) => ({ col: cfg.colPrompt, row: e.row, value: prompt })));
    recordSheetEdits(deps.db, cfg.spreadsheetId, cfg.tab, "fill", edits);
    out.written = edits.map((e) => e.row);
  }
  return out;
}

export type AddRowResult = { ok: true; row: number } | { ok: false; message: string };

/**
 * Thêm dòng: ghi vào dòng trống đầu tiên SAU dòng có dữ liệu cuối cùng của tab (không chèn giữa, D18).
 * Dòng đó phải còn trống ngay trước khi ghi.
 */
export async function addRow(deps: EditDeps, cfg: SheetConfig, input: Partial<Record<EditField, string>>): Promise<AddRowResult> {
  const values: { field: EditField; col: string; value: string }[] = [];
  for (const field of ["image", "shirt", "prompt"] as const) {
    const value = clean(input[field] ?? "");
    if (!value) continue;
    const col = fieldColumn(cfg, field);
    if (!col) return { ok: false, message: "Trang tính này chưa có cột Ảnh áo (đặt ở ⚙ Nâng cao → Kết nối sheet)." };
    values.push({ field, col, value });
  }
  if (values.length === 0) return { ok: false, message: "Điền ít nhất một ô (ảnh người mẫu, ảnh áo hoặc prompt)." };
  for (const v of values) {
    if (v.field === "prompt") continue;
    const problem = await checkImageLink(deps.drive, v.value, v.field === "image" ? "ảnh người mẫu" : "ảnh áo");
    if (problem) return { ok: false, message: problem };
  }

  // Google bỏ các dòng trống ở cuối khi đọc tab, nên độ dài lưới là dòng có dữ liệu cuối cùng (ở bất kỳ cột nào).
  const grid = await deps.sheets.readTab(cfg.spreadsheetId, cfg.tab);
  const row = Math.max(grid.length, cfg.headerRow) + 1;
  await deps.sheets.ensureRows(cfg.spreadsheetId, cfg.tab, row);
  const again = await deps.sheets.readRow(cfg.spreadsheetId, cfg.tab, row, "FORMULA");
  if (again.some((x) => x !== "")) return { ok: false, message: "Sheet vừa có người thêm dòng. Bấm Thêm lần nữa." };

  await deps.sheets.writeDataCells(cfg, values.map((v) => ({ col: v.col, row, value: v.value })));
  recordSheetEdits(
    deps.db,
    cfg.spreadsheetId,
    cfg.tab,
    "add_row",
    values.map((v) => ({ cell: `${v.col}${row}`, row, field: v.field, oldValue: "", newValue: v.value })),
  );
  return { ok: true, row };
}

