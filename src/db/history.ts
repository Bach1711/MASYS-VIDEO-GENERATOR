import type { DB } from "./index.js";

/** Một dòng của trang Lịch sử lô (F6). */
export interface BatchSummary {
  id: number;
  spreadsheetId: string;
  tab: string;
  status: string;
  pauseReason: string | null;
  extraRequest: string | null;
  createdAt: string;
  total: number;
  done: number;
  failed: number;
  needsReview: number;
  skipped: number;
  canceled: number;
  lastSentAt: string | null;
}

export function listBatches(db: DB): BatchSummary[] {
  return db
    .prepare(
      `SELECT b.id, b.spreadsheetId, b.tab, b.status, b.pauseReason, b.extraRequest, b.createdAt,
              COUNT(r.id) AS total,
              COALESCE(SUM(r.state = 'done'), 0) AS done,
              COALESCE(SUM(r.state = 'failed'), 0) AS failed,
              COALESCE(SUM(r.state = 'needs_review'), 0) AS needsReview,
              COALESCE(SUM(r.state = 'skipped_has_video'), 0) AS skipped,
              COALESCE(SUM(r.state = 'canceled'), 0) AS canceled,
              MAX(r.sentAt) AS lastSentAt
       FROM batches b LEFT JOIN runs r ON r.batchId = b.id
       GROUP BY b.id ORDER BY b.id DESC`,
    )
    .all() as BatchSummary[];
}

/** Lô đang chạy hoặc tạm dừng mới nhất — hiện ở dải báo trên đầu mọi trang. */
export function activeBatch(db: DB): { id: number; status: string; pauseReason: string | null } | undefined {
  return db
    .prepare("SELECT id, status, pauseReason FROM batches WHERE status IN ('running', 'paused') ORDER BY (status = 'running') DESC, id DESC LIMIT 1")
    .get() as { id: number; status: string; pauseReason: string | null } | undefined;
}

export interface LogEntry {
  id: number;
  at: string;
  batchId: number;
  rowNumber: number;
  toState: string;
  message: string;
  screenshotPath: string | null;
}

/** Trạng thái được coi là lỗi / cần xem trong Nhật ký. */
export const PROBLEM_STATES = ["failed", "needs_review", "paused_login", "paused_ui", "paused_quota", "paused_limit"];

/** Nhật ký từ run_events. Mặc định chỉ lỗi / cần xem / có ảnh chụp; `all` lấy hết. */
export function listLogs(db: DB, o: { all?: boolean; batchId?: number; limit?: number } = {}): LogEntry[] {
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (!o.all) {
    where.push(`(e.toState IN (${PROBLEM_STATES.map(() => "?").join(", ")}) OR e.screenshotPath IS NOT NULL)`);
    args.push(...PROBLEM_STATES);
  }
  if (o.batchId !== undefined) {
    where.push("r.batchId = ?");
    args.push(o.batchId);
  }
  args.push(o.limit ?? 300);
  return db
    .prepare(
      `SELECT e.id, e.at, r.batchId, r.rowNumber, e.toState, e.message, e.screenshotPath
       FROM run_events e JOIN runs r ON r.id = e.runId
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY e.id DESC LIMIT ?`,
    )
    .all(...args) as LogEntry[];
}
