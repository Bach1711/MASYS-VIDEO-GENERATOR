import type { DB } from "../db/index.js";
import type { SheetConfig } from "../db/sheetConfigs.js";
import type { ScannedRow } from "../scan/labels.js";
import {
  combineExtra,
  folderLink,
  renderTemplate,
  sheetLink,
  videoFileName,
  type TemplateValues,
} from "./template.js";

/** Trạng thái kết thúc của một lượt (spec §7); mọi trạng thái khác coi là còn đang xử lý. */
export const FINAL_RUN_STATES = ["done", "failed", "needs_review", "skipped_has_video", "canceled"] as const;

export interface RowEdit {
  prompt: string;
  extra: string;
}

export interface PlannedRun {
  row: number;
  overwrite: boolean;
  promptSent: string;
  extra: string;
  fileName: string;
  requestText: string;
  /** Ảnh và prompt gốc trong sheet lúc tạo lô — CON-40 dùng để phát hiện dòng bị đổi. */
  inputSnapshot: { image: string; prompt: string; video: string; status: string };
}

export interface BatchPlan {
  cfg: SheetConfig;
  sheetId: number;
  folderId: string;
  batchExtra: string;
  stamp: string;
  template: string;
  rows: ScannedRow[];
  edits: Map<number, RowEdit>;
}

/** Ghép yêu cầu gửi Muse cho từng dòng (§8.2). Prompt trống → báo lỗi, không ghép. */
export function planRuns(p: BatchPlan): { runs: PlannedRun[]; problems: string[] } {
  const runs: PlannedRun[] = [];
  const problems: string[] = [];
  for (const r of p.rows) {
    const edit = p.edits.get(r.row) ?? { prompt: r.prompt, extra: "" };
    const prompt = edit.prompt.trim();
    if (!prompt) {
      problems.push(`Prompt dòng ${r.row} đang trống.`);
      continue;
    }
    const fileName = videoFileName(p.cfg.tab, r.row, p.stamp);
    const values: TemplateValues = {
      link_anh: r.image,
      prompt,
      yeu_cau_them: combineExtra(p.batchExtra, edit.extra),
      link_thu_muc: folderLink(p.folderId),
      ten_file: fileName,
      o_video: `${p.cfg.colVideo}${r.row}`,
      ten_tab: p.cfg.tab,
      link_sheet: sheetLink(p.cfg.spreadsheetId, p.sheetId),
    };
    runs.push({
      row: r.row,
      overwrite: r.label === "has_video",
      promptSent: prompt,
      extra: edit.extra.trim(),
      fileName,
      requestText: renderTemplate(p.template, values),
      inputSnapshot: { image: r.image, prompt: r.prompt, video: r.video, status: r.status },
    });
  }
  return { runs, problems };
}

/** Các dòng của tab đang nằm trong một lượt chưa kết thúc (để không xếp một dòng vào hai lô). */
export function activeRows(db: DB, spreadsheetId: string, tab: string): Set<number> {
  const placeholders = FINAL_RUN_STATES.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT r.rowNumber AS row FROM runs r JOIN batches b ON b.id = r.batchId
       WHERE b.spreadsheetId = ? AND b.tab = ? AND r.state NOT IN (${placeholders})`,
    )
    .all(spreadsheetId, tab, ...FINAL_RUN_STATES) as { row: number }[];
  return new Set(rows.map((r) => r.row));
}

/** Ghi batch + runs (queued) + sự kiện tạo lượt trong một transaction. Chưa gọi bot. */
export function insertBatch(
  db: DB,
  b: { cfg: SheetConfig; folderId: string; batchExtra: string; runs: PlannedRun[] },
): number {
  return db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO batches (spreadsheetId, tab, driveFolderId, extraRequest, status) VALUES (?, ?, ?, ?, 'queued')")
      .run(b.cfg.spreadsheetId, b.cfg.tab, b.folderId, b.batchExtra.trim() || null);
    const batchId = Number(lastInsertRowid);
    const insertRun = db.prepare(
      `INSERT INTO runs (batchId, rowNumber, inputSnapshot, promptSent, requestText, overwrite, state)
       VALUES (?, ?, ?, ?, ?, ?, 'queued')`,
    );
    const insertEvent = db.prepare("INSERT INTO run_events (runId, fromState, toState, message) VALUES (?, NULL, 'queued', ?)");
    for (const r of b.runs) {
      const { lastInsertRowid: runId } = insertRun.run(
        batchId,
        r.row,
        JSON.stringify(r.inputSnapshot),
        r.promptSent,
        r.requestText,
        r.overwrite ? 1 : 0,
      );
      insertEvent.run(runId, `Tạo lô #${batchId}${r.overwrite ? " (ghi đè)" : ""}`);
    }
    return batchId;
  })();
}

export interface BatchView {
  id: number;
  spreadsheetId: string;
  tab: string;
  driveFolderId: string;
  extraRequest: string | null;
  status: string;
  createdAt: string;
  pauseReason: string | null;
  runs: {
    id: number;
    rowNumber: number;
    state: string;
    overwrite: number;
    promptSent: string;
    requestText: string;
    error: string | null;
    sentAt: string | null;
    doneAt: string | null;
    videoLink: string | null;
    museChatUrl: string | null;
  }[];
}

export function getBatch(db: DB, id: number): BatchView | undefined {
  const b = db.prepare("SELECT * FROM batches WHERE id = ?").get(id) as Omit<BatchView, "runs"> | undefined;
  if (!b) return undefined;
  const runs = db
    .prepare(
      `SELECT id, rowNumber, state, overwrite, promptSent, requestText, error, sentAt, doneAt, videoLink, museChatUrl
       FROM runs WHERE batchId = ? ORDER BY rowNumber`,
    )
    .all(id) as BatchView["runs"];
  return { ...b, runs };
}
