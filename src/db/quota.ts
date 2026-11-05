import type { DB } from "./index.js";

/** Nửa đêm hôm nay và hôm sau theo giờ máy, dạng ISO UTC (cùng định dạng runs.sentAt). */
export function localDayBounds(now: Date): { start: string; end: string } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export interface DailyQuota {
  used: number;
  limit: number;
  remaining: number;
}

/**
 * D13: đếm các lượt đã gửi Muse trong ngày theo giờ máy, kể cả lượt lỗi
 * (mọi run có sentAt; sentAt ghi bằng Date.toISOString()). Lần thất bại đã gửi rồi chạy lại vẫn tính lượt (CON-91).
 */
export function getDailyQuota(db: DB, now = new Date()): DailyQuota {
  const { start, end } = localDayBounds(now);
  // Lượt của Bảng ảnh (CON-77, D31) và Tạo nhân vật (CON-81, D35) đếm riêng, không trừ vào giới hạn video.
  const { used } = db
    .prepare("SELECT COUNT(*) AS used FROM runs WHERE sentAt IS NOT NULL AND sentAt >= ? AND sentAt < ? AND anhRowId IS NULL AND nvDraftId IS NULL")
    .get(start, end) as { used: number };
  const { extra } = db
    .prepare("SELECT COALESCE(SUM(extraSends), 0) AS extra FROM runs WHERE extraSentAt IS NOT NULL AND extraSentAt >= ? AND extraSentAt < ?")
    .get(start, end) as { extra: number };
  const { dailyVideoLimit: limit } = db.prepare("SELECT dailyVideoLimit FROM settings WHERE id = 1").get() as {
    dailyVideoLimit: number;
  };
  const total = used + extra;
  return { used: total, limit, remaining: Math.max(0, limit - total) };
}

/**
 * Giới hạn ảnh mỗi ngày của Bảng ảnh (CON-77, D31): mỗi lần gửi Muse một tin xin ảnh là một lượt, kể cả tin xin ảnh
 * quay lưng (anhBackAt), lượt Tạo nhân vật (CON-81) và lượt lỗi. Đếm riêng với video.
 */
export function getImageQuota(db: DB, now = new Date()): DailyQuota {
  const { start, end } = localDayBounds(now);
  const { used } = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM runs WHERE (anhRowId IS NOT NULL OR nvDraftId IS NOT NULL) AND sentAt IS NOT NULL AND sentAt >= @start AND sentAt < @end)
            + (SELECT COUNT(*) FROM runs WHERE anhRowId IS NOT NULL AND anhBackAt IS NOT NULL AND anhBackAt >= @start AND anhBackAt < @end) AS used`,
    )
    .get({ start, end }) as { used: number };
  const { dailyImageLimit: limit } = db.prepare("SELECT dailyImageLimit FROM settings WHERE id = 1").get() as { dailyImageLimit: number };
  return { used, limit, remaining: Math.max(0, limit - used) };
}
