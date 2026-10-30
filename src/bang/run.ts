import type { DB } from "../db/index.js";
import type { BangTemplateKind, Settings } from "../db/settings.js";
import type { BangSnapshot } from "../queue/runner.js";
import { buildBangRequest, type BangRequest } from "./request.js";
import { getRow, labelOf, lockedBangRows, type BangRow } from "./rows.js";

// Tạo lô từ Bảng mới (CON-52, spec 17.5): mỗi dòng một lượt, ảnh đính kèm theo thứ tự 17.4.
// Lô của Bảng mới không có sheet / thư mục Drive (batches.source = 'bang').

export const BANG_BATCH_TAB = "Bảng mới";

export interface BangPlannedRun {
  row: BangRow;
  request: BangRequest;
  /** Dòng đã có video (tạo lại). */
  overwrite: boolean;
}

export interface BangBatchPlan {
  runs: BangPlannedRun[];
  rejected: { id: number; why: string }[];
}

/** Chọn dòng chạy được; dòng không có, đang chạy, thiếu dữ liệu thì loại kèm lý do. */
export function planBangBatch(db: DB, ids: number[], s: Pick<Settings, BangTemplateKind>, extra: string): BangBatchPlan {
  const locked = lockedBangRows(db);
  const runs: BangPlannedRun[] = [];
  const rejected: { id: number; why: string }[] = [];
  for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
    const row = getRow(db, id);
    if (!row) {
      rejected.push({ id, why: "không có dòng này" });
      continue;
    }
    if (locked.has(id)) {
      rejected.push({ id, why: "đang tạo video" });
      continue;
    }
    const req = buildBangRequest(row, s, extra);
    if ("problems" in req) rejected.push({ id, why: req.problems.join("; ") });
    else runs.push({ row, request: req, overwrite: labelOf(row).label === "done" });
  }
  return { runs, rejected };
}

/** Ghi lô + các lượt (queued) trong một transaction. Chưa gọi bot. */
export function insertBangBatch(db: DB, extra: string, runs: BangPlannedRun[]): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, extraRequest, status, source) VALUES ('', ?, '', ?, 'queued', 'bang')")
      .run(BANG_BATCH_TAB, extra.trim() || null);
    const batchId = Number(lastInsertRowid);
    const insertRun = db.prepare(
      `INSERT INTO runs (batchId, rowNumber, bangRowId, inputSnapshot, promptSent, requestText, overwrite, state)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'queued')`,
    );
    const insertEvent = db.prepare("INSERT INTO run_events (runId, fromState, toState, message) VALUES (?, NULL, 'queued', ?)");
    for (const r of runs) {
      const snap: BangSnapshot = { attachments: r.request.attachments.map((a) => a.name), prompt: r.row.prompt.trim() };
      const { lastInsertRowid: runId } = insertRun.run(
        batchId,
        r.row.id,
        r.row.id,
        JSON.stringify(snap),
        r.row.prompt.trim(),
        r.request.text,
        r.overwrite ? 1 : 0,
      );
      insertEvent.run(runId, `Tạo lô #${batchId} từ Bảng mới, ${snap.attachments.length} ảnh${r.overwrite ? " (tạo lại)" : ""}`);
    }
    return batchId;
  })();
}

/** Phút trung bình một lượt gần đây (gửi → xong, 20 lượt gần nhất); chưa có thì 5 phút. */
export function recentRunMinutes(db: DB): number {
  const rows = db
    .prepare("SELECT sentAt, doneAt FROM runs WHERE state = 'done' AND sentAt IS NOT NULL AND doneAt IS NOT NULL ORDER BY id DESC LIMIT 20")
    .all() as { sentAt: string; doneAt: string }[];
  const mins = rows.map((r) => (Date.parse(r.doneAt) - Date.parse(r.sentAt)) / 60_000).filter((m) => m > 0 && m < 120);
  return mins.length ? mins.reduce((a, b) => a + b, 0) / mins.length : 5;
}

/**
 * Ước lượng thời gian một lô (17.9): số dòng × (thời gian trung bình gần đây + nghỉ giữa hai lượt), chia cho số video
 * chạy cùng lúc (D28). Chạy song song vẫn phải nghỉ giữa hai lần gửi, nên mỗi dòng mất ít nhất một lần nghỉ.
 */
export function estimateText(db: DB, n: number, s: Pick<Settings, "pauseMinSec" | "pauseMaxSec"> & { parallelVideos?: number }): string {
  const pause = (s.pauseMinSec + s.pauseMaxSec) / 2 / 60;
  const parallel = Math.max(1, s.parallelVideos ?? 1);
  const perRow = parallel === 1 ? recentRunMinutes(db) + pause : Math.max((recentRunMinutes(db) + pause) / parallel, pause + 0.5);
  const total = n * perRow;
  if (total < 60) return `khoảng ${Math.max(1, Math.round(total))} phút`;
  const hours = Math.round((total / 60) * 2) / 2;
  return `khoảng ${String(hours).replace(".", ",")} giờ`;
}
