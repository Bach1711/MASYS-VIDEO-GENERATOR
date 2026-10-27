import type { DB } from "./index.js";

/**
 * Đổi trạng thái một lượt và ghi `run_events` trong cùng transaction (spec §7: ghi SQLite trước bước tiếp theo).
 * `extra`: các cột khác của `runs` cần ghi cùng lúc (sentAt, museChatUrl, error…).
 */
export function moveRun(
  db: DB,
  runId: number,
  from: string | null,
  to: string,
  message: string,
  extra: Record<string, unknown> = {},
  screenshot?: string,
): void {
  const sets = ["state = @to", ...Object.keys(extra).map((k) => `${k} = @${k}`)].join(", ");
  db.transaction(() => {
    db.prepare(`UPDATE runs SET ${sets} WHERE id = @id`).run({ id: runId, to, ...extra });
    db.prepare("INSERT INTO run_events (runId, fromState, toState, message, screenshotPath) VALUES (?, ?, ?, ?, ?)").run(
      runId,
      from,
      to,
      message,
      screenshot ?? null,
    );
  })();
}

/** Ghi một dòng nhật ký mà không đổi trạng thái. */
export function logRunEvent(db: DB, runId: number, state: string, message: string, screenshot?: string): void {
  db.prepare("INSERT INTO run_events (runId, fromState, toState, message, screenshotPath) VALUES (?, ?, ?, ?, ?)").run(
    runId,
    state,
    state,
    message,
    screenshot ?? null,
  );
}
