import type { DB } from "../db/index.js";
import type { ImageTemplateKind, Settings } from "../db/settings.js";
import { buildImageRequest } from "./request.js";
import { getRow, labelOf, lockedAnhRows, type AnhRow } from "./rows.js";

// Tạo lô từ Bảng ảnh (CON-77, spec 17.13, D31): mỗi dòng một lượt, một cuộc trò chuyện Muse mới, character sheet
// đính kèm là ảnh 1. Dòng tích Quay lưng: cùng lượt, tin thứ hai trong cùng cuộc trò chuyện (D33).

export const ANH_BATCH_TAB = "Bảng ảnh";

/** Dữ liệu dòng lúc bấm Tạo ảnh (runs.inputSnapshot): hàng đợi so lại trước khi gửi. */
export interface AnhSnapshot {
  nhanVatId: number;
  nhanVatFile: string;
  /** Ảnh mặt lúc bấm Tạo ảnh; null / không có (lượt của bản cũ) = chỉ gửi ảnh 4 góc. */
  nhanVatFaceFile?: string | null;
  prompt: string;
  back: boolean;
  /** Tin xin ảnh quay lưng; null = không tích Quay lưng. */
  backText: string | null;
}

export interface AnhPlannedRun {
  row: AnhRow;
  text: string;
  backText: string | null;
  /** Dòng đã có ảnh (tạo lại; ảnh cũ vẫn giữ). */
  again: boolean;
}

export interface AnhBatchPlan {
  runs: AnhPlannedRun[];
  rejected: { id: number; why: string }[];
  /** Số lượt ảnh lô này dùng (mỗi dòng 1, thêm 1 nếu tích Quay lưng). */
  turns: number;
}

/** Chọn dòng chạy được; dòng không có, đang tạo, thiếu dữ liệu, thiếu file character sheet thì loại kèm lý do. */
export function planAnhBatch(
  db: DB,
  ids: number[],
  s: Pick<Settings, ImageTemplateKind>,
  extra: string,
  sheetExists: (file: string) => boolean = () => true,
): AnhBatchPlan {
  const locked = lockedAnhRows(db);
  const runs: AnhPlannedRun[] = [];
  const rejected: { id: number; why: string }[] = [];
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const row = getRow(db, id);
    if (!row) {
      rejected.push({ id, why: "không có dòng này" });
      continue;
    }
    if (locked.has(id)) {
      rejected.push({ id, why: "đang tạo ảnh" });
      continue;
    }
    const { label, problems } = labelOf({ ...row, frontCount: 0, backCount: 0, runState: null });
    if (label === "missing_data") {
      rejected.push({ id, why: problems.join("; ") });
      continue;
    }
    if (!row.nhanVatFile || !sheetExists(row.nhanVatFile)) {
      rejected.push({ id, why: `không còn file character sheet của nhân vật ${row.nhanVatTen}: đổi file ở trang Nhân vật` });
      continue;
    }
    if (row.nhanVatFaceFile && !sheetExists(row.nhanVatFaceFile)) {
      rejected.push({ id, why: `không còn file ảnh mặt của nhân vật ${row.nhanVatTen}: đổi ảnh ở trang Nhân vật` });
      continue;
    }
    const req = buildImageRequest({ prompt: row.prompt, nhanVatTen: row.nhanVatTen!, backOn: !!row.backOn }, s, extra);
    runs.push({ row, text: req.text, backText: req.backText, again: row.frontCount > 0 });
  }
  return { runs, rejected, turns: runs.reduce((n, r) => n + (r.backText ? 2 : 1), 0) };
}

/** Ghi lô + các lượt (queued) trong một transaction. Chưa gọi bot. */
export function insertAnhBatch(db: DB, extra: string, runs: AnhPlannedRun[]): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, extraRequest, status, source) VALUES ('', ?, '', ?, 'queued', 'anh')")
      .run(ANH_BATCH_TAB, extra.trim() || null);
    const batchId = Number(lastInsertRowid);
    const insertRun = db.prepare(
      `INSERT INTO runs (batchId, rowNumber, anhRowId, inputSnapshot, promptSent, requestText, overwrite, state, anhPhase)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 'front')`,
    );
    const insertEvent = db.prepare("INSERT INTO run_events (runId, fromState, toState, message) VALUES (?, NULL, 'queued', ?)");
    for (const r of runs) {
      const snap: AnhSnapshot = {
        nhanVatId: r.row.nhanVatId!,
        nhanVatFile: r.row.nhanVatFile!,
        nhanVatFaceFile: r.row.nhanVatFaceFile,
        prompt: r.row.prompt.trim(),
        back: !!r.backText,
        backText: r.backText,
      };
      const { lastInsertRowid: runId } = insertRun.run(batchId, r.row.id, r.row.id, JSON.stringify(snap), r.row.prompt.trim(), r.text, r.again ? 1 : 0);
      insertEvent.run(runId, `Tạo lô #${batchId} từ Bảng ảnh, nhân vật ${r.row.nhanVatTen}${r.backText ? ", có ảnh quay lưng" : ""}${r.again ? " (tạo lại)" : ""}`);
    }
    return batchId;
  })();
}

/** Ước lượng thời gian lô ảnh: như video (17.9) nhưng mặc định 2 phút một ảnh khi chưa có số liệu. */
export function estimateAnhText(db: DB, turns: number, s: Pick<Settings, "pauseMinSec" | "pauseMaxSec" | "parallelVideos">): string {
  const rows = db
    .prepare("SELECT sentAt, doneAt FROM runs WHERE state = 'done' AND anhRowId IS NOT NULL AND sentAt IS NOT NULL AND doneAt IS NOT NULL ORDER BY id DESC LIMIT 20")
    .all() as { sentAt: string; doneAt: string }[];
  const mins = rows.map((r) => (Date.parse(r.doneAt) - Date.parse(r.sentAt)) / 60_000).filter((m) => m > 0 && m < 60);
  const perTurn = mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 2;
  const pause = (s.pauseMinSec + s.pauseMaxSec) / 2 / 60;
  const parallel = Math.max(1, s.parallelVideos || 1);
  const total = turns * Math.max((perTurn + pause) / parallel, pause + 0.5);
  if (total < 60) return `khoảng ${Math.max(1, Math.round(total))} phút`;
  return `khoảng ${String(Math.round((total / 60) * 2) / 2).replace(".", ",")} giờ`;
}
