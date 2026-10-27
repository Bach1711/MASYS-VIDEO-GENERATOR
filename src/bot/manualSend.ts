import type { DB } from "../db/index.js";
import { getDailyQuota } from "../db/quota.js";
import { moveRun } from "../db/runs.js";
import { logger } from "../logger.js";
import { BotError, stripQuery, type MuseBot } from "./museBot.js";

// Gửi thử một lượt bằng tay (CON-39). Hàng đợi tự chạy và theo dõi ô Video làm ở CON-40.

export const MANUAL_NOTE = "Gửi thử bằng tay (CON-39), tool chưa theo dõi ô Video";

export interface QueuedRun {
  id: number;
  batchId: number;
  rowNumber: number;
  spreadsheetId: string;
  tab: string;
  promptSent: string;
}

export function listQueuedRuns(db: DB): QueuedRun[] {
  return db
    .prepare(
      `SELECT r.id, r.batchId, r.rowNumber, b.spreadsheetId, b.tab, r.promptSent
       FROM runs r JOIN batches b ON b.id = r.batchId WHERE r.state = 'queued' ORDER BY r.batchId, r.rowNumber`,
    )
    .all() as QueuedRun[];
}

export type ManualSendResult =
  | { ok: true; chatUrl: string }
  | { ok: false; message: string; sent: boolean; screenshot?: string };

export async function manualSend(db: DB, bot: MuseBot, runId: number, now = new Date()): Promise<ManualSendResult> {
  const run = db.prepare("SELECT id, state, requestText FROM runs WHERE id = ?").get(runId) as
    | { id: number; state: string; requestText: string | null }
    | undefined;
  if (!run || run.state !== "queued" || !run.requestText) return { ok: false, message: "Lượt này không còn ở trạng thái Chờ chạy.", sent: false };
  if (getDailyQuota(db, now).remaining <= 0) return { ok: false, message: "Hôm nay đã đủ giới hạn video (D13).", sent: false };

  // Đánh dấu đang gửi trước khi bấm Gửi: tool tắt giữa chừng thì lượt vẫn hiện là đã gửi (D9).
  moveRun(db, runId, "queued", "sending", "Bắt đầu gửi thử bằng tay", { sentAt: now.toISOString() });
  try {
    const { chatUrl } = await bot.send(run.requestText);
    moveRun(db, runId, "sending", "needs_review", `Đã gửi Muse. ${MANUAL_NOTE}`, { museChatUrl: chatUrl, error: MANUAL_NOTE });
    logger.info({ runId, chatUrl: stripQuery(chatUrl) }, "Gửi thử thành công");
    return { ok: true, chatUrl };
  } catch (e) {
    const err = e instanceof BotError ? e : new BotError("send_unconfirmed", "Lỗi không rõ khi gửi", true);
    if (!err.sent) {
      // Chưa bấm Gửi: trả lượt về Chờ chạy, không tính vào giới hạn ngày.
      moveRun(db, runId, "sending", "queued", `Chưa gửi: ${err.message}`, { sentAt: null }, err.screenshot);
    } else {
      moveRun(db, runId, "sending", "needs_review", `${err.message}. Không tự gửi lại (D9)`, { error: err.message }, err.screenshot);
    }
    logger.warn({ runId, code: err.code, sent: err.sent, err: e instanceof BotError ? undefined : e }, "Gửi thử không thành công");
    return { ok: false, message: err.message, sent: err.sent, screenshot: err.screenshot };
  }
}
