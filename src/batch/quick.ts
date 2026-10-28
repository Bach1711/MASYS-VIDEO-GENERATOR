import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { getSettings } from "../db/settings.js";
import type { SheetConfig } from "../db/sheetConfigs.js";
import type { DriveClient } from "../google/drive.js";
import { describeGoogleError } from "../google/errors.js";
import { normalizeHeader } from "../google/mapping.js";
import type { SheetsClient } from "../google/sheets.js";
import type { ScannedRow } from "../scan/labels.js";
import { scanTab } from "../scan/scan.js";
import { activeRows, insertBatch, planRuns, type PlannedRun } from "./create.js";
import { checkSelection } from "./selection.js";
import { DEFAULT_SHIRT_TEMPLATE, DEFAULT_TEMPLATE, fileStamp, validateShirtTemplate, validateTemplate } from "./template.js";

// Tạo lô bằng một nút trên Bảng (spec v5.0 D19): dùng mặc định — thư mục Drive gốc (thư mục con "video" nếu có),
// mẫu yêu cầu và đoạn ghép áo trong Cài đặt, prompt đúng như trong sheet. Mọi kiểm tra của trang Chuẩn bị lô giữ nguyên.

export interface QuickDeps {
  db: DB;
  sheets: SheetsClient;
  drive: DriveClient;
  clientEmail: string;
}

export type QuickResult =
  | { ok: true; batchId: number; runs: PlannedRun[]; rejected: { row: number; why: string }[]; scanned: ScannedRow[] }
  | { ok: false; message: string };

/** Thư mục lưu video mặc định: thư mục con tên "video" trong thư mục gốc, không có thì chính thư mục gốc. */
export async function defaultFolderId(drive: DriveClient, rootId: string): Promise<string> {
  const subs = await drive.listFolders(rootId);
  const video = subs.find((s) => normalizeHeader(s.name) === "video");
  return video?.id ?? (await drive.getFolder(rootId)).id;
}

/** Ghép yêu cầu gửi Muse cho các dòng (dùng cho Tạo video và cho Xem yêu cầu từng dòng). */
export async function planForRows(
  deps: QuickDeps,
  cfg: SheetConfig,
  rows: ScannedRow[],
): Promise<{ ok: true; runs: PlannedRun[]; folderId: string } | { ok: false; message: string }> {
  const { db, sheets, drive, clientEmail } = deps;
  const settings = getSettings(db);
  if (!settings.driveRootFolderId) {
    return { ok: false, message: "Chưa đặt thư mục Drive lưu video. Vào ⚙ Nâng cao → Cài đặt → Thư mục Drive gốc." };
  }
  const template = settings.requestTemplate ?? DEFAULT_TEMPLATE;
  const templateProblems = validateTemplate(template);
  if (templateProblems.length) return { ok: false, message: `Mẫu yêu cầu đang lỗi (sửa ở Cài đặt): ${templateProblems.join(" ")}` };
  const shirtTemplate = settings.shirtTemplate ?? DEFAULT_SHIRT_TEMPLATE;
  if (rows.some((r) => r.shirt)) {
    const shirtProblems = validateShirtTemplate(shirtTemplate);
    if (shirtProblems.length) return { ok: false, message: `Đoạn ghép áo đang lỗi (sửa ở Cài đặt): ${shirtProblems.join(" ")}` };
  }
  let folderId: string;
  let sheetId: number | undefined;
  try {
    folderId = await defaultFolderId(drive, settings.driveRootFolderId);
    sheetId = (await sheets.getSpreadsheet(cfg.spreadsheetId)).tabs.find((t) => t.title === cfg.tab)?.sheetId;
  } catch (e) {
    return { ok: false, message: describeGoogleError(e, clientEmail) };
  }
  if (sheetId === undefined) return { ok: false, message: `Không còn trang tính "${cfg.tab}" trong file.` };
  const plan = planRuns({ cfg, sheetId, folderId, batchExtra: "", stamp: fileStamp(new Date()), template, shirtTemplate, rows, edits: new Map() });
  if (plan.problems.length) return { ok: false, message: plan.problems.join(" ") };
  return { ok: true, runs: plan.runs, folderId };
}

/** Quét lại, kiểm tra lựa chọn, giới hạn ngày, rồi tạo lô (chưa chạy). */
export async function quickCreateBatch(deps: QuickDeps, cfg: SheetConfig, selected: number[], overwrite: Set<number>): Promise<QuickResult> {
  const { db, sheets, drive, clientEmail } = deps;
  if (selected.length === 0) return { ok: false, message: "Chưa chọn dòng nào." };
  const quota = getDailyQuota(db);
  if (selected.length > quota.remaining) {
    return { ok: false, message: `Đã chọn ${selected.length} dòng nhưng hôm nay chỉ còn ${quota.remaining} video (giới hạn ${quota.limit}/ngày).` };
  }
  let scanned: ScannedRow[];
  try {
    scanned = (await scanTab(sheets, drive, cfg)).rows;
  } catch (e) {
    return { ok: false, message: describeGoogleError(e, clientEmail) };
  }
  // Dữ liệu sheet có thể vừa đổi sau khi trang được vẽ: chỉ nhận dòng vẫn chạy được.
  const sel = checkSelection(scanned, selected, overwrite);
  const busy = activeRows(db, cfg.spreadsheetId, cfg.tab);
  const rows = sel.accepted.filter((r) => !busy.has(r.row));
  const rejected = [
    ...sel.rejected,
    ...sel.accepted.filter((r) => busy.has(r.row)).map((r) => ({ row: r.row, why: "đang nằm trong một lô chưa chạy xong" })),
  ].sort((a, b) => a.row - b.row);
  if (rows.length === 0) {
    return { ok: false, message: `Không còn dòng nào chạy được: ${rejected.map((r) => `dòng ${r.row} (${r.why})`).join("; ")}.` };
  }
  const plan = await planForRows(deps, cfg, rows);
  if (!plan.ok) return plan;
  const batchId = insertBatch(db, { cfg, folderId: plan.folderId, batchExtra: "", runs: plan.runs });
  return { ok: true, batchId, runs: plan.runs, rejected, scanned };
}
